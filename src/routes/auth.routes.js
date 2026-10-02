const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const auth = require('../middlewares/auth');
const audit = require('../services/audit');
const emailUtils = require('../utils/email');
const { normalizeGoogleAvatarUrl } = require('../utils/avatar');
const googleAuth = require('../services/google_auth');

// Rate limiting maps for local login
const loginFailuresByUsername = new Map();
const loginFailuresByIp = new Map();
const FIFTEEN_MINUTES = 15 * 60 * 1000;

function cleanOldFailures(map, windowMs) {
    const now = Date.now();
    for (const [key, timestamps] of map.entries()) {
        const active = timestamps.filter(t => now - t < windowMs);
        if (active.length === 0) {
            map.delete(key);
        } else {
            map.set(key, active);
        }
    }
}

function recordFailure(map, key) {
    if (!map.has(key)) {
        map.set(key, []);
    }
    map.get(key).push(Date.now());
}

function getFailureCount(map, key, windowMs) {
    const timestamps = map.get(key);
    if (!timestamps) return 0;
    const now = Date.now();
    return timestamps.filter(t => now - t < windowMs).length;
}

function resetFailures(username, ip) {
    loginFailuresByUsername.delete(username);
    loginFailuresByIp.delete(ip);
}

// Reset rate limiters helper
router.resetLoginRateLimiters = function() {
    loginFailuresByUsername.clear();
    loginFailuresByIp.clear();
};

router.post('/test/reset-rate-limiters', (req, res) => {
    router.resetLoginRateLimiters();
    res.json({ ok: true });
});

// GET /api/auth/quick-switch: Tiện ích chuyển đổi vai trò theo phân cấp quản trị (Chỉ dành cho tài khoản đã đăng nhập)
router.get('/quick-switch', async (req, res) => {
    try {
        const currentSessionUser = req.session ? req.session.user : null;
        const originalRole = req.session ? (req.session.original_role || (currentSessionUser ? currentSessionUser.role : null)) : null;

        // 0. BẮT BUỘC PHẢI ĐÃ ĐĂNG NHẬP: Tuyệt đối không cho phép bypass đăng nhập khi chưa có phiên làm việc
        if (!currentSessionUser) {
            return res.status(401).send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 60px;">
                    <h2 style="color: #ef4444;">⛔ Yêu cầu đăng nhập</h2>
                    <p style="color: #4b5563;">Bạn phải đăng nhập bằng tài khoản chính thức đã được quản trị viên phê duyệt trước khi sử dụng hệ thống.</p>
                    <p><a href="/#login" style="color: #6366f1; text-decoration: none; font-weight: 600;">Đến trang Đăng Nhập</a></p>
                </div>
            `);
        }

        // 1. Phân cấp: Tài khoản Trưởng Vùng thực tế TUYỆT ĐỐI KHÔNG ĐƯỢC chuyển đổi vai trò
        if (currentSessionUser && currentSessionUser.role === 'region_leader' && (!req.session || !req.session.original_role)) {
            return res.status(403).send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 60px;">
                    <h2 style="color: #ef4444;">⛔ Quyền truy cập bị từ chối</h2>
                    <p style="color: #4b5563;">Tài khoản Trưởng Vùng không có quyền chuyển đổi vai trò.</p>
                    <p><a href="/#panel-region-workspace" style="color: #6366f1; text-decoration: none; font-weight: 600;">Quay lại Điều Hành Vùng</a></p>
                </div>
            `);
        }

        const target = (req.query.user || '').toLowerCase().trim();
        if (!target) return res.redirect('/#login');

        // Tìm user mục tiêu
        let user = await db.get('SELECT * FROM users WHERE username = ?', [target]);
        if (!user) {
            if (target === 'cluster' || target === 'cum5') {
                user = await db.get('SELECT * FROM users WHERE role = "cluster_leader" LIMIT 1');
            } else if (target === 'admin') {
                user = await db.get('SELECT * FROM users WHERE role = "admin" LIMIT 1');
            }
        }
        if (!user || user.approval_status !== 'approved' || user.is_active !== 1) {
            return res.status(403).send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 60px;">
                    <h2 style="color: #ef4444;">⛔ Tài khoản không khả dụng</h2>
                    <p style="color: #4b5563;">Tài khoản này chưa được Quản trị viên (Admin) phê duyệt hoặc đã bị khóa.</p>
                    <p><a href="/#login" style="color: #6366f1; text-decoration: none; font-weight: 600;">Quay lại Đăng Nhập</a></p>
                </div>
            `);
        }

        // 2. Phân cấp: Trưởng Cụm 5 TUYỆT ĐỐI KHÔNG ĐƯỢC chuyển lên Admin
        if (originalRole === 'cluster_leader' && user.role === 'admin') {
            return res.status(403).send(`
                <div style="font-family: sans-serif; text-align: center; margin-top: 60px;">
                    <h2 style="color: #ef4444;">⛔ Quyền truy cập bị từ chối</h2>
                    <p style="color: #4b5563;">Trưởng Cụm 5 chỉ có quyền chuyển đổi sang các Vùng trực thuộc, không có quyền chuyển lên Quản Trị Viên (Admin).</p>
                    <p><a href="/#panel-cluster-workspace" style="color: #6366f1; text-decoration: none; font-weight: 600;">Quay lại Điều Hành Cụm 5</a></p>
                </div>
            `);
        }

        // 3. Xác định chính xác Vùng hoặc Cụm quản lý
        let managedRegion = null;
        let managedCluster = null;
        if (user.role === 'region_leader') {
            managedRegion = await db.get('SELECT id, region_name FROM regions WHERE manager_id = ?', [user.id]);
            if (!managedRegion) {
                const numMatch = user.username.match(/\d+/);
                if (numMatch) {
                    const rId = parseInt(numMatch[0], 10);
                    managedRegion = await db.get('SELECT id, region_name FROM regions WHERE id = ?', [rId]);
                    if (managedRegion && !user.username.startsWith('phovung')) {
                        await db.run('UPDATE regions SET manager_id = ? WHERE id = ?', [user.id, managedRegion.id]);
                    }
                }
            }
            if (!managedRegion) {
                managedRegion = await db.get('SELECT id, region_name FROM regions WHERE leader_name = ? OR deputy_name = ?', [user.full_name, user.full_name]);
            }
        } else if (user.role === 'cluster_leader') {
            managedCluster = await db.get('SELECT id, cluster_name FROM clusters WHERE manager_id = ?', [user.id]);
            if (!managedCluster) {
                const numMatch = user.username.match(/\d+/);
                if (numMatch) {
                    const cId = parseInt(numMatch[0], 10);
                    managedCluster = await db.get('SELECT id, cluster_name FROM clusters WHERE id = ?', [cId]);
                    if (managedCluster) {
                        await db.run('UPDATE clusters SET manager_id = ? WHERE id = ?', [user.id, managedCluster.id]);
                    }
                }
            }
        }

        // Lưu vai trò gốc để hỗ trợ quay trở lại
        const newOriginalRole = originalRole || (currentSessionUser ? currentSessionUser.role : user.role);

        req.session.regenerate(async (err) => {
            if (err) return res.redirect('/#login');

            req.session.user = {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role,
                session_version: user.session_version,
                managed_region_id: managedRegion ? managedRegion.id : null,
                managed_region_name: managedRegion ? managedRegion.region_name : null,
                managed_cluster_id: managedCluster ? managedCluster.id : null,
                managed_cluster_name: managedCluster ? managedCluster.cluster_name : null
            };

            // Nếu người dùng chuyển về vai trò thực sự ban đầu thì hủy original_role
            if (newOriginalRole === user.role) {
                delete req.session.original_role;
            } else {
                req.session.original_role = newOriginalRole;
            }
            req.session.created_at = Date.now();

            if (user.role === 'cluster_leader') {
                return res.redirect('/#panel-cluster-workspace');
            } else if (user.role === 'region_leader') {
                return res.redirect('/#panel-region-workspace');
            } else {
                return res.redirect('/#panel-dashboard');
            }
        });
    } catch (err) {
        res.redirect('/#login');
    }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
    // 1. Kiểm tra Origin & Referer chống CSRF Login
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const host = req.headers.host;
    if (origin) {
        try {
            const originUrl = new URL(origin);
            if (originUrl.host !== host) {
                return res.status(403).json({ error: 'Yêu cầu không hợp lệ (Origin mismatch).' });
            }
        } catch (e) {
            return res.status(403).json({ error: 'Yêu cầu không hợp lệ.' });
        }
    } else if (referer) {
        try {
            const refererUrl = new URL(referer);
            if (refererUrl.host !== host) {
                return res.status(403).json({ error: 'Yêu cầu không hợp lệ (Referer mismatch).' });
            }
        } catch (e) {
            return res.status(403).json({ error: 'Yêu cầu không hợp lệ.' });
        }
    }

    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Vui lòng cung cấp username và password.' });
    }

    const ip = req.ip;
    const normalizedUsername = username.toLowerCase().trim();

    cleanOldFailures(loginFailuresByUsername, FIFTEEN_MINUTES);
    cleanOldFailures(loginFailuresByIp, FIFTEEN_MINUTES);

    if (getFailureCount(loginFailuresByUsername, normalizedUsername, FIFTEEN_MINUTES) >= 5) {
        return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }
    if (getFailureCount(loginFailuresByIp, ip, FIFTEEN_MINUTES) >= 50) {
        return res.status(429).json({ error: 'Too many login attempts. Please try again later.' });
    }

    try {
        const user = await db.get('SELECT * FROM users WHERE username = ?', [normalizedUsername]);

        const passwordHash = user ? user.password_hash : '$2a$10$1234567890123456789012abcdefghijklmnopqrstuvwxyz12345';
        let isMatch = bcrypt.compareSync(password, passwordHash);
        if (!isMatch && typeof password === 'string') {
            if (password.endsWith(':')) {
                isMatch = bcrypt.compareSync(password.slice(0, -1), passwordHash);
            } else {
                isMatch = bcrypt.compareSync(password + ':', passwordHash);
            }
        }

        if (!user || !isMatch) {
            recordFailure(loginFailuresByUsername, normalizedUsername);
            recordFailure(loginFailuresByIp, ip);
            return res.status(401).json({ error: 'Tên đăng nhập hoặc mật khẩu không chính xác.' });
        }

        if (user.auth_method !== 'local') {
            recordFailure(loginFailuresByUsername, normalizedUsername);
            recordFailure(loginFailuresByIp, ip);
            await audit.logAction(user.id, 'AUTH_METHOD_MISMATCH', `user:${user.id}`, {
                result: 'DENIED',
                details: { error: 'Tài khoản OAuth không được đăng nhập local' }
            }, req);
            return res.status(403).json({ error: 'Tài khoản của bạn yêu cầu đăng nhập bằng Google.' });
        }

        if (user.approval_status !== 'approved') {
            recordFailure(loginFailuresByUsername, normalizedUsername);
            recordFailure(loginFailuresByIp, ip);
            await audit.logAction(user.id, 'LOGIN_FAILED', `user:${user.id}`, {
                result: 'DENIED',
                details: { error: 'Tài khoản chưa được Admin phê duyệt' }
            }, req);
            return res.status(403).json({ error: 'Tài khoản chưa được Quản trị viên (Admin) phê duyệt. Vui lòng liên hệ Admin để kích hoạt tài khoản.' });
        }

        if (user.is_active !== 1) {
            recordFailure(loginFailuresByUsername, normalizedUsername);
            recordFailure(loginFailuresByIp, ip);
            await audit.logAction(user.id, 'LOGIN_FAILED', `user:${user.id}`, {
                result: 'DENIED',
                details: { error: 'Tài khoản đã bị khóa hoặc vô hiệu hóa' }
            }, req);
            return res.status(403).json({ error: 'Tài khoản của bạn đã bị khóa hoặc vô hiệu hóa. Vui lòng liên hệ Quản trị viên.' });
        }

        req.session.regenerate(async (err) => {
            if (err) {
                req.session.destroy(() => {});
                return res.status(500).json({ error: 'Không thể khởi tạo phiên làm việc mới.' });
            }

            const freshUser = await db.get('SELECT session_version FROM users WHERE id = ?', [user.id]);
            if (!freshUser || freshUser.session_version !== user.session_version) {
                req.session.destroy(() => {});
                return res.status(401).json({ error: 'Race condition xảy ra. Phiên đăng nhập bị huỷ.' });
            }

            resetFailures(normalizedUsername, ip);

            let managedRegion = null;
            let managedCluster = null;
            if (user.role === 'region_leader') {
                managedRegion = await db.get('SELECT id, region_name FROM regions WHERE manager_id = ?', [user.id]);
                if (!managedRegion) {
                    const numMatch = user.username.match(/\d+/);
                    if (numMatch) {
                        const rId = parseInt(numMatch[0], 10);
                        managedRegion = await db.get('SELECT id, region_name FROM regions WHERE id = ?', [rId]);
                        if (managedRegion && !user.username.startsWith('phovung')) {
                            await db.run('UPDATE regions SET manager_id = ? WHERE id = ?', [user.id, managedRegion.id]);
                        }
                    }
                }
                if (!managedRegion) {
                    managedRegion = await db.get('SELECT id, region_name FROM regions WHERE leader_name = ? OR deputy_name = ?', [user.full_name, user.full_name]);
                }
            } else if (user.role === 'cluster_leader') {
                managedCluster = await db.get('SELECT id, cluster_name FROM clusters WHERE manager_id = ?', [user.id]);
                if (!managedCluster) {
                    const numMatch = user.username.match(/\d+/);
                    if (numMatch) {
                        const cId = parseInt(numMatch[0], 10);
                        managedCluster = await db.get('SELECT id, cluster_name FROM clusters WHERE id = ?', [cId]);
                        if (managedCluster) {
                            await db.run('UPDATE clusters SET manager_id = ? WHERE id = ?', [user.id, managedCluster.id]);
                        }
                    }
                }
            }
            req.session.user = {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role,
                session_version: user.session_version,
                managed_region_id: managedRegion ? managedRegion.id : null,
                managed_region_name: managedRegion ? managedRegion.region_name : null,
                managed_cluster_id: managedCluster ? managedCluster.id : null,
                managed_cluster_name: managedCluster ? managedCluster.cluster_name : null
            };
            req.session.created_at = Date.now();

            db.run(`
                UPDATE users 
                SET last_login = CURRENT_TIMESTAMP, 
                    login_count = login_count + 1,
                    first_login_at = COALESCE(first_login_at, CURRENT_TIMESTAMP) 
                WHERE id = ?
            `, [user.id]).catch(dbErr => {
                audit.logAction(user.id, 'LOGIN_STATS_UPDATE_FAILED', `user:${user.id}`, {
                    result: 'FAILED',
                    details: { error: dbErr.message }
                }, req);
            });

            await audit.logAction(user.id, 'LOGIN', `user:${user.id}`, { result: 'SUCCESS' }, req);

            req.session.save((saveErr) => {
                if (saveErr) {
                    return res.status(500).json({ error: 'Không thể lưu phiên làm việc.' });
                }
                res.json({ message: 'Đăng nhập thành công.', user: req.session.user });
            });
        });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi máy chủ khi đăng nhập.' });
    }
});

// GET /api/auth/google
router.get('/google', (req, res) => {
    try {
        const authUrl = googleAuth.getAuthUrl(req);
        res.redirect(authUrl);
    } catch (err) {
        console.error('Lỗi khi sinh URL Google Auth:', err);
        res.redirect('/?error=unknown_error');
    }
});

// GET /api/auth/google/callback
router.get('/google/callback', async (req, res) => {
    const { code, state, error: googleError } = req.query;

    if (googleError) {
        console.error('Google OAuth trả về lỗi:', googleError);
        return res.redirect(`/?error=access_denied`);
    }

    try {
        const profile = await googleAuth.verifyCallback(req, code, state);
        const { google_id, email, name, picture } = profile;

        const normalizedEmail = emailUtils.normalizeEmail(email);

        let user = await db.get('SELECT * FROM users WHERE google_id = ?', [google_id]);

        if (user) {
            if (user.email !== normalizedEmail) {
                await audit.logAction(user.id, 'GOOGLE_EMAIL_MISMATCH', `user:${user.id}`, {
                    result: 'DENIED',
                    details: { error: 'Email mismatch', token_email: normalizedEmail, db_email: user.email }
                }, req);
                return res.redirect('/?error=email_not_in_whitelist');
            }

            if (user.approval_status !== 'approved') {
                await audit.logAction(user.id, 'GOOGLE_LOGIN', `user:${user.id}`, {
                    result: 'DENIED',
                    details: { error: 'Tài khoản bị vô hiệu hóa' }
                }, req);
                return res.redirect('/?error=user_disabled');
            }

            return req.session.regenerate(async (err) => {
                if (err) {
                    req.session.destroy(() => {});
                    return res.redirect('/?error=unknown_error');
                }

                const freshUser = await db.get('SELECT session_version FROM users WHERE id = ?', [user.id]);
                if (!freshUser || freshUser.session_version !== user.session_version) {
                    req.session.destroy(() => {});
                    return res.redirect('/?error=unknown_error');
                }

                req.session.user = {
                    id: user.id,
                    username: user.username,
                    full_name: user.full_name,
                    role: user.role,
                    session_version: user.session_version
                };
                req.session.created_at = Date.now();

                const validAvatar = normalizeGoogleAvatarUrl(picture);
                const updateAvatarSQL = validAvatar ? ', avatar_url = ?' : '';
                const updateNameSQL = (user.name_source === 'google' && name) ? ', full_name = ?' : '';
                
                const updateParams = [];
                if (validAvatar) updateParams.push(validAvatar);
                if (user.name_source === 'google' && name) updateParams.push(name);
                updateParams.push(user.id);

                db.run(`
                    UPDATE users 
                    SET last_login = CURRENT_TIMESTAMP, 
                        login_count = login_count + 1,
                        first_login_at = COALESCE(first_login_at, CURRENT_TIMESTAMP),
                        last_google_sync = CURRENT_TIMESTAMP
                        ${updateAvatarSQL}
                        ${updateNameSQL}
                    WHERE id = ?
                `, updateParams).catch(dbErr => {
                    audit.logAction(user.id, 'LOGIN_STATS_UPDATE_FAILED', `user:${user.id}`, {
                        result: 'FAILED',
                        details: { error: dbErr.message }
                    }, req);
                });

                await audit.logAction(user.id, 'GOOGLE_LOGIN', `user:${user.id}`, { result: 'SUCCESS' }, req);

                req.session.save(() => {
                    res.redirect('/index.html');
                });
            });
        }

        const allowedDomainsStr = process.env.ALLOWED_EMAIL_DOMAINS;
        if (!emailUtils.isEmailAllowed(normalizedEmail, allowedDomainsStr)) {
            await audit.logAction(null, 'GOOGLE_LOGIN_DENIED', `email:${normalizedEmail}`, {
                result: 'DENIED',
                details: { error: 'Email domain not allowed' }
            }, req);
            return res.redirect('/?error=email_domain_not_allowed');
        }

        user = await db.get('SELECT * FROM users WHERE email = ?', [normalizedEmail]);

        if (user) {
            if (user.google_id !== null && user.google_id !== google_id) {
                await audit.logAction(user.id, 'GOOGLE_ID_MISMATCH', `user:${user.id}`, {
                    result: 'DENIED',
                    details: { error: 'Google ID mismatch', sub: google_id, db_google_id: user.google_id }
                }, req);
                return res.redirect('/?error=google_id_mismatch');
            }

            if (user.auth_method !== 'google') {
                await audit.logAction(user.id, 'AUTH_METHOD_MISMATCH', `user:${user.id}`, {
                    result: 'DENIED',
                    details: { error: 'Local Admin không được bind Google OAuth' }
                }, req);
                return res.redirect('/?error=auth_method_mismatch');
            }

            if (user.approval_status !== 'approved') {
                await audit.logAction(user.id, 'GOOGLE_LOGIN', `user:${user.id}`, {
                    result: 'DENIED',
                    details: { error: 'Tài khoản bị vô hiệu hóa' }
                }, req);
                return res.redirect('/?error=user_disabled');
            }

            await db.run('BEGIN IMMEDIATE');
            let changes = 0;
            try {
                const checkUser = await db.get('SELECT google_id FROM users WHERE id = ?', [user.id]);
                if (checkUser && checkUser.google_id === null) {
                    const validAvatar = normalizeGoogleAvatarUrl(picture);
                    const nameCheck = user.name_source === 'google' && name;
                    
                    let bindSQL = `
                        UPDATE users 
                        SET google_id = ?, 
                            last_google_sync = CURRENT_TIMESTAMP, 
                            updated_at = CURRENT_TIMESTAMP
                    `;
                    let bindParams = [google_id];

                    if (validAvatar) {
                        bindSQL += `, avatar_url = ?`;
                        bindParams.push(validAvatar);
                    }
                    if (nameCheck) {
                        bindSQL += `, full_name = ?`;
                        bindParams.push(name);
                    }
                    
                    bindSQL += ` WHERE id = ? AND google_id IS NULL AND auth_method = 'google'`;
                    bindParams.push(user.id);
                    
                    const updateRes = await db.run(bindSQL, bindParams);
                    changes = updateRes.changes;
                }
                await db.run('COMMIT');
            } catch (bindErr) {
                await db.run('ROLLBACK');
                console.error('Lỗi khi liên kết google_id:', bindErr);
            }

            if (changes === 0) {
                return res.redirect('/?error=google_id_mismatch');
            }

            await audit.logAction(user.id, 'GOOGLE_BIND', `user:${user.id}`, { result: 'INFO' }, req);

            return req.session.regenerate(async (err) => {
                if (err) {
                    req.session.destroy(() => {});
                    return res.redirect('/?error=unknown_error');
                }

                req.session.user = {
                    id: user.id,
                    username: user.username,
                    full_name: user.full_name,
                    role: user.role,
                    session_version: user.session_version
                };
                req.session.created_at = Date.now();

                db.run(`
                    UPDATE users 
                    SET last_login = CURRENT_TIMESTAMP, 
                        login_count = login_count + 1,
                        first_login_at = COALESCE(first_login_at, CURRENT_TIMESTAMP)
                    WHERE id = ?
                `, [user.id]).catch(dbErr => {
                    audit.logAction(user.id, 'LOGIN_STATS_UPDATE_FAILED', `user:${user.id}`, {
                        result: 'FAILED',
                        details: { error: dbErr.message }
                    }, req);
                });

                await audit.logAction(user.id, 'GOOGLE_LOGIN', `user:${user.id}`, { result: 'SUCCESS' }, req);

                req.session.save(() => {
                    res.redirect('/index.html');
                });
            });
        }

        await audit.logAction(null, 'GOOGLE_LOGIN_DENIED', `email:${normalizedEmail}`, {
            result: 'DENIED',
            details: { error: 'Email không có trong whitelist' }
        }, req);
        return res.redirect('/?error=email_not_in_whitelist');

    } catch (err) {
        console.error('Lỗi trong callback Google OAuth:', err);
        const errorCode = err.message || 'unknown_error';
        const validErrors = ['access_denied', 'invalid_state', 'invalid_grant', 'network_error', 'unknown_error'];
        const queryError = validErrors.includes(errorCode) ? errorCode : 'unknown_error';
        res.redirect(`/?error=${queryError}`);
    } finally {
        if (req.session) {
            delete req.session.oauth_state;
            delete req.session.oauth_state_created_at;
            delete req.session.oauth_nonce;
            delete req.session.oauth_nonce_created_at;
            delete req.session.code_verifier;
        }
    }
});

// POST /api/auth/logout
router.post('/logout', auth.requireAuth, async (req, res) => {
    const user = req.session.user;
    const userId = user.id;
    const cookieSecure = process.env.COOKIE_SECURE === 'true';
    req.session.destroy((err) => {
        res.clearCookie('vnv.sid', {
            path: '/',
            httpOnly: true,
            sameSite: 'lax',
            secure: cookieSecure
        });
        if (err) {
            return res.status(500).json({ error: 'Không thể đăng xuất.' });
        }
        audit.logAction(userId, 'LOGOUT', `user:${userId}`, { result: 'SUCCESS' }, req);
        res.json({ message: 'Đăng xuất thành công.' });
    });
});

// POST /api/auth/logout-all
router.post('/logout-all', auth.requireAuth, async (req, res) => {
    const userId = req.session.user.id;
    const cookieSecure = process.env.COOKIE_SECURE === 'true';

    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            await db.run('UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [userId]);
            await audit.logAction(userId, 'SESSION_REVOKED_BY_USER', `user:${userId}`, {
                result: 'SUCCESS',
                details: { ip: req.ip, user_agent: req.headers['user-agent'] }
            }, req);
            await db.run('COMMIT');
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }

        req.session.destroy((err) => {
            res.clearCookie('vnv.sid', {
                path: '/',
                httpOnly: true,
                sameSite: 'lax',
                secure: cookieSecure
            });
            res.json({ message: 'Đã đăng xuất khỏi tất cả các thiết bị thành công.' });
        });
    } catch (err) {
        res.status(500).json({ error: 'Không thể thu hồi các phiên đăng nhập khác.' });
    }
});

// GET /api/auth/me
router.get('/me', async (req, res) => {
    if (req.session && req.session.user) {
        if (req.session.user.role === 'region_leader' && !req.session.user.managed_region_id) {
            try {
                let managedRegion = await db.get('SELECT id, region_name FROM regions WHERE manager_id = ?', [req.session.user.id]);
                if (!managedRegion) {
                    const numMatch = req.session.user.username.match(/\d+/);
                    if (numMatch) {
                        const rId = parseInt(numMatch[0], 10);
                        managedRegion = await db.get('SELECT id, region_name FROM regions WHERE id = ?', [rId]);
                    }
                }
                if (!managedRegion) {
                    managedRegion = await db.get('SELECT id, region_name FROM regions WHERE leader_name = ? OR deputy_name = ?', [req.session.user.full_name, req.session.user.full_name]);
                }
                if (managedRegion) {
                    req.session.user.managed_region_id = managedRegion.id;
                    req.session.user.managed_region_name = managedRegion.region_name;
                }
            } catch (e) {}
        } else if (req.session.user.role === 'cluster_leader' && !req.session.user.managed_cluster_id) {
            try {
                let cluster = await db.get('SELECT id, cluster_name FROM clusters WHERE manager_id = ?', [req.session.user.id]);
                if (!cluster) {
                    const numMatch = req.session.user.username.match(/\d+/);
                    if (numMatch) {
                        const cId = parseInt(numMatch[0], 10);
                        cluster = await db.get('SELECT id, cluster_name FROM clusters WHERE id = ?', [cId]);
                        if (cluster) {
                            await db.run('UPDATE clusters SET manager_id = ? WHERE id = ? AND manager_id IS NULL', [req.session.user.id, cluster.id]);
                        }
                    }
                }
                if (cluster) {
                    req.session.user.managed_cluster_id = cluster.id;
                    req.session.user.managed_cluster_name = cluster.cluster_name;
                }
            } catch (e) {}
        }
        res.json({ 
            user: {
                ...req.session.user,
                original_role: req.session.original_role || null
            }
        });
    } else {
        res.json({ user: null });
    }
});

module.exports = router;

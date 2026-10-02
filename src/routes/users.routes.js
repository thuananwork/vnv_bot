const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const db = require('../config/db');
const auth = require('../middlewares/auth');
const audit = require('../services/audit');
const emailUtils = require('../utils/email');

// GET /api/users
router.get('/', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    try {
        const usersList = await db.all(`
            SELECT id, username, email, google_id, full_name, zalo_id, role, 
                   approval_status, auth_method, is_active, last_login, first_login_at, login_count, created_at 
            FROM users
        `);
        res.json(usersList);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách user.' });
    }
});

// POST /api/users
router.post('/', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const { username, password, full_name, zalo_id, role, email } = req.body;
    
    if (!['admin', 'cluster_leader', 'region_leader'].includes(role)) {
        return res.status(400).json({ error: 'Vai trò người dùng không hợp lệ.' });
    }
    if (!full_name || full_name.trim() === '') {
        return res.status(400).json({ error: 'Vui lòng nhập Họ và Tên.' });
    }

    let authMethod = 'google';
    let normalizedEmail = null;
    let finalUsername = null;
    let finalPasswordHash = null;

    if (email && email.trim() !== '') {
        normalizedEmail = emailUtils.normalizeEmail(email);
    }

    if (username && username.trim() !== '' && password && password.trim() !== '') {
        authMethod = 'local';
        finalUsername = username.toLowerCase().trim();
        finalPasswordHash = bcrypt.hashSync(password.trim(), 10);
    } else if (normalizedEmail) {
        authMethod = 'google';
        finalUsername = normalizedEmail;
        finalPasswordHash = bcrypt.hashSync(crypto.randomUUID(), 10);
    } else {
        return res.status(400).json({ error: 'Vui lòng cung cấp Username + Mật khẩu (đăng nhập trực tiếp) hoặc Email Gmail (đăng nhập Google).' });
    }

    try {
        await db.run('BEGIN IMMEDIATE');
        
        let result;
        try {
            result = await db.run(
                `INSERT INTO users (username, password_hash, full_name, zalo_id, role, email, auth_method, approval_status, is_active) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, 'approved', 1)`,
                [finalUsername, finalPasswordHash, full_name, zalo_id || null, role, normalizedEmail, authMethod]
            );
            await db.run('COMMIT');
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }

        await audit.logAction(req.session.user.id, 'USER_CREATE', `user:${result.id}`, {
            result: 'SUCCESS',
            target_user_id: result.id,
            details: { username: finalUsername, full_name, role, email: normalizedEmail, auth_method: authMethod }
        }, req);

        res.status(201).json({ message: 'Tạo người dùng thành công.', id: result.id });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username hoặc Email đã tồn tại trong hệ thống.' });
        }
        res.status(500).json({ error: 'Lỗi khi tạo user.' });
    }
});

// PUT /api/users/:id
router.put('/:id', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const userId = req.params.id;
    const { full_name, zalo_id, role, is_active, password, email, auth_method } = req.body;

    try {
        if (auth_method !== undefined) {
            return res.status(400).json({ error: 'IMMUTABLE_AUTH_METHOD' });
        }

        if (is_active !== undefined) {
            return res.status(400).json({ error: 'IMMUTABLE_LEGACY_FIELD' });
        }

        await db.run('BEGIN IMMEDIATE');
        try {
            const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
            if (!user) {
                await db.run('ROLLBACK');
                return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
            }

            let normalizedEmail = user.email;
            let googleId = user.google_id;
            let avatarUrl = user.avatar_url;
            let lastGoogleSync = user.last_google_sync;
            let sessionVersion = user.session_version;
            let finalPasswordHash = user.password_hash;
            let nameSource = user.name_source;
            let finalFullName = full_name !== undefined ? full_name : user.full_name;
            let finalUsername = user.username;

            if (email !== undefined) {
                const checkEmail = emailUtils.normalizeEmail(email);
                if (checkEmail !== user.email) {
                    normalizedEmail = checkEmail;
                    googleId = null;
                    avatarUrl = null;
                    lastGoogleSync = null;
                    sessionVersion += 1;
                    if (user.auth_method === 'google') {
                        finalUsername = checkEmail;
                    }
                }
            }

            if (role !== undefined && role !== user.role) {
                sessionVersion += 1;
            }

            let finalAuthMethod = user.auth_method;
            if (password && password.trim() !== '') {
                finalPasswordHash = bcrypt.hashSync(password.trim(), 10);
                finalAuthMethod = 'local';
            }

            if (full_name !== undefined && full_name !== user.full_name) {
                nameSource = 'manual';
            }

            const targetRole = role !== undefined ? role : user.role;

            await db.run(
                `UPDATE users 
                 SET full_name = ?, 
                     zalo_id = ?, 
                     role = ?, 
                     email = ?, 
                     username = ?,
                     google_id = ?, 
                     avatar_url = ?, 
                     last_google_sync = ?, 
                     session_version = ?, 
                     password_hash = ?,
                     auth_method = ?,
                     name_source = ?,
                     updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [
                    finalFullName, 
                    zalo_id !== undefined ? (zalo_id || null) : user.zalo_id, 
                    targetRole, 
                    normalizedEmail, 
                    finalUsername,
                    googleId, 
                    avatarUrl, 
                    lastGoogleSync, 
                    sessionVersion, 
                    finalPasswordHash,
                    finalAuthMethod,
                    nameSource,
                    userId
                ]
            );

            await audit.logAction(req.session.user.id, 'USER_UPDATE', `user:${userId}`, {
                result: 'SUCCESS',
                target_user_id: parseInt(userId),
                details: { full_name: finalFullName, role: targetRole, email: normalizedEmail, name_source: nameSource }
            }, req);

            await db.run('COMMIT');
            res.json({ message: 'Cập nhật người dùng thành công.' });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username hoặc Email đã tồn tại.' });
        }
        if (err.message && (err.message.includes('USER_ALREADY_MANAGES_CLUSTER') || err.message.includes('USER_ALREADY_MANAGES_REGION'))) {
            return res.status(409).json({ error: 'ROLE_UNIT_CONFLICT' });
        }
        res.status(500).json({ error: 'Lỗi khi cập nhật user.' });
    }
});

async function handleUserDisable(req, res, userId) {
    if (parseInt(userId) === req.session.user.id) {
        return res.status(400).json({ error: 'SELF_DISABLE_PROTECTED' });
    }

    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            const targetUser = await db.get('SELECT role FROM users WHERE id = ?', [userId]);
            if (!targetUser) {
                await db.run('ROLLBACK');
                return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
            }
            if (targetUser.role === 'admin') {
                const adminCount = await db.get("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin' AND approval_status = 'approved'");
                if (adminCount.cnt <= 1) {
                    await db.run('ROLLBACK');
                    return res.status(409).json({ error: 'LAST_ADMIN_PROTECTED' });
                }
            }

            await db.run(
                `UPDATE users 
                 SET approval_status = 'disabled', 
                     is_active = 0, 
                     session_version = session_version + 1, 
                     updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`, 
                [userId]
            );
            await db.run('UPDATE regions SET manager_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE manager_id = ?', [userId]);
            await db.run('UPDATE clusters SET manager_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE manager_id = ?', [userId]);
            
            await audit.logAction(req.session.user.id, 'USER_DISABLED', `user:${userId}`, {
                result: 'SUCCESS',
                target_user_id: parseInt(userId),
                details: 'Tài khoản bị vô hiệu hóa (Soft Delete)'
            }, req);

            await db.run('COMMIT');
            res.json({ message: 'Vô hiệu hóa người dùng thành công.' });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi vô hiệu hóa user.' });
    }
}

// DELETE /api/users/:id/permanent: Xóa tài khoản vĩnh viễn
router.delete('/:id/permanent', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
        return res.status(400).json({ error: 'ID người dùng không hợp lệ.' });
    }

    if (userId === req.session.user.id) {
        return res.status(400).json({ error: 'SELF_DELETE_PROTECTED' });
    }

    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            const targetUser = await db.get('SELECT id, username, full_name, role FROM users WHERE id = ?', [userId]);
            if (!targetUser) {
                await db.run('ROLLBACK');
                return res.status(404).json({ error: 'Không tìm thấy người dùng để xóa.' });
            }

            if (targetUser.role === 'admin') {
                const adminCount = await db.get("SELECT COUNT(*) as cnt FROM users WHERE role = 'admin'");
                if (adminCount.cnt <= 1) {
                    await db.run('ROLLBACK');
                    return res.status(409).json({ error: 'LAST_ADMIN_PROTECTED' });
                }
            }

            // Gỡ bỏ liên kết quản lý Vùng / Cụm
            await db.run('UPDATE regions SET manager_id = NULL WHERE manager_id = ?', [userId]);
            await db.run('UPDATE clusters SET manager_id = NULL WHERE manager_id = ?', [userId]);
            await db.run('UPDATE users SET approved_by = NULL WHERE approved_by = ?', [userId]);

            // Xóa người dùng vĩnh viễn khỏi DB
            await db.run('DELETE FROM users WHERE id = ?', [userId]);

            await audit.logAction(req.session.user.id, 'USER_PERMANENT_DELETE', `user:${userId}`, {
                result: 'SUCCESS',
                target_user_id: userId,
                details: { username: targetUser.username, full_name: targetUser.full_name, role: targetUser.role }
            }, req);

            await db.run('COMMIT');
            res.json({ message: `Đã xóa vĩnh viễn tài khoản "${targetUser.username}" thành công.` });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        console.error('[PERMANENT_DELETE ERROR]', err);
        res.status(500).json({ error: 'Lỗi khi xóa người dùng: ' + err.message });
    }
});

router.delete('/:id', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    await handleUserDisable(req, res, req.params.id);
});

router.post('/:id/disable', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    await handleUserDisable(req, res, req.params.id);
});

router.post('/:id/enable', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const userId = req.params.id;
    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
            if (!user) {
                await db.run('ROLLBACK');
                return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
            }

            await db.run(
                `UPDATE users 
                 SET approval_status = 'approved', 
                     is_active = 1, 
                     session_version = session_version + 1, 
                     updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`, 
                [userId]
            );

            await audit.logAction(req.session.user.id, 'USER_ENABLED', `user:${userId}`, {
                result: 'SUCCESS',
                target_user_id: parseInt(userId),
                details: 'Kích hoạt lại tài khoản'
            }, req);

            await db.run('COMMIT');
            res.json({ message: 'Kích hoạt người dùng thành công.' });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi kích hoạt user.' });
    }
});

router.post('/:id/revoke-sessions', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const userId = req.params.id;
    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            await db.run(
                'UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', 
                [userId]
            );
            await audit.logAction(req.session.user.id, 'SESSION_REVOKED_BY_ADMIN', `user:${userId}`, {
                result: 'SUCCESS',
                target_user_id: parseInt(userId),
                details: 'Admin cưỡng bức đăng xuất tài khoản'
            }, req);
            await db.run('COMMIT');
            res.json({ message: 'Đã cưỡng bức đăng xuất tài khoản trên mọi thiết bị thành công.' });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi cưỡng bức đăng xuất tài khoản.' });
    }
});

module.exports = router;

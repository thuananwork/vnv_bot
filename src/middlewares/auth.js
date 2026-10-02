/**
 * Middleware xác thực session và kiểm soát truy cập vai trò (RBAC)
 */

const { get } = require('../config/db');
const { logAction } = require('../services/audit');

// Yêu cầu người dùng đăng nhập và xác thực phiên hoạt động
async function requireAuth(req, res, next) {
    try {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ error: 'SESSION_UNAUTHENTICATED' });
        }

        const cookieSecure = process.env.COOKIE_SECURE === 'true';

        // 1. Kiểm tra Absolute Timeout (đúng 8 giờ)
        if (req.session.created_at) {
            const elapsed = Date.now() - req.session.created_at;
            if (elapsed >= 8 * 60 * 60 * 1000) {
                const userId = req.session.user.id;
                req.session.destroy((destroyErr) => {
                    res.clearCookie('vnv.sid', {
                        path: '/',
                        httpOnly: true,
                        sameSite: 'lax',
                        secure: cookieSecure
                    });
                    logAction(userId, 'SESSION_REVOKED', `user:${userId}`, {
                        result: 'SUCCESS',
                        details: { reason: 'absolute_timeout' }
                    }, req);
                    return res.status(401).json({ error: 'ABSOLUTE_SESSION_EXPIRED' });
                });
                return;
            }
        }

        // 2. Tra cứu trực tiếp từ DB không cache
        const userId = req.session.user.id;
        const dbUser = await get('SELECT id, approval_status, session_version FROM users WHERE id = ?', [userId]);

        // 3. Xác thực điều kiện phiên hoạt động hợp lệ
        if (!dbUser || dbUser.approval_status !== 'approved' || dbUser.session_version !== req.session.user.session_version) {
            req.session.destroy((destroyErr) => {
                res.clearCookie('vnv.sid', {
                    path: '/',
                    httpOnly: true,
                    sameSite: 'lax',
                    secure: cookieSecure
                });
                let reason = 'user_not_found';
                if (dbUser) {
                    reason = dbUser.approval_status !== 'approved' ? 'status_disabled' : 'session_version_mismatch';
                }
                logAction(userId, 'SESSION_REVOKED', `user:${userId}`, {
                    result: 'SUCCESS',
                    details: { reason }
                }, req);
                return res.status(401).json({ error: 'SESSION_REVOKED' });
            });
            return;
        }

        next();
    } catch (err) {
        next(err);
    }
}

// Yêu cầu vai trò cụ thể
function requireRole(allowedRoles) {
    return (req, res, next) => {
        if (!req.session || !req.session.user) {
            return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
        }
        
        const { role } = req.session.user;
        if (allowedRoles.includes(role)) {
            next();
        } else {
            res.status(403).json({ error: 'Bạn không có quyền truy cập chức năng này.' });
        }
    };
}

// Các helper phân quyền nhanh
const isAdmin = requireRole(['admin']);
const isClusterLeader = requireRole(['cluster_leader']);
const isRegionLeader = requireRole(['region_leader']);
const isClusterOrAdmin = requireRole(['admin', 'cluster_leader']);

// Kiểm tra quyền truy cập tài nguyên theo scope quản lý (Row-Level Security)
function checkScope(req, res, next) {
    if (!req.session || !req.session.user) {
        return res.status(401).json({ error: 'Vui lòng đăng nhập.' });
    }

    const { role, id: userId } = req.session.user;
    
    // Admin có quyền truy cập toàn bộ dữ liệu
    if (role === 'admin') {
        req.userScope = { all: true };
        return next();
    }

    // Trưởng cụm: chỉ truy cập các vùng thuộc cụm của mình
    if (role === 'cluster_leader') {
        req.userScope = {
            role: 'cluster_leader',
            managerId: userId
        };
        return next();
    }

    // Trưởng / Phó vùng: chỉ truy cập vùng của mình
    if (role === 'region_leader') {
        req.userScope = {
            role: 'region_leader',
            managerId: userId,
            regionId: req.session.user?.managed_region_id || null
        };
        return next();
    }

    res.status(403).json({ error: 'Vai trò người dùng không hợp lệ.' });
}

module.exports = {
    requireAuth,
    requireRole,
    isAdmin,
    isClusterLeader,
    isRegionLeader,
    isClusterOrAdmin,
    checkScope
};

/**
 * Middleware xác thực session và kiểm soát truy cập vai trò (RBAC)
 */

// Yêu cầu người dùng đăng nhập
function requireAuth(req, res, next) {
    if (req.session && req.session.user) {
        next();
    } else {
        res.status(401).json({ error: 'Vui lòng đăng nhập để tiếp tục.' });
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

    // Trưởng vùng: chỉ truy cập vùng của mình
    if (role === 'region_leader') {
        req.userScope = {
            role: 'region_leader',
            managerId: userId
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
    checkScope
};

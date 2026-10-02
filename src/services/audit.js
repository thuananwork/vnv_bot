const { run } = require('../config/db');

/**
 * Ghi nhận nhật ký audit log vào SQLite
 * @param {number} userId - ID của User thực hiện
 * @param {string} action - Hành động (ví dụ: CREATE_CLUSTER, DELETE_REGION,...)
 * @param {string} target - Tên tài nguyên đích (ví dụ: cluster:1, user:3,...)
 * @param {object|string} details - Chi tiết (object hoặc text mô tả sự thay đổi)
 * @param {object} [req] - Request Express để lấy IP client
 */
async function logAction(userId, action, target, info, req = null) {
    try {
        const ipAddress = req ? (req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress) : null;
        const userAgent = req ? req.headers['user-agent'] : null;
        const requestId = req ? req.requestId : null;
        const duration = req && req.startTime ? (Date.now() - req.startTime) : null;
        
        let result = 'INFO';
        let detailsVal = info;
        let targetUserId = null;
        let durationMs = duration;
        
        if (info && typeof info === 'object') {
            if (info.result !== undefined) result = info.result;
            if (info.details !== undefined) detailsVal = info.details;
            if (info.target_user_id !== undefined) targetUserId = info.target_user_id;
            if (info.duration_ms !== undefined) durationMs = info.duration_ms;
        }
        
        let targetType = target;
        let targetId = null;
        if (target && typeof target === 'string' && target.includes(':')) {
            const parts = target.split(':');
            targetType = parts[0];
            targetId = parts.slice(1).join(':');
        }

        const detailsStr = (typeof detailsVal === 'object' && detailsVal !== null)
            ? JSON.stringify(detailsVal)
            : String(detailsVal || '');

        await run(
            `INSERT INTO audit_logs (user_id, action, target_type, target_id, details, ip_address) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [userId, action, targetType, targetId, detailsStr, ipAddress]
        );
    } catch (err) {
        console.error('Thất bại khi ghi audit log:', err);
    }
}

module.exports = {
    logAction
};

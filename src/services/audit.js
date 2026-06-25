const { run } = require('../config/db');

/**
 * Ghi nhận nhật ký audit log vào SQLite
 * @param {number} userId - ID của User thực hiện
 * @param {string} action - Hành động (ví dụ: CREATE_CLUSTER, DELETE_REGION,...)
 * @param {string} target - Tên tài nguyên đích (ví dụ: cluster:1, user:3,...)
 * @param {object|string} details - Chi tiết (object hoặc text mô tả sự thay đổi)
 * @param {object} [req] - Request Express để lấy IP client
 */
async function logAction(userId, action, target, details, req = null) {
    try {
        const ipAddress = req ? (req.headers['x-forwarded-for'] || req.ip || req.connection.remoteAddress) : null;
        const detailsStr = typeof details === 'object' ? JSON.stringify(details) : String(details);
        
        await run(
            `INSERT INTO audit_logs (user_id, action, target, details, ip_address) 
             VALUES (?, ?, ?, ?, ?)`,
            [userId, action, target, detailsStr, ipAddress]
        );
    } catch (err) {
        console.error('Thất bại khi ghi audit log:', err);
    }
}

module.exports = {
    logAction
};

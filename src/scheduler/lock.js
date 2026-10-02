const db = require('../config/db');
const os = require('os');
const configProvider = require('./config');

class LockManager {
    constructor() {
        // Sinh ownerId đại diện cho tiến trình hiện tại
        const pm2Instance = process.env.NODE_APP_INSTANCE || process.env.PM2_INSTANCE_ID || '0';
        this.ownerId = `${os.hostname()}-pid${process.pid}-pm2-${pm2Instance}`;
        this.heartbeats = new Map(); // Lưu trữ interval heartbeat của các lockKey
    }

    /**
     * Tạo khóa nguyên tử (Atomic Lock) trên database SQLite
     * @param {string} lockKey 
     * @param {number} ttlMs 
     * @returns {Promise<boolean>}
     */
    async acquireLock(lockKey, ttlMs) {
        const now = Date.now();
        const expiry = now + ttlMs;
        const lockValue = `${this.ownerId}|${expiry}`;

        try {
            // 1. Thử chèn khóa mới
            await db.run(
                'INSERT INTO local_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)',
                [lockKey, lockValue]
            );
            console.log(`[LOCK MANAGER] Đã tạo khóa mới: "${lockKey}" cho owner "${this.ownerId}"`);
            return true;
        } catch (err) {
            if (err.message.includes('UNIQUE constraint failed')) {
                // 2. Khóa đã tồn tại, kiểm tra xem đã hết hạn chưa
                const row = await db.get('SELECT value FROM local_config WHERE key = ?', [lockKey]);
                if (row && row.value) {
                    const parts = row.value.split('|');
                    const oldOwner = parts[0];
                    const oldExpiry = parseInt(parts[1], 10) || 0;

                    if (now > oldExpiry) {
                        // Khóa đã hết hạn, cập nhật nguyên tử bằng UPDATE ... WHERE value = <giá trị cũ>
                        const result = await db.run(
                            'UPDATE local_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ? AND value = ?',
                            [lockValue, lockKey, row.value]
                        );
                        if (result.changes > 0) {
                            console.log(`[LOCK MANAGER] Đã giải phóng khóa hết hạn và chiếm lại khóa: "${lockKey}" từ owner cũ "${oldOwner}"`);
                            return true;
                        }
                    }
                }
                return false; // Khóa vẫn đang active bởi tiến trình khác
            }
            throw err;
        }
    }

    async releaseLock(lockKey) {
        this.stopHeartbeat(lockKey);
        try {
            // Giải phóng khóa nguyên tử: chỉ xóa khi khóa khớp đúng owner hiện tại
            const result = await db.run(
                'DELETE FROM local_config WHERE key = ? AND value LIKE ?',
                [lockKey, `${this.ownerId}|%`]
            );
            if (result.changes > 0) {
                console.log(`[LOCK MANAGER] Đã giải phóng khóa thành công: "${lockKey}"`);
            } else {
                console.warn(`[LOCK MANAGER] Cảnh báo: Không thể giải phóng khóa "${lockKey}" (không sở hữu hoặc đã bị cướp).`);
            }
        } catch (err) {
            console.error(`[LOCK MANAGER] Lỗi khi giải phóng khóa "${lockKey}":`, err);
        }
    }

    /**
     * Bắt đầu chu kỳ gửi tín hiệu Heartbeat để duy trì khóa cho các job chạy dài
     * @param {string} lockKey 
     * @param {number} intervalMs 
     * @param {number} ttlMs 
     */
    startHeartbeat(lockKey, intervalMs = 30000, ttlMs = 1800000) {
        if (this.heartbeats.has(lockKey)) {
            return;
        }

        const interval = setInterval(async () => {
            const now = Date.now();
            const newExpiry = now + ttlMs;
            const newLockValue = `${this.ownerId}|${newExpiry}`;
            
            try {
                // Chỉ cập nhật hạn mức mới nếu khóa hiện tại vẫn thuộc quyền sở hữu của owner này
                const result = await db.run(
                    'UPDATE local_config SET value = ?, updated_at = CURRENT_TIMESTAMP WHERE key = ? AND value LIKE ?',
                    [newLockValue, lockKey, `${this.ownerId}|%`]
                );
                if (result.changes > 0) {
                    console.log(`[LOCK HEARTBEAT] Đã gia hạn khóa: "${lockKey}" đến ${new Date(newExpiry).toLocaleTimeString()}`);
                } else {
                    console.warn(`[LOCK HEARTBEAT] Cảnh báo: Mất quyền sở hữu khóa "${lockKey}". Ngừng Heartbeat.`);
                    this.stopHeartbeat(lockKey);
                }
            } catch (err) {
                console.error(`[LOCK HEARTBEAT] Lỗi khi gia hạn khóa "${lockKey}":`, err);
            }
        }, intervalMs);

        // Đảm bảo không block tiến trình Node khi thoát
        interval.unref();
        this.heartbeats.set(lockKey, interval);
    }

    /**
     * Dừng gửi tín hiệu Heartbeat
     * @param {string} lockKey 
     */
    stopHeartbeat(lockKey) {
        const interval = this.heartbeats.get(lockKey);
        if (interval) {
            clearInterval(interval);
            this.heartbeats.delete(lockKey);
            console.log(`[LOCK HEARTBEAT] Đã ngừng gia hạn khóa: "${lockKey}"`);
        }
    }

    /**
     * Quét và dọn sạch các khóa hết hạn (stale locks) trên database khi khởi chạy máy chủ
     */
    async recoverStaleLocks() {
        const now = Date.now();
        try {
            const rows = await db.all("SELECT key, value FROM local_config WHERE key LIKE 'lock:active:%'");
            for (const row of rows) {
                if (row.value) {
                    const parts = row.value.split('|');
                    const expiry = parseInt(parts[1], 10) || 0;
                    if (now > expiry) {
                        // Khóa đã hết hạn, xóa khỏi bảng local_config
                        await db.run('DELETE FROM local_config WHERE key = ?', [row.key]);
                        console.log(`[LOCK RECOVERY] Đã dọn sạch khóa hết hạn bị kẹt: "${row.key}"`);
                        
                        // Ghi log hành động phục hồi vào audit_logs
                        await db.run(
                            `INSERT INTO audit_logs (action, target, details, created_at) 
                             VALUES ('SCHEDULER_RECOVERY', ?, ?, CURRENT_TIMESTAMP)`,
                            [row.key, `Đã dọn sạch khóa hết hạn bị kẹt của owner: ${parts[0]}`]
                        );
                    }
                }
            }
        } catch (err) {
            console.error('[LOCK RECOVERY] Lỗi khi phục hồi các khóa kẹt:', err);
        }
    }
}

module.exports = new LockManager();

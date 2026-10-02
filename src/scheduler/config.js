const db = require('../config/db');

class ConfigProvider {
    /**
     * Lấy giá trị cấu hình từ bảng local_config theo key
     * @param {string} key 
     * @param {string} defaultValue 
     * @returns {Promise<string>}
     */
    async get(key, defaultValue = null) {
        try {
            const row = await db.get('SELECT value FROM local_config WHERE key = ?', [key]);
            return row ? row.value : defaultValue;
        } catch (err) {
            console.error(`[SCHEDULER CONFIG] Lỗi khi đọc key "${key}":`, err);
            return defaultValue;
        }
    }

    /**
     * Kiểm tra xem Scheduler có được kích hoạt toàn cục không
     * @returns {Promise<boolean>}
     */
    async isSchedulerEnabled() {
        const val = await this.get('scheduler.enabled', 'true');
        return val === 'true';
    }

    /**
     * Kiểm tra xem một Job cụ thể có được kích hoạt không
     * @param {string} jobName 
     * @returns {Promise<boolean>}
     */
    async isJobEnabled(jobName) {
        const globalEnabled = await this.isSchedulerEnabled();
        if (!globalEnabled) return false;

        const val = await this.get(`scheduler.${jobName}.enabled`, 'true');
        return val === 'true';
    }

    /**
     * Lấy múi giờ cấu hình (mặc định Asia/Ho_Chi_Minh)
     * @returns {Promise<string>}
     */
    async getTimezone() {
        return this.get('scheduler.timezone', 'Asia/Ho_Chi_Minh');
    }

    /**
     * Lấy biểu thức cron của Job
     * @param {string} jobName 
     * @returns {Promise<string>}
     */
    async getCronExpression(jobName) {
        // Trả về biểu thức mặc định nếu không cấu hình trong DB
        const defaults = {
            distribute: '0 8 * * *',
            summarize: '0 21 * * *',
            syncSheets: '5 21 * * *',
            sendReports: '10 21 * * *',
            backupDb: '0 2 * * *'
        };
        return this.get(`scheduler.${jobName}.cron`, defaults[jobName] || '* * * * *');
    }

    /**
     * Lấy thời gian hết hạn khóa (Lock TTL - mặc định 30 phút)
     * @returns {Promise<number>}
     */
    async getLockTtl() {
        const val = await this.get('scheduler.lock.ttl', '1800000');
        return parseInt(val, 10) || 1800000;
    }

    /**
     * Lấy thời gian tối đa để chờ Graceful Shutdown hoàn tất (mặc định 60s)
     * @returns {Promise<number>}
     */
    async getShutdownTimeout() {
        const val = await this.get('scheduler.shutdown.timeout', '60000');
        return parseInt(val, 10) || 60000;
    }

    /**
     * Lấy thời điểm cập nhật cấu hình mới nhất của các key scheduler.*
     * Dùng để tự động phát hiện xem có cần reload cron không
     * @returns {Promise<string>}
     */
    async getLatestConfigRevision() {
        try {
            const row = await db.get("SELECT MAX(updated_at) as max_updated FROM local_config WHERE key LIKE 'scheduler.%'");
            return row ? row.max_updated : '';
        } catch (err) {
            console.error('[SCHEDULER CONFIG] Lỗi khi lấy config revision:', err);
            return '';
        }
    }
}

module.exports = new ConfigProvider();

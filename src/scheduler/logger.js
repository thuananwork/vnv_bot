const { logAction } = require('../services/audit');

class AuditLogger {
    /**
     * Ghi log lịch sử chạy Job vào bảng audit_logs dưới dạng JSON cấu trúc
     * @param {Object} logData
     * @param {string} logData.jobName - Tên Job
     * @param {string} logData.status - Trạng thái: 'success' | 'failed' | 'skipped' | 'running'
     * @param {number} logData.attempt - Số lần chạy thử
     * @param {number} logData.executionTimeMs - Thời gian thực thi thực tế (ms)
     * @param {number} logData.maxExecutionTimeMs - Thời gian timeout cấu hình (ms)
     * @param {string} logData.lockKey - Key khóa của Job
     * @param {string} logData.worker - Tên worker/tiến trình giữ khóa
     * @param {string} [logData.errorMessage] - Lỗi nếu thất bại
     * @param {number} [logData.userId] - ID Admin nếu kích hoạt thủ công (manual trigger)
     */
    async logJob({
        jobName,
        status,
        attempt,
        executionTimeMs,
        maxExecutionTimeMs,
        lockKey,
        worker,
        errorMessage = null,
        userId = null
    }) {
        const details = {
            job: jobName,
            status,
            attempt,
            executionTime: executionTimeMs,
            maxExecutionTime: maxExecutionTimeMs,
            lockKey,
            worker,
            error_message: errorMessage
        };

        try {
            await logAction(
                userId, // NULL nếu chạy tự động qua cron, hoặc user_id của Admin nếu click tay
                'SCHEDULER_JOB',
                `job:${jobName}`,
                details
            );
        } catch (err) {
            console.error(`[AUDIT LOGGER] Lỗi khi ghi log chạy Job "${jobName}":`, err);
        }
    }
}

module.exports = new AuditLogger();

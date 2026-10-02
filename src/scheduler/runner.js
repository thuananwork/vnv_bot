class SchedulerRunner {
    /**
     * Khởi tạo Runner thông qua cơ chế Dependency Injection
     * @param {Object} dependencies 
     * @param {Object} dependencies.lockManager 
     * @param {Object} dependencies.retryManager 
     * @param {Object} dependencies.timeoutManager 
     * @param {Object} dependencies.logger 
     * @param {Object} dependencies.configProvider 
     * @param {Object} dependencies.healthProvider 
     */
    constructor({ lockManager, retryManager, timeoutManager, logger, configProvider, healthProvider }) {
        this.lockManager = lockManager;
        this.retryManager = retryManager;
        this.timeoutManager = timeoutManager;
        this.logger = logger;
        this.configProvider = configProvider;
        this.healthProvider = healthProvider;
    }

    /**
     * Thực thi một Job an toàn với đầy đủ cơ chế lock, retry, timeout và logging
     * @param {Object} params
     * @param {string} params.name - Tên Job
     * @param {string} params.lockKey - Khóa động phân biệt
     * @param {Function} params.handler - Hàm xử lý nghiệp vụ của Job
     * @param {Object} params.retryPolicy - Chính sách retry
     * @param {number} params.timeoutMs - Giới hạn thời gian chạy (ms)
     * @param {number} [params.userId] - ID Admin nếu kích hoạt bằng tay
     */
    async runJob({ name, lockKey, handler, retryPolicy, timeoutMs, userId = null }) {
        // 1. Kiểm tra kích hoạt job
        const isEnabled = await this.configProvider.isJobEnabled(name);
        if (!isEnabled) {
            console.log(`[SCHEDULER RUNNER] Job "${name}" đang bị tắt. Bỏ qua thực thi.`);
            return { success: false, status: 'skipped', disabled: true };
        }

        // 2. Kiểm tra xung đột chạy song song
        if (this.healthProvider.isJobRunning(name)) {
            console.warn(`[SCHEDULER RUNNER] Job "${name}" đang chạy trong bộ nhớ của tiến trình này. Bỏ qua.`);
            return { success: false, status: 'skipped', running: true };
        }

        // 3. Thực hiện lấy khóa nguyên tử (Atomic Lock)
        const ttlMs = await this.configProvider.getLockTtl();
        const acquired = await this.lockManager.acquireLock(lockKey, ttlMs);
        if (!acquired) {
            console.log(`[SCHEDULER RUNNER] Không thể lấy khóa "${lockKey}" cho Job "${name}". Bỏ qua.`);
            // Ghi nhận log skipped do kẹt lock
            await this.logger.logJob({
                jobName: name,
                status: 'skipped',
                attempt: 0,
                executionTimeMs: 0,
                maxExecutionTimeMs: timeoutMs,
                lockKey,
                worker: this.lockManager.ownerId,
                errorMessage: 'Skipped due to active lock constraints',
                userId
            });
            return { success: false, status: 'skipped', locked: true };
        }

        // 4. Thiết lập chạy gia hạn khóa ngầm (Heartbeat) và đánh dấu trạng thái bắt đầu chạy
        this.lockManager.startHeartbeat(lockKey, 30000, ttlMs);
        this.healthProvider.markJobStarted(name);

        const startTime = Date.now();
        let status = 'failed';
        let errorMessage = null;
        let attempt = 0;

        // Chuẩn bị JobContext truyền cho handler
        const jobId = `${name}-${startTime}`;
        const context = {
            jobId,
            startedAt: new Date(startTime),
            signal: null, // Sẽ được TimeoutManager gán AbortSignal
            logger: {
                info: (msg) => console.log(`[JOB:${name}][${jobId}][INFO] ${msg}`),
                warn: (msg) => console.warn(`[JOB:${name}][${jobId}][WARN] ${msg}`),
                error: (msg) => console.error(`[JOB:${name}][${jobId}][ERROR] ${msg}`)
            },
            config: this.configProvider
        };

        try {
            // Hàm bọc để đếm số lượt chạy thử thực tế và quản lý timeout
            const wrappedHandler = async (ctx) => {
                attempt++;
                return await this.timeoutManager.executeWithTimeout(handler, timeoutMs, ctx);
            };

            // Thực thi nghiệp vụ với cơ chế Retry
            await this.retryManager.executeWithRetry(wrappedHandler, retryPolicy, context);
            status = 'success';
        } catch (err) {
            errorMessage = err.message || String(err);
            console.error(`[SCHEDULER RUNNER] Job "${name}" thực thi thất bại sau ${attempt} lần thử. Lỗi:`, err);
        } finally {
            const endTime = Date.now();
            const executionTimeMs = endTime - startTime;

            // 5. Ngừng Heartbeat, giải phóng khóa và đánh dấu hoàn tất chạy
            this.lockManager.stopHeartbeat(lockKey);
            await this.lockManager.releaseLock(lockKey);
            this.healthProvider.markJobFinished(name);

            // 6. Ghi log hoàn tất chạy job vào audit_logs
            await this.logger.logJob({
                jobName: name,
                status,
                attempt,
                executionTimeMs,
                maxExecutionTimeMs: timeoutMs,
                lockKey,
                worker: this.lockManager.ownerId,
                errorMessage,
                userId
            });
        }

        return {
            success: status === 'success',
            status,
            attempt,
            errorMessage
        };
    }
}

module.exports = SchedulerRunner;

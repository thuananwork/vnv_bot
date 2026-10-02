class TimeoutError extends Error {
    constructor(message, maxExecutionTimeMs) {
        super(message);
        this.name = 'TimeoutError';
        this.isTimeout = true;
        this.maxExecutionTimeMs = maxExecutionTimeMs;
    }
}

class TimeoutManager {
    /**
     * Thực thi một handler bọc trong giới hạn thời gian chờ
     * @param {Function} handler - Hàm nghiệp vụ
     * @param {number} timeoutMs - Thời gian chờ tối đa (ms)
     * @param {Object} context - Ngữ cảnh thực thi (sẽ được truyền abort signal)
     */
    async executeWithTimeout(handler, timeoutMs, context = {}) {
        if (!timeoutMs || timeoutMs <= 0) {
            return await handler(context);
        }

        const controller = new AbortController();
        context.signal = controller.signal;

        let timer;
        const timeoutPromise = new Promise((_, reject) => {
            timer = setTimeout(() => {
                // Kích hoạt tín hiệu hủy bỏ
                controller.abort();
                reject(new TimeoutError(`Tác vụ vượt quá giới hạn thời gian chạy ${timeoutMs}ms.`, timeoutMs));
            }, timeoutMs);
        });

        try {
            // Chạy song song handler và timer
            const result = await Promise.race([
                handler(context),
                timeoutPromise
            ]);
            return result;
        } finally {
            clearTimeout(timer);
        }
    }
}

module.exports = {
    timeoutManager: new TimeoutManager(),
    TimeoutError
};

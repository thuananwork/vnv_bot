class RetryManager {
    /**
     * Thực thi một handler có hỗ trợ retry và backoff
     * @param {Function} handler - Hàm nghiệp vụ cần chạy
     * @param {Object} retryPolicy - Chính sách thử lại
     * @param {Object} [context] - Context truyền vào handler
     */
    async executeWithRetry(handler, retryPolicy = {}, context = {}) {
        const policy = {
            attempts: 3,
            backoff: 'exponential', // 'exponential' | 'linear'
            baseDelayMs: 1000,
            shouldRetry: (error) => {
                // Mặc định: bỏ qua các lỗi Client/Nghiệp vụ, thử lại lỗi Server/Timeout/RateLimit
                if (error.name === 'ValidationError' || error.name === 'AccessDeniedError') {
                    return false;
                }
                if (error.status && [400, 401, 403, 404].includes(error.status)) {
                    return false;
                }
                return true; 
            },
            ...retryPolicy
        };

        let attempt = 0;
        
        while (true) {
            try {
                attempt++;
                return await handler(context);
            } catch (err) {
                // Kiểm tra xem đã hết lượt retry chưa hoặc lỗi có thuộc diện được retry không
                const isRetryable = policy.shouldRetry(err);
                if (attempt >= policy.attempts || !isRetryable) {
                    // Thêm thông tin số lượt đã thử vào error
                    err.attempts = attempt;
                    throw err;
                }

                // Tính toán độ trễ (delay)
                let delay = policy.baseDelayMs;
                const isQuotaError = err && (
                    (err.message && /quota|rate\s*limit|resource_exhausted|429/i.test(err.message)) ||
                    err.status === 429 ||
                    (err.originalError && (err.originalError.status === 429 || err.originalError.code === 429))
                );
                if (isQuotaError && delay < 3500) {
                    delay = 3500 * attempt;
                } else if (policy.backoff === 'exponential') {
                    delay = policy.baseDelayMs * Math.pow(2, attempt - 1);
                } else if (policy.backoff === 'linear') {
                    delay = policy.baseDelayMs * attempt;
                }

                // Bổ sung độ lệch ngẫu nhiên (jitter +/- 15%) tránh cộng hưởng
                const jitter = (Math.random() * 0.3 - 0.15) * delay;
                const finalDelay = Math.max(0, Math.floor(delay + jitter));

                console.warn(
                    `[RETRY MANAGER] ${isQuotaError ? '⚠️ Vượt hạn ngạch API (Quota): ' : ''}Gặp lỗi "${err.message}". ` +
                    `Đang tiến hành thử lại lần ${attempt + 1}/${policy.attempts} sau ${finalDelay}ms...`
                );

                await new Promise(resolve => setTimeout(resolve, finalDelay));
            }
        }
    }
}

module.exports = new RetryManager();

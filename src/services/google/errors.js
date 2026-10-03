class GoogleApiError extends Error {
    /**
     * Khởi tạo lỗi Google API tùy biến
     * @param {string} message 
     * @param {number} status 
     * @param {Error} [originalError] 
     */
    constructor(message, status, originalError = null) {
        super(message);
        this.name = 'GoogleApiError';
        this.status = status;
        this.originalError = originalError;
        this.isTransient = this.checkTransient(status, message, originalError);
    }

    /**
     * Xác định xem lỗi này là tạm thời (Transient - có thể retry) hay vĩnh viễn (Permanent - báo lỗi ngay)
     * @param {number} status 
     * @param {string} message 
     * @returns {boolean}
     */
    checkTransient(status, message, originalError = null) {
        // 1. Kiểm tra các mã lỗi HTTP có thể thử lại
        const errObj = originalError || this.originalError;
        const statusCode = status || (errObj && (errObj.status || errObj.code || (errObj.response && errObj.response.status)));
        const codeNum = parseInt(statusCode, 10);
        if ([429, 500, 502, 503, 504].includes(codeNum)) {
            return true;
        }

        // 2. Kiểm tra các mã lỗi mạng kết nối và Rate Limit / Quota
        if (message) {
            const lowerMessage = message.toLowerCase();
            const transientKeywords = [
                'etimedout', 'enotfound', 'econnreset', 'econnrefused',
                'socket hang up', 'network timeout', 'request timeout', 'timeout exceeded',
                'quota exceeded', 'quota', 'rate limit', 'resource_exhausted', 'too many requests'
            ];
            return transientKeywords.some(keyword => lowerMessage.includes(keyword));
        }

        return false;
    }
}

module.exports = {
    GoogleApiError
};

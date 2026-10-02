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
        this.isTransient = this.checkTransient(status, message);
    }

    /**
     * Xác định xem lỗi này là tạm thời (Transient - có thể retry) hay vĩnh viễn (Permanent - báo lỗi ngay)
     * @param {number} status 
     * @param {string} message 
     * @returns {boolean}
     */
    checkTransient(status, message) {
        // 1. Kiểm tra các mã lỗi HTTP có thể thử lại
        if ([429, 500, 502, 503, 504].includes(status)) {
            return true;
        }

        // 2. Kiểm tra các mã lỗi mạng kết nối
        if (message) {
            const lowerMessage = message.toLowerCase();
            const transientKeywords = [
                'etimedout', 'enotfound', 'econnreset', 'econnrefused',
                'socket hang up', 'network timeout', 'request timeout', 'timeout exceeded'
            ];
            return transientKeywords.some(keyword => lowerMessage.includes(keyword));
        }

        return false;
    }
}

module.exports = {
    GoogleApiError
};

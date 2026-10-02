const retryManager = require('../../scheduler/retry');
const { GoogleApiError } = require('./errors');

/**
 * Thực hiện gọi Google API bọc trong cơ chế tự động thử lại (Retry)
 * @param {Function} apiCall - Hàm callback thực thi API
 * @param {Object} [retryPolicy] - Chính sách thử lại tùy biến
 * @returns {Promise<any>}
 */
async function executeGoogleApiWithRetry(apiCall, retryPolicy = {}) {
    const defaultPolicy = {
        attempts: 3,
        backoff: 'exponential',
        baseDelayMs: 1000,
        shouldRetry: (error) => {
            if (error instanceof GoogleApiError) {
                return error.isTransient;
            }
            const status = error.status || (error.response ? error.response.status : null);
            const apiError = new GoogleApiError(error.message, status, error);
            return apiError.isTransient;
        }
    };

    const policy = { ...defaultPolicy, ...retryPolicy };

    return await retryManager.executeWithRetry(async () => {
        try {
            return await apiCall();
        } catch (err) {
            const status = err.status || (err.response ? err.response.status : null);
            throw new GoogleApiError(err.message, status, err);
        }
    }, policy);
}

module.exports = {
    executeGoogleApiWithRetry
};

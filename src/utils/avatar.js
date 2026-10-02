/**
 * Chuẩn hóa và xác thực URL Avatar từ Google
 * @param {string} value - URL avatar đầu vào
 * @returns {string|null} URL hợp lệ hoặc null nếu không hợp lệ
 */
function normalizeGoogleAvatarUrl(value) {
    if (typeof value !== 'string' || value.length === 0 || value.length > 2048) {
        return null;
    }

    try {
        const url = new URL(value);

        if (url.protocol !== 'https:') {
            return null;
        }

        const hostname = url.hostname.toLowerCase();

        if (
            hostname !== 'googleusercontent.com' &&
            !hostname.endsWith('.googleusercontent.com')
        ) {
            return null;
        }

        return url.toString();
    } catch {
        return null;
    }
}

module.exports = {
    normalizeGoogleAvatarUrl
};

/**
 * VNV-BOT V2: REMOTE LICENSE & KILLSWITCH SERVICE
 * 
 * Kiểm soát quyền kích hoạt từ xa của ứng dụng VNV-Bot thông qua GitHub Gist bí mật.
 * Cho phép Quản trị viên (Nguyễn Thuận An) ngắt quyền sử dụng từ xa bất cứ lúc nào
 * bằng cách đổi "active": false trên Gist.
 */

const https = require('https');

const GIST_LICENSE_URL = 'https://gist.githubusercontent.com/thuananwork/69a2366dadcf5cebb980acd2509f8c72/raw/vnv_bot_license.json';

// Trạng thái cache trong bộ nhớ (mặc định hợp lệ khi khởi động)
let cachedStatus = {
    checkedAt: 0,
    allowed: true,
    message: 'Hệ thống đang hoạt động bình thường.'
};

let mockStatus = null;

const CACHE_TTL_MS = 30 * 1000; // Cache 30 giây để tránh spam request

/**
 * Tải và kiểm tra trạng thái giấy phép từ Gist
 * @param {boolean} force - Bắt buộc kiểm tra trực tiếp bỏ qua cache
 * @returns {Promise<{allowed: boolean, message: string}>}
 */
function fetchRemoteLicense(force = false) {
    if (mockStatus !== null) {
        return Promise.resolve(mockStatus);
    }

    const now = Date.now();
    if (!force && cachedStatus.checkedAt > 0 && (now - cachedStatus.checkedAt < CACHE_TTL_MS)) {
        return Promise.resolve(cachedStatus);
    }

    return new Promise((resolve) => {
        const url = `${GIST_LICENSE_URL}?_t=${now}`;
        const req = https.get(url, { timeout: 4000 }, (res) => {
            if (res.statusCode !== 200) {
                // Nếu Gist trả lỗi HTTP nhưng trước đó đang active thì giữ nguyên
                cachedStatus.checkedAt = now;
                return resolve(cachedStatus);
            }

            let rawData = '';
            res.on('data', chunk => rawData += chunk);
            res.on('end', () => {
                try {
                    const data = JSON.parse(rawData);
                    const isActive = data.active !== false; // chỉ khóa khi tường minh active === false
                    const msg = data.message || (isActive ? 'Hệ thống đang hoạt động bình thường.' : 'Phiên bản VNV-Bot này đã bị Quản trị viên tạm dừng từ xa.');
                    
                    cachedStatus = {
                        checkedAt: now,
                        allowed: isActive,
                        message: msg
                    };
                    resolve(cachedStatus);
                } catch (pErr) {
                    cachedStatus.checkedAt = now;
                    resolve(cachedStatus);
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            cachedStatus.checkedAt = now;
            resolve(cachedStatus);
        });

        req.on('error', () => {
            cachedStatus.checkedAt = now;
            resolve(cachedStatus);
        });
    });
}

/**
 * Kiểm tra trạng thái hiện tại (đồng bộ nếu có cache, không thì fetch)
 */
async function getLicenseStatus(force = false) {
    return await fetchRemoteLicense(force);
}

/**
 * Kiểm tra nhanh xem bot có đang được phép hoạt động không
 */
async function isAllowed(force = false) {
    const status = await getLicenseStatus(force);
    return status.allowed;
}

function setMockStatus(status) {
    mockStatus = status;
}

function clearMockStatus() {
    mockStatus = null;
}

module.exports = {
    GIST_LICENSE_URL,
    getLicenseStatus,
    isAllowed,
    fetchRemoteLicense,
    setMockStatus,
    clearMockStatus
};

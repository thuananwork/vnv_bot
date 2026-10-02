/**
 * VNV-BOT V2: REMOTE LICENSE & KILLSWITCH SERVICE
 * 
 * Kiểm soát quyền kích hoạt từ xa của ứng dụng VNV-Bot thông qua GitHub Gist bí mật.
 * Cho phép Quản trị viên (Nguyễn Thuận An) ngắt quyền sử dụng từ xa bất cứ lúc nào
 * bằng cách đổi "active": false trên Gist.
 */

const https = require('https');

const GIST_API_URL = 'https://api.github.com/gists/69a2366dadcf5cebb980acd2509f8c72';
const GIST_LICENSE_URL = 'https://gist.githubusercontent.com/thuananwork/69a2366dadcf5cebb980acd2509f8c72/raw/vnv_bot_license.json';

// Trạng thái cache trong bộ nhớ (mặc định hợp lệ khi khởi động)
let cachedStatus = {
    checkedAt: 0,
    allowed: true,
    message: 'Hệ thống đang hoạt động bình thường.'
};

let mockStatus = null;

const CACHE_TTL_MS = 30 * 1000; // Cache 30 giây để tránh spam request

function fetchFromUrl(url, headers = {}) {
    return new Promise((resolve, reject) => {
        const req = https.get(url, { headers, timeout: 4000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, body: data }));
        });
        req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        req.on('error', (err) => reject(err));
    });
}

/**
 * Tải và kiểm tra trạng thái giấy phép từ Gist
 * @param {boolean} force - Bắt buộc kiểm tra trực tiếp bỏ qua cache
 * @returns {Promise<{allowed: boolean, message: string}>}
 */
async function fetchRemoteLicense(force = false) {
    if (mockStatus !== null) {
        return mockStatus;
    }

    const now = Date.now();
    if (!force && cachedStatus.checkedAt > 0 && (now - cachedStatus.checkedAt < CACHE_TTL_MS)) {
        return cachedStatus;
    }

    try {
        let jsonData = null;

        // Ưu tiên 1: GitHub Gist API (Phản hồi tức thì, không bị trễ cache CDN của GitHub)
        try {
            const apiRes = await fetchFromUrl(GIST_API_URL, { 'User-Agent': 'VNV-Bot' });
            if (apiRes.statusCode === 200) {
                const gistObj = JSON.parse(apiRes.body);
                if (gistObj.files && gistObj.files['vnv_bot_license.json']) {
                    jsonData = JSON.parse(gistObj.files['vnv_bot_license.json'].content);
                }
            }
        } catch (apiErr) {
            // Fallback tiếp tục bên dưới
        }

        // Ưu tiên 2 (Fallback): Raw Gist URL nếu API bị giới hạn rate limit
        if (!jsonData) {
            const rawRes = await fetchFromUrl(`${GIST_LICENSE_URL}?_t=${now}`);
            if (rawRes.statusCode === 200) {
                jsonData = JSON.parse(rawRes.body);
            }
        }

        if (jsonData) {
            const isActive = jsonData.active !== false; // Chỉ khóa khi tường minh active === false
            const msg = jsonData.message || (isActive ? 'Hệ thống đang hoạt động bình thường.' : 'Phiên bản này đã bị tạm dừng bởi Admin. Vui lòng liên hệ Admin!');
            cachedStatus = {
                checkedAt: now,
                allowed: isActive,
                message: msg
            };
        } else {
            cachedStatus.checkedAt = now;
        }
    } catch (err) {
        cachedStatus.checkedAt = now;
    }

    return cachedStatus;
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

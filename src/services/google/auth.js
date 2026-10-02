let _GoogleAuth = null;
function getGoogleAuth() {
    if (!_GoogleAuth) {
        _GoogleAuth = require('google-auth-library').GoogleAuth;
    }
    return _GoogleAuth;
}
const fs = require('fs');
const path = require('path');

let authClientInstance = null;

/**
 * Khởi tạo hoặc lấy JWT Auth Client hiện tại (Singleton)
 * @returns {Object} google.auth.JWT client
 */
function getAuthClient() {
    if (process.env.MOCK_GOOGLE_SHEETS === 'true') {
        return null;
    }

    if (authClientInstance) {
        return authClientInstance;
    }

    let credentials = null;
    let credentialsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;

    // 1. Kiểm tra biến môi trường chứa đường dẫn
    if (credentialsPath) {
        try {
            if (fs.existsSync(credentialsPath)) {
                console.log(`[GOOGLE AUTH] Đang tải credentials từ biến môi trường: "${credentialsPath}"`);
                const content = fs.readFileSync(credentialsPath, 'utf8');
                credentials = JSON.parse(content);
            } else {
                // Hỗ trợ trường hợp GOOGLE_APPLICATION_CREDENTIALS chứa trực tiếp JSON string
                console.log('[GOOGLE AUTH] GOOGLE_APPLICATION_CREDENTIALS không phải đường dẫn tệp. Thử phân tích cú pháp chuỗi JSON trực tiếp...');
                credentials = JSON.parse(credentialsPath);
            }
        } catch (err) {
            console.error('[GOOGLE AUTH] Lỗi khi nạp credentials từ biến môi trường:', err.message);
        }
    }

    // 2. Fallback sang file config/credentials.json hoặc data/credentials.json cục bộ
    if (!credentials) {
        const candidatePaths = [
            path.join(__dirname, '../../../config/credentials.json'),
            path.join(__dirname, '../../../data/credentials.json'),
            path.join(process.cwd(), 'config/credentials.json'),
            path.join(process.cwd(), 'data/credentials.json')
        ];

        for (const p of candidatePaths) {
            if (fs.existsSync(p)) {
                console.log(`[GOOGLE AUTH] Tìm kiếm credentials dự phòng tại: "${p}"`);
                try {
                    const content = fs.readFileSync(p, 'utf8');
                    credentials = JSON.parse(content);
                    console.log('[GOOGLE AUTH] Đã tải credentials dự phòng thành công.');
                    break;
                } catch (readErr) {
                    console.error(`[GOOGLE AUTH] Lỗi khi đọc file credentials tại "${p}":`, readErr.message);
                }
            }
        }
    }

    if (!credentials) {
        console.warn('[GOOGLE AUTH] CẢNH BÁO: Không tìm thấy thông tin xác thực Google Service Account. Chạy ở chế độ giả lập (Mock).');
        return null;
    }

    // 3. Khởi tạo GoogleAuth với đầy đủ Scopes và Credentials
    try {
        const { google } = require('googleapis');
        authClientInstance = new google.auth.GoogleAuth({
            credentials,
            scopes: [
                'https://www.googleapis.com/auth/spreadsheets',
                'https://www.googleapis.com/auth/drive.readonly'
            ]
        });
        console.log('[GOOGLE AUTH] Khởi tạo thành công Google Auth Client.');
        return authClientInstance;
    } catch (err) {
        console.error('[GOOGLE AUTH] Lỗi khởi tạo Auth Client:', err);
        return null;
    }
}

module.exports = {
    getAuthClient
};

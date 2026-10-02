const { OAuth2Client } = require('google-auth-library');
const crypto = require('crypto');

// Khởi tạo OAuth2 Client tĩnh
const oauth2Client = new OAuth2Client(
    process.env.GOOGLE_OAUTH_CLIENT_ID,
    process.env.GOOGLE_OAUTH_CLIENT_SECRET,
    process.env.GOOGLE_OAUTH_REDIRECT_URI
);

// Tối ưu hóa cấu hình Transporter defaults cho google-auth-library để kiểm soát Timeout & Retry
// GIỚI HẠN KỸ THUẬT: Thư viện google-auth-library (gaxios) không hỗ trợ tách biệt socket connect timeout
// và read timeout ở tầng transporter API hiện tại. Do đó, overall network timeout được thiết lập là 10,000ms
// (Separate connect timeout: NOT SEPARATELY ENFORCED).
oauth2Client.transporter.defaults = {
    timeout: 10000, // Overall network timeout 10 giây (tối đa 10,000ms)
    retryConfig: {
        retry: 0 // Không tự động thử lại (Retry count = 0)
    }
};

/**
 * Sinh URL Đăng nhập với Google kèm State, Nonce và PKCE
 * @param {object} req - Express Request
 * @returns {string} URL chuyển hướng đăng nhập Google
 */
function getAuthUrl(req) {
    // 1. Sinh State ngẫu nhiên chống CSRF
    const state = crypto.randomBytes(32).toString('hex');
    req.session.oauth_state = state;
    req.session.oauth_state_created_at = Date.now();

    // 2. Sinh Nonce ngẫu nhiên chống Replay Attacks
    const nonce = crypto.randomBytes(32).toString('hex');
    req.session.oauth_nonce = nonce;
    req.session.oauth_nonce_created_at = Date.now();

    // 3. Sinh PKCE code_verifier và code_challenge
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    req.session.code_verifier = codeVerifier;
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    return oauth2Client.generateAuthUrl({
        access_type: 'online',
        scope: ['openid', 'email', 'profile'],
        state: state,
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        nonce: nonce
    });
}

/**
 * Xác thực Authorization Code nhận được từ Google callback
 * @param {object} req - Express Request
 * @param {string} code - Authorization code từ Google
 * @param {string} state - State từ Google
 * @returns {Promise<object>} Profile thông tin user đã xác thực
 */
async function verifyCallback(req, code, state) {
    try {
        // 1. Kiểm tra State chống CSRF & TTL 10 phút
        const savedState = req.session.oauth_state;
        const stateCreatedAt = req.session.oauth_state_created_at;

        if (!savedState || !state || savedState !== state) {
            throw new Error('invalid_state');
        }
        if (!stateCreatedAt || (Date.now() - stateCreatedAt > 10 * 60 * 1000)) {
            throw new Error('invalid_state'); // State đã hết hạn (TTL 10m)
        }

        // 2. Kiểm tra OIDC Nonce & TTL 10 phút
        const savedNonce = req.session.oauth_nonce;
        const nonceCreatedAt = req.session.oauth_nonce_created_at;
        if (!savedNonce) {
            throw new Error('invalid_state');
        }
        if (!nonceCreatedAt || (Date.now() - nonceCreatedAt > 10 * 60 * 1000)) {
            throw new Error('invalid_state'); // Nonce đã hết hạn (TTL 10m)
        }

        // 3. Kiểm tra code_verifier PKCE
        const codeVerifier = req.session.code_verifier;
        if (!codeVerifier) {
            throw new Error('invalid_state');
        }

        // 4. Thiết lập AbortController cho kết nối mạng (Overall Timeout <= 10s)
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
            controller.abort();
        }, 10000); // Overall network timeout 10 giây

        try {
            // Trao đổi mã code lấy token (Sử dụng Abort Signal)
            const { tokens } = await oauth2Client.getToken({
                code,
                codeVerifier,
                requestOptions: {
                    signal: controller.signal
                }
            });
            clearTimeout(timeoutId);

            if (!tokens.id_token) {
                throw new Error('unknown_error');
            }

            // 5. Xác thực ID Token bằng thư viện chính thức google-auth-library
            // (Tự động xác thực chữ ký, thời gian sống exp, nbf, iat, aud, iss)
            const ticket = await oauth2Client.verifyIdToken({
                idToken: tokens.id_token,
                audience: process.env.GOOGLE_OAUTH_CLIENT_ID
            });
            const payload = ticket.getPayload();

            // 6. Kiểm tra các xác nhận bổ sung
            // a. Đối khớp Nonce
            if (payload.nonce !== savedNonce) {
                throw new Error('invalid_state'); // Phát hiện replay attack hoặc sai lệch nonce
            }
            
            // b. Kiểm tra email_verified
            if (payload.email_verified !== true) {
                throw new Error('email_not_verified');
            }

            // Trả về profile sạch
            return {
                google_id: payload.sub, // MUST use the immutable 'sub' claim
                email: payload.email,
                name: payload.name,
                picture: payload.picture
            };
        } catch (err) {
            clearTimeout(timeoutId);
            if (err.name === 'AbortError') {
                throw new Error('network_error'); // Trả về lỗi timeout kết nối
            }
            if (err.message && (err.message.includes('invalid_grant') || err.message.includes('expired_code'))) {
                throw new Error('invalid_grant');
            }
            throw err;
        }
    } finally {
        delete req.session.oauth_state;
        delete req.session.oauth_state_created_at;
        delete req.session.oauth_nonce;
        delete req.session.oauth_nonce_created_at;
        delete req.session.code_verifier;
    }
}

module.exports = {
    getAuthUrl,
    verifyCallback
};

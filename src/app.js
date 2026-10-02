require('./utils/env_loader');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const path = require('path');
const crypto = require('crypto');
const helmet = require('helmet');
const connectSqlite = require('connect-sqlite3');
const sqlite3 = require('sqlite3').verbose();
const stats = require('./utils/stats');
const metrics = require('./utils/metrics');
const apiRoutes = require('./routes');

const app = express();

// 1. Tích hợp Helmet bảo vệ Security Headers (CSP, X-Frame-Options, Referrer-Policy, nosniff)
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", "https://apis.google.com", "https://*.gstatic.com"],
            scriptSrcAttr: ["'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdnjs.cloudflare.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdnjs.cloudflare.com"],
            imgSrc: ["'self'", "data:", "https://lh3.googleusercontent.com", "https://*.googleusercontent.com"],
            connectSrc: ["'self'", "https://accounts.google.com"],
            frameSrc: ["'self'", "https://accounts.google.com"]
        }
    }
}));

// 2. Middleware Request Tracking: Tạo requestId (UUID v4) và log action duration
app.use((req, res, next) => {
    req.requestId = crypto.randomUUID();
    req.startTime = Date.now();
    res.setHeader('X-Request-ID', req.requestId);
    next();
});

// Middleware parse body và cookie
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// 3. Origin & Referer Validation Middleware
function validateOriginAndReferer(req, res, next) {
    if (req.path === '/api/auth/google/callback') {
        return next();
    }
    
    const origin = req.headers.origin;
    const referer = req.headers.referer;
    const host = req.headers.host;
    
    if (origin) {
        try {
            const originUrl = new URL(origin);
            if (originUrl.host !== host) {
                return res.status(403).json({ error: 'Yêu cầu không hợp lệ (Origin mismatch).' });
            }
        } catch (e) {
            return res.status(403).json({ error: 'Yêu cầu không hợp lệ.' });
        }
    } else if (referer) {
        try {
            const refererUrl = new URL(referer);
            if (refererUrl.host !== host) {
                return res.status(403).json({ error: 'Yêu cầu không hợp lệ (Referer mismatch).' });
            }
        } catch (e) {
            return res.status(403).json({ error: 'Yêu cầu không hợp lệ.' });
        }
    } else {
        const isLocalhostHost = host && (host.startsWith('localhost:') || host === 'localhost' || host.startsWith('127.0.0.1:') || host === '127.0.0.1');
        const remoteIp = req.socket.remoteAddress;
        const isLocalhostIp = remoteIp === '127.0.0.1' || remoteIp === '::1' || remoteIp === '::ffff:127.0.0.1';
        
        if (!isLocalhostHost || !isLocalhostIp) {
            return res.status(403).json({ error: 'Yêu cầu không hợp lệ (Missing Origin/Referer).' });
        }
    }
    next();
}
app.use(validateOriginAndReferer);

// 4. Trust proxy nếu chạy sau reverse proxy (Nginx, Cloudflare)
if (process.env.TRUST_PROXY === 'true') {
    app.set('trust proxy', 1);
}

// 5. Khởi chạy và xác thực Session Secret (Fail-fast)
const rawSecrets = process.env.SESSION_SECRET;
if (!rawSecrets || rawSecrets.trim() === '') {
    console.error('LỖI KHỞI CHẠY NGHIÊM TRỌNG: Biến môi trường SESSION_SECRET không được để trống.');
    process.exit(1);
}
const secretsArray = rawSecrets.split(',').map(s => s.trim()).filter(Boolean);
if (secretsArray.length === 0) {
    console.error('LỖI KHỞI CHẠY NGHIÊM TRỌNG: Mảng SESSION_SECRET rỗng.');
    process.exit(1);
}
if (secretsArray[0].length < 32) {
    console.error('LỖI KHỞI CHẠY NGHIÊM TRỌNG: Phần tử đầu tiên của SESSION_SECRET phải dài tối thiểu 32 ký tự.');
    process.exit(1);
}

// Cấu hình Session Store cho Production / Desktop App
const SqliteStore = connectSqlite(session);
const sessionStore = new SqliteStore({
    db: 'sessions.db',
    dir: path.join(__dirname, '../data'),
    table: 'sessions',
    cleanupInterval: 3600000 // 1 giờ dọn dẹp các session expired một lần
});

app.use(session({
    name: 'vnv.sid',
    secret: secretsArray,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    store: sessionStore,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        secure: process.env.COOKIE_SECURE === 'true'
    }
}));

// 6. Serve thư mục giao diện Web tĩnh
app.use(express.static(path.join(__dirname, 'web')));

// 7. Middleware kiểm tra trạng thái Shutdown
app.use((req, res, next) => {
    if (!req.path.startsWith('/api/health') && !req.path.startsWith('/api/ready') && req.path !== '/metrics') {
        if (stats.isShuttingDown) {
            res.setHeader('Connection', 'close');
            return res.status(503).json({ error: 'Server is shutting down' });
        }
        stats.acceptedRequests++;
    }
    next();
});

// 8. Prometheus Metrics Endpoint
app.get('/metrics', async (req, res) => {
    const formatted = await metrics.formatPrometheusMetrics();
    res.set('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(formatted);
});

// 8.5. Remote Killswitch Middleware (Kiểm tra quyền kích hoạt từ xa)
const remoteLicense = require('./services/remote_license');

app.use('/api', async (req, res, next) => {
    // Bỏ qua các endpoint kiểm tra sức khỏe hệ thống
    if (req.path.startsWith('/health') || req.path.startsWith('/ready') || req.path === '/system/license-status') {
        return next();
    }

    try {
        const lic = await remoteLicense.getLicenseStatus();
        if (!lic.allowed) {
            return res.status(403).json({
                success: false,
                revoked: true,
                error: lic.message || 'Phiên bản VNV-Bot này đã bị Quản trị viên tạm dừng từ xa.'
            });
        }
    } catch (licErr) {
        // Fallback an toàn nếu lỗi mạng: không làm gián đoạn người dùng
    }
    next();
});

// 9. Đăng ký Modular API Routes (Tất cả router con được gom gọn gàng trong /api)
app.use('/api', apiRoutes);

// 10. Global Error Handling Middleware
app.use((err, req, res, next) => {
    console.error(`[UNHANDLED ERROR] [${req.requestId || 'no-id'}]:`, err);
    if (!res.headersSent) {
        res.status(500).json({ error: 'Đã xảy ra lỗi máy chủ nội bộ.', requestId: req.requestId });
    }
});

module.exports = app;

const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}
require('./utils/env_loader');
const crypto = require('crypto');
const app = require('./app');
const db = require('./config/db');
const { startScheduler } = require('./scheduler');
const logger = require('./utils/logger');
const stats = require('./utils/stats');

const PORT = process.env.PORT || 3000;
const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

// 1. CONFIGURATION VALIDATION (Fail Fast)
function validateConfig() {
    // Legacy env name detection
    const legacyKeys = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REDIRECT_URI'];
    const foundLegacy = legacyKeys.filter(k => process.env[k]);
    
    const required = ['JWT_SECRET', 'GOOGLE_SHEET_ID', 'GOOGLE_OAUTH_CLIENT_ID', 'GOOGLE_OAUTH_CLIENT_SECRET', 'GOOGLE_OAUTH_REDIRECT_URI'];
    const missing = required.filter(k => !process.env[k]);
    
    if (foundLegacy.length > 0 && missing.some(k => k.startsWith('GOOGLE_OAUTH_'))) {
        console.error(`FATAL: Phát hiện cấu hình biến môi trường legacy (${foundLegacy.join(', ')}). Yêu cầu chuyển đổi sang tên canonical: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REDIRECT_URI`);
        process.exit(1);
    }
    
    if (missing.length > 0) {
        console.error(`FATAL: Thiếu các biến cấu hình bắt buộc: ${missing.join(', ')}`);
        process.exit(1);
    }

    const redirectUri = process.env.GOOGLE_OAUTH_REDIRECT_URI;
    if (!redirectUri || (!redirectUri.startsWith('http://') && !redirectUri.startsWith('https://'))) {
        console.error('FATAL: Biến cấu hình GOOGLE_OAUTH_REDIRECT_URI không hợp lệ (phải bắt đầu bằng http:// hoặc https://)');
        process.exit(1);
    }
    
    const validLevels = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];
    if (!validLevels.includes(LOG_LEVEL.toLowerCase())) {
        console.error(`FATAL: Cấu hình LOG_LEVEL "${LOG_LEVEL}" không hợp lệ. Phải là một trong: ${validLevels.join(', ')}`);
        process.exit(1);
    }
}

async function runSelfChecks() {
    const status = {
        sqlite: 'FAILED',
        queue: 'FAILED',
        zalo: 'FAILED',
        google: 'FAILED',
        worker: 'FAILED'
    };

    try {
        // SQLite
        await db.get('SELECT 1');
        status.sqlite = 'OK';

        // Queue
        await db.get("SELECT COUNT(*) FROM zalo_message_queue");
        status.queue = 'OK';

        // Zalo Web (Puppeteer Automation)
        try {
            const { zaloBrowserManager } = require('./services/zalo_browser_manager');
            status.zalo = zaloBrowserManager ? 'OK' : 'WARN';
        } catch (zErr) {
            status.zalo = 'WARN';
        }

        // Google Sheets
        if (process.env.SAFE_MODE === 'true') {
            console.log('[STARTUP CHECK] Đang chạy ở chế độ SAFE_MODE, bỏ qua tự kiểm tra Google Sheets.');
            status.google = 'SKIP (SAFE_MODE)';
        } else {
            try {
                const { getAuthClient } = require('./services/google/auth');
                const client = getAuthClient();
                status.google = client ? 'OK' : 'MOCK';
            } catch (gErr) {
                status.google = 'WARN';
            }
        }

        // Worker
        const puppeteerProvider = require('./services/zalo/providers/puppeteer_provider');
        if (puppeteerProvider.enabled && !puppeteerProvider.workerProcess) {
            throw new Error('Puppeteer Worker enabled but process not running');
        }
        status.worker = 'OK';

        return status;
    } catch (err) {
        console.error('FATAL: Startup Self Check thất bại:', err.message);
        process.exit(1);
    }
}

// Graceful Shutdown Coordinator
const shutdownStartTime = Date.now();

async function gracefulShutdown(signal) {
    if (stats.isShuttingDown) return;
    stats.isShuttingDown = true;
    console.log(`\n[SHUTDOWN] Nhận tín hiệu ${signal}. Bắt đầu Graceful Shutdown...`);

    const timeoutMs = parseInt(process.env.SHUTDOWN_TIMEOUT_MS, 10) || 15000;
    
    // 1. Drain Queue with Timeout
    const drainPromise = new Promise(async (resolve) => {
        while (true) {
            const pending = await db.get("SELECT COUNT(*) as count FROM zalo_message_queue WHERE status = 'pending' OR status = 'processing'");
            if (!pending || pending.count === 0) {
                resolve('CLEAN');
                break;
            }
            await new Promise(r => setTimeout(r, 100));
        }
    });

    const timeoutPromise = new Promise((resolve) => {
        setTimeout(async () => {
            const pendingItems = await db.all("SELECT id, status FROM zalo_message_queue WHERE status = 'pending' OR status = 'processing'");
            console.warn('[SHUTDOWN WARNING] Graceful Shutdown timeout! Draining không hoàn tất.', pendingItems);
            resolve('FORCED');
        }, timeoutMs);
    });

    const shutdownStatus = await Promise.race([drainPromise, timeoutPromise]);

    // Query stats before closing db connection
    let remainingQueueCount = 0;
    try {
        const remaining = await db.get("SELECT COUNT(*) as count FROM zalo_message_queue WHERE status = 'pending' OR status = 'processing'");
        remainingQueueCount = remaining ? remaining.count : 0;
    } catch (err) {}

    // 2. Terminate Puppeteer worker
    try {
        const puppeteerProvider = require('./services/zalo/providers/puppeteer_provider');
        if (puppeteerProvider && typeof puppeteerProvider.stop === 'function') {
            await puppeteerProvider.stop();
        }
    } catch (err) {}

    // 3. Close SQLite DB connection
    try {
        await db.close();
    } catch (err) {}

    // 4. Print Shutdown Report
    const duration = ((Date.now() - shutdownStartTime) / 1000).toFixed(1);
    console.log('\n=========================================');
    console.log('            Shutdown Summary');
    console.log('=========================================');
    console.log(`accepted_requests : ${stats.acceptedRequests}`);
    console.log(`completed_queue   : ${stats.completedQueueItems}`);
    console.log(`remaining_queue   : ${remainingQueueCount}`);
    console.log(`worker_restart    : ${stats.workerRestarts}`);
    console.log(`duration          : ${duration} s`);
    console.log(`status            : ${shutdownStatus}`);
    console.log('=========================================');

    process.exit(shutdownStatus === 'CLEAN' ? 0 : 1);
}

// Register OS signals
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Bắt các lỗi promise không được xử lý để tránh sập máy chủ đột ngột
process.on('unhandledRejection', (reason) => {
    console.warn('[SERVER SAFETY] Bỏ qua Unhandled Rejection để giữ máy chủ ổn định:', reason && reason.message ? reason.message : reason);
});

process.on('uncaughtException', (err) => {
    console.error('[SERVER SAFETY] Bắt Uncaught Exception:', err && err.message ? err.message : err);
});

async function start() {
    const isSimpleConsole = process.env.CONSOLE_FORMAT === 'simple' || process.env.NODE_ENV !== 'production';
    // 1. Validate Config first
    validateConfig();

    try {
        // 2. Khởi chạy Web Server & Mở trình duyệt khi máy chủ đã sẵn sàng lắng nghe
        const server = app.listen(PORT, () => {
            logger.info(`VNV-BOT V2 - LOCAL BACKEND SERVER STARTED tại http://localhost:${PORT}`);
            console.log(`✔ Máy chủ Web đã lắng nghe tại http://localhost:${PORT}`);
            
            // Tự động mở trình duyệt DUY NHẤT 1 LẦN khi máy chủ đã hoàn toàn sẵn sàng lắng nghe kết nối
            if (process.env.AUTO_OPEN_BROWSER !== 'false' && process.env.NODE_ENV !== 'test' && !process.env.CI && !process.env.HEADLESS_MODE) {
                const isWin = process.platform === 'win32';
                const isMac = process.platform === 'darwin';
                const openCmd = isWin ? `start "" "http://localhost:${PORT}/#login"` : isMac ? `open "http://localhost:${PORT}/#login"` : `xdg-open "http://localhost:${PORT}/#login"`;
                const { exec } = require('child_process');
                setTimeout(() => {
                    exec(openCmd, (err) => {
                        if (err) logger.warn(`Không thể tự động mở trình duyệt: ${err.message}`);
                    });
                }, 400);
            }
        });

        // 3. Khởi tạo Database SQLite & Self Checks nhanh
        console.log('Đang kiểm tra và đồng bộ cơ sở dữ liệu SQLite...');
        await db.initDb();
        console.log('✔ Cơ sở dữ liệu SQLite: SẴN SÀNG');
        
        const checkStatus = await runSelfChecks();

        // 4. Khởi chạy Scheduler ngầm (không chặn hoặc làm trễ máy chủ web)
        startScheduler().catch(schedErr => {
            console.error('[SERVER ENTRYPOINT] Cảnh báo: Khởi động bộ Scheduler thất bại. Lỗi:', schedErr);
        });

        // 4.1 Kiểm tra giấy phép từ xa (Remote Killswitch)
        const remoteLicense = require('./services/remote_license');
        remoteLicense.getLicenseStatus(true).then((lic) => {
            if (!lic.allowed) {
                console.error('\n=============================================================');
                console.error('⛔ CẢNH BÁO: PHIÊN BẢN VNV-BOT ĐÃ BỊ TẠM DỪNG TỪ XA');
                console.error(`Thông báo: ${lic.message}`);
                console.error('Vui lòng liên hệ Quản trị viên Nguyễn Thuận An để được hỗ trợ.');
                console.error('=============================================================\n');
            } else {
                console.log('✔ Trạng thái bản quyền trực tuyến: HỢP LỆ (ACTIVE)');
            }
        }).catch(() => {});

        // 5. Log Config Fingerprint
        const configHash = crypto.createHash('md5').update(process.env.JWT_SECRET + process.env.GOOGLE_SHEET_ID).digest('hex').slice(0, 8);
        logger.info('Startup configuration fingerprint', {
            event: 'startup',
            config_hash: configHash,
            safe_mode: process.env.SAFE_MODE === 'true',
            log_level: LOG_LEVEL,
            google_enabled: true,
            queue_limit: 500
        });

        if (process.env.SAFE_MODE === 'true') {
            logger.warn('WARN: SAFE MODE ENABLED - Google Sheets Sync Disabled, Submission Persist Disabled, Zalo Reply Disabled');
        }

        // 6. Output Startup Report ASCII Table
        if (!isSimpleConsole) {
            console.log('========================');
            console.log(' VNV BOT STARTUP');
            console.log('========================');
            console.log(`SQLite.............${checkStatus.sqlite}`);
            console.log(`Queue..............${checkStatus.queue}`);
            console.log(`Zalo Web...........${checkStatus.zalo}`);
            console.log(`Google.............${checkStatus.google}`);
            console.log(`Worker.............${checkStatus.worker}`);
            console.log('');
            console.log(`Version............${process.env.APP_VERSION || '2.0.0'}`);
            console.log(`Safe Mode..........${process.env.SAFE_MODE === 'true' ? 'ON' : 'OFF'}`);
            console.log(`Listening..........${PORT}`);
            console.log('========================');
            console.log('READY');
            console.log('========================');
        } else {
            console.log(`✔ Startup Checks: SQLite=${checkStatus.sqlite}, Queue=${checkStatus.queue}, ZaloWeb=${checkStatus.zalo}, Google=${checkStatus.google}, Worker=${checkStatus.worker}`);
            console.log(`✔ Safe Mode: ${process.env.SAFE_MODE === 'true' ? 'ON' : 'OFF'}`);
        }
    } catch (err) {
        console.error('Không thể khởi động ứng dụng:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    start();
}

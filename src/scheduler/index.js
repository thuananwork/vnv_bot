const cron = require('node-cron');
const cronParser = require('cron-parser');

// Hàm wrapper hỗ trợ mọi định dạng export của thư viện cron-parser (CJS/ESM)
function parseCron(expression, options) {
    if (typeof cronParser.parseExpression === 'function') {
        return cronParser.parseExpression(expression, options);
    }
    if (cronParser.default && typeof cronParser.default.parse === 'function') {
        return cronParser.default.parse(expression, options);
    }
    throw new Error('Unsupported cron-parser version');
}
const db = require('../config/db');
const configProvider = require('./config');
const lockManager = require('./lock');
const retryManager = require('./retry');
const { timeoutManager } = require('./timeout');
const logger = require('./logger');
const globalLogger = require('../utils/logger');
const healthProvider = require('./health');
const SchedulerRunner = require('./runner');
const jobs = require('./jobs');

// Bản đồ lưu trữ các cron task đang kích hoạt trong bộ nhớ
let activeCronJobs = new Map();
let configRevision = '';

// Khởi tạo SchedulerRunner thông qua Dependency Injection
const runner = new SchedulerRunner({
    lockManager,
    retryManager,
    timeoutManager,
    logger,
    configProvider,
    healthProvider
});

function scheduleJob(job, cronExpr, timezone, options = {}) {
    return cron.schedule(cronExpr, async () => {
        const today = new Date().toLocaleDateString('sv'); // sv format: YYYY-MM-DD
        const lockKey = `lock:${job.name}:${today}`;
        
        globalLogger.info(`[SCHEDULER] Bắt đầu kích hoạt Job "${job.name}" qua Cron. LockKey: "${lockKey}"`);
        
        await runner.runJob({
            name: job.name,
            lockKey,
            handler: job.handler,
            retryPolicy: job.retryPolicy,
            timeoutMs: job.timeoutMs
        });
    }, {
        timezone: timezone,
        scheduled: options.scheduled !== false
    });
}

/**
 * Khởi động bộ Scheduler, dọn dẹp khóa cũ và lên lịch các job
 */
async function startScheduler() {
    try {
        globalLogger.debug('[SCHEDULER] Đang khởi động bộ định thời...');
        
        // 1. Phục hồi và dọn dẹp các khóa bị kẹt từ phiên làm việc trước
        await lockManager.recoverStaleLocks();

        // 2. Kiểm tra cấu hình kích hoạt toàn cục
        const enabled = await configProvider.isSchedulerEnabled();
        if (!enabled) {
            globalLogger.warn('[SCHEDULER] Scheduler đang bị tắt toàn cục trong local_config. Bỏ qua lên lịch.');
            return;
        }

        const timezone = await configProvider.getTimezone();
        let scheduledCount = 0;
        
        // 3. Đăng ký các Job
        for (const job of jobs) {
            const jobEnabled = await configProvider.isJobEnabled(job.name);
            if (!jobEnabled) {
                globalLogger.debug(`[SCHEDULER] Job "${job.name}" đang bị tắt. Bỏ qua lên lịch.`);
                continue;
            }

            const cronExpr = await configProvider.getCronExpression(job.name);
            try {
                // Kiểm định tính hợp lệ của biểu thức cron trước khi lập lịch
                parseCron(cronExpr, { tz: timezone });
                
                const task = scheduleJob(job, cronExpr, timezone);
                activeCronJobs.set(job.name, { task, cron: cronExpr, timezone });
                scheduledCount++;
                
                globalLogger.debug(`[SCHEDULER] Đã lên lịch thành công cho Job "${job.name}" với Cron: "${cronExpr}"`);
            } catch (err) {
                globalLogger.error(`[SCHEDULER] Biểu thức cron không hợp lệ cho Job "${job.name}": "${cronExpr}". Lỗi:`, err.message);
            }
        }

        // Lưu vết revision cấu hình hiện tại
        configRevision = await configProvider.getLatestConfigRevision();
        globalLogger.info(`[SCHEDULER] Scheduler đã sẵn sàng hoạt động: ${scheduledCount} jobs đã được lên lịch. (Revision: "${configRevision}")`);
    } catch (err) {
        globalLogger.error('[SCHEDULER] Lỗi nghiêm trọng khi khởi động bộ định thời:', err);
    }
}

/**
 * Dừng lập lịch toàn bộ các cron jobs
 */
function stopScheduler() {
    console.log('[SCHEDULER] Đang dừng tất cả các cron jobs...');
    for (const [name, jobInfo] of activeCronJobs.entries()) {
        jobInfo.task.stop();
        console.log(`[SCHEDULER] Đã dừng cron của Job: "${name}"`);
    }
}

async function reloadScheduler() {
    console.log('[SCHEDULER] Nhận yêu cầu nạp lại cấu hình (Hot Reload)...');
    
    // 1. Kiểm tra cache revision phiên bản cấu hình
    const latestRevision = await configProvider.getLatestConfigRevision();
    if (latestRevision === configRevision) {
        console.log(`[SCHEDULER] Cấu hình không thay đổi (Revision: "${configRevision}"). Bỏ qua reload.`);
        return { success: true, message: 'Cấu hình không có thay đổi. Bỏ qua.' };
    }

    const tempCronJobs = new Map();
    try {
        const enabled = await configProvider.isSchedulerEnabled();
        const timezone = await configProvider.getTimezone();

        if (enabled) {
            // 2. Khởi tạo thử nghiệm cấu hình mới vào tempCronJobs ở trạng thái TẮT (scheduled: false)
            for (const job of jobs) {
                const jobEnabled = await configProvider.isJobEnabled(job.name);
                if (!jobEnabled) continue;

                const cronExpr = await configProvider.getCronExpression(job.name);
                // Xác thực biểu thức cron
                parseCron(cronExpr, { tz: timezone });
                
                // Khởi tạo task nhưng chưa bắt đầu chạy (để tránh double runs và orphan tasks nếu lỗi)
                const task = scheduleJob(job, cronExpr, timezone, { scheduled: false });
                tempCronJobs.set(job.name, { task, cron: cronExpr, timezone });
            }
        }

        // 3. Nếu khởi tạo thành công tất cả cron mới, dừng các cron cũ
        stopScheduler();
        activeCronJobs.clear();

        // 4. Bật tất cả các cron mới và swap tham chiếu
        for (const [name, jobInfo] of tempCronJobs.entries()) {
            jobInfo.task.start();
            console.log(`[SCHEDULER] Đã kích hoạt chạy Job mới: "${name}" với Cron: "${jobInfo.cron}"`);
        }
        
        activeCronJobs = tempCronJobs;
        configRevision = latestRevision;

        console.log(`[SCHEDULER] Hot Reload hoàn tất thành công. Revision mới: "${configRevision}"`);
        return { success: true, message: 'Hot Reload hoàn tất thành công.' };
    } catch (err) {
        // Dọn sạch các temp tasks đã khởi tạo để tránh leak memory
        for (const jobInfo of tempCronJobs.values()) {
            try { jobInfo.task.stop(); } catch (e) {}
        }
        console.error('[SCHEDULER] Hot Reload thất bại. Giữ nguyên cấu hình cũ hoạt động. Lỗi:', err);
        throw err;
    }
}

/**
 * Xử lý đóng tiến trình an toàn (Graceful Shutdown)
 */
async function handleGracefulShutdown(signal) {
    console.log(`\n[SHUTDOWN] Nhận tín hiệu ${signal}. Đang chuẩn bị Graceful Shutdown...`);
    
    // 1. Dừng nhận lịch trình chạy mới
    stopScheduler();

    // 2. Chờ các Job đang thực thi chạy nốt trong hạn mức timeout
    const shutdownTimeout = await configProvider.getShutdownTimeout();
    const startTime = Date.now();
    let pendingCount = healthProvider.getRunningJobsCount();

    if (pendingCount > 0) {
        console.log(`[SHUTDOWN] Đang chờ ${pendingCount} job đang chạy hoàn thành (Timeout tối đa: ${shutdownTimeout}ms)...`);
        
        while (pendingCount > 0) {
            if (Date.now() - startTime > shutdownTimeout) {
                console.warn('[SHUTDOWN] Hết hạn chờ Graceful Shutdown. Một số job đang chạy bị đóng cưỡng bức.');
                break;
            }
            await new Promise(resolve => setTimeout(resolve, 500));
            pendingCount = healthProvider.getRunningJobsCount();
        }
    }

    // 3. Giải phóng các khóa của tiến trình hiện tại nếu còn kẹt bằng 1 câu lệnh bulk delete nguyên tử
    try {
        const result = await db.run(
            "DELETE FROM local_config WHERE key LIKE 'lock:active:%' AND value LIKE ?",
            [`${lockManager.ownerId}|%`]
        );
        if (result.changes > 0) {
            console.log(`[SHUTDOWN] Đã dọn dẹp giải phóng ${result.changes} khóa kẹt thành công.`);
        }
    } catch (err) {
        console.error('[SHUTDOWN] Lỗi khi dọn khóa khi tắt server:', err);
    }

    console.log('[SHUTDOWN] Tắt tiến trình thành công.');
    process.exit(pendingCount > 0 ? 1 : 0);
}

// Lắng nghe tín hiệu từ HĐH
process.on('SIGINT', () => handleGracefulShutdown('SIGINT'));
process.on('SIGTERM', () => handleGracefulShutdown('SIGTERM'));

module.exports = {
    startScheduler,
    stopScheduler,
    reloadScheduler,
    runner,
    activeCronJobs,
    healthProvider,
    configProvider
};

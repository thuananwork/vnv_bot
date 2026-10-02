process.env.MOCK_GOOGLE_SHEETS = 'true';
const db = require('../config/db');
const configProvider = require('../scheduler/config');
const lockManager = require('../scheduler/lock');
const retryManager = require('../scheduler/retry');
const { timeoutManager, TimeoutError } = require('../scheduler/timeout');
const healthProvider = require('../scheduler/health');
const auditLogger = require('../scheduler/logger');
const assert = require('assert');

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runUnitTests() {
    console.log('====================================================');
    console.log('CHẠY KIỂM THỬ ĐƠN VỊ: SCHEDULER UNIT TESTS');
    console.log('====================================================');

    // 0. Khởi tạo DB Schema sạch
    console.log('0. Chuẩn bị database kiểm thử...');
    await db.run('PRAGMA foreign_keys = OFF;');
    const tables = ['sheet_sync_history', 'reports', 'submissions', 'members', 'regions', 'clusters', 'audit_logs', 'users', 'tasks', 'local_config'];
    for (const table of tables) {
        await db.run(`DROP TABLE IF EXISTS ${table}`);
    }
    await db.run('PRAGMA foreign_keys = ON;');
    await db.initDb();

    // 1. Kiểm thử ConfigProvider
    console.log('1. Kiểm thử ConfigProvider...');
    const isEnabled = await configProvider.isSchedulerEnabled();
    assert.strictEqual(isEnabled, true, 'Scheduler mặc định phải được bật');
    
    const tz = await configProvider.getTimezone();
    assert.strictEqual(tz, 'Asia/Ho_Chi_Minh', 'Timezone mặc định phải là Asia/Ho_Chi_Minh');

    const lockTtl = await configProvider.getLockTtl();
    assert.strictEqual(lockTtl, 1800000, 'Lock TTL mặc định phải là 1,800,000ms');

    // 2. Kiểm thử LockManager (Acquire / Release / Expiry / Heartbeat)
    console.log('2. Kiểm thử LockManager...');
    const lockKey = 'lock:active:unit_test_job';
    
    // Acquire Lock thành công lần đầu
    let acquired = await lockManager.acquireLock(lockKey, 1000); // TTL 1 giây cực ngắn
    assert.strictEqual(acquired, true, 'Phải acquire lock thành công lần đầu');

    // Acquire trùng lập thất bại
    let acquiredDuplicate = await lockManager.acquireLock(lockKey, 1000);
    assert.strictEqual(acquiredDuplicate, false, 'Acquire trùng lập khi chưa hết hạn phải thất bại');

    // Kiểm thử giải phóng khóa
    await lockManager.releaseLock(lockKey);
    let acquiredPostRelease = await lockManager.acquireLock(lockKey, 1000);
    assert.strictEqual(acquiredPostRelease, true, 'Sau khi release phải acquire lại thành công');

    // Kiểm thử hết hạn khóa tự phá lock
    console.log(' -> Đang chờ 1.2 giây để khóa tự động hết hạn...');
    await wait(1200);
    const pm2Instance = process.env.NODE_APP_INSTANCE || process.env.PM2_INSTANCE_ID || '0';
    const fakeOwnerId = `other_host-pid9999-pm2-${pm2Instance}`;
    
    // Sửa owner cũ trong DB thành owner giả định để kiểm tra xem owner hiện tại có cướp khóa hết hạn thành công không
    await db.run('UPDATE local_config SET value = ? WHERE key = ?', [`${fakeOwnerId}|${Date.now() - 500}`, lockKey]);
    
    let acquiredExpired = await lockManager.acquireLock(lockKey, 5000);
    assert.strictEqual(acquiredExpired, true, 'Khóa đã hết hạn phải được chiếm lại thành công');
    await lockManager.releaseLock(lockKey);

    // Kiểm thử Heartbeat gia hạn khóa
    console.log(' -> Kiểm thử Heartbeat gia hạn khóa...');
    const heartbeatKey = 'lock:active:heartbeat_test';
    await lockManager.acquireLock(heartbeatKey, 1000); // 1s TTL
    
    // Bắt đầu heartbeat mỗi 200ms gia hạn TTL lên 1s
    lockManager.startHeartbeat(heartbeatKey, 200, 1000);
    
    // Đợi 1.5 giây. Nếu không có heartbeat, khóa sẽ chết ở 1.0 giây.
    await wait(1500);
    
    // Thử cướp khóa với owner khác (sẽ thất bại vì heartbeat liên tục gia hạn)
    const row = await db.get('SELECT value FROM local_config WHERE key = ?', [heartbeatKey]);
    assert.ok(row, 'Khóa phải tồn tại');
    const parts = row.value.split('|');
    assert.strictEqual(parts[0], lockManager.ownerId, 'Khóa vẫn phải thuộc owner hiện tại');
    assert.ok(parseInt(parts[1], 10) > Date.now(), 'Thời gian hết hạn của khóa phải được đẩy lùi về tương lai');

    // Ngừng heartbeat và giải phóng khóa
    lockManager.stopHeartbeat(heartbeatKey);
    await lockManager.releaseLock(heartbeatKey);

    // 3. Kiểm thử Lock Recovery (Startup Recovery)
    console.log('3. Kiểm thử Lock Recovery...');
    const staleLockKey = 'lock:active:stale_test';
    // Chèn khóa đã hết hạn của owner khác vào DB
    await db.run('INSERT INTO local_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)', [staleLockKey, `other-worker|${Date.now() - 5000}`]);
    
    await lockManager.recoverStaleLocks();
    
    const staleRow = await db.get('SELECT value FROM local_config WHERE key = ?', [staleLockKey]);
    assert.strictEqual(staleRow, undefined, 'Khóa hết hạn bị kẹt phải được dọn dẹp');
    
    const recoveryLog = await db.get("SELECT * FROM audit_logs WHERE action = 'SCHEDULER_RECOVERY' AND target = ?", [staleLockKey]);
    assert.ok(recoveryLog, 'Hành động dọn dẹp phải ghi nhận vào audit_logs');

    // 4. Kiểm thử TimeoutManager & AbortSignal
    console.log('4. Kiểm thử TimeoutManager...');
    const fastHandler = async (context) => {
        return 'DONE';
    };
    
    const slowHandler = async (context) => {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => resolve('SLOW_DONE'), 2000);
            if (context.signal) {
                context.signal.addEventListener('abort', () => {
                    clearTimeout(timer);
                    reject(new Error('AbortSignal triggered'));
                });
            }
        });
    };

    const fastResult = await timeoutManager.executeWithTimeout(fastHandler, 1000);
    assert.strictEqual(fastResult, 'DONE', 'Tác vụ chạy nhanh phải hoàn thành bình thường');

    try {
        await timeoutManager.executeWithTimeout(slowHandler, 500);
        assert.fail('Tác vụ chạy lâu không ném lỗi TimeoutError');
    } catch (err) {
        assert.ok(err instanceof TimeoutError, 'Lỗi ném ra phải thuộc lớp TimeoutError');
        assert.strictEqual(err.isTimeout, true, 'Trường isTimeout phải bằng true');
    }

    // 5. Kiểm thử RetryManager & shouldRetry
    console.log('5. Kiểm thử RetryManager...');
    let failAttempts = 0;
    const transientFailHandler = async () => {
        failAttempts++;
        if (failAttempts < 2) {
            throw new Error('Transient error');
        }
        return 'SUCCESS';
    };

    const retryResult = await retryManager.executeWithRetry(transientFailHandler, { attempts: 3, baseDelayMs: 50 });
    assert.strictEqual(retryResult, 'SUCCESS', 'Tác vụ lỗi tạm thời phải thành công ở lần thử lại');
    assert.strictEqual(failAttempts, 2, 'Tác vụ phải chạy qua 2 lượt');

    // Test Validation Error không được retry
    let validationAttempts = 0;
    const validationHandler = async () => {
        validationAttempts++;
        const err = new Error('Invalid task date');
        err.name = 'ValidationError';
        throw err;
    };

    try {
        await retryManager.executeWithRetry(validationHandler, { attempts: 3, baseDelayMs: 50 });
        assert.fail('ValidationError không được ném ra ngoài');
    } catch (err) {
        assert.strictEqual(err.name, 'ValidationError', 'Lỗi ném ra phải là ValidationError');
        assert.strictEqual(validationAttempts, 1, 'Chính sách retry không được chạy lại đối với ValidationError');
    }

    // 6. Kiểm thử HealthProvider & Logger
    console.log('6. Kiểm thử HealthProvider & Logger...');
    
    // Ghi nhận log trực tiếp qua AuditLogger
    await auditLogger.logJob({
        jobName: 'syncSheets',
        status: 'success',
        attempt: 1,
        executionTimeMs: 150,
        maxExecutionTimeMs: 10000,
        lockKey: 'lock:syncSheets:test',
        worker: lockManager.ownerId
    });

    await auditLogger.logJob({
        jobName: 'syncSheets',
        status: 'failed',
        attempt: 3,
        executionTimeMs: 350,
        maxExecutionTimeMs: 10000,
        lockKey: 'lock:syncSheets:test2',
        worker: lockManager.ownerId,
        errorMessage: 'Connection lost'
    });

    const metrics = await healthProvider.getMetrics();
    assert.strictEqual(metrics.jobsExecuted, 2, 'Tổng số job chạy phải bằng 2');
    assert.strictEqual(metrics.jobsFailed, 1, 'Tổng số job thất bại phải bằng 1');
    assert.strictEqual(metrics.avgExecutionTime, 250, 'Thời gian chạy trung bình phải bằng 250ms ((150+350)/2)');

    const globalStatus = healthProvider.getGlobalStatus([{ lastStatus: 'success' }, { lastStatus: 'failed' }], true);
    assert.strictEqual(globalStatus, 'DEGRADED', 'Có 1 job thành công và 1 job thất bại phải trả về DEGRADED');

    console.log('====================================================');
    console.log('THÀNH CÔNG: TẤT CẢ UNIT TESTS ĐỀU ĐẠT YÊU CẦU (PASS)!');
    console.log('====================================================');
}

runUnitTests().catch(err => {
    console.error('[UNIT TEST ERROR] Kiểm thử đơn vị thất bại:', err);
    process.exit(1);
});

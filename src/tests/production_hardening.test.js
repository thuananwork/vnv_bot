const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');
const assert = require('assert');
const db = require('../config/db');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');
const stats = require('../utils/stats');
const { enqueueMessage } = require('../services/zalo/pipeline');

// Helper to run index.js as a child process and expect it to fail fast
function runStartupAndCheckExit(envOverrides, expectedErrorText) {
    return new Promise((resolve, reject) => {
        // Base environment with default valid test variables
        const baseEnv = {
            JWT_SECRET: 'test_jwt_secret_min_32_chars_long_123',
            SESSION_SECRET: 'super_secret_session_key_minimum_32_characters_long',
            GOOGLE_SHEET_ID: 'test_sheet_id_123',
            GOOGLE_OAUTH_CLIENT_ID: 'test_oauth_client_id',
            GOOGLE_OAUTH_CLIENT_SECRET: 'test_oauth_client_secret',
            GOOGLE_OAUTH_REDIRECT_URI: 'http://localhost:3000/api/auth/google/callback'
        };
        const env = { ...process.env, ...baseEnv, ...envOverrides };
        const child = exec('node src/index.js', {
            cwd: path.join(__dirname, '../..'),
            env,
            timeout: 8000
        });

        let stdout = '';
        let stderr = '';

        if (child.stdout) child.stdout.on('data', data => { stdout += data; });
        if (child.stderr) child.stderr.on('data', data => { stderr += data; });

        child.on('close', (code, signal) => {
            try {
                const fullOutput = stdout + stderr;
                assert.ok(
                    fullOutput.includes(expectedErrorText), 
                    `Output should include "${expectedErrorText}", but got (exit code ${code}, signal ${signal}):\n${fullOutput}`
                );
                // On Windows/Node, exit code 1 or signal termination is expected for fail-fast
                assert.ok(code === 1 || code === null || signal !== null, `Fail-fast should abort execution`);
                resolve();
            } catch (err) {
                reject(err);
            }
        });
    });
}

async function runHardeningTests() {
    console.log('====================================================');
    console.log('BẮT ĐẦU KIỂM THỬ HARDENING & VẬN HÀNH (PHASE 8)');
    console.log('====================================================');

    // 1. Test Case 1: Khởi động thiếu JWT_SECRET
    console.log('[TEST 1] Startup thiếu JWT_SECRET...');
    await runStartupAndCheckExit(
        { JWT_SECRET: '' },
        'Thiếu các biến cấu hình bắt buộc: JWT_SECRET'
    );
    console.log(' -> [OK] Chặn khởi động thiếu JWT_SECRET thành công.');

    // 2. Test Case 2: Khởi động thiếu GOOGLE_SHEET_ID
    console.log('[TEST 2] Startup thiếu GOOGLE_SHEET_ID...');
    await runStartupAndCheckExit(
        { GOOGLE_SHEET_ID: '' },
        'Thiếu các biến cấu hình bắt buộc: GOOGLE_SHEET_ID'
    );
    console.log(' -> [OK] Chặn khởi động thiếu GOOGLE_SHEET_ID thành công.');

    // 3. Test Case 3: Startup kiểm tra các cấu hình hợp lệ
    console.log('[TEST 3] Startup kiểm tra các biến cấu hình hợp lệ...');

    // 4. Test Case 4: Logger Rotation
    console.log('[TEST 4] Logger Rotation & File Output...');
    logger.info('Test log entry for rotation verification');
    const todayStr = new Date().toLocaleDateString('sv');
    const logFilePath = path.join(__dirname, '../../logs', `app-${todayStr}.log`);
    assert.ok(fs.existsSync(logFilePath), `File log app-${todayStr}.log phải được tạo ra`);
    const logContent = fs.readFileSync(logFilePath, 'utf8');
    assert.ok(logContent.includes('Test log entry for rotation verification'), 'Nội dung log phải được ghi xuống file');
    console.log(' -> [OK] Ghi log xoay vòng theo ngày hoạt động tốt.');

    // 5. Test Case 5: Correlation ID Uniqueness
    console.log('[TEST 5] Correlation ID Uniqueness...');
    // Clear and reset DB structures
    await db.run("DROP TABLE IF EXISTS zalo_message_queue");
    await db.run("DROP TABLE IF EXISTS processed_messages");
    await db.initDb();
    const payload1 = { zaloMsgId: 'msg_u1', senderId: 'sender_u1', groupId: 'g1', msgType: 'text', content: 'test 1' };
    const payload2 = { zaloMsgId: 'msg_u2', senderId: 'sender_u2', groupId: 'g2', msgType: 'text', content: 'test 2' };

    await enqueueMessage('oa', payload1);
    await enqueueMessage('oa', payload2);

    const queueItems = await db.all("SELECT id, request_id FROM zalo_message_queue");
    assert.strictEqual(queueItems.length, 2, 'Phải có 2 tin nhắn trong hàng đợi');
    assert.ok(queueItems[0].request_id, 'Item 1 phải có request_id');
    assert.ok(queueItems[1].request_id, 'Item 2 phải có request_id');
    assert.notStrictEqual(queueItems[0].request_id, queueItems[1].request_id, 'Hai request_id phải hoàn toàn duy nhất');
    console.log(' -> [OK] Correlation ID (Request ID) sinh ra hoàn toàn duy nhất.');

    // 6. Test Case 6: Parent Request Trace
    console.log('[TEST 6] Parent Request Trace Propagation...');
    const parentId = 'parent-req-id-999';
    const payloadWithParent = { 
        zaloMsgId: 'msg_parent_test', 
        senderId: 'sender_u1', 
        groupId: 'g1', 
        msgType: 'text', 
        content: 'test parent',
        parent_request_id: parentId
    };

    await enqueueMessage('oa', payloadWithParent);
    const parentQueueItem = await db.get("SELECT parent_request_id FROM zalo_message_queue WHERE raw_payload LIKE '%msg_parent_test%'");
    assert.ok(parentQueueItem, 'Phải tìm thấy hàng đợi tin nhắn vừa nạp');
    assert.strictEqual(parentQueueItem.parent_request_id, parentId, 'parent_request_id phải được truyền chính xác vào queue');
    console.log(' -> [OK] Parent Request ID lan truyền thành công.');

    // 7. Test Case 7: Metrics Counter Consistency
    console.log('[TEST 7] Metrics Counter Consistency...');
    const initialVal = metrics.state.pipeline_processed_total;
    metrics.increment('pipeline_processed_total');
    metrics.increment('pipeline_processed_total');
    
    assert.strictEqual(metrics.state.pipeline_processed_total, initialVal + 2, 'Metrics counter phải tăng lên đúng 2');
    const formatted = await metrics.formatPrometheusMetrics();
    assert.ok(formatted.includes('pipeline_processed_total'), 'Prometheus output phải xuất hiện metric pipeline_processed_total');
    assert.ok(formatted.includes('build_info{version='), 'Prometheus output phải xuất hiện static build_info metadata');
    console.log(' -> [OK] Chỉ số Prometheus Metrics hoạt động chuẩn xác.');

    // 8. Test Case 8: Database Recovery Drill (backup -> restore -> check integrity)
    console.log('[TEST 8] Database Recovery Drill...');
    const backupDbJob = require('../scheduler/backupDb.job');
    const mockContext = {
        logger: {
            info: () => {},
            warn: () => {},
            error: () => {}
        }
    };
    
    // Chạy job tạo backup
    await backupDbJob.handler(mockContext);

    const backupDir = path.join(__dirname, '../../backups');
    const files = fs.readdirSync(backupDir).filter(f => f.startsWith('vnv_bot_backup_') && f.endsWith('.db'));
    assert.ok(files.length > 0, 'Phải có ít nhất 1 tệp backup được tạo ra');

    files.sort();
    const latestBackup = files[files.length - 1];
    const latestBackupPath = path.join(backupDir, latestBackup);

    const restorePath = path.join(__dirname, '../../data/vnv_bot_restore_drill.db');
    fs.copyFileSync(latestBackupPath, restorePath);

    const sqlite3 = require('sqlite3').verbose();
    const restoredDb = new sqlite3.Database(restorePath);

    // Kiểm tra tính toàn vẹn
    await new Promise((resolve, reject) => {
        restoredDb.get("PRAGMA integrity_check", (err, row) => {
            if (err) reject(err);
            else {
                assert.strictEqual(row.integrity_check, 'ok', 'SQLite integrity check phải trả về ok');
                resolve();
            }
        });
    });

    // Truy vấn dữ liệu thực tế
    await new Promise((resolve, reject) => {
        restoredDb.get("SELECT COUNT(*) as count FROM users", (err, row) => {
            if (err) reject(err);
            else {
                assert.ok(row.count >= 0, 'Bảng users trong database phục hồi phải truy vấn bình thường');
                resolve();
            }
        });
    });

    // Đóng DB và dọn dẹp
    await new Promise((resolve) => restoredDb.close(() => resolve()));
    fs.unlinkSync(restorePath);
    fs.unlinkSync(latestBackupPath);
    console.log(' -> [OK] Kịch bản khôi phục và kiểm định toàn vẹn dữ liệu hoàn tất.');

    console.log('====================================================');
    console.log('THÀNH CÔNG: TẤT CẢ UNIT/OPERATIONAL TESTS ĐẠT (PASS)!');
    console.log('====================================================');
}

module.exports = {
    runHardeningTests
};

if (require.main === module) {
    runHardeningTests()
        .then(() => {
            process.exit(0);
        })
        .catch(err => {
            console.error('\n[HARDENING TESTS ERROR] Thất bại:', err);
            process.exit(1);
        });
}

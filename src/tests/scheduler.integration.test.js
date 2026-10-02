process.env.MOCK_GOOGLE_SHEETS = 'true';
const db = require('../config/db');
const { runner } = require('../scheduler');
const taskService = require('../services/tasks');
const reportService = require('../services/reports');
const assert = require('assert');

async function runIntegrationTests() {
    console.log('====================================================');
    console.log('CHẠY KIỂM THỬ TÍCH HỢP: SCHEDULER INTEGRATION TESTS');
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

    // 1. Tạo Dữ liệu mẫu (Task, Cluster, Region, Member, Submission)
    console.log('1. Tạo dữ liệu mẫu trong DB SQLite...');
    const todayStr = new Date().toLocaleDateString('sv');
    
    // Tạo Task ngày hôm nay
    const taskRes = await db.run(
        `INSERT INTO tasks (task_code, title, description, publish_date, status)
         VALUES ('TASK_INTEGRATION_01', 'Nhiệm vụ kiểm thử tích hợp', 'Description', ?, 'active')`,
        [todayStr]
    );
    const taskId = taskRes.id;

    // Tạo Cụm & Vùng
    const clusterRes = await db.run("INSERT INTO clusters (cluster_name) VALUES ('Cụm Tích Hợp 1')");
    const clusterId = clusterRes.id;

    const regionRes = await db.run(
        `INSERT INTO regions (region_name, cluster_id, zalo_group_id, zalo_group_name, sheet_id, sheet_name)
         VALUES ('Vùng Tích Hợp A', ?, 'zalo_group_123', 'Nhóm Vùng A', 'sheet_id_a', 'Sheet Vùng A')`,
        [clusterId]
    );
    const regionId = regionRes.id;

    // Tạo 3 Sứ giả trong Vùng
    const member1 = await db.run(`INSERT INTO members (real_name, zalo_name, region_id, status) VALUES ('Sứ Giả 1', 'zalo_1', ?, 'Active')`, [regionId]);
    const member2 = await db.run(`INSERT INTO members (real_name, zalo_name, region_id, status) VALUES ('Sứ Giả 2', 'zalo_2', ?, 'Active')`, [regionId]);
    const member3 = await db.run(`INSERT INTO members (real_name, zalo_name, region_id, status) VALUES ('Sứ Giả 3', 'zalo_3', ?, 'Active')`, [regionId]);

    // Tạo submissions (2 approved, 1 pending_review)
    // Sứ giả 1 nộp bài approved -> ĐÃ HOÀN THÀNH
    await db.run(
        `INSERT INTO submissions (task_id, member_id, zalo_msg_id, submission_type, status, submitted_at)
         VALUES (?, ?, 'msg_1', 'keyword', 'approved', CURRENT_TIMESTAMP)`,
        [taskId, member1.id]
    );
    // Sứ giả 2 nộp bài approved -> ĐÃ HOÀN THÀNH
    await db.run(
        `INSERT INTO submissions (task_id, member_id, zalo_msg_id, submission_type, status, submitted_at)
         VALUES (?, ?, 'msg_2', 'image', 'approved', CURRENT_TIMESTAMP)`,
        [taskId, member2.id]
    );
    // Sứ giả 3 nộp bài pending_review -> tính là CHƯA HOÀN THÀNH (chưa được approved)
    await db.run(
        `INSERT INTO submissions (task_id, member_id, zalo_msg_id, submission_type, status, submitted_at)
         VALUES (?, ?, 'msg_3', 'image', 'pending_review', CURRENT_TIMESTAMP)`,
        [taskId, member3.id]
    );

    // 2. Chạy Job Distribute
    console.log('2. Chạy Job: Distribute (Giao nhiệm vụ)...');
    const distributeJob = require('../scheduler/distribute.job');
    const distResult = await runner.runJob({
        name: distributeJob.name,
        lockKey: `lock:${distributeJob.name}:${todayStr}:manual`,
        handler: distributeJob.handler,
        retryPolicy: distributeJob.retryPolicy,
        timeoutMs: distributeJob.timeoutMs
    });
    assert.strictEqual(distResult.success, true, 'Job distribute phải chạy thành công');

    // 3. Chạy Job Summarize
    console.log('3. Chạy Job: Summarize (Tổng hợp báo cáo)...');
    const summarizeJob = require('../scheduler/summarize.job');
    const sumResult = await runner.runJob({
        name: summarizeJob.name,
        lockKey: `lock:${summarizeJob.name}:${todayStr}:manual`,
        handler: summarizeJob.handler,
        retryPolicy: summarizeJob.retryPolicy,
        timeoutMs: summarizeJob.timeoutMs
    });
    assert.strictEqual(sumResult.success, true, 'Job summarize phải chạy thành công');

    // Xác thực báo cáo đã được chèn vào DB SQLite
    const regionReport = await db.get(
        'SELECT * FROM reports WHERE region_id = ? AND task_id = ?',
        [regionId, taskId]
    );
    assert.ok(regionReport, 'Báo cáo Vùng phải được tạo');
    assert.strictEqual(regionReport.total_members, 3, 'Tổng số sứ giả trong báo cáo phải bằng 3');
    assert.strictEqual(regionReport.total_completed, 2, 'Tổng số sứ giả hoàn thành trong báo cáo phải bằng 2 (Approved)');
    assert.strictEqual(regionReport.total_failed, 1, 'Tổng số sứ giả chưa hoàn thành trong báo cáo phải bằng 1');

    const clusterReport = await db.get(
        'SELECT * FROM reports WHERE cluster_id = ? AND task_id = ?',
        [clusterId, taskId]
    );
    assert.ok(clusterReport, 'Báo cáo Cụm phải được tạo');
    assert.strictEqual(clusterReport.total_members, 3, 'Tổng số sứ giả trong cụm phải bằng 3');
    assert.strictEqual(clusterReport.total_completed, 2, 'Tổng số hoàn thành cụm phải bằng 2');

    // 4. Chạy Job SyncSheets (MOCK)
    console.log('4. Chạy Job: SyncSheets (Đồng bộ Sheets)...');
    const syncSheetsJob = require('../scheduler/syncSheets.job');
    const syncResult = await runner.runJob({
        name: syncSheetsJob.name,
        lockKey: `lock:${syncSheetsJob.name}:${todayStr}:manual`,
        handler: syncSheetsJob.handler,
        retryPolicy: syncSheetsJob.retryPolicy,
        timeoutMs: syncSheetsJob.timeoutMs
    });
    assert.strictEqual(syncResult.success, true, 'Job syncSheets phải chạy thành công');

    // Xác thực trường sent_at được cập nhật thành công trong reports
    const regionReportUpdated = await db.get(
        'SELECT sent_at FROM reports WHERE region_id = ? AND task_id = ?',
        [regionId, taskId]
    );
    assert.ok(regionReportUpdated.sent_at, 'Trường sent_at của báo cáo Vùng phải được cập nhật ngày gửi');

    // 5. Chạy Job SendReports
    console.log('5. Chạy Job: SendReports (Gửi báo cáo Zalo)...');
    const sendReportsJob = require('../scheduler/sendReports.job');
    const sendResult = await runner.runJob({
        name: sendReportsJob.name,
        lockKey: `lock:${sendReportsJob.name}:${todayStr}:manual`,
        handler: sendReportsJob.handler,
        retryPolicy: sendReportsJob.retryPolicy,
        timeoutMs: sendReportsJob.timeoutMs
    });
    assert.strictEqual(sendResult.success, true, 'Job sendReports phải chạy thành công');

    // 6. Xác thực log lịch sử chạy Job trong bảng audit_logs
    console.log('6. Xác thực các bản ghi lịch sử audit logs...');
    const jobLogs = await db.all("SELECT * FROM audit_logs WHERE action = 'SCHEDULER_JOB'");
    assert.strictEqual(jobLogs.length, 4, 'Bảng audit_logs phải ghi nhận đủ 4 job đã chạy');
    
    // Kiểm chứng định dạng JSON cấu trúc
    for (const log of jobLogs) {
        const details = JSON.parse(log.details);
        assert.ok(details.job, 'Trường JSON details phải chứa tên job');
        assert.strictEqual(details.status, 'success', 'Tất cả các job được log phải có status là success');
        assert.ok(details.executionTime >= 0, 'Phải có chỉ số thời gian thực thi');
    }

    console.log('====================================================');
    console.log('THÀNH CÔNG: KIỂM THỬ TÍCH HỢP HOÀN TẤT TRƠN TRU (PASS)!');
    console.log('====================================================');
}

runIntegrationTests().catch(err => {
    console.error('[INTEGRATION TEST ERROR] Kiểm thử tích hợp thất bại:', err);
    process.exit(1);
});

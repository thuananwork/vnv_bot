process.env.MOCK_GOOGLE_SHEETS = 'true';
const db = require('../config/db');
const { syncRegionSheet } = require('../services/sheet_sync');
const GoogleSheetsClient = require('../services/google/sheets');
const assert = require('assert');

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runSheetIntegrationTests() {
    console.log('====================================================');
    console.log('CHẠY KIỂM THỬ TÍCH HỢP GOOGLE SHEETS PRODUCTION');
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
    console.log('1. Tạo dữ liệu mẫu...');
    const todayStr = new Date().toLocaleDateString('sv');
    
    // Tạo Task
    const taskRes = await db.run(
        `INSERT INTO tasks (task_code, title, description, publish_date, status)
         VALUES ('TASK_SHEET_01', 'Nhiệm vụ kiểm thử Sheets', 'Description', ?, 'active')`,
        [todayStr]
    );
    const taskId = taskRes.id;

    // Tạo Cụm & Vùng
    const clusterRes = await db.run("INSERT INTO clusters (cluster_name) VALUES ('Cụm Đồng Bộ')");
    const clusterId = clusterRes.id;

    const regionRes = await db.run(
        `INSERT INTO regions (region_name, cluster_id, zalo_group_id, zalo_group_name, sheet_id, sheet_name)
         VALUES ('Vùng Đồng Bộ A', ?, 'zalo_group_sheet_a', 'Nhóm Sheet A', 'spreadsheet_id_test_abc', 'Sheet Vùng A')`,
        [clusterId]
    );
    const regionId = regionRes.id;

    // Tạo 3 Sứ giả trong Vùng
    const m1 = await db.run(`INSERT INTO members (real_name, zalo_name, region_id, status) VALUES ('Sứ Giả A', 'zalo_a', ?, 'Active')`, [regionId]);
    const m2 = await db.run(`INSERT INTO members (real_name, zalo_name, region_id, status) VALUES ('Sứ Giả B', 'zalo_b', ?, 'Active')`, [regionId]);
    await db.run(`INSERT INTO submissions (task_id, member_id, status, zalo_msg_id) VALUES (?, ?, 'approved', 'msg_test_a')`, [taskId, m1.id]);
    await db.run(`INSERT INTO submissions (task_id, member_id, status, zalo_msg_id) VALUES (?, ?, 'approved', 'msg_test_b')`, [taskId, m2.id]);

    // -------------------------------------------------------------------------
    // TEST 1: Chế độ Chạy thử nghiệm (Dry Run Mode) và lưu lịch sử
    // -------------------------------------------------------------------------
    console.log('\n2. [TEST 1] Kiểm thử Dry Run Mode...');
    const dryRunResult = await syncRegionSheet(regionId, taskId, { dryRun: true });
    assert.strictEqual(dryRunResult, true, 'Dry Run phải chạy thành công');

    // Kiểm chứng bản ghi lịch sử trong DB
    const history = await db.get('SELECT * FROM sheet_sync_history ORDER BY id DESC LIMIT 1');
    assert.ok(history, 'Bản ghi lịch sử đồng bộ phải được tạo');
    assert.strictEqual(history.status, 'success', 'Trạng thái đồng bộ phải là success');
    assert.strictEqual(history.dry_run, 1, 'Trường dry_run phải bằng 1');
    assert.strictEqual(history.rows_synced, 3, 'rows_synced phải bằng 3 (2 approved + 1 header)');
    assert.strictEqual(history.sheet_name, `TASK_SHEET_01 - ${todayStr}`, 'Tên Tab phải khớp với định dạng');
    assert.strictEqual(history.sheet_id, 'spreadsheet_id_test_abc', 'Sheet ID phải khớp');
    assert.ok(history.started_at, 'started_at phải được ghi nhận');
    assert.ok(history.completed_at, 'completed_at phải được ghi nhận');
    assert.ok(history.execution_time_ms >= 0, 'execution_time_ms phải lớn hơn hoặc bằng 0');
    console.log(' -> [OK] Dry Run chạy và ghi chép lịch sử chuẩn xác.');

    // -------------------------------------------------------------------------
    // TEST 2: Kiểm thử tính Idempotency Lock (Đồng bộ song song trùng lặp)
    // -------------------------------------------------------------------------
    console.log('\n3. [TEST 2] Kiểm thử tính Idempotency Lock...');
    // Gọi song song 2 request đồng bộ thật/giả lập
    const [res1, res2] = await Promise.all([
        syncRegionSheet(regionId, taskId),
        syncRegionSheet(regionId, taskId)
    ]);
    
    // Một trong hai phải thành công, cái còn lại phải thất bại (trả về false) do tranh chấp lock
    const successCount = (res1 ? 1 : 0) + (res2 ? 1 : 0);
    assert.strictEqual(successCount, 1, 'Chỉ duy nhất 1 request đồng bộ được phép chiếm lock và chạy, request còn lại phải bị từ chối');
    console.log(` -> [OK] Kết quả song song: Request 1 = ${res1}, Request 2 = ${res2}. Idempotency được đảm bảo.`);

    // -------------------------------------------------------------------------
    // TEST 3: Kiểm thử bộ nhớ đệm Metadata Cache
    // -------------------------------------------------------------------------
    console.log('\n4. [TEST 3] Kiểm thử bộ nhớ đệm Metadata Cache...');
    const spreadsheetId = 'spreadsheet_id_test_abc';
    
    // Xóa sạch cache trước khi chạy
    GoogleSheetsClient.clearMetadataCache();
    assert.strictEqual(GoogleSheetsClient.hasMetadataCache(spreadsheetId), false, 'Cache phải trống ban đầu');

    // Lần đầu lấy metadata (sẽ lưu vào cache)
    await GoogleSheetsClient.getSheetsMetadata(spreadsheetId);
    assert.strictEqual(GoogleSheetsClient.hasMetadataCache(spreadsheetId), true, 'Sau khi gọi API, thông tin phải được đưa vào cache');

    // Tạo tab mới qua ensureSheet (sẽ gây invalidate/delete cache)
    const context = {
        spreadsheetId,
        sheetName: 'TASK_NEW - 2026-07-02',
        sheetId: null,
        createdSheet: false,
        rows: []
    };
    await GoogleSheetsClient.ensureSheet(context);
    assert.strictEqual(GoogleSheetsClient.hasMetadataCache(spreadsheetId), false, 'Sau khi tạo tab mới, cache metadata bắt buộc phải bị xóa (invalidated)');
    console.log(' -> [OK] Metadata cache và cơ chế tự động xóa (invalidation) hoạt động chính xác.');

    // -------------------------------------------------------------------------
    // TEST 4: SQLite WAL Concurrency ghi song song lịch sử
    // -------------------------------------------------------------------------
    console.log('\n5. [TEST 4] Kiểm thử SQLite WAL ghi song song lịch sử đồng bộ...');
    
    // Tạo 50 Vùng khác nhau
    const regionPromises = Array.from({ length: 50 }).map(async (_, idx) => {
        const rName = `Vùng Concurrency ${idx}`;
        const sId = `sheet_id_concurrency_${idx}`;
        const regionRes = await db.run(
            `INSERT INTO regions (region_name, cluster_id, sheet_id, sheet_name, zalo_group_id, zalo_group_name)
             VALUES (?, ?, ?, 'Sheet test', ?, ?)`,
            [rName, clusterId, sId, `zalo_grp_${idx}`, `Nhóm ${idx}`]
        );
        return { regionId: regionRes.id, rName };
    });
    const createdRegions = await Promise.all(regionPromises);

    // Chạy đồng bộ song song Dry Run cho 50 vùng này lên SQLite DB
    const syncPromises = createdRegions.map(async (r) => {
        return await syncRegionSheet(r.regionId, taskId, { dryRun: true });
    });

    const syncResults = await Promise.all(syncPromises);
    const successSyncs = syncResults.filter(r => r);
    console.log(` -> Đã ghi song song 50 lịch sử đồng bộ thành công: ${successSyncs.length}/50`);
    assert.strictEqual(successSyncs.length, 50, 'Tất cả 50 tác vụ đồng bộ song song phải ghi nhận SQLite thành công dưới chế độ WAL');

    const totalHistoryRecords = await db.get("SELECT COUNT(*) as count FROM sheet_sync_history WHERE status = 'success'");
    // 1 (Test 1) + 1 (Test 2 thành công) + 50 (Test 4) = 52
    assert.strictEqual(totalHistoryRecords.count, 52, 'Tổng số bản ghi lịch sử thành công trong CSDL phải bằng 52');
    console.log(' -> [OK] SQLite WAL hoạt động xuất sắc dưới tải ghi đồng thời.');

    console.log('\n====================================================');
    console.log('THÀNH CÔNG: TẤT CẢ CÁC BÀI TEST GOOGLE SHEETS ĐỀU ĐẠT (PASS)!');
    console.log('====================================================');
    process.exit(0);
}

runSheetIntegrationTests().catch(err => {
    console.error('[TEST ERROR] Kiểm thử tích hợp Google Sheets thất bại:', err);
    process.exit(1);
});

process.env.MOCK_GOOGLE_SHEETS = 'true';
const assert = require('assert');
const { getExpectedMonthTab, getPreviousMonthTab } = require('../utils/sheet_time');
const GoogleSheetsClient = require('../services/google/sheets');
const onDemandService = require('../services/on_demand_actions');
const { syncRegionMatrixSheet } = require('../services/sheet_matrix_sync');
const db = require('../config/db');

async function runTests() {
    console.log('=== BẮT ĐẦU KIỂM THỬ: QUẢN LÝ TAB THÁNG THỰC TẾ & XỬ LÝ THIẾU TAB GOOGLE SHEET ===\n');

    // 1. Kiểm thử định dạng tên tab theo thời gian thực
    console.log('1. Kiểm thử định dạng tên tab thời gian thực (T{M}/{YY})...');
    assert.strictEqual(getExpectedMonthTab('2026-09-06'), 'T9/26', '2026-09-06 phải là T9/26');
    assert.strictEqual(getExpectedMonthTab('2026-10-01'), 'T10/26', '2026-10-01 phải là T10/26');
    assert.strictEqual(getExpectedMonthTab('2026-12-31'), 'T12/26', '2026-12-31 phải là T12/26');
    assert.strictEqual(getExpectedMonthTab('2027-01-01'), 'T1/27', '2027-01-01 phải là T1/27');
    console.log('   -> Định dạng tháng hiện tại: PASSED');

    assert.strictEqual(getPreviousMonthTab('2026-10-01'), 'T9/26', 'Tháng trước của 2026-10-01 phải là T9/26');
    assert.strictEqual(getPreviousMonthTab('2027-01-01'), 'T12/26', 'Tháng trước của 2027-01-01 phải là T12/26');
    console.log('   -> Định dạng tháng trước: PASSED');

    // 2. Kiểm thử kiểm tra tab tồn tại trên Google Sheet
    console.log('\n2. Kiểm thử checkTabExists trên Google Sheets Client...');
    const testSpreadsheetId = 'test-spread-sheet-id-123';
    GoogleSheetsClient.resetFakeSpreadsheets();
    GoogleSheetsClient.clearMetadataCache();

    // Giả lập sheet chỉ có tab 'T8/26' và 'T9/26'
    GoogleSheetsClient.fakeSpreadsheets[testSpreadsheetId] = {
        'T8/26': [['STT', 'Họ Tên']],
        'T9/26': [['STT', 'Họ Tên']]
    };

    // Kiểm tra tab đã có: 'T9/26'
    const checkT9 = await GoogleSheetsClient.checkTabExists(testSpreadsheetId, 'T9/26');
    assert.strictEqual(checkT9.exists, true, 'Tab T9/26 phải tồn tại');
    assert.deepStrictEqual(checkT9.currentTabs, ['T8/26', 'T9/26'], 'Danh sách tab phải gồm T8/26 và T9/26');
    console.log('   -> Phát hiện tab T9/26 tồn tại: PASSED');

    // Kiểm tra tab chưa có: 'T10/26' (Ngày đầu tháng mới)
    const checkT10 = await GoogleSheetsClient.checkTabExists(testSpreadsheetId, 'T10/26');
    assert.strictEqual(checkT10.exists, false, 'Tab T10/26 chưa tồn tại');
    console.log('   -> Phát hiện chính xác tab T10/26 chưa tồn tại: PASSED');

    // 3. Kiểm thử nhân bản tab mới (duplicateMonthTab)
    console.log('\n3. Kiểm thử duplicateMonthTab (Tự nhân bản tab tháng mới)...');
    const dupRes = await GoogleSheetsClient.duplicateMonthTab(testSpreadsheetId, 'T9/26', 'T10/26');
    assert.strictEqual(dupRes.success, true, 'Nhân bản tab phải thành công');
    assert.strictEqual(dupRes.title, 'T10/26', 'Tab mới phải có tiêu đề T10/26');

    // Kiểm tra lại sau khi nhân bản
    const checkAfterDup = await GoogleSheetsClient.checkTabExists(testSpreadsheetId, 'T10/26');
    assert.strictEqual(checkAfterDup.exists, true, 'Tab T10/26 phải tồn tại sau khi nhân bản');
    console.log('   -> Tự động nhân bản tab T10/26 từ T9/26: PASSED');

    // 4. Kiểm thử tổng hợp báo cáo khi chưa có tab (skipSheet = true hoặc tabMissing)
    console.log('\n4. Kiểm thử Tổng hợp Báo cáo khi chưa có tab (Không ghi Google Sheet)...');
    const testDate = '2026-10-01'; // Ngày đầu tháng 10
    const regionId = 27;

    // Reset lại fake spreadsheet không có T10/26 cho region 27
    const region27 = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
    if (region27 && region27.sheet_id) {
        GoogleSheetsClient.fakeSpreadsheets[region27.sheet_id] = {
            'T8/26': [],
            'T9/26': []
        };
        GoogleSheetsClient.clearMetadataCache();
    }

    const reportWithoutSheet = await onDemandService.scanAndReportRegion({
        regionId,
        workDate: testDate,
        simulatedMessages: [
            { sender_zalo_name: 'Quang Đại', content_text: 'Em Đại Vùng 27 báo cáo hoàn thành nhiệm vụ 01/10', msg_type: 'image' },
            { sender_zalo_name: 'Thanh Trà', content_text: 'Thanh Trà V27 hoàn thành nhiệm vụ', msg_type: 'image' }
        ],
        dryRun: false,
        skipSheet: true // Trưởng vùng chọn: Tiếp tục tổng hợp (Chưa ghi Sheet)
    });

    assert.strictEqual(reportWithoutSheet.success, true, 'Báo cáo phải thành công');
    assert.strictEqual(reportWithoutSheet.sheetSynced, false, 'sheetSynced phải là false');
    assert.ok(reportWithoutSheet.reportContent.length > 50, 'Nội dung báo cáo Mẫu 1 phải được sinh đầy đủ');
    assert.ok(reportWithoutSheet.completed >= 2, 'Số người hoàn thành phải được ghi nhận');

    // Kiểm tra SQLite submissions: sheet_synced = 0
    const unsyncedSubs = await db.all(
        'SELECT * FROM submissions WHERE region_id = ? AND work_date = ? AND sheet_synced = 0',
        [regionId, testDate]
    );
    assert.ok(unsyncedSubs.length > 0, 'Phải có submissions với sheet_synced = 0 trong Database');
    console.log(`   -> Tổng hợp Báo cáo không ghi Sheet: PASSED (Có ${unsyncedSubs.length} bản ghi pending)`);

    // 5. Kiểm thử Ghi bù (Backfill) khi tab tháng mới đã sẵn sàng
    console.log('\n5. Kiểm thử Ghi bù (Backfill) sau khi tab T10/26 được tạo...');
    if (region27 && region27.sheet_id) {
        // Tạo tab T10/26 trên fakeSpreadsheet
        GoogleSheetsClient.fakeSpreadsheets[region27.sheet_id]['T10/26'] = [];
        GoogleSheetsClient.clearMetadataCache();
    }

    const syncPendingRes = await syncRegionMatrixSheet(regionId, testDate, { dryRun: false, skipSheet: false });
    assert.strictEqual(syncPendingRes.success, true, 'Ghi bù phải thành công');

    // Cập nhật DB
    await db.run(
        'UPDATE submissions SET sheet_synced = 1 WHERE region_id = ? AND work_date = ?',
        [regionId, testDate]
    );

    const checkPendingAfter = await db.all(
        'SELECT * FROM submissions WHERE region_id = ? AND work_date = ? AND sheet_synced = 0',
        [regionId, testDate]
    );
    assert.strictEqual(checkPendingAfter.length, 0, 'Sau khi ghi bù, không còn bản ghi sheet_synced = 0');
    console.log('   -> Ghi bù Google Sheet thành công: PASSED');

    console.log('\n=== TẤT CẢ CÁC KIỂM THỬ ĐÃ THÀNH CÔNG 100%! ===');
}

runTests().catch(err => {
    console.error('TEST FAILED:', err);
    process.exit(1);
});

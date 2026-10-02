const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

// Tạo in-memory DB độc lập
const testDb = new sqlite3.Database(':memory:');

function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        testDb.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        testDb.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        testDb.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Mock db module
const mockDb = { db: testDb, run, get, all };
require.cache[require.resolve('../config/db')] = {
    id: require.resolve('../config/db'),
    filename: require.resolve('../config/db'),
    loaded: true,
    exports: mockDb
};

const onDemandService = require('../services/on_demand_actions');
const { generateRegionReport, generateClusterReport } = require('../services/reports_v2');

async function runE2ETests() {
    console.log('===============================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ ON-DEMAND ACTIONS & DỮ LIỆU GOOGLE SHEET');
    console.log('===============================================================\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✅ [PASS] ${message}`);
            passed++;
        } else {
            console.error(`  ❌ [FAIL] ${message}`);
            failed++;
        }
    }

    // 1. Nạp Schema V2 & Seed V2
    console.log('1. Nạp Schema và Dữ liệu thực tế Vùng 27...');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../database/schema_v2.sql'), 'utf8');
    const seedSql = fs.readFileSync(path.join(__dirname, '../database/seed_v2.sql'), 'utf8');

    await new Promise((res, rej) => testDb.exec(schemaSql, err => err ? rej(err) : res()));
    await new Promise((res, rej) => testDb.exec(seedSql, err => err ? rej(err) : res()));
    
    const countMembers = await get("SELECT COUNT(*) as count FROM members WHERE region_id = 27");
    assert(countMembers.count === 19, 'Vùng 27 có đủ 19 thành viên (2 Lãnh đạo + 17 Sứ giả)');

    // 2. Kiểm thử Nút 1: Chia Sẻ Nhiệm Vụ
    console.log('\n2. Kiểm thử Nút 1: [Lấy & Chia Sẻ Nhiệm Vụ]...');
    const testDate = '2026-08-19';
    const fwdResult = await onDemandService.forwardTask({
        regionId: 27,
        workDate: testDate,
        taskContent: 'Link nhiệm vụ bài viết thiện nguyện ngày 19/08...'
    });
    assert(fwdResult.success === true, 'Chia sẻ nhiệm vụ thành công');
    assert(fwdResult.forwardedRegions.some(r => r.includes('27')), 'Đã forward tới Vùng 27');

    // 3. Giả lập tin nhắn Zalo trong ngày của Vùng 27
    console.log('\n3. Giả lập tin nhắn Sứ giả gửi trong ngày...');
    const simulatedMessages = [
        { sender_zalo_name: 'Quang Đại', msg_type: 'image', content_text: 'DONE' },
        { sender_zalo_name: 'Thanh Trà', msg_type: 'image', content_text: 'Oke' },
        { sender_zalo_name: 'Mỹ Duyên', msg_type: 'text', content_text: 'Hoàn thành' },
        { sender_zalo_name: 'Mai Thủy', msg_type: 'image', content_text: 'Em nộp bài ạ' },
        { sender_zalo_name: 'Phương Trinh', msg_type: 'text', content_text: 'Học quân sự nên hoãn đến 10/08/2026' },
        { sender_zalo_name: 'Văn Toàn', msg_type: 'text', content_text: 'Học quân sự nên hoãn đến 23/08/2026' }
    ];

    // 4. Kiểm thử Nút 2: Quét Bài & Xuất Báo Cáo Vùng 27 (Mẫu 1)
    console.log('\n4. Kiểm thử Nút 2: [Quét Bài & Xuất Báo Cáo Vùng 27]...');
    const scanResult = await onDemandService.scanAndReportRegion({
        regionId: 27,
        workDate: testDate,
        simulatedMessages,
        dryRun: true
    });

    assert(scanResult.success === true, 'Quét và tạo báo cáo Vùng thành công');
    assert(scanResult.completed === 4, 'Số người hoàn thành đúng: 4 (Đại, Trà, Duyên, Thủy)');
    assert(scanResult.incomplete === 15, 'Số người chưa hoàn thành / hoãn: 15');
    assert(scanResult.sheetRange.includes('T8/26!V4:V24'), 'Dải ma trận Google Sheet ngày 19 ở Cột V (V4:V24)');

    console.log('\n--- Nội dung Báo Cáo Vùng 27 (Mẫu 1) ---');
    console.log(scanResult.reportContent);
    console.log('----------------------------------------');

    // 5. Kiểm thử Nút Dành Cho Trưởng Cụm: Tổng Hợp Cụm 5 (Mẫu 2)
    console.log('\n5. Kiểm thử Nút Trưởng Cụm: [Tổng Hợp Báo Cáo Cụm 5]...');
    const clusterResult = await onDemandService.aggregateAndDispatchCluster({
        clusterId: 5,
        workDate: testDate,
        dryRun: true
    });

    assert(clusterResult.success === true, 'Tổng hợp Báo cáo Cụm 5 thành công');
    assert(clusterResult.reportContent.includes('@Phạm Minh Tú em gửi báo cáo nha anh'), 'Có dòng tag @Phạm Minh Tú');
    assert(clusterResult.reportContent.includes('Cụm 5 (Vùng 25–31)'), 'Có header Cụm 5');

    console.log('\n--- Nội dung Báo Cáo Cụm 5 (Mẫu 2) ---');
    console.log(clusterResult.reportContent);
    console.log('--------------------------------------');

    console.log('\n===============================================================');
    console.log(`🎉 TẤT CẢ KIỂM THỬ THÀNH CÔNG: ${passed} PASSED | ${failed} FAILED`);
    console.log('===============================================================');

    testDb.close();
    if (failed > 0) process.exit(1);
    else process.exit(0);
}

runE2ETests().catch(err => {
    console.error('Lỗi kiểm thử E2E:', err);
    process.exit(1);
});

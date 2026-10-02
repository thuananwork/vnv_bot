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

const { resolveMember } = require('../services/identity_resolver');
const { parseMessageSubmission } = require('../services/message_parser');
const { getColumnForDay } = require('../services/sheet_matrix_sync');
const { generateRegionReport, generateClusterReport } = require('../services/reports_v2');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ VNV-BOT V2 SYSTEM DESIGN (VÙNG 27 REAL DATA)');
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

    // 1. Khởi tạo Database V2
    console.log('1. Khởi tạo & nạp Schema V2 + Seed V2...');
    const schemaSql = fs.readFileSync(path.join(__dirname, '../database/schema_v2.sql'), 'utf8');
    const seedSql = fs.readFileSync(path.join(__dirname, '../database/seed_v2.sql'), 'utf8');

    await new Promise((res, rej) => testDb.exec(schemaSql, err => err ? rej(err) : res()));
    await new Promise((res, rej) => testDb.exec(seedSql, err => err ? rej(err) : res()));
    assert(true, 'Schema và Seed V2 đã nạp thành công vào SQLite');

    // 2. Kiểm thử Ánh xạ Định danh (Identity Resolver)
    console.log('\n2. Kiểm thử Identity Resolver (Ánh xạ Tên Zalo -> Tên Sheet)...');
    const member1 = await resolveMember({
        zaloUserId: 'uid_dai_v27',
        zaloDisplayName: 'Quang Đại',
        regionId: 27
    });
    assert(member1 && member1.real_name === 'Phạm Quang Đại', 'Map đúng Trưởng vùng 27 qua Zalo UID');

    const member2 = await resolveMember({
        zaloDisplayName: 'Thanh Trà',
        regionId: 27
    });
    assert(member2 && member2.real_name === 'Nguyễn Thị Thanh Trà', 'Map đúng Phó Vùng 27 qua Display Name / Alias');

    // 3. Kiểm thử Message Parser
    console.log('\n3. Kiểm thử Message Parser (Cú pháp & Lý do)...');
    const parse1 = parseMessageSubmission({ msgType: 'image', content: 'DONE' });
    assert(parse1.status === 'OK', 'Nhận diện nộp bài ảnh + DONE');

    const parse2 = parseMessageSubmission({ msgType: 'text', content: 'Học quân sự nên hoãn đến 10/08/2026' });
    assert(parse2.status === 'LATE_REQUEST' && parse2.notes.includes('quân sự'), 'Trích xuất lý do quân sự/hoãn');

    const parse3 = parseMessageSubmission({ msgType: 'text', content: 'hoàn thành nhiệm vụ ngày 28/05, 29/05 và 30/05' });
    assert(parse3.status === 'SUPPLEMENT' && parse3.supplementDates.length >= 3, 'Trích xuất 3 ngày nộp bù');

    // 4. Kiểm thử Tọa độ Ma trận Google Sheet
    console.log('\n4. Kiểm thử Tọa độ Ma trận Cột Google Sheet...');
    assert(getColumnForDay(1) === 'D', 'Ngày 1 -> Cột D');
    assert(getColumnForDay(16) === 'S', 'Ngày 16 -> Cột S');
    assert(getColumnForDay(19) === 'V', 'Ngày 19 -> Cột V');
    assert(getColumnForDay(31) === 'AH', 'Ngày 31 -> Cột AH');

    // 5. Giả lập nộp bài trong ngày và sinh Báo cáo Vùng 27
    console.log('\n5. Giả lập Nộp bài & Sinh Báo cáo Vùng 27 (Mẫu 1)...');
    const testDate = '2026-08-19';
    
    // Tạo task mẫu
    await run(`
        INSERT OR REPLACE INTO tasks (id, task_code, title, description, publish_date, status)
        VALUES (1, 'TSK-C5-20260819-01', 'Nhiệm vụ 19/08', 'Chia sẻ bài viết', ?, 'active')
    `, [testDate]);

    // Ghi nhận Trưởng vùng nộp OK
    await run(`
        INSERT OR REPLACE INTO submissions (task_id, member_id, region_id, work_date, status)
        VALUES (1, 2701, 27, ?, 'OK')
    `, [testDate]);

    // Ghi nhận Phương Trinh xin hoãn quân sự
    await run(`
        INSERT OR REPLACE INTO submissions (task_id, member_id, region_id, work_date, status, notes)
        VALUES (1, 2703, 27, ?, 'LATE_REQUEST', 'đi quân sự hoãn đến 10/08/2026')
    `, [testDate]);

    const reportV27 = await generateRegionReport(27, testDate);
    assert(reportV27.totalCompleted === 1, 'Vùng 27: Hoàn thành 1');
    assert(reportV27.totalIncomplete === 18, 'Vùng 27: Không hoàn thành 18');
    assert(reportV27.content.includes('VÙNG 27'), 'Báo cáo Vùng chứa header VÙNG 27');
    assert(reportV27.content.includes('Phạm Quang Đại'), 'Báo cáo Vùng chứa tên Trưởng vùng');

    // 6. Kiểm thử Báo cáo Cụm (Mẫu 2)
    console.log('\n6. Kiểm thử Báo cáo Tổng hợp Cụm 5 (Mẫu 2)...');
    const clusterRep = await generateClusterReport(5, testDate);
    assert(clusterRep.content.includes('Cụm 5 (Vùng 25–31)'), 'Báo cáo Cụm chứa Cụm 5 (Vùng 25–31)');
    assert(clusterRep.content.includes('@Phạm Minh Tú em gửi báo cáo nha anh'), 'Báo cáo Cụm có dòng tag @Phạm Minh Tú');

    console.log('\n===============================================================');
    console.log(`🎉 KẾT QUẢ KIỂM THỬ: ${passed} PASSED | ${failed} FAILED`);
    console.log('===============================================================');

    testDb.close();
    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runTests().catch(err => {
    console.error('Lỗi kiểm thử:', err);
    process.exit(1);
});

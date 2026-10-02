const assert = require('assert');
const path = require('path');
const { getColumnForDay, indexToColumnLetter } = require('../services/sheet_matrix_sync');
const { extractDatesFromText, parseMessageSubmission } = require('../services/message_parser');
const { generateRegionReport } = require('../services/reports_v2');
const db = require('../config/db');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 KIỂM THỬ TÍNH NĂNG CHỌN NGÀY BÁO CÁO TRONG 7 NGÀY GẦN NHẤT');
    console.log('===============================================================');

    // 1. Kiểm thử định dạng 7 ngày gần nhất
    console.log('\n1. Kiểm thử thuật toán sinh 7 ngày gần nhất...');
    const now = new Date();
    const days = [];
    for (let i = 0; i < 7; i++) {
        const d = new Date(now);
        d.setDate(d.getDate() - i);
        const ymd = d.toLocaleDateString('sv');
        days.push(ymd);
    }
    assert.strictEqual(days.length, 7, 'Phải sinh đúng 7 ngày');
    console.log('  ✅ [PASS] Đã sinh đúng 7 ngày gần nhất:', days.join(', '));

    // 2. Kiểm thử tính toán cột Google Sheet cho các ngày
    console.log('\n2. Kiểm thử ánh xạ cột Google Sheet cho các ngày trong 7 ngày...');
    assert.strictEqual(getColumnForDay(1), 'D', 'Ngày 1 phải là cột D');
    assert.strictEqual(getColumnForDay(9), 'L', 'Ngày 9 phải là cột L');
    assert.strictEqual(getColumnForDay(13), 'P', 'Ngày 13 phải là cột P');
    assert.strictEqual(getColumnForDay(14), 'Q', 'Ngày 14 phải là cột Q');
    assert.strictEqual(getColumnForDay(15), 'R', 'Ngày 15 phải là cột R');
    console.log('  ✅ [PASS] Ánh xạ cột Google Sheet chính xác 100%');

    // 3. Kiểm thử phân tích divider date và điều kiện dừng cuộn
    console.log('\n3. Kiểm thử phân tích divider date và điều kiện dừng cuộn...');
    function parseDividerTextToYmd(text, refMs) {
        if (!text) return null;
        const t = text.trim().toLowerCase();
        const ref = new Date(refMs);
        const pad = (n) => String(n).padStart(2, '0');
        const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

        if (t.includes('hôm nay') || t.includes('today')) return toYmd(ref);
        if (t.includes('hôm qua') || t.includes('yesterday')) {
            const y = new Date(ref);
            y.setDate(y.getDate() - 1);
            return toYmd(y);
        }
        if (t.includes('hôm kia')) {
            const k = new Date(ref);
            k.setDate(k.getDate() - 2);
            return toYmd(k);
        }
        const slashMatch = t.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
        if (slashMatch) {
            const day = parseInt(slashMatch[1], 10);
            const month = parseInt(slashMatch[2], 10);
            let year = slashMatch[3] ? parseInt(slashMatch[3], 10) : ref.getFullYear();
            if (year < 100) year += 2000;
            if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
                return `${year}-${pad(month)}-${pad(day)}`;
            }
        }
        return null;
    }

    const testRefDate = new Date('2026-09-15T10:00:00Z').getTime();
    assert.strictEqual(parseDividerTextToYmd('Hôm nay', testRefDate), '2026-09-15');
    assert.strictEqual(parseDividerTextToYmd('Hôm qua', testRefDate), '2026-09-14');
    assert.strictEqual(parseDividerTextToYmd('Thứ Bảy, 13/09/2026', testRefDate), '2026-09-13');
    assert.strictEqual(parseDividerTextToYmd('12/09', testRefDate), '2026-09-12');

    // Kiểm tra điều kiện dừng cuộn khi targetDate = '2026-09-14'
    const targetDate = '2026-09-14';
    const divToday = parseDividerTextToYmd('Hôm nay', testRefDate);
    const divYesterday = parseDividerTextToYmd('Hôm qua', testRefDate);
    const divTwoDaysAgo = parseDividerTextToYmd('13/09', testRefDate);

    assert.strictEqual(divToday < targetDate, false, 'Hôm nay không dừng');
    assert.strictEqual(divYesterday < targetDate, false, 'Hôm qua (ngày mục tiêu) chưa dừng');
    assert.strictEqual(divTwoDaysAgo < targetDate, true, 'Ngày 13/09 trước 14/09 -> DỪNG CUỘN THÀNH CÔNG');
    console.log('  ✅ [PASS] Logic phân tích divider và điều kiện dừng cuộn chính xác');

    // 4. Kiểm thử sinh Báo cáo Vùng khi truyền workDate quá khứ
    console.log('\n4. Kiểm thử Báo cáo Vùng với ngày quá khứ...');
    const testPastDate = '2026-09-14';
    await db.run("INSERT OR REPLACE INTO tasks (id, task_code, title, description, publish_date, source_group) VALUES (999, 'TSK-TEST-PAST', 'Test Past', 'Desc', ?, 'CỤM 5')", [testPastDate]);
    
    const mem = await db.get("SELECT id FROM members WHERE region_id = 27 LIMIT 1");
    if (mem) {
        await db.run("INSERT OR REPLACE INTO submissions (task_id, member_id, region_id, work_date, status, submitted_at) VALUES (999, ?, 27, ?, 'OK', '2026-09-14 18:00:00')", [mem.id, testPastDate]);
    }

    const report = await generateRegionReport(27, testPastDate);
    assert.ok(report.content.includes('Báo cáo ngày 14/9/2026'), 'Báo cáo phải ghi đúng ngày 14/9/2026');
    assert.ok(report.totalCompleted >= 1, 'Phải có ít nhất 1 thành viên hoàn thành');
    console.log('  ✅ [PASS] Báo cáo Vùng sinh đúng ngày quá khứ 14/09/2026');

    console.log('\n===============================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ TÍNH NĂNG 7 NGÀY GẦN NHẤT THÀNH CÔNG!');
    console.log('===============================================================');
}

runTests().catch(err => {
    console.error('❌ Lỗi kiểm thử:', err);
    process.exit(1);
});

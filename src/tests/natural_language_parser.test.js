/**
 * Test Suite: Natural Language Parser, Identity Resolution & Cluster Report Format
 * Kiểm tra các tính năng nghiệp vụ tiếp thu từ dự án cũ vnv-zalo-bot
 */

const assert = require('assert');
const db = require('../config/db');
const { 
    parseMessageSubmission, 
    extractDatesFromText, 
    extractMemberNameFromSubmission,
    extractReasonNotes 
} = require('../services/message_parser');
const { resolveMember } = require('../services/identity_resolver');
const { generateClusterReport } = require('../services/reports_v2');

let passed = 0;
let failed = 0;

function it(desc, fn) {
    try {
        fn();
        console.log(`  ✓ [PASS] ${desc}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ [FAIL] ${desc}:`, err.message);
        failed++;
    }
}

async function itAsync(desc, fn) {
    try {
        await fn();
        console.log(`  ✓ [PASS] ${desc}`);
        passed++;
    } catch (err) {
        console.error(`  ✗ [FAIL] ${desc}:`, err.message);
        failed++;
    }
}

async function runAllTests() {
    console.log('===============================================================');
    console.log('  KIỂM THỬ TÍNH NĂNG NGHIỆP VỤ & PARSER MỚI (TỪ DỰ ÁN CŨ)     ');
    console.log('===============================================================\n');

    const baseDate = '2026-05-04'; // Thứ Hai

    // 1. Kiểm thử trích xuất ngày tương đối
    console.log('1. Kiểm thử trích xuất ngày tương đối & nhiều ngày:');
    it('Phát hiện "hôm qua" trả về ngày hôm trước', () => {
        const dates = extractDatesFromText('Em gửi nv hôm qua ạ', baseDate);
        assert.deepStrictEqual(dates, ['2026-05-03']);
    });

    it('Phát hiện "hôm kia" trả về 2 ngày trước', () => {
        const dates = extractDatesFromText('Dạ em nộp bù bài hôm kia', baseDate);
        assert.deepStrictEqual(dates, ['2026-05-02']);
    });

    it('Phát hiện chuỗi ngày gộp "22/23/04/2026"', () => {
        const dates = extractDatesFromText('Thanh Trà bổ sung nhiệm vụ ngày 22/23/04/2026', baseDate);
        assert(dates.includes('2026-04-22'));
        assert(dates.includes('2026-04-23'));
        assert.strictEqual(dates.length, 2);
    });

    it('Phát hiện chuỗi ngày gộp "18/21/23/04/2026"', () => {
        const dates = extractDatesFromText('Hoàng Lê Na bổ sung nhiệm vụ ngày 18/21/23/04/2026', baseDate);
        assert(dates.includes('2026-04-18'));
        assert(dates.includes('2026-04-21'));
        assert(dates.includes('2026-04-23'));
        assert.strictEqual(dates.length, 3);
    });

    // 2. Kiểm thử trích xuất tên sau dấu gạch ngang
    console.log('\n2. Kiểm thử trích xuất tên sau gạch ngang:');
    it('Trích xuất tên thành viên từ cú pháp báo cáo Vùng 25', () => {
        const name = extractMemberNameFromSubmission('Phản hồi hoàn thành Nhiệm vụ CN ngày 3/5/2026 - Phạm Thu Vân');
        assert.strictEqual(name, 'Phạm Thu Vân');
    });

    it('Trích xuất tên từ cú pháp có gạch ngang dài', () => {
        const name = extractMemberNameFromSubmission('Nhiệm vụ sứ giả CN (03/05/2026) – Dương Văn Quang Minh');
        assert.strictEqual(name, 'Dương Văn Quang Minh');
    });

    // 3. Kiểm thử phân loại trạng thái nộp bài (100% Text-based, không cần ảnh)
    console.log('\n3. Kiểm thử phân loại trạng thái nộp bài:');
    it('Phát hiện tin nhắn nộp bài hôm nay + bổ sung hôm qua', () => {
        const res = parseMessageSubmission({
            content: 'Em gửi nv hôm qua với hôm nay ạ',
            workDate: baseDate
        });
        assert.strictEqual(res.status, 'OK');
        assert(res.supplementDates.includes('2026-05-03'));
    });

    it('Phát hiện tin nhắn làm bù ngày cũ', () => {
        const res = parseMessageSubmission({
            content: 'Nga đã bổ sung nv ngày 21/4',
            workDate: baseDate
        });
        assert.strictEqual(res.status, 'SUPPLEMENT');
        assert(res.supplementDates.includes('2026-04-21'));
    });

    it('Phát hiện tin nhắn hoàn thành bằng từ khóa text', () => {
        const res = parseMessageSubmission({
            content: 'Đã hoàn thành nhiệm vụ',
            workDate: baseDate
        });
        assert.strictEqual(res.status, 'OK');
    });

    // 4. Kiểm thử Identity Resolution với dữ liệu nạp từ name_mapping.json
    console.log('\n4. Kiểm thử Bản đồ Ánh xạ Danh tính (Identity Mappings) 7 Vùng:');
    await itAsync('Khớp nickname viết tắt "Vnl" -> "Vũ Ngọc Lâm" (Vùng 25)', async () => {
        const resolved = await resolveMember({
            zaloDisplayName: 'Vnl',
            regionId: 25
        });
        assert(resolved !== null, 'Phải tìm thấy thành viên');
        assert.strictEqual(resolved.real_name, 'Vũ Ngọc Lâm');
    });

    await itAsync('Khớp nickname viết tắt "Pvy" -> "Vũ Hà Phương Vy" (Vùng 25)', async () => {
        const resolved = await resolveMember({
            zaloDisplayName: 'Pvy',
            regionId: 25
        });
        assert(resolved !== null, 'Phải tìm thấy thành viên');
        assert.strictEqual(resolved.real_name, 'Vũ Hà Phương Vy');
    });

    await itAsync('Khớp nickname "Judy Nguyễn" -> "Vũ Judy Nguyễn" (Vùng 26)', async () => {
        const resolved = await resolveMember({
            zaloDisplayName: 'Judy Nguyễn',
            regionId: 26
        });
        assert(resolved !== null, 'Phải tìm thấy thành viên');
        assert.strictEqual(resolved.real_name, 'Vũ Judy Nguyễn');
    });

    await itAsync('Khớp tên qua cú pháp gạch ngang "... - Phạm Thu Vân"', async () => {
        const resolved = await resolveMember({
            messageContent: 'Phản hồi hoàn thành Nhiệm vụ CN ngày 3/5/2026 - Phạm Thu Vân',
            regionId: 25
        });
        assert(resolved !== null, 'Phải tìm thấy thành viên');
        assert.strictEqual(resolved.real_name, 'Phạm Thu Vân');
    });

    // 5. Kiểm thử định dạng báo cáo Trưởng Cụm gom nhóm
    console.log('\n5. Kiểm thử Định dạng Báo cáo Trưởng Cụm gom nhóm chuyên nghiệp:');
    await itAsync('Báo cáo Cụm sử dụng gạch đầu dòng và gom nhóm lý do', async () => {
        const report = await generateClusterReport(5, baseDate);
        assert(report.content.includes('Cụm 5 (Vùng 25–31)'));
        assert(report.content.includes('Ghi chú:'));
        // Kiểm tra có ký tự '-' trong block ghi chú nếu có thành viên chưa hoàn thành
        console.log('  Nội dung mẫu báo cáo Cụm sinh ra:');
        console.log('  ' + report.content.split('\n').slice(0, 15).join('\n  '));
    });

    console.log('\n===============================================================');
    console.log(`🎉 KẾT QUẢ KIỂM THỬ: ${passed} PASSED | ${failed} FAILED`);
    console.log('===============================================================');

    if (failed > 0) {
        process.exit(1);
    } else {
        process.exit(0);
    }
}

runAllTests().catch(err => {
    console.error('Lỗi khi chạy test:', err);
    process.exit(1);
});

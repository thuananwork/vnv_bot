const assert = require('assert');
const { cleanZaloSenderName, normalizeVietnamese } = require('../utils/name_cleaner');
const { resolveMember, registerMapping } = require('../services/identity_resolver');
const db = require('../config/db');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 KIỂM THỬ: LÀM SẠCH TÊN ZALO & NHẬN DIỆN SỨ GIẢ THÔNG MINH');
    console.log('===============================================================');

    // 1. Kiểm thử cleanZaloSenderName
    console.log('\n1. Kiểm thử lọc bỏ tiền tố "a", "aVùng31_", "aV31_"...');
    const cases = [
        { in: 'aVùng31_Nguyễn Tân', out: 'Nguyễn Tân' },
        { in: 'aVùng 31_Nguyễn Tân', out: 'Nguyễn Tân' },
        { in: 'aVùng 31 - Nguyễn Tân', out: 'Nguyễn Tân' },
        { in: 'aV31_Nguyễn Tân', out: 'Nguyễn Tân' },
        { in: 'V31_Nguyễn Tân', out: 'Nguyễn Tân' },
        { in: 'Vùng 31_Nguyễn Tân', out: 'Nguyễn Tân' },
        { in: 'aTuyết Như', out: 'Tuyết Như' },
        { in: 'aPhương Hoa', out: 'Phương Hoa' },
        { in: 'aHuyền', out: 'Huyền' },
        { in: 'aDuyên Nguyễn', out: 'Duyên Nguyễn' },
        { in: 'a Tuyết Như', out: 'Tuyết Như' },
        { in: 'a_Tuyết Như', out: 'Tuyết Như' },
        { in: 'a-Tuyết Như', out: 'Tuyết Như' },
        { in: 'Anh Tuấn', out: 'Anh Tuấn' }, // Không làm mất chữ Anh thật
        { in: 'An Nguyễn', out: 'An Nguyễn' }, // Không làm mất chữ An thật
        { in: 'Ánh Tuyết', out: 'Ánh Tuyết' },
        { in: 'Ân Trần', out: 'Ân Trần' },
        { in: 'aAn Nguyễn', out: 'An Nguyễn' }, // Thêm 'a' trước 'An' -> lọc được
        { in: 'Quang Đại', out: 'Quang Đại' },
        { in: 'Thanh Trà ❤️', out: 'Thanh Trà ❤️' }
    ];

    cases.forEach(c => {
        const cleaned = cleanZaloSenderName(c.in);
        assert.strictEqual(cleaned, c.out, `Lỗi: "${c.in}" ra "${cleaned}", kỳ vọng "${c.out}"`);
        console.log(`  ✅ "${c.in}" => "${cleaned}"`);
    });

    // 2. Kiểm thử nhận diện Sứ giả trong DB kể cả khi gửi ảnh [Ảnh]
    console.log('\n2. Kiểm thử resolveMember với các sender Zalo có tiền tố "a" & gửi [Ảnh]...');
    
    // Tạo giả lập thành viên Vùng test (ID 999) trong DB
    const TEST_REGION_ID = 999;
    await db.run('INSERT OR REPLACE INTO regions (id, region_name, cluster_id, zalo_group_id, zalo_group_name) VALUES (?, "Vùng Test 999", 5, "vung_999_test", "SỨ GIẢ VÙNG TEST")', [TEST_REGION_ID]);
    await db.run('DELETE FROM identity_mappings WHERE zalo_user_id IN ("uid_test_tan", "uid_test_nhu", "uid_test_huyen", "uid_tan", "uid_nhu", "uid_huyen")');
    await db.run('DELETE FROM members WHERE region_id = ?', [TEST_REGION_ID]);
    await db.run('DELETE FROM identity_mappings WHERE member_id IN (SELECT id FROM members WHERE region_id = ?)', [TEST_REGION_ID]);

    const m1 = await db.run('INSERT INTO members (region_id, sheet_row_index, real_name, role, status) VALUES (?, 4, "Nguyễn Thanh Tân", "EMISSARY", "Active")', [TEST_REGION_ID]);
    const m2 = await db.run('INSERT INTO members (region_id, sheet_row_index, real_name, role, status) VALUES (?, 5, "Nguyễn Thị Tuyết Như", "EMISSARY", "Active")', [TEST_REGION_ID]);
    const m3 = await db.run('INSERT INTO members (region_id, sheet_row_index, real_name, role, status) VALUES (?, 6, "Tạ Thị Khánh Huyền", "EMISSARY", "Active")', [TEST_REGION_ID]);

    // Test A: Chưa có mapping trong DB, gửi ảnh [Ảnh] với sender 'aVùng31_Nguyễn Tân'
    const resA = await resolveMember({
        zaloUserId: 'uid_test_tan',
        zaloDisplayName: 'aVùng31_Nguyễn Tân',
        messageContent: '[Ảnh]',
        regionId: TEST_REGION_ID
    });
    assert(resA, 'Phải nhận diện được Nguyễn Thanh Tân');
    assert.strictEqual(resA.id, m1.id);
    console.log(`  ✅ Nhận diện thành công: "aVùng31_Nguyễn Tân" + [Ảnh] => "${resA.real_name}" (Confidence: ${resA.confidence_score})`);

    // Kiểm tra tên lưu trong identity_mappings đã được làm sạch thành 'Nguyễn Tân' (không có chữ a thừa)
    const mapTan = await db.get('SELECT * FROM identity_mappings WHERE member_id = ?', [m1.id]);
    assert.strictEqual(mapTan.zalo_display_name, 'Nguyễn Tân');
    console.log(`  ✅ Tên Zalo lưu trong DB hiển thị sạch: "${mapTan.zalo_display_name}"`);

    // Test B: Sender 'aTuyết Như' gửi [Ảnh]
    const resB = await resolveMember({
        zaloUserId: 'uid_test_nhu',
        zaloDisplayName: 'aTuyết Như',
        messageContent: '[Ảnh]',
        regionId: TEST_REGION_ID
    });
    assert(resB, 'Phải nhận diện được Nguyễn Thị Tuyết Như');
    assert.strictEqual(resB.id, m2.id);
    console.log(`  ✅ Nhận diện thành công: "aTuyết Như" + [Ảnh] => "${resB.real_name}" (Confidence: ${resB.confidence_score})`);

    // Test C: Sender 'aHuyền' gửi [Ảnh]
    const resC = await resolveMember({
        zaloUserId: 'uid_test_huyen',
        zaloDisplayName: 'aHuyền',
        messageContent: '[Ảnh]',
        regionId: TEST_REGION_ID
    });
    assert(resC, 'Phải nhận diện được Tạ Thị Khánh Huyền');
    assert.strictEqual(resC.id, m3.id);
    console.log(`  ✅ Nhận diện thành công: "aHuyền" + [Ảnh] => "${resC.real_name}" (Confidence: ${resC.confidence_score})`);

    // Dọn dẹp dữ liệu test
    await db.run('DELETE FROM identity_mappings WHERE zalo_user_id IN ("uid_test_tan", "uid_test_nhu", "uid_test_huyen", "uid_tan", "uid_nhu", "uid_huyen")');
    await db.run('DELETE FROM identity_mappings WHERE member_id IN (SELECT id FROM members WHERE region_id = ?)', [TEST_REGION_ID]);
    await db.run('DELETE FROM members WHERE region_id = ?', [TEST_REGION_ID]);
    await db.run('DELETE FROM regions WHERE id = ?', [TEST_REGION_ID]);

    console.log('\n===============================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ LÀM SẠCH TÊN & RESOLVE DANH TÍNH ĐỀU THÀNH CÔNG 100%!');
    console.log('===============================================================');
}

runTests().catch(err => {
    console.error('❌ Lỗi kiểm thử:', err);
    process.exit(1);
});

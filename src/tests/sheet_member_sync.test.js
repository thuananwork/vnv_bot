const assert = require('assert');
const db = require('../config/db');
const GoogleSheetsClient = require('../services/google/sheets');
const { isValidMemberName, syncMembersFromSheet } = require('../services/sheet_member_sync');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ ĐỒNG BỘ SỨ GIẢ TỪ GOOGLE SHEET VÀO HỆ THỐNG');
    console.log('===============================================================');

    // 1. Kiểm thử hàm lọc tên hợp lệ
    console.log('\n1. Kiểm tra bộ lọc tên Sứ giả hợp lệ...');
    assert.strictEqual(isValidMemberName('Phạm Quang Đại'), true, 'Tên thật hợp lệ');
    assert.strictEqual(isValidMemberName('Nguyễn Thị Thanh Trà'), true, 'Tên thật hợp lệ');
    assert.strictEqual(isValidMemberName('Lê Văn C'), true, 'Tên 3 từ hợp lệ');
    assert.strictEqual(isValidMemberName('STT'), false, 'Header STT phải bị loại');
    assert.strictEqual(isValidMemberName('Họ và Tên'), false, 'Header Họ và Tên phải bị loại');
    assert.strictEqual(isValidMemberName('Nhóm 1'), false, 'Nhóm phải bị loại');
    assert.strictEqual(isValidMemberName('123'), false, 'Số phải bị loại');
    assert.strictEqual(isValidMemberName(''), false, 'Rỗng phải bị loại');
    assert.strictEqual(isValidMemberName('Đại'), false, '1 từ phải bị loại');
    assert.strictEqual(isValidMemberName('Tô Kim Ngân'), true, 'Họ Tô (bỏ dấu = "to") KHÔNG được bị loại nhầm là tiêu đề Tổ');
    assert.strictEqual(isValidMemberName('Tồ Văn Hùng'), true, 'Họ Tồ hợp lệ');
    assert.strictEqual(isValidMemberName('Tổ 1'), false, 'Tiêu đề "Tổ 1" phải bị loại');
    console.log('  ✅ [PASS] Bộ lọc tên hoạt động chuẩn xác');

    // 2. Thiết lập dữ liệu giả lập cho Vùng 27
    console.log('\n2. Thiết lập dữ liệu giả lập Google Sheet cho Vùng 27...');
    const region = await db.get('SELECT * FROM regions WHERE id = 27');
    assert.ok(region, 'Vùng 27 phải tồn tại');
    assert.ok(region.sheet_id, 'Vùng 27 phải có sheet_id');

    // Đảm bảo "Thàn Thị Quỳnh Nhi" đang Active trong DB
    await db.run("UPDATE members SET status = 'Active' WHERE region_id = 27 AND real_name = 'Thàn Thị Quỳnh Nhi'");

    // Giả lập dữ liệu trên Google Sheet:
    // - Dòng 4: Phạm Quang Đại (Trưởng Vùng, Active)
    // - Dòng 5: Nguyễn Thị Thanh Trà (Phó Vùng, Active)
    // - Dòng 6: Thàn Thị Quỳnh Nhi (bị gạch ngang - strikethrough: true)
    // - Dòng 25: Lê Minh Tuấn (Sứ giả MỚI trên Sheet)
    //
    // setMockValues: mock cho getValues → trả về string[][] (array index 0 = hàng 4)
    // Cột: [A=STT, B=NgàyVào, C=HọTên, D...=GhiChú]
    const mockRows = [];
    // Row 4 (idx 0): Phạm Quang Đại
    mockRows[0] = ['1', '01/01/2026', 'Phạm Quang Đại'];
    // Row 5 (idx 1): Nguyễn Thị Thanh Trà
    mockRows[1] = ['2', '01/01/2026', 'Nguyễn Thị Thanh Trà'];
    // Row 6 (idx 2): Thàn Thị Quỳnh Nhi (strikethrough - sẽ được setMockGridData xử lý)
    mockRows[2] = ['3', '01/01/2026', 'Thàn Thị Quỳnh Nhi'];
    // Rows 7-24 (idx 3-20): trống
    for (let i = 3; i <= 20; i++) mockRows[i] = [];
    // Row 25 (idx 21): Lê Minh Tuấn
    mockRows[21] = ['22', '01/01/2026', 'Lê Minh Tuấn'];
    GoogleSheetsClient.setMockValues(region.sheet_id, mockRows);

    // setMockGridData: mock cho getGridData (cột C) → cung cấp strikethrough info
    const mockGrid = [
        { rowIndex: 4, value: 'Phạm Quang Đại', strikethrough: false },
        { rowIndex: 5, value: 'Nguyễn Thị Thanh Trà', strikethrough: false },
        { rowIndex: 6, value: 'Thàn Thị Quỳnh Nhi', strikethrough: true },
        { rowIndex: 25, value: 'Lê Minh Tuấn', strikethrough: false }
    ];
    GoogleSheetsClient.setMockGridData(region.sheet_id, mockGrid);


    // 3. Thực thi đồng bộ
    console.log('\n3. Thực thi đồng bộ Sứ giả từ Google Sheet...');
    const result = await syncMembersFromSheet(27, { userId: 1 });
    console.log('Kết quả đồng bộ:', {
        regionName: result.regionName,
        totalOnSheet: result.totalOnSheet,
        added: result.added.map(a => `${a.name} (Hàng ${a.rowIndex})`),
        updated: result.updated.map(u => u.name),
        deactivated: result.deactivated.map(d => d.name),
        totalActive: result.totalActive
    });

    // 4. Kiểm tra kết quả
    console.log('\n4. Xác minh dữ liệu trong SQLite Database...');
    
    // a. Kiểm tra thành viên mới "Lê Minh Tuấn"
    const newMember = await db.get("SELECT * FROM members WHERE region_id = 27 AND real_name = 'Lê Minh Tuấn'");
    assert.ok(newMember, 'Sứ giả mới "Lê Minh Tuấn" phải được lưu vào bảng members');
    assert.strictEqual(newMember.sheet_row_index, 25, 'Hàng trên sheet của Lê Minh Tuấn phải là 25');
    assert.strictEqual(newMember.status, 'Active', 'Trạng thái phải là Active');
    assert.strictEqual(newMember.role, 'EMISSARY', 'Vai trò mặc định là EMISSARY');

    // b. Kiểm tra identity mapping cho Lê Minh Tuấn
    const mapping = await db.get("SELECT * FROM identity_mappings WHERE member_id = ?", [newMember.id]);
    assert.ok(mapping, 'Phải tự động tạo identity mapping cho Lê Minh Tuấn');
    assert.strictEqual(mapping.zalo_display_name, 'Lê Minh Tuấn');

    // c. Kiểm tra thành viên gạch ngang "Thàn Thị Quỳnh Nhi"
    const retiredMember = await db.get("SELECT * FROM members WHERE region_id = 27 AND real_name = 'Thàn Thị Quỳnh Nhi'");
    assert.strictEqual(retiredMember.status, 'Inactive', 'Thàn Thị Quỳnh Nhi bị gạch ngang phải có status Inactive');

    // Cleanup mock data & test member
    await db.run("DELETE FROM identity_mappings WHERE member_id = ?", [newMember.id]);
    await db.run("DELETE FROM members WHERE id = ?", [newMember.id]);
    await db.run("UPDATE members SET status = 'Active' WHERE region_id = 27 AND real_name = 'Thàn Thị Quỳnh Nhi'");
    GoogleSheetsClient.resetFakeSpreadsheets();

    console.log('\n===============================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ ĐỒNG BỘ GOOGLE SHEET THÀNH CÔNG RỰC RỠ!');
    console.log('===============================================================');
}

runTests().catch(err => {
    console.error('❌ Lỗi kiểm thử:', err);
    process.exit(1);
});

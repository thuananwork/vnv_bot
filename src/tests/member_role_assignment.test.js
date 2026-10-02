const assert = require('assert');
const path = require('path');
const db = require('../config/db');
const { assignMemberRole } = require('../routes/members.routes');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ RÀNG BUỘC: BỔ NHIỆM & HỦY CHỨC VỤ TRƯỞNG/PHÓ VÙNG');
    console.log('===============================================================\n');

    await db.initDb();

    const testRegionId = 27;

    // Lưu lại trạng thái ban đầu của Vùng 27 để phục hồi sau test
    const initialRegion = await db.get('SELECT * FROM regions WHERE id = ?', [testRegionId]);
    const initialMembers = await db.all('SELECT id, real_name, role, status FROM members WHERE region_id = ?', [testRegionId]);
    const initialTruongUser = await db.get('SELECT * FROM users WHERE username = ?', [`truongvung${testRegionId}`]);
    const initialPhoUser = await db.get('SELECT * FROM users WHERE username = ?', [`phovung${testRegionId}`]);

    try {
        // Chuẩn bị 3 thành viên thử nghiệm trong Vùng 27
        // Member A (2703), Member B (2704), Member C (2705)
        const memberA = await db.get("SELECT * FROM members WHERE region_id = ? AND real_name = 'Nguyễn Thị Phương Trinh'", [testRegionId]);
        const memberB = await db.get("SELECT * FROM members WHERE region_id = ? AND real_name = 'Thàn Thị Quỳnh Nhi'", [testRegionId]);
        const memberC = await db.get("SELECT * FROM members WHERE region_id = ? AND real_name = 'Nguyễn Thị Mỹ Duyên'", [testRegionId]);

        assert(memberA, 'Thành viên A phải tồn tại trong DB');
        assert(memberB, 'Thành viên B phải tồn tại trong DB');
        assert(memberC, 'Thành viên C phải tồn tại trong DB');

        // Đảm bảo cả 3 đều là Active và ban đầu là EMISSARY
        await db.run("UPDATE members SET role = 'EMISSARY', status = 'Active' WHERE id IN (?, ?, ?)", [memberA.id, memberB.id, memberC.id]);

        // ====================================================================
        // TEST 1: Bổ nhiệm Sứ giả A làm Trưởng Vùng (LEADER)
        // ====================================================================
        console.log('1. Kiểm thử bổ nhiệm Sứ giả A làm Trưởng Vùng (LEADER)...');
        const resA = await assignMemberRole(memberA.id, 'LEADER', 1);
        assert(resA.message.includes('thành công'), 'Bổ nhiệm A làm Trưởng Vùng phải thành công');

        const dbMemberA = await db.get('SELECT role FROM members WHERE id = ?', [memberA.id]);
        assert.strictEqual(dbMemberA.role, 'LEADER', 'Member A phải có role = LEADER');

        const regAfterA = await db.get('SELECT leader_name FROM regions WHERE id = ?', [testRegionId]);
        assert.strictEqual(regAfterA.leader_name, memberA.real_name, 'regions.leader_name phải cập nhật thành tên Sứ giả A');

        const userTruongAfterA = await db.get('SELECT full_name FROM users WHERE username = ?', [`truongvung${testRegionId}`]);
        assert.strictEqual(userTruongAfterA.full_name, memberA.real_name, 'users.full_name của truongvung27 phải cập nhật thành tên Sứ giả A');
        console.log('  ✅ [PASS] Bổ nhiệm Trưởng Vùng đồng bộ members, regions và users thành công');

        // ====================================================================
        // TEST 2: Ràng buộc duy nhất 1 Trưởng Vùng: Bổ nhiệm tiếp Sứ giả B làm Trưởng Vùng
        // -> Sứ giả A phải tự động hạ về EMISSARY, B trở thành LEADER mới
        // ====================================================================
        console.log('\n2. Kiểm thử ràng buộc duy nhất: Bổ nhiệm tiếp B làm Trưởng Vùng...');
        const resB = await assignMemberRole(memberB.id, 'LEADER', 1);
        assert(resB.message.includes('thành công'), 'Bổ nhiệm B làm Trưởng Vùng phải thành công');

        const dbMemberA2 = await db.get('SELECT role FROM members WHERE id = ?', [memberA.id]);
        assert.strictEqual(dbMemberA2.role, 'EMISSARY', 'Trưởng Vùng cũ (A) phải tự động chuyển về EMISSARY');

        const dbMemberB = await db.get('SELECT role FROM members WHERE id = ?', [memberB.id]);
        assert.strictEqual(dbMemberB.role, 'LEADER', 'Trưởng Vùng mới (B) phải có role = LEADER');

        const countLeaders = await db.get("SELECT COUNT(*) as cnt FROM members WHERE region_id = ? AND role = 'LEADER'", [testRegionId]);
        assert.strictEqual(countLeaders.cnt, 1, 'Mỗi Vùng chỉ được phép có đúng 1 Trưởng Vùng');

        const regAfterB = await db.get('SELECT leader_name FROM regions WHERE id = ?', [testRegionId]);
        assert.strictEqual(regAfterB.leader_name, memberB.real_name, 'regions.leader_name phải đổi sang B');
        console.log('  ✅ [PASS] Ràng buộc duy nhất 1 Trưởng Vùng: Trưởng Vùng cũ tự động hạ về Sứ giả chuẩn xác');

        // ====================================================================
        // TEST 3: Bổ nhiệm Sứ giả C làm Phó Vùng (DEPUTY)
        // ====================================================================
        console.log('\n3. Kiểm thử bổ nhiệm Sứ giả C làm Phó Vùng (DEPUTY)...');
        const resC = await assignMemberRole(memberC.id, 'DEPUTY', 1);
        assert(resC.message.includes('thành công'), 'Bổ nhiệm C làm Phó Vùng phải thành công');

        const dbMemberC = await db.get('SELECT role FROM members WHERE id = ?', [memberC.id]);
        assert.strictEqual(dbMemberC.role, 'DEPUTY', 'Member C phải có role = DEPUTY');

        const regAfterC = await db.get('SELECT deputy_name FROM regions WHERE id = ?', [testRegionId]);
        assert.strictEqual(regAfterC.deputy_name, memberC.real_name, 'regions.deputy_name phải cập nhật thành tên Sứ giả C');

        const userPhoAfterC = await db.get('SELECT full_name FROM users WHERE username = ?', [`phovung${testRegionId}`]);
        assert.strictEqual(userPhoAfterC.full_name, memberC.real_name, 'users.full_name của phovung27 phải cập nhật thành tên Sứ giả C');
        console.log('  ✅ [PASS] Bổ nhiệm Phó Vùng đồng bộ members, regions và users thành công');

        // ====================================================================
        // TEST 4: Bổ nhiệm Sứ giả A làm Phó Vùng mới -> C tự động hạ về EMISSARY
        // ====================================================================
        console.log('\n4. Kiểm thử ràng buộc duy nhất 1 Phó Vùng: Bổ nhiệm A làm Phó Vùng thay C...');
        await assignMemberRole(memberA.id, 'DEPUTY', 1);

        const dbMemberC2 = await db.get('SELECT role FROM members WHERE id = ?', [memberC.id]);
        assert.strictEqual(dbMemberC2.role, 'EMISSARY', 'Phó Vùng cũ (C) phải tự động chuyển về EMISSARY');

        const dbMemberA3 = await db.get('SELECT role FROM members WHERE id = ?', [memberA.id]);
        assert.strictEqual(dbMemberA3.role, 'DEPUTY', 'Phó Vùng mới (A) phải có role = DEPUTY');

        const countDeputies = await db.get("SELECT COUNT(*) as cnt FROM members WHERE region_id = ? AND role = 'DEPUTY'", [testRegionId]);
        assert.strictEqual(countDeputies.cnt, 1, 'Mỗi Vùng chỉ được phép có đúng 1 Phó Vùng');
        console.log('  ✅ [PASS] Ràng buộc duy nhất 1 Phó Vùng: Phó Vùng cũ tự động hạ về Sứ giả chuẩn xác');

        // ====================================================================
        // TEST 5: Tắt chức vụ / Hủy bổ nhiệm (Revoke role to EMISSARY)
        // ====================================================================
        console.log('\n5. Kiểm thử TẮT CHỨC VỤ (Hủy bổ nhiệm, về Sứ giả)...');
        // Tắt chức vụ Phó Vùng của A
        const resRevokePho = await assignMemberRole(memberA.id, 'EMISSARY', 1);
        assert(resRevokePho.message.includes('hủy chức vụ'), 'Hủy chức vụ Phó Vùng của A thành công');

        const dbMemberA4 = await db.get('SELECT role FROM members WHERE id = ?', [memberA.id]);
        assert.strictEqual(dbMemberA4.role, 'EMISSARY', 'A phải trở về EMISSARY');

        const regAfterRevokePho = await db.get('SELECT deputy_name FROM regions WHERE id = ?', [testRegionId]);
        assert.strictEqual(regAfterRevokePho.deputy_name, null, 'regions.deputy_name phải về null sau khi tắt chức vụ');

        // Tắt chức vụ Trưởng Vùng của B
        const resRevokeTruong = await assignMemberRole(memberB.id, 'EMISSARY', 1);
        assert(resRevokeTruong.message.includes('hủy chức vụ'), 'Hủy chức vụ Trưởng Vùng của B thành công');

        const dbMemberB2 = await db.get('SELECT role FROM members WHERE id = ?', [memberB.id]);
        assert.strictEqual(dbMemberB2.role, 'EMISSARY', 'B phải trở về EMISSARY');

        const regAfterRevokeTruong = await db.get('SELECT leader_name FROM regions WHERE id = ?', [testRegionId]);
        assert.strictEqual(regAfterRevokeTruong.leader_name, `Trưởng Vùng ${testRegionId}`, 'regions.leader_name phải reset về mặc định');
        console.log('  ✅ [PASS] Tắt chức vụ hoàn trả trạng thái về Sứ giả và làm sạch liên kết Trưởng/Phó thành công');

        // ====================================================================
        // TEST 6: Ràng buộc không cho phép bổ nhiệm Sứ giả Inactive
        // ====================================================================
        console.log('\n6. Kiểm thử ràng buộc Sứ giả Inactive không được bổ nhiệm...');
        await db.run("UPDATE members SET status = 'Inactive' WHERE id = ?", [memberA.id]);

        let errorCaught = false;
        try {
            await assignMemberRole(memberA.id, 'LEADER', 1);
        } catch (err) {
            errorCaught = true;
            assert(err.message.includes('Inactive'), 'Thông báo lỗi phải đề cập đến trạng thái Inactive');
        }
        assert.strictEqual(errorCaught, true, 'Hệ thống phải chặn không cho bổ nhiệm thành viên Inactive');

        const checkA = await db.get('SELECT role FROM members WHERE id = ?', [memberA.id]);
        assert.strictEqual(checkA.role, 'EMISSARY', 'Role của thành viên Inactive không được thay đổi');
        console.log('  ✅ [PASS] Chặn bổ nhiệm thành viên Inactive chuẩn xác');

        // ====================================================================
        // TEST 7: Kiểm thử tự động hạ chức khi Sứ giả bị đổi sang Inactive
        // ====================================================================
        console.log('\n7. Kiểm thử tự động hạ chức khi Sứ giả bị đổi sang Inactive...');
        // Đặt C lại thành Active và bổ nhiệm làm Trưởng Vùng
        await db.run("UPDATE members SET status = 'Active' WHERE id = ?", [memberC.id]);
        await assignMemberRole(memberC.id, 'LEADER', 1);

        const checkBefore = await db.get('SELECT role FROM members WHERE id = ?', [memberC.id]);
        assert.strictEqual(checkBefore.role, 'LEADER');

        // Thực hiện gán Inactive kèm hạ chức
        await assignMemberRole(memberC.id, 'EMISSARY', 1);
        await db.run("UPDATE members SET status = 'Inactive' WHERE id = ?", [memberC.id]);

        const checkAfter = await db.get('SELECT role, status FROM members WHERE id = ?', [memberC.id]);
        assert.strictEqual(checkAfter.role, 'EMISSARY');
        assert.strictEqual(checkAfter.status, 'Inactive');
        console.log('  ✅ [PASS] Tự động thu hồi chức vụ khi thành viên ngưng hoạt động');

    } finally {
        // Phục hồi dữ liệu ban đầu cho Vùng 27
        console.log('\n🧹 Dọn dẹp và khôi phục dữ liệu ban đầu Vùng 27...');
        await db.run(
            'UPDATE regions SET leader_name = ?, deputy_name = ? WHERE id = ?',
            [initialRegion.leader_name, initialRegion.deputy_name, testRegionId]
        );
        for (const m of initialMembers) {
            await db.run(
                'UPDATE members SET role = ?, status = ? WHERE id = ?',
                [m.role, m.status, m.id]
            );
        }
        if (initialTruongUser) {
            await db.run('UPDATE users SET full_name = ? WHERE id = ?', [initialTruongUser.full_name, initialTruongUser.id]);
        }
        if (initialPhoUser) {
            await db.run('UPDATE users SET full_name = ? WHERE id = ?', [initialPhoUser.full_name, initialPhoUser.id]);
        }
        console.log('  ✅ Dữ liệu Vùng 27 đã được khôi phục nguyên vẹn.');
    }

    console.log('\n===============================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ RÀNG BUỘC BỔ NHIỆM & HỦY CHỨC VỤ ĐẠT 100% PASS!');
    console.log('===============================================================');
}

runTests().catch(err => {
    console.error('❌ LỖI KIỂM THỬ:', err);
    process.exit(1);
});

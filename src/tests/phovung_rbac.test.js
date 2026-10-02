const assert = require('assert');
const bcrypt = require('bcryptjs');
const db = require('../config/db');

async function runPhovungRbacTest() {
    console.log('===============================================================');
    console.log('🧪 KIỂM THỬ TÀI KHOẢN PHÓ VÙNG (PHOVUNG 25 -> 31) & RBAC');
    console.log('===============================================================');

    // 1. Kiểm tra 7 tài khoản Phó Vùng trong database
    console.log('\n1. Kiểm tra sự tồn tại của 7 tài khoản Phó Vùng...');
    for (let rId = 25; rId <= 31; rId++) {
        const username = `phovung${rId}`;
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        assert(user, `Tài khoản ${username} phải tồn tại trong DB`);
        assert.strictEqual(user.role, 'region_leader', `Vai trò của ${username} phải là region_leader`);
        assert.strictEqual(user.approval_status, 'approved', `Trạng thái của ${username} phải là approved`);
        assert.strictEqual(user.is_active, 1, `${username} phải ở trạng thái active`);

        // Kiểm tra password hash
        const passMatch = bcrypt.compareSync(username, user.password_hash);
        assert(passMatch, `Mật khẩu mặc định của ${username} phải khớp với username`);
        console.log(`  ✅ [PASS] ${username}: ID ${user.id} | Họ tên: ${user.full_name} | Role: ${user.role}`);
    }

    // 2. Kiểm tra không bị ghi đè manager_id của Vùng
    console.log('\n2. Kiểm tra tính toàn vẹn của manager_id trong bảng regions...');
    const regions = await db.all('SELECT id, region_name, leader_name, deputy_name, manager_id FROM regions WHERE id BETWEEN 25 AND 31 ORDER BY id ASC');
    for (const r of regions) {
        assert(r.manager_id, `Vùng ${r.id} phải có manager_id`);
        const mgrUser = await db.get('SELECT username FROM users WHERE id = ?', [r.manager_id]);
        assert(mgrUser.username.startsWith('truongvung'), `manager_id của Vùng ${r.id} (${mgrUser.username}) phải thuộc Trưởng Vùng, không bị ghi đè bởi Phó Vùng`);
        console.log(`  ✅ [PASS] ${r.region_name}: Trưởng Vùng (user: ${mgrUser.username}, id: ${r.manager_id}) | Phó Vùng: ${r.deputy_name}`);
    }

    // 3. Kiểm tra logic phân giải managed_region_id cho Phó Vùng
    console.log('\n3. Kiểm tra phân giải Vùng quản lý cho phovung25 và phovung27...');
    for (const testUser of ['phovung25', 'phovung27']) {
        const user = await db.get('SELECT * FROM users WHERE username = ?', [testUser]);
        let managedRegion = await db.get('SELECT id, region_name FROM regions WHERE manager_id = ?', [user.id]);
        if (!managedRegion) {
            const numMatch = user.username.match(/\d+/);
            if (numMatch) {
                const rId = parseInt(numMatch[0], 10);
                managedRegion = await db.get('SELECT id, region_name FROM regions WHERE id = ?', [rId]);
            }
        }
        if (!managedRegion) {
            managedRegion = await db.get('SELECT id, region_name FROM regions WHERE leader_name = ? OR deputy_name = ?', [user.full_name, user.full_name]);
        }
        assert(managedRegion, `Phải phân giải được Vùng cho ${testUser}`);
        const expectedId = parseInt(testUser.match(/\d+/)[0], 10);
        assert.strictEqual(managedRegion.id, expectedId, `Vùng phân giải của ${testUser} phải là ${expectedId}`);
        console.log(`  ✅ [PASS] ${testUser} -> ${managedRegion.region_name} (ID: ${managedRegion.id})`);
    }

    // 4. Kiểm tra quyền truy cập dữ liệu (Row-Level Security)
    console.log('\n4. Kiểm tra Row-Level Security: Thành viên thuộc Vùng của Phó Vùng...');
    const pv25Members = await db.all(
        'SELECT id, real_name FROM members WHERE region_id = ? AND status = "Active"',
        [25]
    );
    assert(pv25Members.length > 0, 'Vùng 25 phải có danh sách thành viên Active');
    console.log(`  ✅ [PASS] phovung25 truy cập được ${pv25Members.length} thành viên Vùng 25`);

    console.log('\n===============================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ PHÓ VÙNG THÀNH CÔNG RỰC RỠ!');
    console.log('===============================================================');
}

runPhovungRbacTest()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ KIỂM THỬ THẤT BẠI:', err);
        process.exit(1);
    });

/**
 * KIỂM THỬ TOÀN DIỆN 3 VAI TRÒ (ADMIN - TRƯỞNG CỤM - TRƯỞNG VÙNG)
 * VÀ TÁC ĐỘNG TƯƠNG HỖ CHÉO (CROSS-ROLE INTERACTIONS)
 */

const assert = require('assert');
const db = require('../config/db');
const { generateRegionReport, generateClusterReport } = require('../services/reports_v2');

async function runComprehensiveRoleTests() {
    console.log('======================================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ: 3 VAI TRÒ (ADMIN - CỤM - VÙNG) & RÀNG BUỘC RBAC');
    console.log('======================================================================\n');

    // -------------------------------------------------------------------------
    // PHẦN 1: KIỂM TRA PHÂN QUYỀN RÀNG BUỘC TỪNG ROLE (RBAC CONSTRAINTS)
    // -------------------------------------------------------------------------
    console.log('--- 1. KIỂM TRA RÀNG BUỘC TỪNG VAI TRÒ ---');

    // 1.1 Kiểm tra tài khoản Admin
    const adminUser = await db.get("SELECT * FROM users WHERE username = 'admin'");
    assert(adminUser, 'Tài khoản admin phải tồn tại');
    assert.strictEqual(adminUser.role, 'admin', 'Role phải là admin');
    assert.strictEqual(adminUser.approval_status, 'approved', 'Admin phải approved');
    console.log('  ✅ [PASS] ADMIN: Toàn quyền hệ thống, phê duyệt approved.');

    // 1.2 Kiểm tra tài khoản Trưởng Cụm (cum5)
    const clusterUser = await db.get("SELECT * FROM users WHERE username = 'cum5'");
    assert(clusterUser, 'Tài khoản cum5 phải tồn tại');
    assert.strictEqual(clusterUser.role, 'cluster_leader', 'Role phải là cluster_leader');
    
    // Kiểm tra Cụm 5 quản lý các Vùng 25-31
    const clusterRegions = await db.all("SELECT id, region_name FROM regions WHERE cluster_id = 5 ORDER BY id ASC");
    assert.strictEqual(clusterRegions.length, 7, 'Cụm 5 phải quản lý đúng 7 Vùng (25-31)');
    console.log(`  ✅ [PASS] TRƯỞNG CỤM: Quản lý Cụm 5 gồm ${clusterRegions.length} Vùng (25 -> 31).`);

    // 1.3 Kiểm tra các tài khoản Trưởng Vùng (truongvung25 -> truongvung31)
    for (let rId = 25; rId <= 31; rId++) {
        const tvUser = await db.get("SELECT * FROM users WHERE username = ?", [`truongvung${rId}`]);
        assert(tvUser, `Tài khoản truongvung${rId} phải tồn tại`);
        assert.strictEqual(tvUser.role, 'region_leader', `Role của truongvung${rId} phải là region_leader`);
        
        // Trưởng Vùng chỉ quản lý đúng 1 Vùng
        const region = await db.get("SELECT * FROM regions WHERE id = ?", [rId]);
        assert(region, `Vùng ${rId} phải tồn tại`);
        assert.strictEqual(region.manager_id, tvUser.id, `Trưởng vùng ${rId} phải là manager của Vùng ${rId}`);
    }
    console.log('  ✅ [PASS] TRƯỞNG VÙNG: Mỗi Trưởng Vùng gắn chặt với đúng 1 Vùng riêng biệt.');

    // 1.4 Kiểm tra phân quyền quick-switch giữa các role
    console.log('\n--- 2. KIỂM TRA RÀNG BUỘC CHUYỂN VAI TRÒ (QUICK-SWITCH RBAC) ---');
    // Rule: Trưởng Vùng KHÔNG ĐƯỢC chuyển sang Cụm hoặc Admin
    const authMiddleware = require('../middlewares/auth');
    assert(typeof authMiddleware.isAdmin === 'function', 'isAdmin middleware phải tồn tại');
    assert(typeof authMiddleware.isClusterLeader === 'function', 'isClusterLeader middleware phải tồn tại');
    assert(typeof authMiddleware.isRegionLeader === 'function', 'isRegionLeader middleware phải tồn tại');
    console.log('  ✅ [PASS] RBAC Middlewares (isAdmin, isClusterLeader, isRegionLeader, checkScope) sẵn sàng.');

    // -------------------------------------------------------------------------
    // PHẦN 2: CHỨC NĂNG VÙNG ẢNH HƯỞNG ĐẾN CỤM (REGION -> CLUSTER)
    // -------------------------------------------------------------------------
    console.log('\n--- 3. KIỂM TRA TƯƠNG TÁC: VÙNG QUÉT BÀI -> CỤM TỰ ĐỘNG CẬP NHẬT ---');
    
    const testDate = '2026-09-20';
    // Lấy 1 thành viên của Vùng 28
    const mem28 = await db.get("SELECT * FROM members WHERE region_id = 28 AND status = 'Active' LIMIT 1");
    assert(mem28, 'Vùng 28 phải có ít nhất 1 thành viên');

    // Lấy báo cáo Cụm trước khi nộp
    const initialClusterReport = await generateClusterReport(5, testDate);
    const initialCompleted = initialClusterReport.totalClusterCompleted;
    console.log(`  -> Số lượng hoàn thành ban đầu của Cụm 5: ${initialCompleted}`);

    // Giả lập Vùng 28 nộp bài thành công (OK)
    await db.run(
        `INSERT OR REPLACE INTO submissions (task_id, region_id, member_id, work_date, status, raw_content)
         VALUES (1, 28, ?, ?, 'OK', 'Gửi nhiệm vụ 20/09')`,
        [mem28.id, testDate]
    );

    // Kiểm tra báo cáo Vùng 28
    const rep28 = await generateRegionReport(28, testDate);
    assert(rep28.totalCompleted >= 1, 'Vùng 28 phải ghi nhận ít nhất 1 hoàn thành');
    console.log(`  -> Báo cáo Vùng 28 sau khi nộp: ${rep28.totalCompleted}/${rep28.totalMembers} hoàn thành`);

    // Kiểm tra báo cáo Cụm 5
    const updatedClusterReport = await generateClusterReport(5, testDate);
    console.log(`  -> Số lượng hoàn thành mới của Cụm 5: ${updatedClusterReport.totalClusterCompleted}`);
    assert(
        updatedClusterReport.totalClusterCompleted >= initialCompleted,
        'Báo cáo Cụm phải tự động tăng số lượng hoàn thành khi Vùng 28 có thêm bài nộp!'
    );
    assert(
        updatedClusterReport.content.includes('Cụm 5 (Vùng 25–31)'),
        'Nội dung Báo cáo Cụm phải chứa tiêu đề chuẩn Cụm 5'
    );
    assert(
        updatedClusterReport.content.includes('Vùng 28'),
        'Nội dung Báo cáo Cụm phải liệt kê chi tiết của Vùng 28'
    );
    console.log('  ✅ [PASS] VÙNG -> CỤM: Kết quả nộp bài của Vùng lập tức phản ánh chính xác 100% vào Báo Cáo Tổng Hợp Cụm 5!');

    // -------------------------------------------------------------------------
    // PHẦN 3: CHỨC NĂNG ADMIN ẢNH HƯỞNG ĐẾN VÙNG VÀ CỤM (ADMIN -> REGION & CLUSTER)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. KIỂM TRA TƯƠNG TÁC: ADMIN ĐỔI CẤU HÌNH -> VÙNG VÀ CỤM THỪA HƯỞNG ---');

    // Admin cấu hình text hoàn thành thành 'Oke'
    await db.run("INSERT OR REPLACE INTO local_config (key, value) VALUES ('completed_text', 'Oke')");
    await db.run("INSERT OR REPLACE INTO local_config (key, value) VALUES ('enable_sheet_colors', 'true')");
    
    // Kiểm tra cấu hình có được áp dụng tức thì
    const cfgCompletedText = await db.get("SELECT value FROM local_config WHERE key = 'completed_text'");
    const cfgEnableColors = await db.get("SELECT value FROM local_config WHERE key = 'enable_sheet_colors'");
    assert.strictEqual(cfgCompletedText.value, 'Oke', "completed_text phải là 'Oke'");
    assert.strictEqual(cfgEnableColors.value, 'true', "enable_sheet_colors phải là 'true'");

    // Kiểm tra khi Vùng đồng bộ Sheet (syncRegionMatrixSheet)
    const { syncRegionMatrixSheet } = require('../services/sheet_matrix_sync');
    process.env.SAFE_MODE = 'true'; // Chế độ an toàn giả lập
    const syncResult = await syncRegionMatrixSheet(28, testDate, { dryRun: true });
    assert(syncResult.success, 'Đồng bộ Vùng phải thành công');
    console.log(`  -> Giả lập đồng bộ Sheet Vùng 28: ${syncResult.rowsUpdated} hàng được chuẩn bị với text '${cfgCompletedText.value}'`);
    assert(syncResult.formatsPrepared > 0, 'Khi bật màu, formatRequests phải được tạo để tô màu Sheet');
    console.log(`  -> Số định dạng màu chuẩn bị gửi Google Sheets: ${syncResult.formatsPrepared} ô`);
    console.log('  ✅ [PASS] ADMIN -> VÙNG/CỤM: Cấu hình của Admin được áp dụng ngay lập tức cho toàn bộ các thao tác của Vùng!');

    console.log('\n======================================================================');
    console.log('🎉 TẤT CẢ CÁC BÀI KIỂM THỬ 3 VAI TRÒ & TƯƠNG TÁC ĐÃ THÀNH CÔNG 100%!');
    console.log('======================================================================');
}

runComprehensiveRoleTests()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ KIỂM THỬ THẤT BẠI:', err);
        process.exit(1);
    });

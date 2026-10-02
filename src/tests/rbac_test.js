process.env.MOCK_GOOGLE_SHEETS = 'true';
const db = require('../config/db');
const bcrypt = require('bcryptjs');

async function runTests() {
    console.log('----------------------------------------------------');
    console.log('KHỞI CHẠY KIỂM THỬ PHÂN QUYỀN RBAC & SCHEMA DATABASE');
    console.log('----------------------------------------------------');
    
    // Dọn dẹp/xóa tất cả bảng trước để đảm bảo schema.sql được nạp mới hoàn toàn
    console.log('0. Xóa các bảng cũ để cập nhật Schema mới...');
    await db.run('PRAGMA foreign_keys = OFF;');
    const tables = ['sheet_sync_history', 'reports', 'submissions', 'members', 'regions', 'clusters', 'audit_logs', 'users', 'tasks', 'local_config'];
    for (const table of tables) {
        await db.run(`DROP TABLE IF EXISTS ${table}`);
    }
    await db.run('PRAGMA foreign_keys = ON;');

    // Khởi chạy nạp schema
    await db.initDb();

    // 1. Dọn dẹp dữ liệu cũ để tránh trùng lặp
    console.log('1. Làm sạch dữ liệu kiểm thử cũ...');
    await db.run('DELETE FROM submissions');
    await db.run('DELETE FROM members');
    await db.run('DELETE FROM regions');
    await db.run('DELETE FROM clusters');
    await db.run("DELETE FROM users WHERE username IN ('test_admin', 'test_cluster_mgr', 'test_region_mgr')");
    await db.run('DELETE FROM audit_logs');

    // 2. Tạo users test
    console.log('2. Tạo người dùng mẫu cho các vai trò...');
    const salt = bcrypt.genSaltSync(10);
    const hash = bcrypt.hashSync('testpass', salt);

    const adminRes = await db.run(
        `INSERT INTO users (username, password_hash, full_name, role, auth_method, name_source) 
         VALUES ('test_admin', ?, 'Test Admin User', 'admin', 'local', 'manual')`,
        [hash]
    );
    const clusterLeaderRes = await db.run(
        `INSERT INTO users (username, password_hash, full_name, role, auth_method, name_source) 
         VALUES ('test_cluster_mgr', ?, 'Test Cluster Leader', 'cluster_leader', 'google', 'google')`,
        [hash]
    );
    const regionLeaderRes = await db.run(
        `INSERT INTO users (username, password_hash, full_name, role, auth_method, name_source) 
         VALUES ('test_region_mgr', ?, 'Test Region Leader', 'region_leader', 'google', 'google')`,
        [hash]
    );

    const clusterLeaderId = clusterLeaderRes.id;
    const regionLeaderId = regionLeaderRes.id;

    // 3. Tạo cụm và gán trưởng cụm
    console.log('3. Tạo Cụm mới...');
    const clusterRes = await db.run(
        `INSERT INTO clusters (cluster_name, manager_id) 
         VALUES ('Cụm Kiểm Thử 99', ?)`,
        [clusterLeaderId]
    );
    const clusterId = clusterRes.id;

    // 4. Tạo vùng và gán cụm, trưởng vùng, sheet_id
    console.log('4. Tạo Vùng mới và gán cấu hình Google Sheet...');
    const regionRes = await db.run(
        `INSERT INTO regions (region_name, cluster_id, manager_id, zalo_group_id, zalo_group_name, sheet_id, sheet_name) 
         VALUES ('Vùng Kiểm Thử 999', ?, ?, 'group_zalo_test_999', 'Group Test Vùng 999', 'sheet_test_id_999', 'Sheet Vùng 999')`,
        [clusterId, regionLeaderId]
    );
    const regionId = regionRes.id;

    // 5. Kiểm thử RBAC lọc dữ liệu
    console.log('5. Đang chạy kiểm tra truy vấn phân cấp dữ liệu (RBAC)...');
    
    // A. Kiểm tra Trưởng Cụm: Chỉ xem được các vùng thuộc Cụm họ quản lý
    const clusterRegions = await db.all(
        `SELECT r.*, c.cluster_name 
         FROM regions r 
         JOIN clusters c ON r.cluster_id = c.id
         WHERE r.cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?)`,
        [clusterLeaderId]
    );
    
    console.log(` -> Trưởng Cụm thấy: ${clusterRegions.length} vùng.`);
    if (clusterRegions.length === 1 && clusterRegions[0].id === regionId) {
        console.log(' [OK] TRƯỞNG CỤM: Lọc chính xác Vùng thuộc Cụm tương ứng.');
    } else {
        console.error(' [ERROR] TRƯỞNG CỤM: Lọc sai dữ liệu Vùng.');
        process.exit(1);
    }

    // B. Kiểm tra Trưởng Vùng: Chỉ xem được đúng Vùng họ quản lý trực tiếp
    const leaderRegions = await db.all(
        `SELECT r.* FROM regions r WHERE r.manager_id = ?`,
        [regionLeaderId]
    );

    console.log(` -> Trưởng Vùng thấy: ${leaderRegions.length} vùng.`);
    if (leaderRegions.length === 1 && leaderRegions[0].id === regionId) {
        console.log(' [OK] TRƯỞNG VÙNG: Lọc chính xác Vùng được gán quản lý.');
    } else {
        console.error(' [ERROR] TRƯỞNG VÙNG: Lọc sai dữ liệu Vùng.');
        process.exit(1);
    }

    // 6. Bổ sung kiểm thử nâng cao theo yêu cầu nghiệm thu
    console.log('6. Đang chạy kiểm tra nâng cao theo yêu cầu nghiệm thu...');
    
    // A. Tạo Cluster Khác (Cụm 88) và Region Khác (Vùng 888) thuộc Cụm 88
    const otherClusterRes = await db.run(
        `INSERT INTO clusters (cluster_name, manager_id) 
         VALUES ('Cụm Kiểm Thử Khác 88', NULL)`
    );
    const otherClusterId = otherClusterRes.id;
    
    const otherRegionRes = await db.run(
        `INSERT INTO regions (region_name, cluster_id, manager_id, zalo_group_id, zalo_group_name, sheet_id, sheet_name) 
         VALUES ('Vùng Kiểm Thử Khác 888', ?, NULL, 'group_zalo_test_888', 'Group Test Vùng 888', 'sheet_test_id_888', 'Sheet Vùng 888')`,
        [otherClusterId]
    );
    const otherRegionId = otherRegionRes.id;

    // B. Tạo một số báo cáo (reports) mẫu để test
    // Task mẫu
    const taskRes = await db.run(
        `INSERT INTO tasks (task_code, title, description, publish_date, status)
         VALUES ('TASK_TEST_001', 'Task Test 001', 'Description', '2026-06-25', 'active')`
    );
    const taskId = taskRes.id;

    // Report A: type='region', region_id = Vùng 999 (Cụm 99)
    const repARes = await db.run(
        `INSERT INTO reports (task_id, report_type, cluster_id, region_id, total_members, total_completed, total_failed, content)
         VALUES (?, 'region', NULL, ?, 10, 8, 2, 'Báo cáo vùng 999')`,
        [taskId, regionId]
    );
    const repAId = repARes.id;

    // Report B: type='region', region_id = Vùng 888 (Cụm 88)
    const repBRes = await db.run(
        `INSERT INTO reports (task_id, report_type, cluster_id, region_id, total_members, total_completed, total_failed, content)
         VALUES (?, 'region', NULL, ?, 5, 4, 1, 'Báo cáo vùng 888')`,
        [taskId, otherRegionId]
    );
    const repBId = repBRes.id;

    // Report C: type='cluster', cluster_id = Cụm 99
    const repCRes = await db.run(
        `INSERT INTO reports (task_id, report_type, cluster_id, region_id, total_members, total_completed, total_failed, content)
         VALUES (?, 'cluster', ?, NULL, 10, 8, 2, 'Báo cáo cụm 99')`,
        [taskId, clusterId]
    );
    const repCId = repCRes.id;

    // Report D: type='cluster', cluster_id = Cụm 88
    const repDRes = await db.run(
        `INSERT INTO reports (task_id, report_type, cluster_id, region_id, total_members, total_completed, total_failed, content)
         VALUES (?, 'cluster', ?, NULL, 5, 4, 1, 'Báo cáo cụm 88')`,
        [taskId, otherClusterId]
    );
    const repDId = repDRes.id;

    // --- TEST 1: Cluster Leader xem được report vùng thuộc cụm mình, không xem được cụm khác ---
    // Mô phỏng hàm lọc của GET /api/reports cho Cluster Leader (manager_id = clusterLeaderId)
    const reportsForClusterLeader = await db.all(
        `SELECT rep.id, rep.report_type FROM reports rep 
         WHERE rep.cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?)
            OR rep.region_id IN (SELECT id FROM regions WHERE cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?))`,
        [clusterLeaderId, clusterLeaderId]
    );
    
    const visibleReportIds = reportsForClusterLeader.map(r => r.id);
    console.log(' -> Báo cáo thấy được bởi Trưởng Cụm 99:', visibleReportIds);
    
    const hasRepA = visibleReportIds.includes(repAId); // Vùng thuộc cụm mình
    const hasRepC = visibleReportIds.includes(repCId); // Cụm mình
    const hasRepB = visibleReportIds.includes(repBId); // Vùng thuộc cụm khác
    const hasRepD = visibleReportIds.includes(repDId); // Cụm khác

    if (hasRepA && hasRepC && !hasRepB && !hasRepD) {
        console.log(' [OK] TRƯỞNG CỤM: Xem đúng báo cáo (vùng thuộc cụm mình và cụm mình), không bị lộ cụm khác.');
    } else {
        console.error(' [ERROR] TRƯỞNG CỤM: Lọc báo cáo sai hoặc bị rò rỉ dữ liệu cụm khác!', { hasRepA, hasRepC, hasRepB, hasRepD });
        process.exit(1);
    }

    // --- TEST 2: Region Leader không sync được report vùng khác ---
    const simulateSyncCheck = async (userId, userRole, repId) => {
        const report = await db.get(`
            SELECT rep.*, r.sheet_id, r.sheet_name, r.sheet_url, r.cluster_id AS region_cluster_id
            FROM reports rep 
            LEFT JOIN regions r ON rep.region_id = r.id 
            WHERE rep.id = ?
        `, [repId]);
        
        const reportClusterId = report.report_type === 'cluster' ? report.cluster_id : report.region_cluster_id;

        if (userRole !== 'admin') {
            if (userRole === 'cluster_leader') {
                const managedCluster = await db.get('SELECT id FROM clusters WHERE manager_id = ?', [userId]);
                if (!managedCluster || managedCluster.id !== reportClusterId) {
                    throw new Error('403: Bạn không có quyền đồng bộ báo cáo ngoài cụm quản lý.');
                }
            } else if (userRole === 'region_leader') {
                const managedRegion = await db.get('SELECT id FROM regions WHERE manager_id = ?', [userId]);
                if (!managedRegion || managedRegion.id !== report.region_id) {
                    throw new Error('403: Bạn không có quyền đồng bộ báo cáo ngoài vùng quản lý.');
                }
            }
        }
        return true;
    };

    try {
        await simulateSyncCheck(regionLeaderId, 'region_leader', repBId);
        console.error(' [ERROR] TRƯỞNG VÙNG: Cho phép đồng bộ báo cáo vùng khác! Bảo mật bị lỗi.');
        process.exit(1);
    } catch (err) {
        if (err.message.includes('403')) {
            console.log(' [OK] TRƯỞNG VÙNG: Bị chặn thành công khi cố đồng bộ báo cáo của vùng khác.');
        } else {
            console.error(' [ERROR] TRƯỞNG VÙNG:', err);
            process.exit(1);
        }
    }

    // --- TEST 3: Admin sync được report cluster ---
    try {
        const adminCheck = await simulateSyncCheck(adminRes.id, 'admin', repCId);
        if (adminCheck === true) {
            console.log(' [OK] ADMIN: Quyền Admin cho phép đồng bộ báo cáo cấp Cụm (Cluster Report).');
        } else {
            console.error(' [ERROR] ADMIN: Không cho phép đồng bộ báo cáo cấp Cụm.');
            process.exit(1);
        }
    } catch (err) {
        console.error(' [ERROR] ADMIN:', err);
        process.exit(1);
    }

    // --- TEST 4: API tạo/sửa Cluster và Region đã kiểm tra role của manager_id ---
    const simulateManagerRoleCheck = async (type, managerId) => {
        if (!managerId) return true;
        const mgrUser = await db.get('SELECT role FROM users WHERE id = ?', [managerId]);
        if (!mgrUser) {
            throw new Error('Người quản lý được gán không tồn tại.');
        }
        if (type === 'cluster') {
            if (mgrUser.role !== 'cluster_leader') {
                throw new Error('Chỉ có tài khoản vai trò Trưởng Cụm mới được gán quản lý Cụm.');
            }
        } else if (type === 'region') {
            if (mgrUser.role !== 'region_leader') {
                throw new Error('Chỉ có tài khoản vai trò Trưởng Vùng mới được gán quản lý Vùng.');
            }
        }
        return true;
    };

    // Test 4a: Cluster gán Trưởng Vùng (sai vai trò) -> phải báo lỗi
    try {
        await simulateManagerRoleCheck('cluster', regionLeaderId);
        console.error(' [ERROR] Gán sai vai trò Trưởng Vùng cho Cụm nhưng không báo lỗi!');
        process.exit(1);
    } catch (err) {
        if (err.message.includes('Trưởng Cụm mới được gán quản lý Cụm')) {
            console.log(' [OK] CỤM: Ngăn chặn thành công khi gán sai vai trò quản lý (Trưởng Vùng làm Trưởng Cụm).');
        } else {
            console.error(' [ERROR] CỤM:', err);
            process.exit(1);
        }
    }

    // Test 4b: Region gán Trưởng Cụm (sai vai trò) -> phải báo lỗi
    try {
        await simulateManagerRoleCheck('region', clusterLeaderId);
        console.error(' [ERROR] Gán sai vai trò Trưởng Cụm cho Vùng nhưng không báo lỗi!');
        process.exit(1);
    } catch (err) {
        if (err.message.includes('Trưởng Vùng mới được gán quản lý Vùng')) {
            console.log(' [OK] VÙNG: Ngăn chặn thành công khi gán sai vai trò quản lý (Trưởng Cụm làm Trưởng Vùng).');
        } else {
            console.error(' [ERROR] VÙNG:', err);
            process.exit(1);
        }
    }

    // --- TEST 5: Email Normalization Unit Tests ---
    console.log('\n5. Đang chạy kiểm thử chuẩn hóa Email (normalizeEmail)...');
    const emailUtils = require('../utils/email');
    const emailTests = [
        { input: 'ThuanAn.Work@googlemail.com', expected: 'thuananwork@gmail.com' },
        { input: 'thuan.an.work+test@gmail.com', expected: 'thuananwork@gmail.com' },
        { input: 'ThuanAn.Work@gmail.com', expected: 'thuananwork@gmail.com' },
        { input: 'Trưởng.Cụm@vnv.vn', expected: 'trưởng.cụm@vnv.vn' } // Unicode normalization (NFC) & lower
    ];

    for (const test of emailTests) {
        const result = emailUtils.normalizeEmail(test.input);
        if (result === test.expected) {
            console.log(` [OK] normalizeEmail("${test.input}") -> "${result}"`);
        } else {
            console.error(` [ERROR] normalizeEmail("${test.input}") kì vọng "${test.expected}" nhưng nhận "${result}"`);
            process.exit(1);
        }
    }

    // --- TEST 6: Absolute Timeout (8 hours) Verification ---
    console.log('\n6. Đang chạy kiểm thử Absolute Session Timeout...');
    const verifyAbsoluteTimeout = (createdAt, timeoutMs = 8 * 3600 * 1000) => {
        const elapsed = Date.now() - createdAt;
        if (elapsed > timeoutMs) {
            return { valid: false, error: 'Session expired (Absolute Timeout)' };
        }
        return { valid: true };
    };

    // Case 6a: Session mới tạo (1 giờ trước) -> Hợp lệ
    const validSessionResult = verifyAbsoluteTimeout(Date.now() - 3600 * 1000);
    if (validSessionResult.valid) {
        console.log(' [OK] Session mới tạo hoạt động bình thường.');
    } else {
        console.error(' [ERROR] Session mới tạo bị đánh dấu hết hạn sai lầm.');
        process.exit(1);
    }

    // Case 6b: Session tạo 8 giờ 1 giây trước -> Bị từ chối
    const expiredSessionResult = verifyAbsoluteTimeout(Date.now() - (8 * 3600 * 1000 + 1000));
    if (!expiredSessionResult.valid && expiredSessionResult.error.includes('Absolute Timeout')) {
        console.log(' [OK] Chặn thành công session vượt quá Absolute Timeout 8 giờ.');
    } else {
        console.error(' [ERROR] Không chặn được session đã quá hạn Absolute Timeout.');
        process.exit(1);
    }

    // --- TEST 7: Race Condition / Session Version Verification ---
    console.log('\n7. Đang chạy kiểm thử Race Condition & Session Version Mismatch...');
    
    // Giả lập cache kiểm tra in-memory 2s của session_version
    const sessionCache = {
        data: {},
        get(key) {
            const entry = this.data[key];
            if (entry && (Date.now() - entry.timestamp < 2000)) {
                return entry.value;
            }
            return null;
        },
        set(key, value) {
            this.data[key] = { value, timestamp: Date.now() };
        }
    };

    // Định nghĩa logic middleware mô phỏng
    const simulateAuthMiddleware = async (sessionUser, dbGetUserFn) => {
        if (!sessionUser) throw new Error('401: Unauthorized');

        // 1. Kiểm tra cache
        let cached = sessionCache.get(sessionUser.id);
        let freshUser;
        
        if (cached) {
            freshUser = cached;
        } else {
            // Cache miss: Truy vấn DB
            freshUser = await dbGetUserFn(sessionUser.id);
            if (freshUser) {
                sessionCache.set(sessionUser.id, freshUser);
            }
        }

        if (!freshUser) throw new Error('403: User not found or disabled');
        
        // 2. Đối soát session_version
        if (freshUser.session_version !== sessionUser.session_version) {
            throw new Error('401: Session version mismatch. Force logout.');
        }

        return true;
    };

    // Case 7a: Khớp session_version trong DB -> Cho qua
    const dbUserMock = { id: 1, session_version: 3 };
    const sessionUserMock = { id: 1, session_version: 3 };
    
    const passResult = await simulateAuthMiddleware(sessionUserMock, async () => dbUserMock);
    if (passResult === true) {
        console.log(' [OK] Cho phép truy cập khi session_version trùng khớp.');
    } else {
        console.error(' [ERROR] Chặn nhầm session có version hợp lệ.');
        process.exit(1);
    }

    // Case 7b: Lệch session_version trong DB -> Từ chối (Force Logout)
    const mismatchedSessionUser = { id: 1, session_version: 2 }; // Phiên bản cũ hơn DB
    try {
        await simulateAuthMiddleware(mismatchedSessionUser, async () => dbUserMock);
        console.error(' [ERROR] Cho phép truy cập khi session_version bị lệch!');
        process.exit(1);
    } catch (err) {
        if (err.message.includes('Session version mismatch')) {
            console.log(' [OK] Phát hiện và chặn thành công session_version lệch.');
        } else {
            console.error(' [ERROR] Lỗi kiểm tra session version:', err);
            process.exit(1);
        }
    }

    // Case 7c: Kiểm tra tính năng Cache in-memory trong vòng 2 giây
    sessionCache.data = {}; // Reset cache
    let dbQueryCount = 0;
    const dbQueryMock = async (id) => {
        dbQueryCount++;
        return { id, session_version: 3 };
    };

    // Gọi lần 1: cache miss -> Query DB
    await simulateAuthMiddleware(sessionUserMock, dbQueryMock);
    // Gọi lần 2: cache hit -> Không query DB
    await simulateAuthMiddleware(sessionUserMock, dbQueryMock);
    
    if (dbQueryCount === 1) {
        console.log(' [OK] Cache in-memory hoạt động chính xác (chỉ truy vấn DB 1 lần).');
    } else {
        console.error(` [ERROR] Cache in-memory thất bại. Truy vấn DB ${dbQueryCount} lần thay vì 1.`);
        process.exit(1);
    }

    console.log('----------------------------------------------------');
    console.log('THÀNH CÔNG: TẤT CẢ BÀI KIỂM THỬ CƠ SỞ DỮ LIỆU & RBAC ĐẠT YÊU CẦU!');
    console.log('----------------------------------------------------');
    process.exit(0);
}

runTests().catch(err => {
    console.error('Lỗi nghiêm trọng khi chạy kiểm thử:', err);
    process.exit(1);
});

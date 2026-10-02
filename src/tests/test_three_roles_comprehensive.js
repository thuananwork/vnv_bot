const assert = require('assert');
const http = require('http');
const app = require('../app');
const db = require('../config/db');

function makeRequest(server, options, postData, cookie = null) {
    return new Promise((resolve, reject) => {
        const reqOptions = {
            hostname: '127.0.0.1',
            port: server.address().port,
            path: options.path,
            method: options.method || 'GET',
            headers: {
                'Host': `127.0.0.1:${server.address().port}`,
                'Origin': `http://127.0.0.1:${server.address().port}`,
                'Referer': `http://127.0.0.1:${server.address().port}/`,
                ...(cookie ? { 'Cookie': cookie } : {}),
                ...(options.headers || {})
            }
        };

        if (postData) {
            const bodyStr = typeof postData === 'string' ? postData : JSON.stringify(postData);
            reqOptions.headers['Content-Type'] = 'application/json';
            reqOptions.headers['Content-Length'] = Buffer.byteLength(bodyStr);
        }

        const req = http.request(reqOptions, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    parsed = body;
                }
                const setCookie = res.headers['set-cookie'];
                let newCookie = cookie;
                if (setCookie) {
                    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
                    newCookie = cookieStr.split(';')[0];
                }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: parsed,
                    cookie: newCookie
                });
            });
        });
        req.on('error', reject);
        if (postData) {
            req.write(typeof postData === 'string' ? postData : JSON.stringify(postData));
        }
        req.end();
    });
}

async function loginUser(server, username, password) {
    const res = await makeRequest(server, {
        path: '/api/auth/login',
        method: 'POST'
    }, { username, password });
    return { res, cookie: res.cookie };
}

async function runComprehensiveTests() {
    console.log('========================================================================');
    console.log('🧪 KIỂM THỬ TOÀN DIỆN 3 VAI TRÒ (ADMIN - TRƯỞNG CỤM - TRƯỞNG VÙNG)');
    console.log('   VÀ ĐỐI SOÁT BÁO CÁO 7 VÙNG (CỤM 5) - NGÀY 20/09/2026');
    console.log('========================================================================\n');

    await db.initDb();

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;
    console.log(`🚀 Test Server đang chạy tại port tạm thời: ${port}\n`);

    let passedCount = 0;
    let totalCount = 0;

    function testAssert(condition, name) {
        totalCount++;
        if (condition) {
            console.log(`  ✅ [PASS ${totalCount}] ${name}`);
            passedCount++;
        } else {
            console.error(`  ❌ [FAIL ${totalCount}] ${name}`);
            throw new Error(`Failed: ${name}`);
        }
    }

    try {
        // =====================================================================
        // PHẦN 1: BẢO MẬT & XÁC THỰC API (BUG 5 VERIFICATION)
        // =====================================================================
        console.log('--- 1. BẢO MẬT & XÁC THỰC API KHI CHƯA ĐĂNG NHẬP (UNAUTHENTICATED) ---');

        const unauth1 = await makeRequest(server, { path: '/api/v2/cluster/run-report', method: 'POST' }, { workDate: '2026-09-20' });
        testAssert(unauth1.statusCode === 401, 'POST /api/v2/cluster/run-report chặn 401 khi chưa login');

        const unauth2 = await makeRequest(server, { path: '/api/v2/regions/27/run-report', method: 'POST' }, { workDate: '2026-09-20' });
        testAssert(unauth2.statusCode === 401, 'POST /api/v2/regions/27/run-report chặn 401 khi chưa login');

        const unauth3 = await makeRequest(server, { path: '/api/v2/regions/27/settings', method: 'POST' }, { sheet_name: 'T9/26' });
        testAssert(unauth3.statusCode === 401, 'POST /api/v2/regions/27/settings chặn 401 khi chưa login');

        const unauth4 = await makeRequest(server, { path: '/api/v2/zalo/open-login', method: 'POST' }, {});
        testAssert(unauth4.statusCode === 401, 'POST /api/v2/zalo/open-login chặn 401 khi chưa login');

        const unauth5 = await makeRequest(server, { path: '/api/v2/regions/27/create-sheet-tab', method: 'POST' }, {});
        testAssert(unauth5.statusCode === 401, 'POST /api/v2/regions/27/create-sheet-tab chặn 401 khi chưa login');

        const unauth6 = await makeRequest(server, { path: '/api/v2/regions/27/sync-pending-sheet', method: 'POST' }, {});
        testAssert(unauth6.statusCode === 401, 'POST /api/v2/regions/27/sync-pending-sheet chặn 401 khi chưa login');

        const unauth7 = await makeRequest(server, { path: '/api/v2/regions/27/name-mappings', method: 'POST' }, { mappings: {} });
        testAssert(unauth7.statusCode === 401, 'POST /api/v2/regions/27/name-mappings chặn 401 khi chưa login');

        // =====================================================================
        // PHẦN 2: VAI TRÒ ADMIN (ADMIN SUITE)
        // =====================================================================
        console.log('\n--- 2. KIỂM THỬ VAI TRÒ ADMIN ---');

        const adminLogin = await loginUser(server, 'admin', 'admin');
        testAssert(adminLogin.res.statusCode === 200, 'Admin đăng nhập thành công (200 OK)');
        const adminCookie = adminLogin.cookie;

        // 2.1 Xem Dashboard Overview
        const dashRes = await makeRequest(server, { path: '/api/dashboard/overview?date=2026-09-20' }, null, adminCookie);
        testAssert(dashRes.statusCode === 200 && dashRes.body.success, 'Admin xem tiến độ Dashboard tổng quan thành công');

        // 2.2 Xem danh sách Vùng
        const regionsRes = await makeRequest(server, { path: '/api/v2/regions' }, null, adminCookie);
        testAssert(regionsRes.statusCode === 200 && Array.isArray(regionsRes.body.data) && regionsRes.body.data.length >= 7, 'Admin nạp danh sách 7 Vùng Cụm 5 đầy đủ');

        // 2.3 Xem chi tiết 7 Vùng (25-31)
        for (let rId = 25; rId <= 31; rId++) {
            const rDetail = await makeRequest(server, { path: `/api/v2/regions/${rId}` }, null, adminCookie);
            testAssert(rDetail.statusCode === 200 && rDetail.body.data.id === rId, `Admin truy cập thành công dữ liệu Vùng ${rId}`);
        }

        // 2.4 Xem thành viên Vùng 27
        const membersRes = await makeRequest(server, { path: '/api/v2/regions/27/members?date=2026-09-20' }, null, adminCookie);
        testAssert(membersRes.statusCode === 200 && membersRes.body.data.length > 0, 'Admin nạp danh sách Sứ giả Vùng 27 thành công');

        // 2.5 Xem trước Báo cáo Vùng 27 và Báo cáo Cụm 5 ngày 20/09
        const repRegion27 = await makeRequest(server, { path: '/api/v2/preview/report?type=region&regionId=27&workDate=2026-09-20' }, null, adminCookie);
        testAssert(repRegion27.statusCode === 200 && repRegion27.body.content.includes('SỨ GIẢ VÙNG 27'), 'Admin xem trước Báo cáo Vùng 27 ngày 20/09 đúng chuẩn Mẫu 1');

        const repCluster = await makeRequest(server, { path: '/api/v2/preview/report?type=cluster&workDate=2026-09-20' }, null, adminCookie);
        testAssert(repCluster.statusCode === 200 && repCluster.body.content.includes('Cụm 5 (Vùng 25–31)'), 'Admin xem trước Báo cáo Cụm 5 ngày 20/09 đúng chuẩn Mẫu 2');

        // 2.6 Đổi khung giờ / cấu hình Vùng 27
        const updateSettingRes = await makeRequest(server, { path: '/api/v2/regions/27/settings', method: 'POST' }, {
            sheet_name: 'T9/26',
            task_start_time: '10:00',
            task_end_time: '15:00',
            report_start_time: '21:00',
            report_end_time: '22:30'
        }, adminCookie);
        testAssert(updateSettingRes.statusCode === 200 && updateSettingRes.body.success, 'Admin cập nhật khung giờ làm việc Vùng 27 thành công');

        // 2.7 Bổ nhiệm thành viên (Role Assignment)
        const sampleMember = await db.get("SELECT id, real_name FROM members WHERE region_id = 27 AND role = 'EMISSARY' LIMIT 1");
        const promoteRes = await makeRequest(server, { path: `/api/members/${sampleMember.id}/assign-role`, method: 'POST' }, {
            role: 'DEPUTY'
        }, adminCookie);
        testAssert(promoteRes.statusCode === 200 && promoteRes.body.success, `Admin bổ nhiệm ${sampleMember.real_name} làm Phó Vùng thành công`);

        const demoteRes = await makeRequest(server, { path: `/api/members/${sampleMember.id}/assign-role`, method: 'POST' }, {
            role: 'EMISSARY'
        }, adminCookie);
        testAssert(demoteRes.statusCode === 200 && demoteRes.body.success, `Admin đưa ${sampleMember.real_name} trở lại vai trò Sứ giả thành công`);

        // 2.8 Kiểm thử Quản lý User & Tính năng Mở khóa (Bug 4 verification!)
        console.log('   Kiểm tra Bug 4: Khóa và Mở khóa tài khoản User...');
        // Tạo tài khoản test
        const testUserCreateRes = await makeRequest(server, { path: '/api/users', method: 'POST' }, {
            username: 'test_toggle_user',
            password: 'password123',
            full_name: 'Người Dùng Kiểm Thử Mở Khóa',
            email: 'test_toggle_user@gmail.com',
            role: 'region_leader'
        }, adminCookie);
        testAssert(testUserCreateRes.statusCode === 201 || testUserCreateRes.statusCode === 200, 'Admin tạo tài khoản test thành công');
        const createdUserId = testUserCreateRes.body.id || (await db.get("SELECT id FROM users WHERE username = 'test_toggle_user'")).id;

        // Khóa tài khoản
        const lockRes = await makeRequest(server, { path: `/api/users/${createdUserId}`, method: 'DELETE' }, null, adminCookie);
        testAssert(lockRes.statusCode === 200, 'Admin khóa tài khoản test thành công');
        const userAfterLock = await db.get("SELECT approval_status, is_active FROM users WHERE id = ?", [createdUserId]);
        testAssert(userAfterLock.approval_status === 'disabled' || userAfterLock.is_active === 0, 'DB ghi nhận tài khoản đã bị khóa');

        // MỞ KHÓA TÀI KHOẢN (Bug 4 API)
        const enableRes = await makeRequest(server, { path: `/api/users/${createdUserId}/enable`, method: 'POST' }, null, adminCookie);
        testAssert(enableRes.statusCode === 200, 'Admin bấm [Mở khóa] -> POST /api/users/:id/enable thành công');
        const userAfterEnable = await db.get("SELECT approval_status, is_active FROM users WHERE id = ?", [createdUserId]);
        testAssert(userAfterEnable.approval_status === 'approved' && userAfterEnable.is_active === 1, 'DB ghi nhận tài khoản đã được kích hoạt lại thành công');

        // Dọn dẹp user test
        await db.run("DELETE FROM users WHERE id = ?", [createdUserId]);

        // 2.9 Xem Nhật ký & Hệ thống (Audit Log)
        const auditRes = await makeRequest(server, { path: '/api/audit-logs' }, null, adminCookie);
        testAssert(auditRes.statusCode === 200 && Array.isArray(auditRes.body.data || auditRes.body), 'Admin truy cập thành công Nhật ký hệ thống Audit Logs');

        // 2.10 Quick-switch từ Admin sang Trưởng Vùng 27
        const qsRes = await makeRequest(server, { path: '/api/auth/quick-switch?user=truongvung27' }, null, adminCookie);
        testAssert(qsRes.statusCode === 302, 'Admin chuyển đổi vai trò (quick-switch) sang Trưởng Vùng 27 thành công (302 Redirect)');

        // =====================================================================
        // PHẦN 3: VAI TRÒ TRƯỞNG CỤM (cum5 SUITE)
        // =====================================================================
        console.log('\n--- 3. KIỂM THỬ VAI TRÒ TRƯỞNG CỤM 5 ---');

        const clusterLogin = await loginUser(server, 'cum5', 'cum5');
        testAssert(clusterLogin.res.statusCode === 200, 'Trưởng Cụm 5 đăng nhập thành công (200 OK)');
        const clusterCookie = clusterLogin.cookie;

        // 3.1 Xem Dashboard Overview
        const clusterDash = await makeRequest(server, { path: '/api/dashboard/overview?date=2026-09-20' }, null, clusterCookie);
        testAssert(clusterDash.statusCode === 200 && clusterDash.body.success, 'Trưởng Cụm 5 xem tiến độ Dashboard Cụm thành công');

        // 3.2 Xem trước Báo cáo Cụm Mẫu 2
        const clusterPreview = await makeRequest(server, { path: '/api/v2/preview/report?type=cluster&workDate=2026-09-20' }, null, clusterCookie);
        testAssert(clusterPreview.statusCode === 200 && clusterPreview.body.content.includes('@Phạm Minh Tú'), 'Trưởng Cụm 5 xem trước Báo cáo Cụm Mẫu 2 có tag BĐH toàn quốc');

        // 3.3 Bổ nhiệm thành viên trong Cụm 5
        const cPromoteRes = await makeRequest(server, { path: `/api/members/${sampleMember.id}/assign-role`, method: 'POST' }, {
            role: 'DEPUTY'
        }, clusterCookie);
        testAssert(cPromoteRes.statusCode === 200 && cPromoteRes.body.success, 'Trưởng Cụm 5 có quyền bổ nhiệm thành viên trong Cụm 5');

        await makeRequest(server, { path: `/api/members/${sampleMember.id}/assign-role`, method: 'POST' }, { role: 'EMISSARY' }, clusterCookie);

        // 3.4 Trưởng Cụm cố xóa tài khoản Admin -> Phải bị chặn
        const clusterDeleteAdmin = await makeRequest(server, { path: '/api/users/1', method: 'DELETE' }, null, clusterCookie);
        testAssert(clusterDeleteAdmin.statusCode === 409 || clusterDeleteAdmin.statusCode === 403, 'Trưởng Cụm 5 cố khóa tài khoản Admin -> Bị chặn LAST_ADMIN_PROTECTED (409 Conflict)');

        // 3.5 Quick switch sang Trưởng Vùng 28 (thuộc Cụm)
        const qsClusterToRegion = await makeRequest(server, { path: '/api/auth/quick-switch?user=truongvung28' }, null, clusterCookie);
        testAssert(qsClusterToRegion.statusCode === 302, 'Trưởng Cụm 5 switch sang Trưởng Vùng 28 thành công');

        // 3.6 Trưởng Cụm cố switch lên Admin -> Phải bị chặn 403
        const qsClusterToAdmin = await makeRequest(server, { path: '/api/auth/quick-switch?user=admin' }, null, qsClusterToRegion.cookie);
        testAssert(qsClusterToAdmin.statusCode === 403, 'Trưởng Cụm 5 (khi đang xem Vùng) cố switch lên Admin -> Bị chặn 403 Forbidden');

        // =====================================================================
        // PHẦN 4: VAI TRÒ TRƯỞNG VÙNG (truongvung27 SUITE)
        // =====================================================================
        console.log('\n--- 4. KIỂM THỬ VAI TRÒ TRƯỞNG VÙNG 27 ---');

        const regionLogin = await loginUser(server, 'truongvung27', 'truongvung27');
        testAssert(regionLogin.res.statusCode === 200, 'Trưởng Vùng 27 đăng nhập thành công (200 OK)');
        const regionCookie = regionLogin.cookie;

        // 4.1 Xem thành viên Vùng 27
        const tv27Members = await makeRequest(server, { path: '/api/v2/regions/27/members?date=2026-09-20' }, null, regionCookie);
        testAssert(tv27Members.statusCode === 200 && tv27Members.body.data.length > 0, 'Trưởng Vùng 27 xem danh sách Sứ giả Vùng 27 thành công');

        // 4.2 Cập nhật Mapping nick Zalo Vùng 27
        const tv27Mapping = await makeRequest(server, { path: '/api/v2/regions/27/name-mappings', method: 'POST' }, {
            mappings: { 'Phạm Quang Đại': 'Quang Đại' }
        }, regionCookie);
        testAssert(tv27Mapping.statusCode === 200 && tv27Mapping.body.success, 'Trưởng Vùng 27 cập nhật Mapping tên Zalo thành công');

        // 4.3 Trưởng Vùng cố bổ nhiệm chức vụ -> Phải bị chặn 403 Forbidden
        const tv27AssignRole = await makeRequest(server, { path: `/api/members/${sampleMember.id}/assign-role`, method: 'POST' }, {
            role: 'DEPUTY'
        }, regionCookie);
        testAssert(tv27AssignRole.statusCode === 403, 'Trưởng Vùng cố bổ nhiệm chức vụ -> Bị chặn 403 Forbidden');

        // 4.4 Trưởng Vùng cố sửa khung giờ Vùng -> Phải bị chặn 403 Forbidden
        const tv27Settings = await makeRequest(server, { path: '/api/v2/regions/27/settings', method: 'POST' }, {
            sheet_name: 'T9/26'
        }, regionCookie);
        testAssert(tv27Settings.statusCode === 403, 'Trưởng Vùng cố đổi cài đặt hệ thống Vùng -> Bị chặn 403 Forbidden');

        // 4.5 Trưởng Vùng cố bắn Báo cáo Cụm 5 -> Phải bị chặn 403 Forbidden
        const tv27ClusterReport = await makeRequest(server, { path: '/api/v2/cluster/run-report', method: 'POST' }, {
            workDate: '2026-09-20'
        }, regionCookie);
        testAssert(tv27ClusterReport.statusCode === 403, 'Trưởng Vùng cố phát lệnh Báo cáo Cụm -> Bị chặn 403 Forbidden');

        // 4.6 Trưởng Vùng cố truy cập danh sách Tài khoản Admin -> Phải bị chặn 403
        const tv27Users = await makeRequest(server, { path: '/api/users' }, null, regionCookie);
        testAssert(tv27Users.statusCode === 403, 'Trưởng Vùng cố truy cập danh sách người dùng quản trị -> Bị chặn 403 Forbidden');

        // 4.7 Trưởng Vùng cố truy cập Nhật ký Audit -> Phải bị chặn 403
        const tv27Audit = await makeRequest(server, { path: '/api/audit-logs' }, null, regionCookie);
        testAssert(tv27Audit.statusCode === 403, 'Trưởng Vùng cố đọc Nhật ký kiểm toán Audit -> Bị chặn 403 Forbidden');

        // 4.8 Trưởng Vùng cố chuyển đổi vai trò quick-switch -> Phải bị chặn 403
        const tv27QuickSwitch = await makeRequest(server, { path: '/api/auth/quick-switch?user=admin' }, null, regionCookie);
        testAssert(tv27QuickSwitch.statusCode === 403, 'Trưởng Vùng cố chuyển vai trò sang Admin -> Bị chặn 403 Forbidden');

        // =====================================================================
        // PHẦN 5: ĐỐI SOÁT BÁO CÁO 7 VÙNG (25-31) & CỤM 5 NGÀY 20/09/2026
        // =====================================================================
        console.log('\n--- 5. ĐỐI SOÁT NỘI DUNG BÁO CÁO 7 VÙNG CỤM 5 (NGÀY 20/09/2026) ---');

        const testDate = '2026-09-20';
        for (let rId = 25; rId <= 31; rId++) {
            const rep = await makeRequest(server, { path: `/api/v2/preview/report?type=region&regionId=${rId}&workDate=${testDate}` }, null, adminCookie);
            testAssert(rep.statusCode === 200 && rep.body.success, `API xem trước báo cáo Vùng ${rId} thành công (200 OK)`);
            const content = rep.body.content || '';
            testAssert(content.includes('Báo cáo ngày 20/9/2026') || content.includes('20/09/2026') || content.includes('------HÀNG NGÀY-------'), `Báo cáo Vùng ${rId} có header ngày chuẩn xác`);
            testAssert(content.includes(`SỨ GIẢ VÙNG ${rId}`), `Báo cáo Vùng ${rId} có định danh SỨ GIẢ VÙNG ${rId}`);
            testAssert(content.includes('3. Tổng số sứ giả:'), `Báo cáo Vùng ${rId} có mục 3 (Tổng số sứ giả)`);
            testAssert(content.includes('4. Hoàn thành:'), `Báo cáo Vùng ${rId} có mục 4 (Hoàn thành)`);
            testAssert(content.includes('5. Không hoàn thành:'), `Báo cáo Vùng ${rId} có mục 5 (Không hoàn thành)`);
            testAssert(content.includes('6. Lý do:'), `Báo cáo Vùng ${rId} có mục 6 (Lý do)`);
            testAssert(content.includes('7. Bổ sung:'), `Báo cáo Vùng ${rId} có mục 7 (Bổ sung / Nộp bù)`);
        }

        // Báo cáo Cụm 5
        const clusterRep = await makeRequest(server, { path: `/api/v2/preview/report?type=cluster&workDate=${testDate}` }, null, adminCookie);
        testAssert(clusterRep.statusCode === 200 && clusterRep.body.success, 'API xem trước báo cáo Cụm 5 thành công (200 OK)');
        const cContent = clusterRep.body.content || '';
        testAssert(cContent.includes('Cụm 5 (Vùng 25–31)'), 'Báo cáo Cụm 5 có tiêu đề Cụm 5');
        testAssert(cContent.includes('Tổng số thành viên:'), 'Báo cáo Cụm 5 có số liệu Tổng số thành viên');
        testAssert(cContent.includes('Kết quả hoàn thành:'), 'Báo cáo Cụm 5 có số liệu Hoàn thành');
        testAssert(cContent.includes('Chưa làm nhiệm vụ:'), 'Báo cáo Cụm 5 có số liệu Chưa làm nhiệm vụ');
        testAssert(cContent.includes('@Phạm Minh Tú'), 'Báo cáo Cụm 5 có tag người nhận BĐH toàn quốc');

        console.log('\n========================================================================');
        console.log(`🎉 TẤT CẢ KIỂM THỬ THÀNH CÔNG: ${passedCount}/${totalCount} PASSED (100%)`);
        console.log('========================================================================\n');

    } finally {
        server.close();
    }
}

runComprehensiveTests().catch(err => {
    console.error('❌ Kiểm thử thất bại với lỗi:', err);
    process.exit(1);
});

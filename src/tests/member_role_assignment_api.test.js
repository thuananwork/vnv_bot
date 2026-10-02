const assert = require('assert');
const http = require('http');
const app = require('../app');
const db = require('../config/db');

function makeRequest(server, options, postData) {
    return new Promise((resolve, reject) => {
        const req = http.request(options, (res) => {
            let body = '';
            res.on('data', chunk => body += chunk);
            res.on('end', () => {
                let parsed = null;
                try {
                    parsed = JSON.parse(body);
                } catch (e) {
                    parsed = body;
                }
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    body: parsed
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

function extractCookie(headers) {
    const setCookie = headers['set-cookie'];
    if (!setCookie) return null;
    const cookieStr = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return cookieStr.split(';')[0];
}

async function runApiTests() {
    console.log('===============================================================');
    console.log('🌐 KIỂM THỬ HTTP API: POST /api/members/:id/assign-role & RBAC');
    console.log('===============================================================\n');

    await db.initDb();

    const server = http.createServer(app);
    await new Promise(resolve => server.listen(0, resolve));
    const port = server.address().port;

    try {
        const testMember = await db.get("SELECT * FROM members WHERE region_id = 27 AND status = 'Active' AND role = 'EMISSARY'");
        assert(testMember, 'Cần có test member');

        // 1. Kiểm thử khi chưa đăng nhập (Unauthenticated) -> Phải trả về 401
        console.log('1. Kiểm thử request khi chưa đăng nhập...');
        const unauthRes = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: `/api/members/${testMember.id}/assign-role`,
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { role: 'LEADER' });

        assert.strictEqual(unauthRes.statusCode, 401, 'Chưa đăng nhập phải bị từ chối 401');
        console.log('  ✅ [PASS] Chặn truy cập unauthenticated (401)');

        // 2. Đăng nhập tài khoản Trưởng Vùng 27 (region_leader)
        console.log('\n2. Đăng nhập tài khoản region_leader (truongvung27)...');
        const loginLeaderRes = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: '/api/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: 'truongvung27', password: 'truongvung27' });

        const leaderCookie = extractCookie(loginLeaderRes.headers);
        assert(leaderCookie, 'Phải nhận được session cookie');

        // Thử dùng region_leader để bổ nhiệm -> Phải trả về 403 Forbidden
        const forbidRes = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: `/api/members/${testMember.id}/assign-role`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': leaderCookie
            }
        }, { role: 'LEADER' });

        assert.strictEqual(forbidRes.statusCode, 403, 'Region leader không có quyền bổ nhiệm Trưởng/Phó Vùng (403)');
        console.log('  ✅ [PASS] Chặn quyền region_leader không được phân quyền Trưởng/Phó Vùng (403)');

        // 2b. Thử dùng tài khoản Trưởng Vùng 31 (truongvung31) đối với Vùng 31 -> Cũng phải bị 403 Forbidden
        console.log('\n2b. Đăng nhập tài khoản truongvung31 và thử đổi role thành viên Vùng 31...');
        const loginV31Res = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: '/api/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: 'truongvung31', password: 'truongvung31' });

        const v31Cookie = extractCookie(loginV31Res.headers);
        assert(v31Cookie, 'Phải nhận được session cookie');

        const member31 = await db.get("SELECT * FROM members WHERE region_id = 31 AND status = 'Active' AND role = 'EMISSARY' LIMIT 1");
        assert(member31, 'Cần có thành viên Vùng 31');

        const forbidV31Res = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: `/api/members/${member31.id}/assign-role`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': v31Cookie
            }
        }, { role: 'LEADER' });

        assert.strictEqual(forbidV31Res.statusCode, 403, 'Trưởng vùng 31 tuyệt đối không được tự ý đổi role trong vùng 31 (403)');
        console.log('  ✅ [PASS] Chặn quyền truongvung31 không được tự ý đổi role (403 Forbidden)');

        // 3. Đăng nhập tài khoản Trưởng Cụm 5 (cum5) -> Có quyền quản lý Cụm 5
        console.log('\n3. Đăng nhập tài khoản Trưởng Cụm 5 (cum5)...');
        const loginCum5Res = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: '/api/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: 'cum5', password: 'cum5' });

        const cum5Cookie = extractCookie(loginCum5Res.headers);
        assert(cum5Cookie, 'Phải nhận được session cookie');

        // Trưởng Cụm 5 bổ nhiệm Phó Vùng cho thành viên Vùng 27 (thuộc Cụm 5) -> Phải thành công 200
        console.log('  Thử Trưởng Cụm 5 đổi vai trò thành viên Vùng 27 (thuộc Cụm 5)...');
        const cum5PromoteRes = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: `/api/members/${testMember.id}/assign-role`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': cum5Cookie
            }
        }, { role: 'DEPUTY' });

        assert.strictEqual(cum5PromoteRes.statusCode, 200, 'Trưởng Cụm 5 có quyền bổ nhiệm trong Cụm 5 (200 OK)');
        console.log('  ✅ [PASS] Trưởng Cụm 5 bổ nhiệm thành công thành viên thuộc Cụm 5 (200 OK)');

        // 4. Giả lập một tài khoản Trưởng Cụm khác (ví dụ Cụm 999) -> Phải bị 403 khi thao tác trên Cụm 5
        console.log('\n4. Kiểm tra tài khoản Trưởng Cụm khác thao tác trên Vùng của Cụm 5...');
        const bcrypt = require('bcryptjs');
        const otherHash = bcrypt.hashSync('testpass', 10);
        await db.run("INSERT OR REPLACE INTO clusters (id, cluster_name, leader_name) VALUES (999, 'Cụm Khác 999', 'Lãnh Đạo Test')");
        await db.run("INSERT OR REPLACE INTO users (id, username, password_hash, full_name, role, auth_method, name_source, approval_status, is_active) VALUES (999, 'cumkhac999', ?, 'Trưởng Cụm Khác', 'cluster_leader', 'local', 'manual', 'approved', 1)", [otherHash]);
        await db.run("UPDATE clusters SET manager_id = 999 WHERE id = 999");

        const loginOtherClusterRes = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: '/api/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: 'cumkhac999', password: 'testpass' });

        const otherClusterCookie = extractCookie(loginOtherClusterRes.headers);
        assert(otherClusterCookie, 'Phải nhận được session cookie');

        const forbidOtherClusterRes = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: `/api/members/${testMember.id}/assign-role`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': otherClusterCookie
            }
        }, { role: 'EMISSARY' });

        assert.strictEqual(forbidOtherClusterRes.statusCode, 403, 'Trưởng Cụm khác tuyệt đối không được sửa role của Cụm 5 (403)');
        console.log('  ✅ [PASS] Chặn thành công Trưởng Cụm khác can thiệp vào Cụm 5 (403 Forbidden)');

        // Dọn dẹp user và cluster test
        await db.run("DELETE FROM users WHERE id = 999");
        await db.run("DELETE FROM clusters WHERE id = 999");

        // 5. Đăng nhập tài khoản Admin
        console.log('\n5. Đăng nhập tài khoản Admin (admin)...');
        const loginAdminRes = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: '/api/auth/login',
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        }, { username: 'admin', password: process.env.ADMIN_PASSWORD || 'admin' });

        const adminCookie = extractCookie(loginAdminRes.headers);
        assert(adminCookie, 'Admin phải nhận được session cookie');

        // Admin tắt chức vụ, chuyển về Sứ giả ban đầu
        console.log('  Admin thực hiện TẮT CHỨC VỤ (chuyển về EMISSARY) qua API...');
        const revokeRes = await makeRequest(server, {
            hostname: '127.0.0.1',
            port,
            path: `/api/members/${testMember.id}/assign-role`,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Cookie': adminCookie
            }
        }, { role: 'EMISSARY' });

        assert.strictEqual(revokeRes.statusCode, 200, 'Admin tắt chức vụ phải thành công 200');
        assert.strictEqual(revokeRes.body.success, true);
        console.log('  ✅ [PASS] Admin có toàn quyền điều chỉnh vai trò (200 OK)');

    } finally {
        await new Promise(resolve => server.close(resolve));
    }

    console.log('\n===============================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ HTTP API & RBAC ĐẠT 100% PASS!');
    console.log('===============================================================');
    process.exit(0);
}

runApiTests().catch(err => {
    console.error('❌ LỖI KIỂM THỬ API:', err);
    process.exit(1);
});

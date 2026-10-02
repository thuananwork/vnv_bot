const assert = require('assert');
const http = require('http');
const app = require('../app');
const remoteLicense = require('../services/remote_license');
const onDemandActions = require('../services/on_demand_actions');

function makeRequest(server, path, method = 'GET') {
    return new Promise((resolve, reject) => {
        const port = server.address().port;
        const req = http.request({
            hostname: '127.0.0.1',
            port,
            path,
            method,
            headers: {
                Host: `127.0.0.1:${port}`,
                Origin: `http://127.0.0.1:${port}`,
                Referer: `http://127.0.0.1:${port}/`
            }
        }, (res) => {
            let body = '';
            res.on('data', c => body += c);
            res.on('end', () => {
                let parsed = null;
                try { parsed = JSON.parse(body); } catch (e) { parsed = body; }
                resolve({ statusCode: res.statusCode, body: parsed });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

async function runKillswitchTests() {
    console.log('========================================================================');
    console.log('🧪 KIỂM THỬ: CÔNG TẮC NGẮT TỪ XA (REMOTE KILLSWITCH & GIST LICENSE)');
    console.log('========================================================================\n');

    // 1. Kiểm tra kết nối thực tế tới Gist của user
    console.log('1. Đang kết nối tới Gist thực tế của bạn:');
    console.log(`   URL: ${remoteLicense.GIST_LICENSE_URL}`);
    const liveStatus = await remoteLicense.getLicenseStatus(true);
    console.log('   Trạng thái hiện tại trên GitHub Gist:', liveStatus);
    assert.strictEqual(liveStatus.allowed, true, 'Gist thực tế phải đang ở trạng thái active: true');
    console.log('  ✅ [PASS] Kết nối Gist thành công, giấy phép đang ACTIVE bình thường!\n');

    // 2. Kiểm thử chạy server khi ACTIVE: API hoạt động bình thường
    const server = http.createServer(app);
    await new Promise(res => server.listen(0, res));
    const port = server.address().port;

    try {
        console.log('2. Kiểm thử khi ACTIVE (bình thường):');
        const normalHealth = await makeRequest(server, '/api/system/license-status');
        assert.strictEqual(normalHealth.statusCode, 200);
        assert.strictEqual(normalHealth.body.allowed, true);
        console.log('  ✅ [PASS] /api/system/license-status trả về allowed: true');

        // 3. Giả lập tình huống Quản trị viên đổi active: false trên Gist
        console.log('\n3. Giả lập tình huống Quản trị viên chuyển Gist sang active: false:');
        remoteLicense.setMockStatus({
            checkedAt: Date.now(),
            allowed: false,
            message: 'Phiên bản này đã bị tạm dừng bởi Quản trị viên Nguyễn Thuận An.'
        });

        const lockedStatus = await remoteLicense.getLicenseStatus(true);
        assert.strictEqual(lockedStatus.allowed, false, 'Trạng thái phải là false');
        console.log('  ✅ [PASS] remoteLicense nhận diện hệ thống đã bị khóa');

        // 4. Kiểm tra middleware API chặn đứng toàn bộ
        console.log('\n4. Kiểm thử Middleware chặn các lệnh gọi API khi bị khóa:');
        const blockedApi = await makeRequest(server, '/api/v2/regions');
        assert.strictEqual(blockedApi.statusCode, 403, 'API phải trả về 403 Forbidden khi bị khóa');
        assert.strictEqual(blockedApi.body.revoked, true, 'Response phải có cờ revoked: true');
        assert(blockedApi.body.error.includes('tạm dừng'), 'Thông báo lỗi phải hiển thị đúng lời nhắn của Admin');
        console.log('  ✅ [PASS] Toàn bộ API /api/* bị chặn đứng với mã 403 và revoked: true');

        // 5. Kiểm tra On-demand actions (Nút quét) bị chặn đứng
        console.log('\n5. Kiểm thử Nút Quét Zalo khi bị khóa:');
        const scanRes = await onDemandActions.scanAndReportRegion({ regionId: 27, workDate: '2026-09-20' });
        assert.strictEqual(scanRes.success, false, 'Hành động quét phải bị hủy');
        assert.strictEqual(scanRes.revoked, true, 'Hành động quét phải có cờ revoked: true');
        console.log('  ✅ [PASS] Nút Quét Zalo bị chặn lập tức, Chrome không bị mở lên');

        // 6. Khôi phục lại trạng thái bình thường (Admin đổi lại active: true)
        console.log('\n6. Khôi phục lại trạng thái Gist thật (ACTIVE):');
        remoteLicense.clearMockStatus();
        const restoredStatus = await remoteLicense.getLicenseStatus(true);
        assert.strictEqual(restoredStatus.allowed, true, 'Trạng thái phải trở lại allowed: true');
        console.log('  ✅ [PASS] Hệ thống tự động mở khóa và hoạt động bình thường trở lại');

        console.log('\n========================================================================');
        console.log('🎉 TẤT CẢ KIỂM THỬ CÔNG TẮC TỪ XA ĐỀU THÀNH CÔNG 100%!');
        console.log('========================================================================\n');
    } finally {
        server.close();
    }
}

runKillswitchTests().catch(err => {
    console.error('❌ Lỗi kiểm thử killswitch:', err);
    process.exit(1);
});

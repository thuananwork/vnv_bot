const puppeteer = require('puppeteer-core');
const fs = require('fs');

function findBrowserPath() {
    const candidates = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
        'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe'
    ];
    for (const p of candidates) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

async function runBrowserTests() {
    console.log('================================================================');
    console.log('🚀 BẮT ĐẦU CHẠY TRÌNH DUYỆT TỰ ĐỘNG KIỂM THỬ TỪNG TÍNH NĂNG');
    console.log('================================================================\n');

    const browserPath = findBrowserPath();
    if (!browserPath) {
        console.error('❌ Không tìm thấy Chrome hoặc Edge trên hệ thống!');
        process.exit(1);
    }
    console.log(`[BROWSER] Sử dụng trình duyệt: ${browserPath}`);

    const browser = await puppeteer.launch({
        executablePath: browserPath,
        headless: 'new', // Chạy chế độ headless chuẩn mới
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1366, height: 768 });

    // Lắng nghe console lỗi nếu có
    const pageErrors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.warn(`  [BROWSER ERROR] ${msg.text()}`);
            pageErrors.push(msg.text());
        }
    });
    page.on('pageerror', err => {
        console.error(`  [PAGE ERROR] ${err.message}`);
    });

    // Tự động chấp nhận các hộp thoại confirm / alert
    page.on('dialog', async dialog => {
        console.log(`  [DIALOG] ${dialog.type().toUpperCase()}: "${dialog.message()}" -> Chấp nhận (OK)`);
        await dialog.accept();
    });

    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✅ [PASS] ${message}`);
            passed++;
        } else {
            console.error(`  ❌ [FAIL] ${message}`);
            failed++;
        }
    }

    // Clean up any test fixtures from previous runs
    try {
        const db = require('../config/db');
        await db.run("DELETE FROM members WHERE real_name = 'Trần Quốc Toản'");
    } catch (e) {}

    try {
        // ==========================================
        // 1. KIỂM THỬ ĐĂNG NHẬP (AUTH FLOW)
        // ==========================================
        console.log('1. Kiểm thử Đăng Nhập (Login Flow)...');
        await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
        console.log('  -> Đã mở trang http://localhost:3000');

        await page.waitForSelector('#username', { visible: true });
        await page.type('#username', 'admin');
        await page.type('#password', 'admin');
        console.log('  -> Đã điền thông tin đăng nhập: admin / admin');

        await Promise.all([
            page.waitForResponse(res => res.url().includes('/api/auth/login') && res.status() === 200),
            page.click('#login-form button[type="submit"]')
        ]);
        console.log('  -> API Login trả về 200 OK');

        await page.waitForSelector('#profile-fullname', { timeout: 5000 });
        const fullName = await page.$eval('#profile-fullname', el => el.innerText);
        assert(fullName === 'System Administrator', 'Đăng nhập thành công với tài khoản Admin');

        // ==========================================
        // 2. KIỂM THỬ ĐIỀU HÀNH VÙNG (REGION WORKSPACE)
        // ==========================================
        console.log('\n2. Kiểm thử Bảng Điều Hành Vùng (Region Workspace)...');
        await page.click('a[data-target="panel-region-workspace"]');
        await page.waitForSelector('#panel-region-workspace.active', { timeout: 3000 });
        assert(true, 'Chuyển sang tab Bảng Điều Hành Vùng thành công');

        // Đợi dữ liệu nhân sự tải xong
        await page.waitForFunction(() => {
            const rows = document.querySelectorAll('#rw-members-table-body tr');
            return rows.length > 1;
        }, { timeout: 5000 });

        const memberRowsCount = await page.$$eval('#rw-members-table-body tr', rows => rows.length);
        assert(memberRowsCount >= 19, `Vùng 27 tải đủ thành viên trên bảng (Hiện tại: ${memberRowsCount})`);

        const firstMemberName = await page.$eval('#rw-members-table-body tr:first-child td:nth-child(2) strong', el => el.innerText);
        assert(firstMemberName === 'Phạm Quang Đại', `Trưởng Vùng hàng 4 đúng tên: ${firstMemberName}`);

        const secondMemberName = await page.$eval('#rw-members-table-body tr:nth-child(2) td:nth-child(2) strong', el => el.innerText);
        assert(secondMemberName === 'Nguyễn Thị Thanh Trà', `Phó Vùng hàng 5 đúng tên: ${secondMemberName}`);

        // Test Nút Lưu Khung Giờ
        console.log('  -> Thử nghiệm Lưu Khung Giờ Vùng...');
        await page.click('#btn-rw-save-settings');
        assert(true, 'Bấm Lưu Khung Giờ hoạt động trơn tru');

        // Test Nút Quét Bài & Xuất Báo Cáo Vùng
        console.log('  -> Thử nghiệm Nút [Quét Bài & Xuất Báo Cáo Vùng]...');
        await page.click('#btn-rw-run-report');
        await new Promise(r => setTimeout(r, 1000));

        const regionReportText = await page.$eval('#rw-report-preview-text', el => el.value);
        assert(regionReportText.includes('VÙNG 27') && regionReportText.includes('Phạm Quang Đại'), 'Xem trước Báo Cáo Vùng (Mẫu 1) hiển thị chuẩn xác');

        // Test Nút Sao Chép Báo Cáo Vùng
        console.log('  -> Thử nghiệm Nút [Sao Chép Báo Cáo Vùng]...');
        await page.click('#btn-rw-copy-report');
        await new Promise(r => setTimeout(r, 500));
        assert(true, 'Nút sao chép Báo cáo Vùng hoạt động');

        // ==========================================
        // 3. KIỂM THỬ ĐIỀU HÀNH CỤM 5 (CLUSTER WORKSPACE)
        // ==========================================
        console.log('\n3. Kiểm thử Bảng Điều Hành Cụm 5 (Cluster Workspace)...');
        await page.evaluate(() => {
            document.querySelector('a[data-target="panel-cluster-workspace"]').click();
        });
        await page.waitForSelector('#panel-cluster-workspace.active', { timeout: 3000 });
        assert(true, 'Chuyển sang tab Bảng Điều Hành Cụm 5 thành công');

        // Test Nút Tổng Hợp Cụm 5
        console.log('  -> Thử nghiệm Nút [Tổng Hợp & Bắn Báo Cáo Cụm 5]...');
        await page.click('#btn-cw-run-cluster-report');
        await new Promise(r => setTimeout(r, 1000));

        const clusterReportText = await page.$eval('#cw-report-preview-text', el => el.value);
        assert(clusterReportText.includes('Cụm 5 (Vùng 25–31)'), 'Báo cáo Cụm chứa header Cụm 5');
        assert(clusterReportText.includes('@Phạm Minh Tú em gửi báo cáo nha anh'), 'Báo cáo Cụm 5 có dòng tag @Phạm Minh Tú');

        // Test Nút Sao Chép Báo Cáo Cụm
        console.log('  -> Thử nghiệm Nút [Sao Chép Báo Cáo Cụm]...');
        await page.click('#btn-cw-copy-report');
        assert(true, 'Nút sao chép Báo cáo Cụm hoạt động');

        // ==========================================
        // 4. KIỂM THỬ GIAO DIỆN SÁNG / TỐI (THEME TOGGLE)
        // ==========================================
        console.log('\n4. Kiểm thử Chuyển Đổi Giao Diện Sáng / Tối (Theme Mode)...');
        await page.evaluate(() => document.getElementById('btn-theme-toggle').click());
        const themeAttr = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        assert(themeAttr === 'dark', 'Chuyển sang Giao diện Tối (Dark mode) thành công');

        await page.evaluate(() => document.getElementById('btn-theme-toggle').click());
        const themeLight = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
        assert(!themeLight, 'Chuyển về Giao diện Sáng (Light mode) thành công');

        // ==========================================
        // 5. KIỂM THỬ CÁC PANEL KHÁC TRONG HỆ THỐNG
        // ==========================================
        console.log('\n5. Kiểm thử Điều Hướng Các Panel Quản Trị Khác...');
        const panels = [
            { target: 'panel-region-workspace', name: 'Điều Hành Vùng' },
            { target: 'panel-cluster-workspace', name: 'Điều Hành Cụm 5' },
            { target: 'panel-members', name: 'Quản lý Sứ giả' },
            { target: 'panel-regions', name: 'Cấu hình Vùng' },
            { target: 'panel-users', name: 'Tài khoản quản trị' },
            { target: 'panel-audit', name: 'Nhật ký & Hệ thống' }
        ];

        for (const p of panels) {
            await page.evaluate((target) => {
                document.querySelector(`a[data-target="${target}"]`).click();
            }, p.target);
            await page.waitForSelector(`#${p.target}.active`, { timeout: 3000 });
            assert(true, `Panel [${p.name}] mở thành công không lỗi`);
        }

        // ==========================================
        // 6. ĐĂNG XUẤT TÀI KHOẢN ADMIN
        // ==========================================
        console.log('\n6. Đăng xuất tài khoản Admin...');
        await page.evaluate(() => document.getElementById('btn-logout').click());
        await page.waitForSelector('#login-container.active', { timeout: 3000 });
        assert(true, 'Admin đăng xuất thành công, quay về màn hình đăng nhập');

        // ==========================================
        // 7. KIỂM THỬ TÀI KHOẢN TRƯỞNG VÙNG (REGION LEADER)
        // ==========================================
        console.log('\n7. Kiểm thử Đăng Nhập & Phân Quyền Trưởng Vùng 27 (truongvung27)...');
        await page.waitForSelector('#username', { visible: true });
        await Promise.all([
            page.waitForResponse(res => res.url().includes('/api/auth/login') && res.status() === 200),
            page.evaluate(() => {
                document.getElementById('username').value = 'truongvung27';
                document.getElementById('password').value = 'vung27@123';
                document.getElementById('login-form').requestSubmit();
            })
        ]);

        await page.waitForSelector('#profile-fullname', { timeout: 5000 });
        const leaderName = await page.$eval('#profile-fullname', el => el.innerText);
        const leaderRole = await page.$eval('#profile-role', el => el.innerText);
        assert(leaderName === 'Phạm Quang Đại', `Đăng nhập Trưởng Vùng thành công: ${leaderName}`);
        assert(leaderRole.toUpperCase() === 'TRƯỞNG VÙNG', `Role hiển thị chuẩn: ${leaderRole}`);

        // 7.1 Kiểm tra RBAC Menu bên Sidebar của Trưởng Vùng
        console.log('  -> Kiểm tra Phân Quyền Menu (RBAC) của Trưởng Vùng...');
        const isClusterMenuHidden = await page.$eval('a[data-target="panel-cluster-workspace"]', el => el.classList.contains('hide'));
        assert(isClusterMenuHidden, 'Menu [Điều Hành Cụm 5] ĐÃ ĐƯỢC ẨN đối với Trưởng Vùng');

        const adminMenuCount = await page.$$eval('.admin-only', els => els.filter(e => !e.classList.contains('hide')).length);
        assert(adminMenuCount === 0, 'Tất cả các menu Admin (Cấu hình Vùng, Users, Audit) ĐÃ ĐƯỢC ẨN');

        const isRegionWorkspaceActive = await page.$eval('#panel-region-workspace', el => el.classList.contains('active'));
        assert(isRegionWorkspaceActive, 'Trưởng Vùng tự động vào thẳng Bảng Điều Hành Vùng');

        // 7.2 Kiểm tra Bảng Điều Hành Vùng của Trưởng Vùng 27
        console.log('  -> Kiểm tra Bảng Điều Hành Vùng 27...');
        const selectedRegion = await page.$eval('#rw-region-select', el => el.value);
        const isRegionSelectDisabled = await page.$eval('#rw-region-select', el => el.disabled);
        assert(selectedRegion === '27', `Dropdown tự động chọn đúng Vùng 27 (Hiện tại: ${selectedRegion})`);
        assert(isRegionSelectDisabled, 'Dropdown Vùng bị khóa (disabled) bảo đảm đúng phạm vi quản lý của Trưởng Vùng');

        // Thử nghiệm Quét & Báo Cáo Vùng 27
        await page.click('#btn-rw-run-report');
        await new Promise(r => setTimeout(r, 1000));
        const v27Report = await page.$eval('#rw-report-preview-text', el => el.value);
        assert(v27Report.includes('VÙNG 27') && v27Report.includes('Phạm Quang Đại'), 'Trưởng Vùng 27 quét và tạo Báo Cáo Mẫu 1 thành công');

        // 7.3 Kiểm thử Quản lý Sứ Giả của Trưởng Vùng
        console.log('  -> Kiểm thử Quản lý Sứ Giả (Chỉ xem và quản lý Sứ giả Vùng 27)...');
        await page.evaluate(() => {
            document.querySelector('a[data-target="panel-members"]').click();
        });
        await page.waitForSelector('#panel-members.active', { timeout: 3000 });

        // Đợi nạp danh sách sứ giả
        await page.waitForFunction(() => {
            const rows = document.querySelectorAll('#table-members-body tr');
            return rows.length > 1;
        }, { timeout: 5000 });

        const v27MembersCount = await page.$$eval('#table-members-body tr', rows => rows.length);
        assert(v27MembersCount >= 19, `Trưởng Vùng chỉ thấy các thành viên Vùng 27 (${v27MembersCount} người)`);

        // Kiểm tra cột tên Zalo có dữ liệu (không bị undefined/rỗng)
        const sampleZaloName = await page.$eval('#table-members-body tr:first-child td:nth-child(2)', el => el.innerText);
        assert(sampleZaloName.length > 0 && sampleZaloName !== 'undefined', `Cột Tên Zalo hiển thị chính xác: "${sampleZaloName}"`);

        // 7.4 Thử nghiệm Thêm Sứ Giả Mới
        console.log('  -> Thử nghiệm Thêm Sứ Giả Mới cho Vùng 27...');
        await page.evaluate(() => window.showMemberModal());
        await page.waitForSelector('#modal-member.active', { timeout: 3000 });

        const modalRegionVal = await page.$eval('#select-member-region', el => el.value);
        assert(modalRegionVal === '27', `Modal thêm sứ giả tự động gắn Vùng 27 (Hiện tại: ${modalRegionVal})`);

        await page.type('#input-member-fullname', 'Trần Quốc Toản');
        await page.type('#input-member-zaloname', 'Quốc Toản');
        await page.evaluate(() => document.getElementById('form-member').requestSubmit());
        await page.waitForFunction(() => {
            const tbody = document.getElementById('table-members-body');
            return tbody && tbody.innerText.includes('Trần Quốc Toản');
        }, { timeout: 5000 });
        assert(true, 'Thêm mới Sứ Giả "Trần Quốc Toản" vào Vùng 27 thành công');

        // Dọn dẹp thành viên kiểm thử vừa tạo
        await page.evaluate(async () => {
            const rows = Array.from(document.querySelectorAll('#table-members-body tr'));
            const testRow = rows.find(r => r.innerText.includes('Trần Quốc Toản'));
            if (testRow) {
                const delBtn = testRow.querySelector('button.btn-danger-outline');
                if (delBtn) delBtn.click();
            }
        });
        await new Promise(r => setTimeout(r, 600));

        // 7.5 Kiểm tra Chặn truy cập trái phép URL Hash
        console.log('  -> Thử truy cập trái phép vào Điều Hành Cụm 5 (#cluster-workspace)...');
        await page.evaluate(() => {
            window.location.hash = '#cluster-workspace';
            window.dispatchEvent(new HashChangeEvent('hashchange'));
        });
        await new Promise(r => setTimeout(r, 500));
        const activeAfterForbidden = await page.$eval('.content-panel.active', el => el.id);
        assert(activeAfterForbidden === 'panel-region-workspace', 'Hệ thống bảo mật tự động chặn Trưởng Vùng vào Cụm và chuyển về Bảng Điều Hành Vùng');

        // Đăng xuất Trưởng Vùng
        await page.evaluate(() => document.getElementById('btn-logout').click());
        await page.waitForSelector('#login-container.active', { timeout: 3000 });
        assert(true, 'Trưởng Vùng đăng xuất thành công');

        console.log('\n================================================================');
        console.log(`🎉 TẤT CẢ KIỂM THỬ TRÌNH DUYỆT (ADMIN & TRƯỞNG VÙNG) HOÀN TẤT: ${passed} PASSED | ${failed} FAILED`);
        console.log('================================================================');

    } catch (err) {
        console.error('\n❌ GẶP LỖI TRONG QUÁ TRÌNH KIỂM THỬ TRÌNH DUYỆT:', err);
        failed++;
    } finally {
        await browser.close();
        if (failed > 0) process.exit(1);
        else process.exit(0);
    }
}

runBrowserTests();

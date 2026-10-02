const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const guideDir = path.join(__dirname, '../src/web/img/guide');
const distGuideDir = path.join(__dirname, '../dist/VNV-Bot-v2.0.0/src/web/img/guide');

[guideDir, distGuideDir].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
});

async function saveBoth(filename, buffer) {
    fs.writeFileSync(path.join(guideDir, filename), buffer);
    if (fs.existsSync(distGuideDir)) {
        fs.writeFileSync(path.join(distGuideDir, filename), buffer);
    }
    console.log(`  📸 Đã lưu siêu nét & bảo mật danh tính: ${filename} (${Math.round(buffer.length / 1024)} KB)`);
}

// Danh sách tên mẫu giả định 100% để bảo mật thông tin cá nhân
const SAMPLE_MEMBERS = [
    { name: 'Nguyễn Văn An', zalo: 'Văn An', role: 'LEADER', status: 'Oke' },
    { name: 'Trần Thị Bình', zalo: 'Trần Bình', role: 'DEPUTY', status: 'Chưa nộp' },
    { name: 'Lê Hoàng Cường', zalo: 'Hoàng Cường', role: 'EMISSARY', status: 'Chưa nộp' },
    { name: 'Phạm Minh Dũng', zalo: 'Minh Dũng', role: 'EMISSARY', status: 'Chưa nộp' },
    { name: 'Vũ Thị Mai', zalo: 'Thị Mai', role: 'EMISSARY', status: 'Chưa nộp' },
    { name: 'Hoàng Gia Hân', zalo: 'Gia Hân', role: 'EMISSARY', status: 'Chưa nộp' },
    { name: 'Đỗ Quốc Khánh', zalo: 'Quốc Khánh', role: 'EMISSARY', status: 'Chưa nộp' },
    { name: 'Bùi Tuyết Lan', zalo: 'Tuyết Lan', role: 'EMISSARY', status: 'Chưa nộp' },
    { name: 'Phan Văn Nam', zalo: 'Văn Nam', role: 'EMISSARY', status: 'Chưa nộp' },
    { name: 'Đặng Thị Oanh', zalo: 'Oanh Đặng', role: 'EMISSARY', status: 'Chưa nộp' },
    { name: 'Ngô Văn Phúc', zalo: 'Phúc Ngô', role: 'EMISSARY', status: 'Chưa nộp' },
    { name: 'Lý Thu Quỳnh', zalo: 'Thu Quỳnh', role: 'EMISSARY', status: 'Chưa nộp' }
];

async function capture() {
    const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
    console.log('🚀 Đang khởi động Chrome HD (Retina 2x, Anonymous Data Filter)...');
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: 'new',
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--window-size=1440,960'
        ]
    });

    const page = await browser.newPage();
    await page.setViewport({
        width: 1440,
        height: 960,
        deviceScaleFactor: 2
    });

    // -------------------------------------------------------------
    // 1. CHỤP MÀN HÌNH ĐĂNG NHẬP
    // -------------------------------------------------------------
    console.log('1. Chụp màn hình đăng nhập...');
    await page.goto('http://localhost:3000/#login', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1000));

    await page.evaluate(() => {
        const u = document.getElementById('username');
        const p = document.getElementById('password');
        if (u) u.value = 'truongvung28';
        if (p) p.value = '••••••••••••';
    });

    const loginCard = await page.$('.login-card') || await page.$('.auth-card');
    if (loginCard) {
        const buf = await loginCard.screenshot();
        await saveBoth('guide_step1_login.png', buf);
    } else {
        const buf = await page.screenshot({ fullPage: false });
        await saveBoth('guide_step1_login.png', buf);
    }

    // -------------------------------------------------------------
    // 2. ĐĂNG NHẬP VÀO KHÔNG GIAN VÙNG
    // -------------------------------------------------------------
    console.log('2. Đăng nhập vào Không Gian Vùng...');
    await page.evaluate(() => {
        const u = document.getElementById('username');
        const p = document.getElementById('password');
        if (u) u.value = 'truongvung28';
        if (p) p.value = 'truongvung28';
    });
    await page.click('#login-form button[type="submit"]');
    await new Promise(r => setTimeout(r, 2000));

    // -------------------------------------------------------------
    // 3. ẨN & THAY THẾ TOÀN BỘ THÔNG TIN CÁ NHÂN (ANONYMIZE DOM)
    // -------------------------------------------------------------
    console.log('3. Đang ẩn và thay thế toàn bộ thông tin nhạy cảm của Sứ giả bằng tên mẫu...');
    await page.evaluate((sampleData) => {
        // A. Ẩn thông tin tên người dùng trên thanh sidebar/header nếu có
        document.querySelectorAll('*').forEach(el => {
            if (el.children.length === 0) {
                if (el.innerText && el.innerText.includes('Đỗ Văn Xuyên')) {
                    el.innerText = el.innerText.replace(/Đỗ Văn Xuyên/g, 'Nguyễn Văn An');
                }
            }
        });

        // B. Thay thế toàn bộ hàng trong bảng Sứ giả bằng danh sách giả định
        const rows = document.querySelectorAll('#rw-members-table-body tr');
        rows.forEach((tr, index) => {
            if (index < sampleData.length) {
                const sample = sampleData[index];
                const strongName = tr.querySelector('td:nth-child(2) strong');
                if (strongName) strongName.innerText = sample.name;

                const input = tr.querySelector('.rw-zalo-mapping-input');
                if (input) {
                    input.value = sample.zalo;
                    input.setAttribute('data-real-name', sample.name);
                }
            }
        });

        // C. Thay thế nội dung trong khung Báo cáo nháp bên phải
        const reportTextarea = document.getElementById('rw-report-preview-text');
        if (reportTextarea) {
            reportTextarea.value = 
`Báo cáo ngày 20/09/2026
------HÀNG NGÀY-------
SỨ GIẢ VÙNG 28
1. Nguyễn Văn An
2. Chức vụ: Trưởng Vùng
3. Tổng số sứ giả: 12
4. Hoàn thành: 1
5. Không hoàn thành: 11
6. Lý do:
* Không phản hồi:
- Trần Thị Bình
- Lê Hoàng Cường
- Phạm Minh Dũng
- Vũ Thị Mai
- Hoàng Gia Hân
- Đỗ Quốc Khánh
- Bùi Tuyết Lan
- Phan Văn Nam
- Đặng Thị Oanh
- Ngô Văn Phúc
- Lý Thu Quỳnh
* Xin làm muộn/bổ sung:
- Không có
7. Bổ sung:
- Không có`;
        }
    }, SAMPLE_MEMBERS);

    await new Promise(r => setTimeout(r, 400));

    // -------------------------------------------------------------
    // 4. CHỤP HEADER VÀ NÚT [MỞ ZALO]
    // -------------------------------------------------------------
    console.log('4. Chụp Header & Nút [Mở Zalo]...');
    const headerNav = await page.$('.sidebar-header') || await page.$('.top-nav');
    if (headerNav) {
        const buf = await headerNav.screenshot();
        await saveBoth('guide_step1_open_zalo.png', buf);
    }

    // -------------------------------------------------------------
    // 5. CHỤP THANH CÔNG CỤ QUÉT BÀI & BÁO CÁO (TOOLBAR)
    // -------------------------------------------------------------
    console.log('5. Chụp Toolbar Quét Bài...');
    const wsHeader = await page.$('#panel-region-workspace .workspace-header');
    if (wsHeader) {
        const buf = await wsHeader.screenshot();
        await saveBoth('guide_step3_toolbar.png', buf);
    }

    // -------------------------------------------------------------
    // 6. CHỤP TOÀN BỘ KHÔNG GIAN VÙNG (ĐÃ BẢO MẬT TÊN 100%)
    // -------------------------------------------------------------
    console.log('6. Chụp Không Gian Vùng (Đã ẩn tên thật)...');
    const wsPanel = await page.$('#panel-region-workspace');
    if (wsPanel) {
        const buf = await wsPanel.screenshot();
        await saveBoth('guide_step3_workspace.png', buf);
    }

    // -------------------------------------------------------------
    // 7. CHỤP CỤM NÚT [MAPPING TÊN ZALO] VÀ BẢNG SỨ GIẢ MẪU
    // -------------------------------------------------------------
    console.log('7. Chụp Cụm Nút [Mapping tên Zalo] & Danh Sách Sứ Giả...');
    const leftPane = await page.$('#panel-region-workspace .split-workspace-grid .workspace-card-pane:first-child');
    if (leftPane) {
        await page.evaluate(() => {
            const el = document.querySelector('#panel-region-workspace .split-workspace-grid .workspace-card-pane:first-child');
            if (el) el.scrollTop = 0;
        });
        await new Promise(r => setTimeout(r, 300));
        const buf = await leftPane.screenshot();
        await saveBoth('guide_step2_mapping_buttons.png', buf);
        await saveBoth('guide_step2_member_row.png', buf);
    }

    // -------------------------------------------------------------
    // 8. CHỤP NÚT MÀU ĐỎ: [🛑 DỪNG QUÉT (BẤM ĐỂ DỪNG)] - BÀI 6
    // -------------------------------------------------------------
    console.log('8. Chụp nút màu đỏ: [Dừng quét (Bấm để dừng)]...');
    await page.evaluate(() => {
        const btn = document.getElementById('btn-rw-run-report') || document.querySelector('.btn-run-report, [onclick*="runRegionReport"]');
        if (btn) {
            btn.className = 'btn btn-danger';
            btn.style.setProperty('background-color', '#dc2626', 'important');
            btn.style.setProperty('background', '#dc2626', 'important');
            btn.style.setProperty('border-color', '#b91c1c', 'important');
            btn.style.setProperty('color', '#ffffff', 'important');
            btn.innerHTML = '<i class="fa-solid fa-hand"></i> Dừng quét (Bấm để dừng)';
        }
    });
    await new Promise(r => setTimeout(r, 400));
    const wsHeaderStop = await page.$('#panel-region-workspace .workspace-header');
    if (wsHeaderStop) {
        const buf = await wsHeaderStop.screenshot();
        await saveBoth('guide_step6_stop_button.png', buf);
    }

    // Phục hồi lại nút quét
    await page.evaluate(() => {
        const btn = document.getElementById('btn-rw-run-report');
        if (btn) {
            btn.classList.remove('btn-danger');
            btn.style.backgroundColor = '';
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Quét Bài & Báo Cáo';
        }
    });

    // -------------------------------------------------------------
    // 9. CHỤP TRANG CÀI ĐẶT & BẢNG MÀU GOOGLE SHEETS
    // -------------------------------------------------------------
    console.log('9. Chụp trang Cài Đặt & Bảng Màu Google Sheets...');
    await page.goto('http://localhost:3000/#settings', { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 1200));

    const settingsPanel = await page.$('#panel-settings');
    if (settingsPanel) {
        const buf = await settingsPanel.screenshot();
        await saveBoth('guide_step4_settings.png', buf);
    }

    const paletteBox = await page.$('#panel-settings .settings-section:nth-of-type(2)') 
                    || await page.$('#settings-palette-container')
                    || await page.$('#panel-settings .glass-card:nth-child(3)');
    if (paletteBox) {
        const buf = await paletteBox.screenshot();
        await saveBoth('guide_step4_palette_section.png', buf);
    }

    // -------------------------------------------------------------
    // 10. CHỤP MOCKUP CỬA SỔ CMD ĐỂ TẮT BOT (CTRL+C HOẶC [X]) - BÀI 6
    // -------------------------------------------------------------
    console.log('10. Chụp cửa sổ dòng lệnh đen và hướng dẫn tắt Bot...');
    const termHtml = `
    <!DOCTYPE html>
    <html>
    <head>
    <meta charset="utf-8">
    <style>
      body {
        margin: 0;
        padding: 30px;
        background: #0f172a;
        font-family: Consolas, "Lucida Console", "Courier New", monospace;
        display: flex;
        justify-content: center;
        align-items: center;
      }
      .cmd-window {
        width: 860px;
        background: #0c0c0c;
        border-radius: 8px;
        box-shadow: 0 16px 36px rgba(0,0,0,0.6);
        border: 1px solid #334155;
        overflow: hidden;
      }
      .cmd-titlebar {
        background: #1e293b;
        padding: 10px 16px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        border-bottom: 1px solid #334155;
        user-select: none;
      }
      .cmd-title {
        color: #f1f5f9;
        font-size: 13px;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        align-items: center;
        gap: 10px;
        font-weight: 500;
      }
      .cmd-controls {
        display: flex;
        align-items: center;
        gap: 6px;
      }
      .cmd-btn {
        width: 34px;
        height: 24px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #94a3b8;
        font-size: 12px;
        font-family: -apple-system, sans-serif;
      }
      .cmd-btn.close {
        background: #dc2626;
        color: white;
        border-radius: 4px;
        font-weight: bold;
        box-shadow: 0 2px 6px rgba(220,38,38,0.4);
      }
      .cmd-body {
        padding: 20px 24px;
        color: #cbd5e1;
        font-size: 14px;
        line-height: 1.65;
      }
      .cyan { color: #38bdf8; font-weight: bold; }
      .green { color: #4ade80; font-weight: bold; }
      .yellow { color: #fbbf24; font-weight: bold; }
      .white { color: #ffffff; font-weight: bold; }
      .gray { color: #64748b; }
      .kbd {
        background: #334155;
        color: #38bdf8;
        padding: 3px 8px;
        border-radius: 4px;
        font-weight: bold;
        border: 1px solid #475569;
      }
    </style>
    </head>
    <body>
      <div class="cmd-window">
        <div class="cmd-titlebar">
          <div class="cmd-title">
            <span>💻</span> VNV-Bot v2.0.0 — D:\\VNV-Bot-v2.0.0\\VNV-Bot.exe
          </div>
          <div class="cmd-controls">
            <div class="cmd-btn">─</div>
            <div class="cmd-btn">□</div>
            <div class="cmd-btn close" title="Nhấp nút [X] màu đỏ để tắt bot ngay lập tức">✕</div>
          </div>
        </div>
        <div class="cmd-body">
          <div class="cyan">============================================================</div>
          <div class="white">  🚀 VNV-BOT V2.0 — HỆ THỐNG QUÉT BÀI & BÁO CÁO ZALO</div>
          <div class="cyan">============================================================</div>
          <div class="gray">[INFO] Khởi động VNV-Bot Web Server tại: http://localhost:3000</div>
          <div class="green">[READY] Hệ thống đã sẵn sàng phục vụ!</div>
          <div class="gray">[ZALO] Phiên đăng nhập Zalo đã sẵn sàng.</div>
          <br>
          <div class="yellow">⚡ HƯỚNG DẪN TẮT BOT KHI BÁO CÁO XONG:</div>
          <div>   👉 <span class="white">Cách 1:</span> Bấm tổ hợp phím <span class="kbd">Ctrl + C</span> trong cửa sổ này</div>
          <div>   👉 <span class="white">Cách 2:</span> Nhấp nút dấu nhân đỏ <span class="kbd" style="background:#dc2626; color:white; border-color:#b91c1c;">[ ✕ ]</span> ở góc trên bên phải</div>
          <br>
          <div><span class="gray">D:\\VNV-Bot-v2.0.0&gt; </span><span class="white">^C</span></div>
          <div class="green">[SHUTDOWN] Đang đóng các tiến trình và giải phóng bộ nhớ RAM...</div>
          <div class="green">[SHUTDOWN] Đã tắt sạch 100% tài nguyên hệ thống. Tạm biệt!</div>
        </div>
      </div>
    </body>
    </html>
    `;
    const termPage = await browser.newPage();
    await termPage.setViewport({ width: 960, height: 500, deviceScaleFactor: 2 });
    await termPage.setContent(termHtml);
    await new Promise(r => setTimeout(r, 400));
    const cmdWindowEl = await termPage.$('.cmd-window');
    if (cmdWindowEl) {
        const buf = await cmdWindowEl.screenshot();
        await saveBoth('guide_step6_terminal_exit.png', buf);
    }
    await termPage.close();

    await browser.close();
    console.log('🎉 HOÀN TẤT CHỤP TOÀN BỘ ẢNH BẢO MẬT & ĐẦY ĐỦ CHO BÀI 6 (RETINA 2X)!');
}

capture().catch(err => {
    console.error('❌ Lỗi chụp:', err);
    process.exit(1);
});

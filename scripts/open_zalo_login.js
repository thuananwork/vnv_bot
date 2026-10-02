const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');

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

async function openZaloLogin() {
    const browserPath = findBrowserPath();
    if (!browserPath) {
        console.error('❌ Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính.');
        process.exit(1);
    }

    const userDataDir = path.join(__dirname, '../zalo_session');
    if (!fs.existsSync(userDataDir)) {
        fs.mkdirSync(userDataDir, { recursive: true });
    }

    console.log('================================================================');
    console.log('📱 MỞ TRÌNH DUYỆT ĐĂNG NHẬP ZALO WEB (CHỈ QUÉT MÃ QR 1 LẦN)');
    console.log('================================================================');
    console.log(`- Trình duyệt: ${browserPath}`);
    console.log(`- Thư mục lưu session: ${userDataDir}`);
    console.log('\nĐang mở cửa sổ trình duyệt...');

    const browser = await puppeteer.launch({
        executablePath: browserPath,
        headless: false, // Mở cửa sổ thật để người dùng quét mã QR
        userDataDir: userDataDir,
        defaultViewport: null,
        ignoreDefaultArgs: ['--enable-automation'],
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-blink-features=AutomationControlled',
            '--start-maximized'
        ]
    });

    const pages = await browser.pages();
    const page = pages.length > 0 ? pages[0] : await browser.newPage();
    
    await page.evaluateOnNewDocument(() => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => undefined
        });
    });

    await page.goto('https://chat.zalo.me', { waitUntil: 'domcontentloaded' });
    console.log('\n✔ Đã mở trang https://chat.zalo.me.');
    console.log('👉 Vui lòng dùng app Zalo trên điện thoại quét mã QR để đăng nhập.');
    console.log('👉 Sau khi đăng nhập thành công vào màn hình tin nhắn Zalo, phiên đăng nhập sẽ tự động lưu lại vĩnh viễn!');

    // Lắng nghe khi trình duyệt đóng
    browser.on('disconnected', () => {
        console.log('\n✔ Đã lưu phiên đăng nhập Zalo vào thư mục ./zalo_session thành công.');
        process.exit(0);
    });
}

openZaloLogin().catch(err => {
    console.error('Lỗi khi mở Zalo:', err);
    process.exit(1);
});

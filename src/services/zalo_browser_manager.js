const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

class ZaloBrowserManager {
    constructor() {
        this.browserInstance = null;
        this.sessionDir = path.join(__dirname, '../../zalo_session');
        if (!fs.existsSync(this.sessionDir)) {
            fs.mkdirSync(this.sessionDir, { recursive: true });
        }
    }

    findBrowserPath() {
        if (process.platform === 'darwin') {
            const home = process.env.HOME || '';
            const macCandidates = [
                '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
                '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
                '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
                '/Applications/CocCoc.app/Contents/MacOS/CocCoc',
                path.join(home, 'Applications/Google Chrome.app/Contents/MacOS/Google Chrome'),
                path.join(home, 'Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'),
                path.join(home, 'Applications/Brave Browser.app/Contents/MacOS/Brave Browser'),
                path.join(home, 'Applications/CocCoc.app/Contents/MacOS/CocCoc')
            ];
            for (const p of macCandidates) {
                try {
                    if (fs.existsSync(p)) return p;
                } catch (e) {}
            }
            const unixNames = ['google-chrome', 'chromium', 'google-chrome-stable'];
            for (const name of unixNames) {
                try {
                    const out = execSync(`which ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
                    const firstLine = out.split(/\r?\n/)[0]?.trim();
                    if (firstLine && fs.existsSync(firstLine)) return firstLine;
                } catch (e) {}
            }
            return null;
        }

        const localAppData = process.env.LOCALAPPDATA || (process.env.USERPROFILE ? path.join(process.env.USERPROFILE, 'AppData', 'Local') : '');
        const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

        const candidates = [
            // 1. Google Chrome (Standard & 32-bit & User Profile)
            path.join(progFiles, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(progFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
            localAppData ? path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe') : '',
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',

            // 2. Microsoft Edge (Built-in on 100% Windows 10/11)
            path.join(progFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
            path.join(progFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
            localAppData ? path.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe') : '',
            'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
            'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',

            // 3. Trình duyệt Cốc Cốc (Rất phổ biến tại Việt Nam)
            localAppData ? path.join(localAppData, 'CocCoc\\Browser\\Application\\browser.exe') : '',
            path.join(progFiles, 'CocCoc\\Browser\\Application\\browser.exe'),
            path.join(progFilesX86, 'CocCoc\\Browser\\Application\\browser.exe'),

            // 4. Brave Browser
            path.join(progFiles, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
            path.join(progFilesX86, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
            localAppData ? path.join(localAppData, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe') : ''
        ].filter(Boolean);

        for (const p of candidates) {
            try {
                if (fs.existsSync(p)) return p;
            } catch (e) {}
        }

        // 5. Truy vấn Windows Registry nếu người dùng cài đặt ở phân vùng khác (D:\, E:\...)
        const regKeys = [
            'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
            'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\chrome.exe',
            'HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
            'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\msedge.exe',
            'HKCU\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\browser.exe'
        ];
        for (const rk of regKeys) {
            try {
                const out = execSync(`reg query "${rk}" /ve`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
                const m = out.match(/REG_SZ\s+(.+)$/m);
                if (m && m[1]) {
                    const cleanPath = m[1].trim().replace(/^"|"$/g, '');
                    if (fs.existsSync(cleanPath)) return cleanPath;
                }
            } catch (e) {}
        }

        // 6. Truy vấn lệnh where trên Windows
        const exeNames = ['chrome.exe', 'msedge.exe', 'browser.exe'];
        for (const name of exeNames) {
            try {
                const out = execSync(`where ${name}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000 });
                const firstLine = out.split(/\r?\n/)[0]?.trim();
                if (firstLine && fs.existsSync(firstLine)) return firstLine;
            } catch (e) {}
        }

        return null;
    }

    /**
     * Mở cửa sổ trình duyệt thật cho người dùng quét mã QR đăng nhập Zalo
     */
    async openLoginWindow() {
        const browserPath = this.findBrowserPath();
        if (!browserPath) {
            throw new Error('Không tìm thấy Google Chrome hoặc Microsoft Edge trên máy tính của bạn.\nVui lòng cài đặt Google Chrome tại https://www.google.com/chrome để tiếp tục.');
        }

        // 1. Nếu trình duyệt đang mở và còn kết nối, mang lại tab đầu tiên
        if (this.browserInstance) {
            try {
                if (this.browserInstance.isConnected()) {
                    const pages = await this.browserInstance.pages();
                    if (pages && pages.length > 0) {
                        await pages[0].bringToFront();
                        return { success: true, message: 'Cửa sổ Zalo đã mở sẵn trên màn hình của bạn!' };
                    }
                }
            } catch (e) {
                this.browserInstance = null;
            }
        }

        // 2. Thử tái kết nối tới cửa sổ Chrome đã mở sẵn trong Windows (tránh lỗi khóa profile)
        const reconnected = await this.tryReconnectExisting();
        if (reconnected && this.browserInstance) {
            try {
                const pages = await this.browserInstance.pages();
                if (pages.length > 0) {
                    await pages[0].bringToFront();
                    return { success: true, message: 'Đã kết nối lại cửa sổ Zalo đang mở!' };
                }
            } catch (e) {
                this.browserInstance = null;
            }
        }

        // 3. Nếu không kết nối lại được, dọn dẹp các tiến trình Chrome mồ côi đang khóa profile zalo_session
        await this.killOrphanProcesses();

        console.log(`[ZALO MANAGER] Mở cửa sổ trình duyệt Zalo Login với profile: ${this.sessionDir}`);

        const launchOptions = {
            executablePath: browserPath,
            headless: false, // Mở cửa sổ thật để quét QR
            userDataDir: this.sessionDir,
            defaultViewport: null,
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-blink-features=AutomationControlled',
                '--start-maximized'
            ]
        };

        try {
            this.browserInstance = await puppeteer.launch(launchOptions);
        } catch (firstLaunchErr) {
            console.warn(`[ZALO MANAGER] Lần mở Chrome đầu tiên gặp lỗi: ${firstLaunchErr.message}. Đang dọn dẹp và thử lại lần 2...`);
            await this.killOrphanProcesses();
            await new Promise(r => setTimeout(r, 1200));
            this.browserInstance = await puppeteer.launch(launchOptions);
            console.log(`[ZALO MANAGER] ✅ Đã mở Chrome thành công ở lần thử thứ 2.`);
        }

        this._setupBrowserEvents();

        const pages = await this.browserInstance.pages();
        const page = pages.length > 0 ? pages[0] : await this.browserInstance.newPage();

        // Ẩn navigator.webdriver để tránh bị Zalo anti-bot nhận diện
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, 'webdriver', {
                get: () => undefined
            });
        });

        await page.goto('https://chat.zalo.me', { waitUntil: 'domcontentloaded' });

        // Tự động kiểm tra và bấm "Kích hoạt" sau khi tải trang
        setTimeout(() => this.handleActivatePopup(page), 2500);

        return {
            success: true,
            message: 'Đã mở cửa sổ Zalo Web. Vui lòng quét mã QR trên màn hình để kết nối!'
        };
    }

    /**
     * Thử kết nối lại với tiến trình Chrome đang chạy sẵn nếu có DevToolsActivePort
     */
    async tryReconnectExisting() {
        const portFile = path.join(this.sessionDir, 'DevToolsActivePort');
        if (!fs.existsSync(portFile)) return false;

        try {
            const portContent = fs.readFileSync(portFile, 'utf8').split('\n');
            const port = portContent[0]?.trim();
            const pathPrefix = portContent[1]?.trim() || '';
            if (!port) return false;

            const wsUrl = `ws://127.0.0.1:${port}${pathPrefix}`;
            console.log(`[ZALO MANAGER] 🔄 Phát hiện cổng DevTools (${port}). Đang thử kết nối lại Chrome...`);

            const browser = await puppeteer.connect({
                browserWSEndpoint: wsUrl,
                defaultViewport: null
            });

            if (browser && browser.isConnected()) {
                const pages = await browser.pages();
                if (pages && pages.length > 0) {
                    this.browserInstance = browser;
                    this._setupBrowserEvents();
                    console.log(`[ZALO MANAGER] ✅ Đã kết nối lại thành công với Chrome đang chạy (Port: ${port})`);
                    return true;
                }
            }
        } catch (err) {
            console.warn(`[ZALO MANAGER] Không thể kết nối lại Chrome cũ: ${err.message}`);
            try {
                if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
            } catch (e) {}
        }
        return false;
    }

    /**
     * Dọn dẹp triệt để các tiến trình Chrome mồ côi giữ profile khi không thể kết nối
     */
    async killOrphanProcesses() {
        console.log('[ZALO MANAGER] 🧹 Dọn dẹp tiến trình Chrome mồ côi giữ profile...');
        try {
            const { execSync } = require('child_process');
            if (process.platform === 'win32') {
                const psCmd = `Get-CimInstance Win32_Process | Where-Object { ($_.Name -eq 'chrome.exe' -or $_.Name -eq 'msedge.exe') -and $_.CommandLine -like '*zalo_session*' } | Select-Object -ExpandProperty ProcessId`;
                const out = execSync(`powershell -NoProfile -Command "${psCmd}"`, { encoding: 'utf8', timeout: 5000 });
                const pids = out.split(/\r?\n/).map(s => s.trim()).filter(s => /^\d+$/.test(s));
                for (const pid of pids) {
                    try {
                        process.kill(parseInt(pid, 10), 'SIGKILL');
                    } catch (e) {
                        try { execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore' }); } catch (e2) {}
                    }
                }
            } else {
                // macOS / Linux Unix process killing
                try {
                    execSync('pkill -f "zalo_session"', { stdio: 'ignore' });
                } catch (e) {}
            }
        } catch (e) {}

        // Đợi 600ms cho Windows giải phóng hoàn toàn file lock
        await new Promise(r => setTimeout(r, 600));

        // Dọn dẹp lock files cũ để tránh lỗi SingletonLock / LevelDB / IndexedDB
        const defaultDir = path.join(this.sessionDir, 'Default');
        const lockFiles = [
            path.join(this.sessionDir, 'SingletonLock'),
            path.join(this.sessionDir, 'SingletonCookie'),
            path.join(this.sessionDir, 'SingletonSocket'),
            path.join(this.sessionDir, 'LOCK'),
            path.join(this.sessionDir, 'DevToolsActivePort'),
            path.join(defaultDir, 'LOCK'),
            path.join(defaultDir, 'Local Storage', 'leveldb', 'LOCK'),
            path.join(defaultDir, 'IndexedDB', 'https_chat.zalo.me_0.indexeddb.leveldb', 'LOCK')
        ];
        for (const lf of lockFiles) {
            if (fs.existsSync(lf)) {
                try { fs.unlinkSync(lf); } catch (e) {}
            }
        }
    }

    /**
     * Cài đặt các trình lắng nghe sự kiện của Browser
     */
    _setupBrowserEvents() {
        if (!this.browserInstance) return;

        this.browserInstance.on('disconnected', () => {
            if (this._activateInterval) {
                clearInterval(this._activateInterval);
                this._activateInterval = null;
            }
            this.browserInstance = null;
            this._stuckCount = 0;
            console.log('[ZALO MANAGER] Cửa sổ Zalo đã được đóng hoặc ngắt kết nối.');
        });

        this.browserInstance.pages().then(pages => {
            if (pages && pages.length > 0) {
                const page = pages[0];
                this._stuckCount = 0;
                if (this._activateInterval) clearInterval(this._activateInterval);
                this._activateInterval = setInterval(async () => {
                    await this.handleActivatePopup(page);
                    await this.handleStuckLogin(page);
                }, 3000);
            }
        }).catch(() => {});
    }

    /**
     * Tự động kiểm tra và click nút "Kích hoạt" khi Zalo hiện popup cảnh báo mở nhiều tab hoặc idle
     */
    async handleActivatePopup(page) {
        if (!page || page.isClosed()) return false;
        try {
            const activated = await page.evaluate(() => {
                const candidates = document.querySelectorAll('button, [role="button"], div[class*="btn"], span');
                for (const el of candidates) {
                    const txt = (el.textContent || '').trim();
                    if (txt === 'Kích hoạt') {
                        el.click();
                        return true;
                    }
                }
                return false;
            });
            if (activated) {
                console.log('[ZALO MANAGER] 🔄 Đã tự động nhấn nút "Kích hoạt" khôi phục phiên Zalo.');
            }
            return activated;
        } catch (err) {
            return false;
        }
    }

    /**
     * Tự động giải cứu nếu Zalo bị kẹt tại màn hình splash "Đang đăng nhập..."
     */
    async handleStuckLogin(page) {
        if (!page || page.isClosed()) return;
        try {
            const isStuck = await page.evaluate(() => {
                const bodyText = document.body ? document.body.innerText : '';
                // Nếu trang có chữ "Đang đăng nhập..." và chưa xuất hiện khung chat hay khung quét QR
                const hasChat = !!document.querySelector('.conv-item, #chatViewContainer, .nav__tabs__top, #conversationListId');
                const hasQr = !!document.querySelector('.qrcode, .login-wrap, .login-v2, .content-login');
                return bodyText.includes('Đang đăng nhập') && !hasChat && !hasQr;
            });

            if (isStuck) {
                this._stuckCount = (this._stuckCount || 0) + 1;
                // Nếu bị kẹt quá 4 lần quét liên tiếp (~12 giây)
                if (this._stuckCount >= 4) {
                    console.warn('[ZALO MANAGER] ⚠ Phát hiện Zalo Web bị kẹt tại "Đang đăng nhập...". Tự động dọn dẹp cache lỗi và khôi phục màn hình đăng nhập QR...');
                    this._stuckCount = 0;
                    await page.evaluate(async () => {
                        try { localStorage.clear(); } catch (e) {}
                        try { sessionStorage.clear(); } catch (e) {}
                    });
                    await page.goto('https://chat.zalo.me', { waitUntil: 'domcontentloaded' });
                }
            } else {
                this._stuckCount = 0;
            }
        } catch (err) {}
    }

    /**
     * Kích hoạt và đưa cửa sổ Zalo lên phía trước màn hình để người dùng theo dõi trực quan
     */
    async bringToForeground(page) {
        if (!page || page.isClosed()) return;
        try {
            await page.bringToFront();
            const session = await page.target().createCDPSession();
            await session.send('Page.bringToFront');
        } catch (e) {}

        try {
            const { exec } = require('child_process');
            const script = `
$wshell = New-Object -ComObject WScript.Shell
$proc = Get-CimInstance Win32_Process -Filter "Name = 'chrome.exe'" | Where-Object { $_.CommandLine -like "*zalo_session*" } | Select-Object -First 1
if ($proc) {
    $wshell.AppActivate($proc.ProcessId)
} else {
    $wshell.AppActivate('Zalo')
}
`;
            const b64 = Buffer.from(script, 'utf16le').toString('base64');
            exec(`powershell -NoProfile -EncodedCommand ${b64}`, () => {});
        } catch (e) {}
    }

    /**
     * Thiết lập chế độ hiển thị cửa sổ Zalo:
     * - showBrowser = true: Cửa sổ bình thường (normal) và mang lên phía trước màn hình để theo dõi
     * - showBrowser = false: Cửa sổ thu nhỏ ngầm (minimized) dưới Taskbar để không che màn hình
     */
    async setWindowDisplayMode(page, showBrowser = false) {
        if (!page || page.isClosed()) return;
        try {
            const session = await page.target().createCDPSession();
            const { windowId } = await session.send('Browser.getWindowForTarget');
            if (windowId) {
                await session.send('Browser.setWindowBounds', {
                    windowId,
                    bounds: { windowState: showBrowser ? 'maximized' : 'minimized' }
                });
            }
            if (showBrowser) {
                await this.bringToForeground(page);
            }
        } catch (err) {
            if (showBrowser) {
                await this.bringToForeground(page);
            }
        }
    }

    /**
     * Tắt / đóng trình duyệt Zalo
     */
    async closeBrowser() {
        if (this._activateInterval) {
            clearInterval(this._activateInterval);
            this._activateInterval = null;
        }
        if (this.browserInstance) {
            try {
                if (this.browserInstance.isConnected()) {
                    await this.browserInstance.close();
                }
            } catch (e) {}
            this.browserInstance = null;
            console.log('[ZALO MANAGER] 🛑 Đã tắt trình duyệt Zalo.');
        }
    }

    /**
     * Kiểm tra trạng thái session Zalo
     */
    getSessionStatus() {
        const hasSession = fs.existsSync(this.sessionDir) && fs.readdirSync(this.sessionDir).length > 0;
        const isRunning = this.browserInstance !== null && this.browserInstance.isConnected();
        return {
            hasSession,
            isRunning,
            sessionDir: this.sessionDir
        };
    }

    /**
     * Quét các tin nhắn hiện có trong khung chat Zalo
     * Tự động khởi chạy trình duyệt nếu chưa mở và tự tìm/chọn nhóm Zalo tương ứng
     * @param {string} groupName - Tên nhóm cần quét (vd: "Vùng 31", "SỨ GIẢ VÙNG 31")
     * @param {Object} [options]
     * @param {boolean} [options.autoOpen=true] - Tự động mở Zalo nếu chưa chạy
     * @param {boolean} [options.showBrowser=true] - Mở hiển thị trình duyệt hay chạy ngầm
     * @param {number} [options.maxWaitMs=15000] - Thời gian tối đa chờ trang Zalo tải
     */
    async scanMessagesFromCurrentChat(groupName = '', options = {}) {
        const autoOpen = options.autoOpen !== false;
        const showBrowser = options.showBrowser === true;
        const maxWaitMs = options.maxWaitMs || 15000;

        // 1. Tự động khởi chạy trình duyệt nếu chưa mở
        if (!this.browserInstance || !this.browserInstance.isConnected()) {
            if (!autoOpen) {
                return { connected: false, messagesScraped: 0, reason: 'Trình duyệt Zalo chưa được mở.' };
            }
            console.log('[ZALO MANAGER] 🚀 Trình duyệt Zalo chưa mở. Đang tự động mở cửa sổ Zalo...');
            try {
                await this.openLoginWindow();
            } catch (openErr) {
                return { connected: false, messagesScraped: 0, reason: 'Không thể mở Zalo: ' + openErr.message };
            }
        }

        const pages = await this.browserInstance.pages();
        if (!pages || pages.length === 0) {
            return { connected: false, messagesScraped: 0, reason: 'Không tìm thấy tab Zalo Web.' };
        }

        const page = pages[0];
        try {
            // Thiết lập chế độ hiển thị: Hiện cửa sổ hoặc thu nhỏ chạy ngầm
            await this.setWindowDisplayMode(page, showBrowser);

            // 2. Chờ Zalo sẵn sàng hoặc phát hiện màn hình đăng nhập QR
            let isChatReady = false;
            let needsQr = false;
            const waitStart = Date.now();

            while (Date.now() - waitStart < maxWaitMs) {
                await this.handleActivatePopup(page);

                const check = await page.evaluate(() => {
                    const chatReady = !!(document.querySelector('.chat-message-list') || 
                                         document.querySelector('#chat-box-message-list') || 
                                         document.querySelector('.conv-item') ||
                                         document.querySelector('#chatViewContainer') ||
                                         document.querySelector('#conversationListId'));
                    const qrReady = !!(document.querySelector('.qrcode, .login-wrap, .login-v2, .content-login, .login-body'));
                    return { chatReady, qrReady };
                });

                if (check.chatReady) {
                    isChatReady = true;
                    break;
                }
                if (check.qrReady) {
                    needsQr = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 1000));
            }

            if (!isChatReady) {
                if (needsQr) {
                    return {
                        connected: false,
                        needsLogin: true,
                        messagesScraped: 0,
                        reason: 'Cửa sổ Zalo đã được mở trên màn hình nhưng chưa đăng nhập. Vui lòng dùng ứng dụng Zalo trên điện thoại quét mã QR để đăng nhập!'
                    };
                }
                return {
                    connected: false,
                    messagesScraped: 0,
                    reason: 'Zalo đang tải hoặc chưa sẵn sàng. Vui lòng kiểm tra cửa sổ Zalo trên màn hình máy tính.'
                };
            }

            // 3. Tự động tìm và mở nhóm Zalo nếu có chỉ định groupName
            let actualGroupName = groupName;
            if (groupName) {
                const normTarget = groupName.toLowerCase().trim();

                // Kiểm tra xem tiêu đề chat hiện tại có phải nhóm này không
                const currentHeader = await page.evaluate(() => {
                    const el = document.querySelector('.header-title, .chat-title, #chatViewTitle, .chat-header');
                    return el ? el.textContent.trim() : '';
                });

                const isAlreadyInGroup = currentHeader && currentHeader.toLowerCase().includes(normTarget);

                if (!isAlreadyInGroup) {
                    // Thử bấm vào item trong danh sách hội thoại nếu có sẵn
                    let clicked = await page.evaluate((target) => {
                        const convItems = document.querySelectorAll('.conv-item, .conv-item-title, .conv-item__name, div[id^="conv-item"]');
                        for (const item of convItems) {
                            const txt = (item.textContent || '').trim().toLowerCase();
                            if (txt.includes(target)) {
                                item.click();
                                return true;
                            }
                        }
                        return false;
                    }, normTarget);

                    // Nếu chưa thấy, dùng ô tìm kiếm của Zalo
                    if (!clicked) {
                        try {
                            const searchSelectors = [
                                '#contact-search-input',
                                'input[placeholder*="Tìm kiếm"]',
                                'input[data-translate-placeholder="STR_SEARCH"]'
                            ];
                            let searchInput = null;
                            for (const sel of searchSelectors) {
                                searchInput = await page.$(sel);
                                if (searchInput) break;
                            }

                            if (searchInput) {
                                await searchInput.click();
                                await page.evaluate((keyword) => {
                                    const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                                    if (inp) {
                                        inp.focus();
                                        inp.select();
                                        try {
                                            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                                            if (nativeSetter) nativeSetter.call(inp, keyword);
                                            else inp.value = keyword;
                                        } catch (e) {
                                            inp.value = keyword;
                                        }
                                        try {
                                            document.execCommand('selectAll', false, null);
                                            document.execCommand('insertText', false, keyword);
                                        } catch (e) {}
                                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                                    }
                                }, groupName);

                                const curVal = await page.evaluate(() => {
                                    const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                                    return inp ? inp.value : '';
                                });

                                if (curVal !== groupName) {
                                    try {
                                        const client = await page.target().createCDPSession();
                                        await client.send('Input.insertText', { text: groupName });
                                        await client.detach();
                                        await page.evaluate(() => {
                                            const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                                            if (inp) {
                                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                                                inp.dispatchEvent(new Event('change', { bubbles: true }));
                                            }
                                        });
                                    } catch (e) {}
                                }
                                await new Promise(r => setTimeout(r, 1500));

                                clicked = await page.evaluate((target) => {
                                    const results = document.querySelectorAll('.search-list-item, .conv-item, .global-search-item, [class*="search-result"]');
                                    for (const r of results) {
                                        const txt = (r.textContent || '').trim().toLowerCase();
                                        if (txt.includes(target)) {
                                            r.click();
                                            return true;
                                        }
                                    }
                                    if (results.length > 0) {
                                        results[0].click();
                                        return true;
                                    }
                                    return false;
                                }, normTarget);
                            }
                        } catch (sErr) {
                            console.warn('[ZALO MANAGER] Lỗi khi tìm kiếm nhóm:', sErr.message);
                        }
                    }

                    // Chờ khung chat tải dữ liệu
                    await new Promise(r => setTimeout(r, 2500));
                }

                // Lấy tiêu đề nhóm thực tế sau khi click
                actualGroupName = await page.evaluate(() => {
                    const el = document.querySelector('.header-title, .chat-title, #chatViewTitle, .chat-header');
                    return el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
                }) || groupName;
            }

            // 4. Trích xuất danh sách tin nhắn và hình ảnh trong khung chat với cơ chế cuộn ngược (Scroll Up)
            const targetDate = options.targetDate || options.workDate || new Date().toLocaleDateString('sv');
            const todayStr = new Date().toLocaleDateString('sv');
            const isTargetToday = targetDate === todayStr;
            const MAX_SCROLL_PASSES = options.maxScrollPasses || (isTargetToday ? 10 : 16);

            console.log(`[ZALO MANAGER] 📜 Đang mở nhóm "${actualGroupName}". Bắt đầu cuộn ngược để thu thập tin nhắn cho ngày ${targetDate} (Hôm nay: ${todayStr})...`);

            // Nếu bật mở trình duyệt, đảm bảo cửa sổ Zalo nổi lên trên để người dùng quan sát trực quan
            if (showBrowser) {
                await this.bringToForeground(page);
            }

            const allMessagesMap = new Map();

            for (let pass = 0; pass < MAX_SCROLL_PASSES; pass++) {
                const batch = await page.evaluate((args) => {
                    const { targetDate, todayStr, nowMs } = args;
                    const list = [];
                    const chatRoot = document.querySelector('#chatViewContainer') || document.querySelector('[id*="chatView"]') || document.body;

                    function parseDividerTextToYmd(text, refMs) {
                        if (!text) return null;
                        const t = text.trim().toLowerCase();
                        const now = new Date(refMs);
                        const pad = (n) => String(n).padStart(2, '0');
                        const toYmd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

                        if (t.includes('hôm nay') || t.includes('today')) {
                            return toYmd(now);
                        }
                        if (t.includes('hôm qua') || t.includes('yesterday')) {
                            const y = new Date(now);
                            y.setDate(y.getDate() - 1);
                            return toYmd(y);
                        }
                        if (t.includes('hôm kia')) {
                            const k = new Date(now);
                            k.setDate(k.getDate() - 2);
                            return toYmd(k);
                        }

                        const slashMatch = t.match(/(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
                        if (slashMatch) {
                            const day = parseInt(slashMatch[1], 10);
                            const month = parseInt(slashMatch[2], 10);
                            let year = slashMatch[3] ? parseInt(slashMatch[3], 10) : now.getFullYear();
                            if (year < 100) year += 2000;
                            if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
                                return `${year}-${pad(month)}-${pad(day)}`;
                            }
                        }

                        const monthMatch = t.match(/(\d{1,2})\s+tháng\s+(\d{1,2})(?:[,\s]+(\d{4}))?/);
                        if (monthMatch) {
                            const day = parseInt(monthMatch[1], 10);
                            const month = parseInt(monthMatch[2], 10);
                            const year = monthMatch[3] ? parseInt(monthMatch[3], 10) : now.getFullYear();
                            if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
                                return `${year}-${pad(month)}-${pad(day)}`;
                            }
                        }

                        return null;
                    }

                    const msgNodes = chatRoot.querySelectorAll('.chat-item, .msg-item, [class*="chat-item"], [class*="msg-item"], .message-view, .chat-message, .chat-date, .msg-date, [class*="date-divider"], [class*="chat-date"], .header-date');
                    let currentSender = '';
                    let currentDividerDate = null;
                    let hitBeforeTargetDate = false;

                    msgNodes.forEach(node => {
                        // Kiểm tra vạch ngăn cách ngày (Date Divider)
                        const dateDivider = (node.classList && (node.classList.contains('chat-date') || node.classList.contains('msg-date') || (node.className && typeof node.className === 'string' && node.className.includes('date-divider'))))
                            ? node
                            : node.querySelector('.chat-date, .msg-date, [class*="date-divider"], [class*="chat-date"], .header-date');
                        const dividerText = (dateDivider ? dateDivider.textContent : '').trim();
                        if (dividerText) {
                            const parsedDate = parseDividerTextToYmd(dividerText, nowMs);
                            if (parsedDate) {
                                currentDividerDate = parsedDate;
                                if (parsedDate < targetDate) {
                                    hitBeforeTargetDate = true;
                                }
                            }
                        }

                        let rawSender = '';
                        const innerSender = node.querySelector('.sender-name, .message-sender-name-content');
                        if (innerSender) {
                            rawSender = (innerSender.textContent || '').trim();
                        } else {
                            const containerSender = node.querySelector('.card-sender-name, .message-sender-name-bubble');
                            if (containerSender) {
                                const clone = containerSender.cloneNode(true);
                                clone.querySelectorAll('.rel-name, .sub-name, [class*="rel-name"]').forEach(el => el.remove());
                                rawSender = (clone.textContent || '').trim();
                            } else {
                                const relEl = node.querySelector('div.rel-name');
                                if (relEl) rawSender = (relEl.textContent || '').trim();
                            }
                        }

                        if (rawSender) {
                            let cleanSender = rawSender.replace(/\/-[a-z0-9\:\(\)]+/gi, '').replace(/\s+/g, ' ').trim();
                            const vnUpper = 'A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ';
                            const vnLower = 'a-zàáảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ';
                            const match = cleanSender.match(new RegExp('^(.+?[' + vnLower + '0-9])([' + vnUpper + '][' + vnLower + ']+(?:\\s+[' + vnUpper + '][' + vnLower + ']+){1,3})$'));
                            if (match && match[1].trim().length >= 2 && match[2].trim().length >= 4) {
                                cleanSender = match[1].trim();
                            }

                            if (cleanSender && cleanSender.length <= 35 && !cleanSender.includes('\n') && !cleanSender.toLowerCase().includes('báo cáo')) {
                                currentSender = cleanSender;
                            }
                        }

                        const textEl = node.querySelector('.message-text, [class*="content-text"], .bubble-text, span.text, .text-quote');
                        const photoEl = node.querySelector('img.img-msg, [class*="photo"], [class*="thumb"], img:not([class*="avatar"])');
                        const timeEl = node.querySelector('.time, .message-time, [class*="time"], [class*="msg-time"]');
                        const timeText = timeEl ? timeEl.textContent.trim() : '';

                        const text = textEl ? textEl.textContent.trim() : (photoEl ? '[Ảnh]' : '');
                        const hasImage = !!photoEl;

                        if (text || hasImage) {
                            const rawId = node.getAttribute('data-id') || node.getAttribute('data-mid') || node.id || '';
                            const key = rawId ? rawId : `${currentSender}::${timeText}::${text.substring(0, 40)}::${hasImage ? '1' : '0'}`;
                            list.push({
                                uniqueKey: key,
                                sender: currentSender || 'Unknown',
                                text,
                                hasImage,
                                timeText,
                                messageDate: currentDividerDate,
                                isBeforeTarget: hitBeforeTargetDate,
                                timestamp: Date.now()
                            });
                        }
                    });

                    // Tìm container cuộn bên trong chatRoot (khung chat bên phải)
                    let container = null;
                    const divs = Array.from(chatRoot.querySelectorAll('div'));
                    for (const d of divs) {
                        const s = window.getComputedStyle(d);
                        if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && d.scrollHeight > d.clientHeight && d.clientHeight > 150) {
                            container = d;
                            break;
                        }
                    }

                    let atTop = false;
                    let prevScrollTop = 0;
                    let newScrollTop = 0;
                    if (container) {
                        prevScrollTop = container.scrollTop;
                        // Cuộn ngược lên trên (Scroll Up)
                        container.scrollTop = Math.max(0, container.scrollTop - 600);
                        container.dispatchEvent(new Event('scroll', { bubbles: true }));
                        newScrollTop = container.scrollTop;
                        atTop = container.scrollTop <= 10;
                    }

                    return {
                        messages: list,
                        hitBeforeTargetDate,
                        atTop,
                        prevScrollTop,
                        newScrollTop,
                        containerFound: !!container
                    };
                }, { targetDate, todayStr, nowMs: Date.now() });

                // Nạp các tin nhắn vào map tổng hợp và cập nhật messageDate
                for (const m of batch.messages) {
                    const existing = allMessagesMap.get(m.uniqueKey);
                    if (existing) {
                        if (!existing.messageDate && m.messageDate) {
                            existing.messageDate = m.messageDate;
                        }
                    } else {
                        allMessagesMap.set(m.uniqueKey, m);
                    }
                }

                // Di chuyển chuột đến giữa khung chat và cuộn bánh xe chuột để kích hoạt virtual scroll của Zalo
                try {
                    const chatBox = await page.evaluate(() => {
                        const cr = document.querySelector('#chatViewContainer') || document.body;
                        const r = cr.getBoundingClientRect();
                        return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
                    });
                    await page.mouse.move(chatBox.x, chatBox.y);
                    await page.mouse.wheel({ deltaY: -600 });
                } catch (e) {}

                // Chờ một chút để người dùng nhìn thấy cuộn và Zalo kịp tải thêm tin nhắn
                await new Promise(r => setTimeout(r, 900));

                if (batch.hitBeforeTargetDate && !options.ignoreDateLimit) {
                    console.log(`[ZALO MANAGER] 📅 Đã cuộn tới mốc thời gian trước ngày ${targetDate} ở lượt cuộn ${pass + 1}. Đã gom đủ tin nhắn.`);
                    break;
                }

                // Nếu đã ở đỉnh và không đổi vị trí scroll qua 2 lượt
                const isStuckAtTop = batch.atTop && batch.prevScrollTop <= 10;
                if (isStuckAtTop && pass >= 5) {
                    console.log(`[ZALO MANAGER] 🔝 Đã cuộn tới đỉnh lịch sử chat ở lượt ${pass + 1}.`);
                    break;
                }
            }

            // Cuộn mượt lại về cuối khung chat để hiển thị các tin mới nhất và ô soạn thảo
            await page.evaluate(() => {
                const chatRoot = document.querySelector('#chatViewContainer') || document.body;
                const divs = Array.from(chatRoot.querySelectorAll('div'));
                for (const d of divs) {
                    const s = window.getComputedStyle(d);
                    if ((s.overflowY === 'auto' || s.overflowY === 'scroll') && d.scrollHeight > d.clientHeight && d.clientHeight > 150) {
                        d.scrollTo({ top: d.scrollHeight, behavior: 'smooth' });
                        return;
                    }
                }
            });
            await new Promise(r => setTimeout(r, 600));

            const { extractDatesFromText } = require('./message_parser');
            const messages = Array.from(allMessagesMap.values()).map(m => {
                if (!m.messageDate) {
                    const dates = extractDatesFromText(m.text, targetDate);
                    if (dates.length > 0) {
                        m.messageDate = dates[0];
                    } else if (isTargetToday && !m.isBeforeTarget) {
                        m.messageDate = todayStr;
                    }
                }
                return m;
            });
            console.log(`[ZALO MANAGER] ✅ Đã quét thành công ${messages.length} tin nhắn từ nhóm "${actualGroupName}" (sau khi cuộn dòng thời gian cho ngày ${targetDate})!`);

            return {
                connected: true,
                isChatReady: true,
                groupName: actualGroupName,
                messagesScraped: messages.length,
                messages
            };
        } catch (err) {
            console.error('[ZALO MANAGER] Lỗi khi quét tin nhắn Zalo:', err);
            return { connected: true, messagesScraped: 0, error: err.message };
        }
    }

    /**
     * Mở danh sách thành viên của nhóm Zalo và trích xuất 100% tất cả thành viên trong nhóm
     * @param {string} groupName - Tên nhóm Zalo cần lấy thành viên (vd: "Vùng 31", "SỨ GIẢ VÙNG 31")
     * @param {Object} [options]
     * @returns {Promise<{success: boolean, members: Array<{name: string, role: string}>, count: number, error?: string}>}
     */
    async getGroupMembers(groupName = '', options = {}) {
        const autoOpen = options.autoOpen !== false;
        const showBrowser = options.showBrowser === true;
        const maxWaitMs = options.maxWaitMs || 15000;

        if (!this.browserInstance || !this.browserInstance.isConnected()) {
            if (!autoOpen) {
                return { success: false, members: [], count: 0, reason: 'Trình duyệt Zalo chưa được mở.' };
            }
            try {
                await this.openLoginWindow();
            } catch (openErr) {
                return { success: false, members: [], count: 0, reason: 'Không thể mở Zalo: ' + openErr.message };
            }
        }

        const pages = await this.browserInstance.pages();
        if (!pages || pages.length === 0) {
            return { success: false, members: [], count: 0, reason: 'Không tìm thấy tab Zalo Web.' };
        }

        const page = pages[0];
        try {
            await this.setWindowDisplayMode(page, showBrowser);

            // 1. Chờ Zalo sẵn sàng
            let isChatReady = false;
            let needsQr = false;
            const waitStart = Date.now();

            while (Date.now() - waitStart < maxWaitMs) {
                await this.handleActivatePopup(page);
                const check = await page.evaluate(() => {
                    const chatReady = !!(document.querySelector('.chat-message-list') || 
                                         document.querySelector('#chat-box-message-list') || 
                                         document.querySelector('.conv-item') ||
                                         document.querySelector('#chatViewContainer') ||
                                         document.querySelector('#conversationListId'));
                    const qrReady = !!(document.querySelector('.qrcode, .login-wrap, .login-v2, .content-login, .login-body'));
                    return { chatReady, qrReady };
                });
                if (check.chatReady) { isChatReady = true; break; }
                if (check.qrReady) { needsQr = true; break; }
                await new Promise(r => setTimeout(r, 1000));
            }

            if (!isChatReady) {
                return {
                    success: false,
                    needsLogin: needsQr,
                    members: [],
                    count: 0,
                    reason: needsQr ? 'Zalo chưa đăng nhập. Vui lòng quét mã QR!' : 'Zalo chưa sẵn sàng.'
                };
            }

            // 2. Tự động điều hướng đến nhóm nếu có groupName
            let actualGroupName = groupName;
            if (groupName) {
                const normTarget = groupName.toLowerCase().trim();
                const currentHeader = await page.evaluate(() => {
                    const el = document.querySelector('.header-title, .chat-title, #chatViewTitle, .chat-header');
                    return el ? el.textContent.trim() : '';
                });

                const isAlreadyInGroup = currentHeader && currentHeader.toLowerCase().includes(normTarget);

                if (!isAlreadyInGroup) {
                    let clicked = await page.evaluate((target) => {
                        const convItems = document.querySelectorAll('.conv-item, .conv-item-title, .conv-item__name, div[id^="conv-item"]');
                        for (const item of convItems) {
                            const txt = (item.textContent || '').trim().toLowerCase();
                            if (txt.includes(target)) {
                                item.click();
                                return true;
                            }
                        }
                        return false;
                    }, normTarget);

                    if (!clicked) {
                        try {
                            const searchSelectors = [
                                '#contact-search-input',
                                'input[placeholder*="Tìm kiếm"]',
                                'input[data-translate-placeholder="STR_SEARCH"]'
                            ];
                            let searchInput = null;
                            for (const sel of searchSelectors) {
                                searchInput = await page.$(sel);
                                if (searchInput) break;
                            }
                            if (searchInput) {
                                await searchInput.click();
                                await page.evaluate((keyword) => {
                                    const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                                    if (inp) {
                                        inp.focus();
                                        inp.select();
                                        try {
                                            const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                                            if (nativeSetter) nativeSetter.call(inp, keyword);
                                            else inp.value = keyword;
                                        } catch (e) {
                                            inp.value = keyword;
                                        }
                                        try {
                                            document.execCommand('selectAll', false, null);
                                            document.execCommand('insertText', false, keyword);
                                        } catch (e) {}
                                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                                    }
                                }, groupName);

                                const curVal = await page.evaluate(() => {
                                    const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                                    return inp ? inp.value : '';
                                });

                                if (curVal !== groupName) {
                                    try {
                                        const client = await page.target().createCDPSession();
                                        await client.send('Input.insertText', { text: groupName });
                                        await client.detach();
                                        await page.evaluate(() => {
                                            const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                                            if (inp) {
                                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                                                inp.dispatchEvent(new Event('change', { bubbles: true }));
                                            }
                                        });
                                    } catch (e) {}
                                }
                                await new Promise(r => setTimeout(r, 1500));

                                await page.evaluate((target) => {
                                    const results = document.querySelectorAll('.search-list-item, .conv-item, .global-search-item, [class*="search-result"]');
                                    for (const r of results) {
                                        const txt = (r.textContent || '').trim().toLowerCase();
                                        if (txt.includes(target)) {
                                            r.click();
                                            return true;
                                        }
                                    }
                                    if (results.length > 0) {
                                        results[0].click();
                                        return true;
                                    }
                                    return false;
                                }, normTarget);
                            }
                        } catch (sErr) {}
                    }
                    await new Promise(r => setTimeout(r, 2000));
                }

                actualGroupName = await page.evaluate(() => {
                    const el = document.querySelector('.header-title, .chat-title, #chatViewTitle, .chat-header');
                    return el ? el.textContent.trim().replace(/\s+/g, ' ') : '';
                }) || groupName;
            }

            console.log(`[ZALO MANAGER] 👥 Đang mở Danh sách thành viên nhóm "${actualGroupName}"...`);

            // 3. Mở panel Danh sách thành viên nếu chưa mở
            let isBoxOpen = await page.evaluate(() => {
                const box = document.querySelector('.chat-box-member');
                return !!(box && box.offsetWidth > 0);
            });

            if (!isBoxOpen) {
                await page.evaluate(() => {
                    const btn = document.querySelector('.subtitle__groupmember__content, [class*="groupmember"]');
                    if (btn) btn.click();
                });
                await new Promise(r => setTimeout(r, 1200));
            }

            // 4. Trích xuất và cuộn ảo hóa (ReactVirtualized)
            const membersMap = new Map();

            const extractCurrent = async () => {
                const items = await page.evaluate(() => {
                    const list = [];
                    document.querySelectorAll('[data-id="div_MemList_MemItem"]').forEach(el => {
                        const title = el.getAttribute('title') || '';
                        const roleEl = el.querySelector('.chat-box-member__info__sub-title');
                        const role = roleEl ? roleEl.textContent.trim() : '';
                        const nameEl = el.querySelector('.chat-box-member__info__name');
                        let name = title.trim();
                        if (!name && nameEl) {
                            name = nameEl.innerText.replace(role, '').trim();
                        }
                        name = name.replace(/\u00a0/g, ' ').trim();
                        if (name && name.toLowerCase() !== 'bạn') {
                            list.push({ name, role });
                        }
                    });
                    return list;
                });
                for (const item of items) {
                    if (!membersMap.has(item.name)) {
                        membersMap.set(item.name, item);
                    }
                }
            };

            await extractCurrent();

            const rect = await page.evaluate(() => {
                const el = document.querySelector('.chat-box-member .virtualized-scroll') || document.querySelector('.chat-box-member');
                if (!el) return null;
                const r = el.getBoundingClientRect();
                return { x: r.x, y: r.y, width: r.width, height: r.height };
            });

            if (rect && rect.width > 0) {
                await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2);
                
                // Cuộn mượt XUỐNG ĐÁY bên trong danh sách thành viên để ReactVirtualized nạp toàn bộ thành viên
                for (let i = 0; i < 20; i++) {
                    await page.mouse.wheel({ deltaY: 300 });
                    await new Promise(r => setTimeout(r, 120));
                    await extractCurrent();
                }
            }

            // Đóng sidebar thành viên lại để trả lại giao diện chat bình thường
            await page.evaluate(() => {
                const backBtn = document.querySelector('.chat-info [icon*="chevron-left"], .chat-info [class*="back"], .chat-info [title*="Trở lại"], .chat-info [title*="Đóng"]');
                if (backBtn) backBtn.click();
            });

            // Thu nhỏ cửa sổ Zalo xuống Taskbar để không che khuất màn hình Dashboard
            try {
                await this.setWindowDisplayMode(page, false);
            } catch (minErr) {}

            const members = Array.from(membersMap.values());
            console.log(`[ZALO MANAGER] 👥 Đã quét thành công ${members.length} thành viên trong nhóm "${actualGroupName}"!`);

            return {
                success: true,
                groupName: actualGroupName,
                count: members.length,
                members
            };
        } catch (err) {
            console.error('[ZALO MANAGER] Lỗi khi lấy danh sách thành viên nhóm:', err);
            return { success: false, members: [], count: 0, error: err.message };
        }
    }

    /**
     * Soạn thảo tin nhắn vào khung chat Zalo nhưng TUYỆT ĐỐI KHÔNG BẤM GỬI
     * @param {string} groupName - Tên nhóm cần soạn tin
     * @param {string} messageText - Nội dung tin nhắn cần đưa vào khung chat
     */
    async draftMessageToChat(groupName = '', messageText = '', screenshotPath = null, options = {}) {
        const showBrowser = options.showBrowser === true;
        if (!this.browserInstance || !this.browserInstance.isConnected()) {
            await this.openLoginWindow();
        }

        const pages = await this.browserInstance.pages();
        if (!pages || pages.length === 0) {
            return { success: false, error: 'Không tìm thấy tab Zalo Web.' };
        }
        const page = pages[0];

        try {
            await this.setWindowDisplayMode(page, showBrowser);

            // 1. Chờ Zalo tải xong và sẵn sàng hoặc phát hiện màn hình đăng nhập QR
            let isChatReady = false;
            let needsQr = false;
            const waitStart = Date.now();
            const maxWaitMs = 25000;

            while (Date.now() - waitStart < maxWaitMs) {
                await this.handleActivatePopup(page);

                const check = await page.evaluate(() => {
                    const chatReady = !!(document.querySelector('.chat-message-list') || 
                                         document.querySelector('#chat-box-message-list') || 
                                         document.querySelector('.conv-item') ||
                                         document.querySelector('#contact-search-input') ||
                                         document.querySelector('#chatViewContainer') ||
                                         document.querySelector('#conversationListId'));
                    const qrReady = !!(document.querySelector('.qrcode, .login-wrap, .login-v2, .content-login, .login-body'));
                    return { chatReady, qrReady };
                });

                if (check.chatReady) {
                    isChatReady = true;
                    break;
                }
                if (check.qrReady) {
                    needsQr = true;
                    break;
                }
                await new Promise(r => setTimeout(r, 1000));
            }

            if (needsQr) {
                if (screenshotPath) {
                    try { await page.screenshot({ path: screenshotPath }); } catch (e) {}
                }
                return {
                    success: false,
                    needsLogin: true,
                    error: 'Cửa sổ Zalo đã mở nhưng chưa đăng nhập. Vui lòng dùng app Zalo quét mã QR trên màn hình!'
                };
            }

            // Đảm bảo mở đúng nhóm nếu có chỉ định groupName
            if (groupName) {
                const normTarget = groupName.toLowerCase().trim();
                const currentHeader = await page.evaluate(() => {
                    const el = document.querySelector('.header-title, .chat-title, #chatViewTitle, .chat-header');
                    return el ? el.textContent.trim() : '';
                });

                if (!currentHeader || !currentHeader.toLowerCase().includes(normTarget)) {
                    // Tìm kiếm nhóm
                    const searchInput = await page.$('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                    if (searchInput) {
                        await searchInput.click();
                        await page.evaluate((keyword) => {
                            const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                            if (inp) {
                                inp.focus();
                                inp.select();
                                try {
                                    const nativeSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
                                    if (nativeSetter) nativeSetter.call(inp, keyword);
                                    else inp.value = keyword;
                                } catch (e) {
                                    inp.value = keyword;
                                }
                                try {
                                    document.execCommand('selectAll', false, null);
                                    document.execCommand('insertText', false, keyword);
                                } catch (e) {}
                                inp.dispatchEvent(new Event('input', { bubbles: true }));
                                inp.dispatchEvent(new Event('change', { bubbles: true }));
                            }
                        }, groupName);

                        const curVal = await page.evaluate(() => {
                            const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                            return inp ? inp.value : '';
                        });

                        if (curVal !== groupName) {
                            try {
                                const client = await page.target().createCDPSession();
                                await client.send('Input.insertText', { text: groupName });
                                await client.detach();
                                await page.evaluate(() => {
                                    const inp = document.querySelector('#contact-search-input, input[placeholder*="Tìm kiếm"]');
                                    if (inp) {
                                        inp.dispatchEvent(new Event('input', { bubbles: true }));
                                        inp.dispatchEvent(new Event('change', { bubbles: true }));
                                    }
                                });
                            } catch (e) {}
                        }
                        await new Promise(r => setTimeout(r, 1500));

                        await page.evaluate((target) => {
                            const results = document.querySelectorAll('.search-list-item, .conv-item, .global-search-item, [class*="search-result"]');
                            for (const r of results) {
                                const txt = (r.textContent || '').trim().toLowerCase();
                                if (txt.includes(target)) {
                                    r.click();
                                    return true;
                                }
                            }
                            if (results.length > 0) {
                                results[0].click();
                                return true;
                            }
                            return false;
                        }, normTarget);
                        await new Promise(r => setTimeout(r, 2000));
                    }
                }
            }

            // Tìm ô soạn thảo tin nhắn
            const drafted = await page.evaluate((text) => {
                const inputEl = document.querySelector('div#richInput, div#chat-input-content, div[contenteditable="true"], .rich-input, #input_line_0');
                if (!inputEl) return false;

                inputEl.focus();
                inputEl.innerHTML = '';
                inputEl.innerText = text;
                inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                inputEl.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            }, messageText);

            let screenshotSaved = false;
            if (screenshotPath) {
                try {
                    await new Promise(r => setTimeout(r, 500));
                    await page.screenshot({ path: screenshotPath });
                    screenshotSaved = true;
                    console.log(`[ZALO MANAGER] 📸 Đã chụp ảnh khung chat Zalo lưu vào: ${screenshotPath}`);
                } catch (scErr) {
                    console.warn('[ZALO MANAGER] Không thể chụp ảnh Zalo:', scErr.message);
                }
            }

            if (drafted) {
                console.log(`[ZALO MANAGER] 📝 Đã soạn thảo báo cáo vào khung chat nhóm "${groupName}" (CHƯA GỬI).`);
                return { 
                    success: true, 
                    message: `Đã soạn thảo báo cáo vào khung chat nhóm "${groupName}" thành công (chưa gửi).`,
                    screenshotSaved,
                    screenshotPath
                };
            } else {
                return { success: false, error: 'Không tìm thấy ô nhập tin nhắn Zalo.' };
            }
        } catch (err) {
            console.error('[ZALO MANAGER] Lỗi khi soạn thảo tin nhắn vào Zalo:', err);
            return { success: false, error: err.message };
        }
    }

    async takeScreenshot(savePath) {
        if (!this.browserInstance || !this.browserInstance.isConnected()) {
            return { success: false, error: 'Trình duyệt Zalo chưa được mở' };
        }
        const pages = await this.browserInstance.pages();
        if (!pages || pages.length === 0) {
            return { success: false, error: 'Không tìm thấy trang Zalo' };
        }
        await pages[0].screenshot({ path: savePath });
        return { success: true, path: savePath };
    }
}

const zaloBrowserManagerInstance = new ZaloBrowserManager();
module.exports = zaloBrowserManagerInstance;
module.exports.zaloBrowserManager = zaloBrowserManagerInstance;
module.exports.ZaloBrowserManager = ZaloBrowserManager;


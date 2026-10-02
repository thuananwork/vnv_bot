const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Hàm tự động phát hiện Google Chrome cài đặt trên máy tính
function getChromePath() {
    const platform = os.platform();
    if (platform === 'win32') {
        const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData\\Local');
        const progFiles = process.env.ProgramFiles || 'C:\\Program Files';
        const progFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';

        const paths = [
            path.join(progFiles, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(progFilesX86, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(localAppData, 'Google\\Chrome\\Application\\chrome.exe'),
            path.join(progFiles, 'Microsoft\\Edge\\Application\\msedge.exe'),
            path.join(progFilesX86, 'Microsoft\\Edge\\Application\\msedge.exe'),
            path.join(localAppData, 'Microsoft\\Edge\\Application\\msedge.exe'),
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
        ];
        for (const p of paths) {
            if (fs.existsSync(p)) return p;
        }
    } else if (platform === 'darwin') {
        const paths = [
            '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
            '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'
        ];
        for (const p of paths) {
            if (fs.existsSync(p)) return p;
        }
    } else if (platform === 'linux') {
        const paths = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
        for (const p of paths) {
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

let page = null;
let browser = null;

async function startPuppeteer() {
    const chromePath = getChromePath();
    if (!chromePath) {
        console.error('[PUPPETEER WORKER] Không tìm thấy Google Chrome.');
        process.exit(1);
    }

    const monitorGroup = process.env.PUPPETEER_MONITOR_GROUP || 'Nhóm Sứ Giả';
    console.log(`[PUPPETEER WORKER] Khởi động giám sát Zalo Web. Nhóm mục tiêu: "${monitorGroup}"`);

    browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: false, // Hiện giao diện để quét mã QR đăng nhập
        defaultViewport: null,
        args: ['--start-maximized'],
        userDataDir: path.join(__dirname, '../../../zalo_session') // Lưu session để duy trì đăng nhập
    });

    const pages = await browser.pages();
    page = pages[0];

    // Tạo hàm callback liên kết trình duyệt -> NodeJS
    await page.exposeFunction('onNewZaloMessage', (msg) => {
        // Đẩy tin nhắn qua IPC về Main Process
        if (process.send) {
            process.send({
                type: 'NEW_MESSAGE',
                data: {
                    zaloMsgId: msg.zaloMsgId,
                    senderId: msg.senderId,
                    senderName: msg.sender,
                    groupId: monitorGroup, // Puppeteer map groupName làm groupId
                    timestamp: msg.timestamp,
                    msgType: msg.hasImage ? 'image' : 'text',
                    content: msg.text
                }
            });
        }
    });

    // Truy cập Zalo Web
    await page.goto('https://chat.zalo.me', { waitUntil: 'networkidle2' });

    // Tiêm MutationObserver lắng nghe tin nhắn mới trong DOM Zalo Web
    await page.evaluateOnNewDocument((targetGroup) => {
        let currentGroupObserver = null;
        let lastObservedContainer = null;

        setInterval(() => {
            // Lấy danh sách tin nhắn hiện tại
            const chatContainer = document.querySelector('.chat-message-list') || 
                                  document.querySelector('#chat-box-message-list') ||
                                  document.querySelector('.chat-date-item-holder');
            
            if (chatContainer && chatContainer !== lastObservedContainer) {
                if (currentGroupObserver) {
                    currentGroupObserver.disconnect();
                }

                lastObservedContainer = chatContainer;
                currentGroupObserver = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                            mutation.addedNodes.forEach((node) => {
                                if (node.nodeType === Node.ELEMENT_NODE) {
                                    setTimeout(() => {
                                        try {
                                            const senderEl = node.querySelector('.card-sender-name') || 
                                                             node.querySelector('.sender-name') || 
                                                             node.querySelector('[class*="sender"]');
                                            
                                            const textEl = node.querySelector('.text') || 
                                                           node.querySelector('.msg-text') || 
                                                           node.querySelector('[class*="message-text"]');
                                            
                                            const hasImage = !!(node.querySelector('img') || 
                                                               node.querySelector('.photo-card') || 
                                                               node.querySelector('[class*="photo"]'));

                                            const sender = senderEl ? senderEl.innerText.trim() : 'Ẩn danh/Không rõ';
                                            const text = textEl ? textEl.innerText.trim() : '';
                                            const msgId = node.getAttribute('id') || 'dom_' + Math.random().toString(36).substr(2, 9);

                                            if (sender !== 'Ẩn danh/Không rõ' && (text || hasImage)) {
                                                window.onNewZaloMessage({
                                                    zaloMsgId: msgId,
                                                    senderId: sender, // Puppeteer map sender làm ID
                                                    sender,
                                                    text,
                                                    hasImage,
                                                    timestamp: Date.now()
                                                });
                                            }
                                        } catch (err) {
                                            // DOM parse error fallback
                                        }
                                    }, 150);
                                }
                            });
                        }
                    });
                });

                currentGroupObserver.observe(chatContainer, { childList: true, subtree: true });
            }
        }, 1500);
    }, monitorGroup);

    console.log('[PUPPETEER WORKER] Đang theo dõi và chờ đăng nhập...');
}

// Xử lý gửi tin nhắn từ Main Process qua IPC
process.on('message', async (message) => {
    if (message.type === 'SEND_MESSAGE') {
        const { groupName, text } = message.data;
        console.log(`[PUPPETEER WORKER] Nhận yêu cầu gửi tin nhắn tới nhóm: "${groupName}"`);

        try {
            if (!page) return;

            // 1. Nhấp vào ô tìm kiếm liên hệ/nhóm
            const searchInputSelector = '#contact-search-input';
            await page.waitForSelector(searchInputSelector, { timeout: 5000 });
            await page.click(searchInputSelector);
            
            // Xóa nội dung tìm kiếm cũ và gõ tên nhóm
            await page.keyboard.down('Control');
            await page.keyboard.press('A');
            await page.keyboard.up('Control');
            await page.keyboard.press('Backspace');
            await page.keyboard.sendCharacter(groupName);
            await page.waitForTimeout ? await page.waitForTimeout(1000) : await new Promise(r => setTimeout(r, 1000));

            // 2. Nhấp vào kết quả tìm kiếm đầu tiên
            const firstResultSelector = '.div-search-item, .search-item';
            await page.waitForSelector(firstResultSelector, { timeout: 3000 });
            await page.click(firstResultSelector);
            await page.waitForTimeout ? await page.waitForTimeout(500) : await new Promise(r => setTimeout(r, 500));

            // 3. Focus vào khung soạn thảo tin nhắn và gửi
            const editorSelector = '#chat-editor-v2, .input-txt';
            await page.waitForSelector(editorSelector, { timeout: 3000 });
            await page.click(editorSelector);
            await page.keyboard.sendCharacter(text);
            await page.keyboard.press('Enter');
            console.log('[PUPPETEER WORKER] Đã gửi tin nhắn mô phỏng qua browser thành công.');
        } catch (err) {
            console.error('[PUPPETEER WORKER] Lỗi tự động gửi tin nhắn:', err.message);
        }
    }
});

// Khởi chạy tiến trình
startPuppeteer().catch(err => {
    console.error('[PUPPETEER WORKER] Khởi chạy thất bại:', err);
    process.exit(1);
});

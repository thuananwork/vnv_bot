const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Tự động phát hiện đường dẫn Chrome
function getChromePath() {
    const platform = os.platform();
    if (platform === 'win32') {
        const paths = [
            'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
            'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
            path.join(os.homedir(), 'AppData\\Local\\Google\\Chrome\\Application\\chrome.exe')
        ];
        for (const p of paths) {
            if (fs.existsSync(p)) return p;
        }
    } else if (platform === 'darwin') {
        const p = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
        if (fs.existsSync(p)) return p;
    } else if (platform === 'linux') {
        const paths = ['/usr/bin/google-chrome', '/usr/bin/chromium-browser'];
        for (const p of paths) {
            if (fs.existsSync(p)) return p;
        }
    }
    return null;
}

async function run() {
    const chromePath = getChromePath();
    if (!chromePath) {
        console.error('Không tìm thấy Google Chrome cài đặt trên máy tính của bạn.');
        process.exit(1);
    }

    console.log('====================================================');
    console.log('VNV-BOT V2 - ZALO CONNECTOR DEBUG PROTOYPE (POC)');
    console.log('====================================================');
    console.log('1. Khởi chạy Google Chrome...');
    
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: false,
        defaultViewport: null,
        args: ['--start-maximized'],
        userDataDir: path.join(__dirname, 'zalo_session')
    });

    const [page] = await browser.pages();
    
    console.log('2. Truy cập Zalo Web...');
    await page.goto('https://chat.zalo.me', { waitUntil: 'networkidle2' });
    
    console.log('3. Đã mở Zalo Web. Hãy đăng nhập và nhấp vào group chat cần test.');
    console.log('4. Node.js sẽ định kỳ kiểm tra và tự động chèn mã theo dõi...');
    console.log('----------------------------------------------------');

    // Cầu nối log từ browser console về Node.js console
    await page.exposeFunction('browserLog', (level, message) => {
        const timeStr = new Date().toLocaleTimeString();
        let prefix = `[BROWSER ${level.toUpperCase()}]`;
        if (level === 'error') {
            console.error(`\x1b[31m${timeStr} ${prefix} ${message}\x1b[0m`);
        } else if (level === 'warn') {
            console.warn(`\x1b[33m${timeStr} ${prefix} ${message}\x1b[0m`);
        } else if (level === 'click') {
            console.log(`\x1b[36m${timeStr} ${prefix} ${message}\x1b[0m`);
        } else {
            console.log(`${timeStr} ${prefix} ${message}`);
        }
    });

    // Cầu nối nhận tin nhắn Zalo mới về Node.js console
    await page.exposeFunction('onNewZaloMessage', (msg) => {
        const timeStr = new Date(msg.timestamp).toLocaleTimeString();
        console.log(`\n\x1b[32m[SUCCESS NEW MSG] [${timeStr}] | Người gửi: ${msg.sender} | Ảnh: ${msg.hasImage ? 'CÓ [IMAGE]' : 'KHÔNG'} | Nội dung: ${msg.text}\x1b[0m\n`);
    });

    // Hàm chèn code theo dõi vào trang web
    const injectDebugger = async () => {
        try {
            await page.evaluate(() => {
                // Kiểm tra xem đã chèn chưa để tránh trùng lặp
                if (window.vnvDebuggerAttached) return;
                window.vnvDebuggerAttached = true;
                
                window.browserLog('info', '>>> Đang khởi tạo VNV-Bot DOM Inspector & Debugger trong Zalo Web... <<<');
                window.browserLog('info', 'Vui lòng CLICK vào bất kỳ vùng chat tin nhắn nào ở khung bên phải để quét container tự động.');

                let currentObserver = null;
                let currentObservedEl = null;

                // Hàm tìm ancestor tốt nhất chứa danh sách tin nhắn và tự động gắn observer
                function inspectAndBindObserver(clickedEl) {
                    let current = clickedEl;
                    let chain = [];
                    let bestEl = null;
                    let maxMsgCount = -1;
                    let count = 0;

                    window.browserLog('info', '----------------------------------------------------');
                    window.browserLog('info', 'BẮT ĐẦU QUÉT DOM ANCESTORS CỦA PHẦN TỬ ĐƯỢC CLICK:');

                    while (current) {
                        let name = current.tagName;
                        if (current.id) name += '#' + current.id;
                        if (current.className) name += '.' + String(current.className).split(' ').filter(c => c).join('.');
                        
                        let childrenCount = current.children.length;
                        let scrollHeight = current.scrollHeight;
                        let clientHeight = current.clientHeight;

                        // Tìm các phần tử con có class liên quan đến tin nhắn bên trong node này
                        let msgCount = current.querySelectorAll('[class*="message"], [class*="msg-item"], [class*="chat-item"], [class*="msg-user"]').length;

                        // In thông tin chain DOM lên console
                        window.browserLog('info', `[Cấp ${count}] Tag: ${current.tagName} | Class: "${current.className}" | ID: "${current.id}" | Children: ${childrenCount} | MsgDescendants: ${msgCount} | scrollHeight: ${scrollHeight}`);

                        // Log HTML của 5 cấp đầu tiên
                        if (count < 5) {
                            window.browserLog('info', ` -> OuterHTML [Cấp ${count}]: ${current.outerHTML.substring(0, 400)}...`);
                        }

                        // Thuật toán chọn container: Lấy DIV/SECTION/UL có số lượng tin nhắn con nhiều nhất và có chiều cao cuộn lớn
                        if (['DIV', 'SECTION', 'UL', 'OL'].includes(current.tagName)) {
                            if (msgCount > maxMsgCount && scrollHeight > 150) {
                                maxMsgCount = msgCount;
                                bestEl = current;
                            }
                        }

                        current = current.parentElement;
                        count++;
                    }

                    if (bestEl) {
                        if (bestEl === currentObservedEl) {
                            window.browserLog('info', '>>> Container này ĐÃ ĐƯỢC GHÉP OBSERVER trước đó. Không ghép lại. <<<');
                            return;
                        }

                        if (currentObserver) {
                            currentObserver.disconnect();
                            window.browserLog('info', 'Đã ngắt kết nối observer của container cũ.');
                        }

                        currentObservedEl = bestEl;
                        window.browserLog('info', `\n\x1b[35m>>> CONTAINER ĐƯỢC CHỌN ĐỂ MONITOR: <${bestEl.tagName} class="${bestEl.className}" id="${bestEl.id}"> | Chứa: ${maxMsgCount} messages | scrollHeight: ${bestEl.scrollHeight}px <<<\x1b[0m\n`);

                        currentObserver = new MutationObserver((mutations) => {
                            // 3. Log số lượng mutation nhận được mỗi lần
                            window.browserLog('debug', `TRIGGERED! Số lượng mutations nhận được: ${mutations.length}`);

                            mutations.forEach((mutation, mIndex) => {
                                const addedNodes = mutation.addedNodes || [];
                                if (addedNodes.length > 0) {
                                    window.browserLog('debug', ` -> Mutation #${mIndex} | Số addedNodes: ${addedNodes.length}`);

                                    // 1. Log outerHTML của node đầu tiên được chèn
                                    if (addedNodes[0]) {
                                        const firstNode = addedNodes[0];
                                        if (firstNode.nodeType === Node.ELEMENT_NODE) {
                                            window.browserLog('debug', `[FIRST NODE HTML]:\n${firstNode.outerHTML.substring(0, 1500)}`);
                                        } else {
                                            window.browserLog('debug', `[FIRST NODE TYPE]: ${firstNode.nodeType} (Non-element) | Text: "${firstNode.textContent.trim()}"`);
                                        }
                                    }

                                    // 2. Log tagName và className của từng addedNode
                                    addedNodes.forEach((node, nIndex) => {
                                        if (node.nodeType === Node.ELEMENT_NODE) {
                                            window.browserLog('debug', `    └─ addedNode[${nIndex}] | TagName: ${node.tagName} | ClassName: "${node.className}"`);
                                        } else {
                                            window.browserLog('debug', `    └─ addedNode[${nIndex}] | NodeType: ${node.nodeType}`);
                                        }
                                    });
                                }
                            });
                        });

                        // Bắt đầu quan sát container chính thức
                        currentObserver.observe(bestEl, { childList: true, subtree: true });
                        window.browserLog('info', '>>> ĐÃ GHÉP THÀNH CÔNG MUTATIONOBSERVER VÀO CHAT CONTAINER MỚI! <<<');
                    } else {
                        window.browserLog('error', 'Không tìm thấy container phù hợp thông qua thuật toán phân tích.');
                    }
                    window.browserLog('info', '----------------------------------------------------');
                }

                // Lắng nghe sự kiện click chuột
                document.addEventListener('mousedown', (e) => {
                    // Chỉ kích hoạt rà soát DOM khi click vào khu vực hiển thị chat bên phải
                    // Thông thường khu vực chat nằm ngoài sidebarNav và nằm trong vùng view chat
                    let pathStr = '';
                    let temp = e.target;
                    let isChatPanel = true;
                    while (temp) {
                        if (temp.id === 'sidebarNav' || temp.className === 'left-menu') {
                            isChatPanel = false;
                        }
                        temp = temp.parentElement;
                    }

                    if (isChatPanel) {
                        window.browserLog('click', 'Đã click vào vùng chat. Đang rà soát và tự động gán Observer...');
                        inspectAndBindObserver(e.target);
                    }
                });
            });
        } catch (e) {
            // Im lặng nếu trang chưa sẵn sàng
        }
    };

    // Theo dõi thay đổi trang (đề phòng SPA reset context hoặc user reload trang)
    page.on('framenavigated', async () => {
        console.log('[NODE.JS] Frame navigated. Đang thiết lập chèn lại debugger...');
        await injectDebugger();
    });

    // Loop kiểm tra định kỳ từ phía Node.js để chèn lại nếu context bị xóa
    setInterval(async () => {
        await injectDebugger();
    }, 5000);

    // Chạy lần đầu
    await injectDebugger();

    // Giữ terminal hoạt động
    await new Promise(() => {});
}

run().catch(err => {
    console.error('Lỗi khi vận hành Debug POC:', err);
});

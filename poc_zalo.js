const puppeteer = require('puppeteer-core');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Hàm tự động phát hiện đường dẫn cài đặt Google Chrome trên hệ điều hành
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
        console.error('Vui lòng cài đặt Google Chrome hoặc chỉ định đường dẫn thủ công trong mã nguồn.');
        process.exit(1);
    }

    console.log('----------------------------------------------------');
    console.log('VNV-BOT V2 - ZALO CONNECTOR PROTOTYPE');
    console.log('----------------------------------------------------');
    console.log('1. Đang khởi chạy Google Chrome...');
    
    const browser = await puppeteer.launch({
        executablePath: chromePath,
        headless: false, // Bắt buộc mở giao diện trực quan để người dùng quét QR
        defaultViewport: null,
        args: ['--start-maximized'],
        userDataDir: path.join(__dirname, 'zalo_session') // Lưu session để duy trì đăng nhập
    });

    const [page] = await browser.pages();
    
    console.log('2. Đang truy cập Zalo Web (https://chat.zalo.me)...');
    await page.goto('https://chat.zalo.me', { waitUntil: 'networkidle2' });
    
    console.log('3. CHỜ ĐĂNG NHẬP: Vui lòng quét mã QR hoặc đăng nhập tài khoản Zalo của bạn.');
    console.log('4. SAU KHI ĐĂNG NHẬP: Hãy click chọn nhóm chat Vùng/Cụm mà bạn muốn giám sát.');
    console.log('----------------------------------------------------');

    // Tạo cầu nối (exposeFunction) để nhận sự kiện từ trình duyệt gửi về Node.js console
    await page.exposeFunction('onNewZaloMessage', (msg) => {
        const timeStr = new Date(msg.timestamp).toLocaleTimeString();
        console.log(`[NEW MESSAGE] [${timeStr}] | Người gửi: ${msg.sender} | Ảnh: ${msg.hasImage ? 'CÓ [IMAGE]' : 'KHÔNG'} | Nội dung: ${msg.text}`);
    });

    // Hàm chạy ngầm bên trong Zalo Web để tự động phát hiện và gán MutationObserver
    await page.evaluateOnNewDocument(() => {
        let currentGroupObserver = null;
        let lastObservedContainer = null;

        // Định kỳ quét DOM để phát hiện khu vực chứa tin nhắn của nhóm đang active
        setInterval(() => {
            // Zalo Web sử dụng cấu trúc container tin nhắn trong khu vực chat feed.
            // Các lớp phổ biến: chat-message-list, chat-item, hoặc scroll container bên phải
            const chatContainer = document.querySelector('.chat-message-list') || 
                                  document.querySelector('#chat-box-message-list') ||
                                  document.querySelector('.chat-date-item-holder'); // Selector fallback
            
            if (chatContainer && chatContainer !== lastObservedContainer) {
                if (currentGroupObserver) {
                    currentGroupObserver.disconnect();
                    console.log('Ngắt kết nối observer nhóm cũ.');
                }

                lastObservedContainer = chatContainer;
                console.log('Phát hiện vùng chat mới, đang thiết lập lắng nghe tin nhắn thời gian thực...');

                currentGroupObserver = new MutationObserver((mutations) => {
                    mutations.forEach((mutation) => {
                        if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                            mutation.addedNodes.forEach((node) => {
                                // Chỉ kiểm tra các phần tử tin nhắn (thường có thẻ con chứa thông tin sender và text)
                                if (node.nodeType === Node.ELEMENT_NODE) {
                                    // Chờ DOM render đầy đủ các thẻ con
                                    setTimeout(() => {
                                        try {
                                            // Trích xuất Tên người gửi
                                            // Lớp tên người gửi thường nằm trong .card-sender-name hoặc tương đương
                                            const senderEl = node.querySelector('.card-sender-name') || 
                                                             node.querySelector('.sender-name') || 
                                                             node.querySelector('[class*="sender"]');
                                            
                                            // Trích xuất nội dung text
                                            const textEl = node.querySelector('.text') || 
                                                           node.querySelector('.msg-text') || 
                                                           node.querySelector('[class*="message-text"]');
                                            
                                            // Kiểm tra đính kèm hình ảnh
                                            const hasImage = !!(node.querySelector('img') || 
                                                               node.querySelector('.photo-card') || 
                                                               node.querySelector('[class*="photo"]'));

                                            const sender = senderEl ? senderEl.innerText.trim() : 'Ẩn danh/Không rõ';
                                            const text = textEl ? textEl.innerText.trim() : '(Không có nội dung chữ)';

                                            // Bỏ qua nếu là tin nhắn hệ thống hoặc tin nhắn trống (như sticker, tin thu hồi)
                                            if (sender !== 'Ẩn danh/Không rõ' || text !== '(Không có nội dung chữ)' || hasImage) {
                                                window.onNewZaloMessage({
                                                    sender,
                                                    text,
                                                    hasImage,
                                                    timestamp: Date.now()
                                                });
                                            }
                                        } catch (err) {
                                            // Bỏ qua lỗi parse lỗi do DOM render không kịp
                                        }
                                    }, 100);
                                								}
                            });
                        }
                    });
                });

                // Cấu hình observer theo dõi mọi sự thay đổi chèn phần tử mới trong container tin nhắn
                currentGroupObserver.observe(chatContainer, { childList: true, subtree: true });
            }
        }, 1500);
    });

    // Giữ cho terminal chạy vô hạn
    await new Promise(() => {});
}

run().catch(err => {
    console.error('Lỗi khi vận hành Prototype:', err);
});

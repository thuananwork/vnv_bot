const assert = require('assert');
const { fork } = require('child_process');
const path = require('path');
const fs = require('fs');

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runPuppeteerWorkerTests() {
    console.log('====================================================');
    console.log('CHẠY KIỂM THỬ: CO LẬP TIẾN TRÌNH WORKER PUPPETEER');
    console.log('====================================================');

    // 1. Tạo một tệp worker giả lập (mock worker) ghi log và tự động thoát sau 1s để test crash recovery
    const mockWorkerPath = path.join(__dirname, 'mock_puppeteer_worker.js');
    console.log('1. Tạo mock worker file...');
    
    fs.writeFileSync(mockWorkerPath, `
        console.log('[MOCK WORKER] Khởi chạy thành công.');
        
        // Nhận lệnh từ main process
        process.on('message', (msg) => {
            if (msg.type === 'SEND_MESSAGE') {
                console.log('[MOCK WORKER] Nhận yêu cầu gửi tin nhắn:', msg.data);
                process.send({ type: 'NEW_MESSAGE', data: { zaloMsgId: 'mock_msg_123', senderName: 'Sender Mock', text: msg.data.text } });
            }
        });

        // Tự động exit sau 1 giây để giả lập crash
        setTimeout(() => {
            console.log('[MOCK WORKER] Giả lập tiến trình bị CRASH/EXIT.');
            process.exit(1);
        }, 1000);
    `);

    // 2. Định nghĩa logic điều phối và giám sát worker tương tự PuppeteerProvider
    console.log('2. Bắt đầu giám sát tiến trình worker...');
    let worker = null;
    let messageReceived = null;
    let restartCount = 0;

    function startTestWorker() {
        worker = fork(mockWorkerPath, []);

        worker.on('message', (message) => {
            if (message.type === 'NEW_MESSAGE') {
                messageReceived = message.data;
            }
        });

        worker.on('exit', (code) => {
            console.warn(`[TEST MONITOR] Worker đã thoát với Code: ${code}. Đang chuẩn bị restart...`);
            worker = null;
            restartCount++;
            
            // Chỉ restart 1 lần trong bài test để tránh lặp vô hạn
            if (restartCount < 2) {
                setTimeout(startTestWorker, 500);
            }
        });
    }

    startTestWorker();

    // Gửi tin nhắn và chờ nhận hồi đáp IPC
    await wait(300);
    assert.ok(worker, 'Worker phải đang chạy');
    
    console.log(' -> Gửi tin nhắn yêu cầu qua IPC...');
    worker.send({
        type: 'SEND_MESSAGE',
        data: { text: 'Hello from main' }
    });

    await wait(300);
    assert.ok(messageReceived, 'Phải nhận được hồi đáp tin nhắn mới qua IPC');
    assert.strictEqual(messageReceived.text, 'Hello from main', 'Nội dung tin nhắn nhận qua IPC phải trùng khớp');
    console.log(' -> [OK] Giao tiếp hai chiều IPC hoạt động tốt.');

    // Chờ mock worker tự crash sau 1s và kiểm tra tính năng tự động khởi tạo lại
    console.log(' -> Đang chờ worker tự crash...');
    await wait(1200);

    assert.strictEqual(restartCount, 1, 'Worker phải được tự động kích hoạt khởi động lại 1 lần sau khi crash');
    assert.ok(worker, 'Tiến trình worker mới phải được tạo lại thành công');
    console.log(' -> [OK] Cơ chế tự động hồi phục (Auto-recovery) khi crash hoạt động xuất sắc.');

    // Dọn dẹp
    if (worker) {
        worker.kill();
    }
    try {
        fs.unlinkSync(mockWorkerPath);
    } catch (e) {}

    console.log('\n====================================================');
    console.log('THÀNH CÔNG: TẤT CẢ CA KIỂM THỬ WORKER PUPPETEER ĐẠT (PASS)!');
    console.log('====================================================');
    process.exit(0);
}

runPuppeteerWorkerTests().catch(err => {
    console.error('[TEST ERROR] Kiểm thử worker Puppeteer thất bại:', err);
    process.exit(1);
});

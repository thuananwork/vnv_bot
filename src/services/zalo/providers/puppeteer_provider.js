const ZaloProvider = require('./zalo_provider');
const { fork } = require('child_process');
const path = require('path');
const db = require('../../../config/db');

class ZaloPuppeteerProvider extends ZaloProvider {
    constructor() {
        super();
        this.worker = null;
        this.onMessage = null;
        this.enabled = false;
        this.groupName = '';
        this.isRestarting = false;
    }

    /**
     * Khả năng hỗ trợ của Puppeteer Scraper
     */
    supports(feature) {
        const supported = ['text', 'image', 'group'];
        return supported.includes(feature.toLowerCase());
    }

    /**
     * Gửi tin nhắn qua Puppeteer (Giả lập gõ phím gửi nhóm chat)
     */
    async sendMessage(recipientId, messageContent) {
        console.log(`[PUPPETEER PROVIDER] Đang gửi tin nhắn tới nhóm "${recipientId}": "${messageContent}"...`);
        if (!this.worker) {
            console.warn('[PUPPETEER PROVIDER] Worker chưa khởi chạy. Bỏ qua gửi tin nhắn.');
            return false;
        }

        // Gửi thông điệp IPC bảo worker gửi tin nhắn
        this.worker.send({
            type: 'SEND_MESSAGE',
            data: {
                groupName: recipientId,
                text: messageContent
            }
        });
        return true;
    }

    /**
     * Không hỗ trợ gửi Template
     */
    async sendTemplateMessage(recipientId, templateId, templateData) {
        console.warn('[PUPPETEER PROVIDER] Tính năng gửi Template không được hỗ trợ bởi Puppeteer Scraper.');
        return false;
    }

    /**
     * Bắt đầu lắng nghe tin nhắn qua Puppeteer Worker Process
     */
    async startListening(onMessageCallback) {
        this.onMessage = onMessageCallback;

        // Đọc cấu hình động từ database SQLite
        const enabledRow = await db.get("SELECT value FROM local_config WHERE key = 'zalo.puppeteer.enabled'");
        this.enabled = enabledRow ? enabledRow.value === 'true' : false;

        const groupRow = await db.get("SELECT value FROM local_config WHERE key = 'zalo.puppeteer.group_name'");
        this.groupName = groupRow ? groupRow.value : '';

        if (!this.enabled) {
            console.log('[PUPPETEER PROVIDER] Puppeteer Scraper đang ở trạng thái TẮT (disabled). Không khởi động worker.');
            return;
        }

        this.startWorker();
    }

    /**
     * Khởi chạy Worker Process
     */
    startWorker() {
        if (this.worker) {
            this.worker.kill();
        }

        const workerPath = path.join(__dirname, '../puppeteer_worker.js');
        console.log(`[PUPPETEER PROVIDER] Đang fork tiến trình Puppeteer Worker tại: "${workerPath}"`);

        this.worker = fork(workerPath, [], {
            env: {
                ...process.env,
                PUPPETEER_MONITOR_GROUP: this.groupName
            }
        });

        // Nhận thông điệp IPC từ Worker
        this.worker.on('message', (message) => {
            if (message.type === 'NEW_MESSAGE') {
                console.log(`[PUPPETEER PROVIDER] Nhận tin nhắn mới từ Worker IPC của: "${message.data.senderName}"`);
                if (this.onMessage) {
                    this.onMessage(message.data);
                }
            }
        });

        // Lắng nghe sự kiện Worker kết thúc (crash/close) để tự động hồi phục
        this.worker.on('exit', (code, signal) => {
            console.warn(`[PUPPETEER PROVIDER] Tiến trình Worker thoát. Code: ${code}, Signal: ${signal}`);
            this.worker = null;

            if (this.enabled && !this.isRestarting) {
                this.isRestarting = true;
                console.log('[PUPPETEER PROVIDER] Phát hiện worker crash hoặc dừng đột ngột. Tự động khởi động lại sau 5 giây...');
                setTimeout(() => {
                    this.isRestarting = false;
                    this.startWorker();
                }, 5000);
            }
        });
    }

    /**
     * Dừng lắng nghe và giải phóng tiến trình
     */
    stopListening() {
        this.enabled = false;
        if (this.worker) {
            console.log('[PUPPETEER PROVIDER] Đang dừng tiến trình Worker Puppeteer...');
            this.worker.kill();
            this.worker = null;
        }
    }
}

module.exports = new ZaloPuppeteerProvider();

const pipeline = require('./pipeline');
const puppeteerProvider = require('./providers/puppeteer_provider');

/**
 * Khởi tạo toàn bộ phân hệ Zalo Connector và nối với Message Pipeline (100% Zalo Web Automation)
 */
async function initZaloConnector() {
    console.log('[ZALO CONNECTOR] Đang khởi tạo Zalo Connector (Zalo Web Automation)...');

    // 1. Đảm bảo tạo bảng cơ sở dữ liệu
    await pipeline.ensurePipelineTables();

    // 2. Khởi động Puppeteer Provider và đăng ký nhận tin nhắn đưa vào Pipeline
    await puppeteerProvider.startListening((payload) => {
        pipeline.enqueueMessage('puppeteer', payload);
    });

    console.log('[ZALO CONNECTOR] Đã khởi tạo hoàn tất.');
}

module.exports = {
    initZaloConnector,
    puppeteerProvider,
    pipeline
};

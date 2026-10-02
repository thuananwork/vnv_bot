const fs = require('fs');
const path = require('path');
const dbConfig = require('../config/db');

module.exports = {
    name: 'backupDb',
    cronKey: 'scheduler.backupDb.cron',
    enabledKey: 'scheduler.backupDb.enabled',
    timeoutMs: 30000,
    retryPolicy: {
        attempts: 2,
        backoff: 'exponential',
        baseDelayMs: 2000,
        shouldRetry: () => true
    },
    handler: async (context) => {
        context.logger.info('Bắt đầu Job: Sao lưu cơ sở dữ liệu SQLite tự động...');

        const backupDir = path.join(__dirname, '../../backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const dateStr = new Date().toLocaleDateString('sv'); // YYYY-MM-DD
        const timeStr = new Date().toTimeString().split(' ')[0].replace(/:/g, '-'); // HH-MM-SS
        const destPath = path.join(backupDir, `vnv_bot_backup_${dateStr}_${timeStr}.db`);

        try {
            if (fs.existsSync(destPath)) {
                fs.unlinkSync(destPath);
            }

            // Sử dụng VACUUM INTO của SQLite để sao lưu CSDL đang chạy WAL một cách an toàn
            await dbConfig.run(`VACUUM INTO ?`, [destPath]);

            // Dọn dẹp bản sao lưu cũ hơn 7 ngày để tránh đầy bộ nhớ
            const files = fs.readdirSync(backupDir);
            const thresholdDate = new Date();
            thresholdDate.setDate(thresholdDate.getDate() - 7);

            for (const file of files) {
                const match = file.match(/^vnv_bot_backup_(\d{4}-\d{2}-\d{2})_.*\.db$/);
                if (match) {
                    const fileDate = new Date(match[1]);
                    if (fileDate < thresholdDate) {
                        fs.unlinkSync(path.join(backupDir, file));
                        context.logger.info(`Đã xóa bản sao lưu SQLite cũ: ${file}`);
                    }
                }
            }

            context.logger.info(`Sao lưu SQLite thành công: ${destPath}`);
            return { success: true, message: `Backup saved to ${destPath}` };
        } catch (err) {
            context.logger.error(`Lỗi ngoại lệ khi sao lưu database: ${err.message}`);
            throw err;
        }
    }
};

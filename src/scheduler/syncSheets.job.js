const db = require('../config/db');
const { syncRegionSheet } = require('../services/sheet_sync');

module.exports = {
    name: 'syncSheets',
    cronKey: 'scheduler.syncSheets.cron',
    enabledKey: 'scheduler.syncSheets.enabled',
    timeoutMs: 45000,
    retryPolicy: {
        attempts: 3,
        backoff: 'exponential',
        baseDelayMs: 1000,
        shouldRetry: (error) => {
            return !error.isBusinessError;
        }
    },
    handler: async (context) => {
        context.logger.info('Bắt đầu Job: Đồng bộ Google Sheet...');

        // 1. Quét toàn bộ các báo cáo Vùng được tạo trong ngày hôm nay
        const todayStr = new Date().toLocaleDateString('sv');
        const reports = await db.all(`
            SELECT rep.* 
            FROM reports rep
            JOIN tasks t ON rep.task_id = t.id
            WHERE rep.report_type = 'region' 
              AND (t.publish_date = ? OR date(rep.created_at) = ?)
        `, [todayStr, todayStr]);

        if (reports.length === 0) {
            context.logger.warn(`Không tìm thấy báo cáo Vùng nào được tạo hôm nay (${todayStr}) để đồng bộ.`);
            return { status: 'success', message: 'No reports to sync today' };
        }

        context.logger.info(`Đã tìm thấy ${reports.length} báo cáo Vùng cần đồng bộ Google Sheets.`);

        // 2. Lặp và gọi API đồng bộ cho từng vùng với khoảng trễ (delay) tránh Rate Limit
        const delayMinRow = await db.get("SELECT value FROM local_config WHERE key = 'scheduler.sheet.delay.min'");
        const delayMaxRow = await db.get("SELECT value FROM local_config WHERE key = 'scheduler.sheet.delay.max'");
        const delayMin = delayMinRow ? parseInt(delayMinRow.value, 10) : 1500;
        const delayMax = delayMaxRow ? parseInt(delayMaxRow.value, 10) : 2500;

        let successCount = 0;
        for (let i = 0; i < reports.length; i++) {
            const report = reports[i];
            
            // Chèn khoảng trễ giữa các lượt đồng bộ (bắt đầu từ vùng thứ 2)
            if (i > 0) {
                const waitTime = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
                context.logger.info(`Đang chờ ${waitTime}ms để tránh giới hạn tần suất API (Rate Limit)...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            try {
                context.logger.info(`Đang đồng bộ báo cáo Vùng ID ${report.region_id} (Task ID: ${report.task_id})...`);
                
                const region = await db.get('SELECT sheet_id, region_name FROM regions WHERE id = ?', [report.region_id]);
                if (!region || !region.sheet_id) {
                    context.logger.info(`Vùng "${region ? region.region_name : report.region_id}" chưa cấu hình Sheet ID, bỏ qua.`);
                    continue;
                }

                // Đồng bộ ma trận bảng điểm danh tháng V2 (ví dụ T9/26!S6:S33)
                const workDate = report.work_date || todayStr;
                try {
                    const { syncRegionMatrixSheet } = require('../services/sheet_matrix_sync');
                    await syncRegionMatrixSheet(report.region_id, workDate, { dryRun: context.dryRun });
                } catch (mErr) {
                    context.logger.warn(`Đồng bộ ma trận Sheet tháng cho Vùng ID ${report.region_id}: ${mErr.message}`);
                }

                const ok = await syncRegionSheet(report.region_id, report.task_id, { dryRun: context.dryRun });
                if (ok) {
                    successCount++;
                    // Đánh dấu thời gian đã gửi/đồng bộ thành công vào reports
                    await db.run('UPDATE reports SET sent_at = CURRENT_TIMESTAMP WHERE id = ?', [report.id]);
                } else {
                    context.logger.error(`Đồng bộ Google Sheet cho Vùng ID ${report.region_id} thất bại.`);
                }
            } catch (syncErr) {
                context.logger.error(`Lỗi ngoại lệ khi đồng bộ Vùng ID ${report.region_id}: ${syncErr.message}`);
            }
        }

        context.logger.info(`Hoàn tất Job: Đồng bộ Google Sheet. Thành công: ${successCount}/${reports.length}`);
        return {
            success: true,
            totalReports: reports.length,
            syncedCount: successCount
        };
    }
};

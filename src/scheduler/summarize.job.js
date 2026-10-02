const taskService = require('../services/tasks');
const reportService = require('../services/reports');

module.exports = {
    name: 'summarize',
    cronKey: 'scheduler.summarize.cron',
    enabledKey: 'scheduler.summarize.enabled',
    timeoutMs: 60000,
    retryPolicy: {
        attempts: 3,
        backoff: 'exponential',
        baseDelayMs: 1000,
        shouldRetry: (error) => {
            return !error.isBusinessError;
        }
    },
    handler: async (context) => {
        context.logger.info('Bắt đầu Job: Tổng hợp báo cáo số liệu...');

        // 1. Xác định nhiệm vụ để tổng hợp báo cáo (Nhiệm vụ hôm nay, hoặc mới nhất)
        const todayStr = new Date().toLocaleDateString('sv');
        let task = await taskService.getTaskByDate(todayStr);

        if (!task) {
            context.logger.warn(`Không tìm thấy nhiệm vụ nào được lên lịch hôm nay (${todayStr}). Thử lấy nhiệm vụ gần nhất.`);
            task = await taskService.getLatestTask();
        }

        if (!task) {
            context.logger.warn('Cơ sở dữ liệu chưa cấu hình nhiệm vụ nào. Bỏ qua tổng hợp.');
            return { status: 'success', message: 'No tasks found in DB' };
        }

        context.logger.info(`Đang tổng hợp báo cáo cho nhiệm vụ: [${task.task_code}] "${task.title}"`);

        // 2. Chạy dịch vụ sinh báo cáo hàng ngày
        const stats = await reportService.generateDailyReports(task.id);

        context.logger.info(
            `Hoàn tất tổng hợp báo cáo hàng ngày. ` +
            `Đã tạo ${stats.regionReportsCount} báo cáo Vùng và ${stats.clusterReportsCount} báo cáo Cụm.`
        );

        return {
            success: true,
            taskId: task.id,
            regionCount: stats.regionReportsCount,
            clusterCount: stats.clusterReportsCount
        };
    }
};

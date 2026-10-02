const taskService = require('../services/tasks');
const db = require('../config/db');

module.exports = {
    name: 'distribute',
    cronKey: 'scheduler.distribute.cron',
    enabledKey: 'scheduler.distribute.enabled',
    timeoutMs: 30000,
    retryPolicy: {
        attempts: 3,
        backoff: 'exponential',
        baseDelayMs: 1000,
        shouldRetry: (error) => {
            return !error.isBusinessError;
        }
    },
    handler: async (context) => {
        context.logger.info('Bắt đầu Job: Giao nhiệm vụ...');

        // 1. Lấy nhiệm vụ được lên lịch hôm nay (YYYY-MM-DD)
        const todayStr = new Date().toLocaleDateString('sv');
        const task = await taskService.getTaskByDate(todayStr);

        if (!task) {
            context.logger.warn(`Không tìm thấy nhiệm vụ nào được lên lịch cho ngày hôm nay (${todayStr}). Bỏ qua.`);
            return { status: 'success', message: 'No task for today' };
        }

        if (task.status !== 'active') {
            context.logger.warn(`Nhiệm vụ "${task.task_code}" đang ở trạng thái "${task.status}". Bỏ qua.`);
            return { status: 'success', message: 'Task is inactive' };
        }

        context.logger.info(`Đã tìm thấy nhiệm vụ ngày hôm nay: [${task.task_code}] "${task.title}"`);

        // 2. Lấy danh sách các Vùng đang hoạt động
        const activeRegions = await db.all("SELECT id, region_name, zalo_group_id, zalo_group_name FROM regions WHERE status = 'active'");
        if (activeRegions.length === 0) {
            context.logger.warn('Không có Vùng nào hoạt động để giao nhiệm vụ.');
            return { status: 'success', message: 'No active regions' };
        }

        // 3. Thực hiện gửi nhiệm vụ
        const isSafeMode = process.env.SAFE_MODE === 'true';
        const { oaProvider, puppeteerProvider } = require('../services/zalo');
        
        const puppeteerEnabledRow = await db.get("SELECT value FROM local_config WHERE key = 'zalo.puppeteer.enabled'");
        const usePuppeteer = puppeteerEnabledRow ? puppeteerEnabledRow.value === 'true' : false;
        const activeProvider = usePuppeteer ? puppeteerProvider : oaProvider;

        let distributedCount = 0;
        for (const region of activeRegions) {
            const recipient = usePuppeteer ? region.zalo_group_name : region.zalo_group_id;
            const message = `[NHIỆM VỤ NGÀY] ${task.title}\n\n${task.description}\n\nMã: ${task.task_code}`;

            if (isSafeMode) {
                context.logger.info(
                    `[SAFE MODE MOCK SEND] Gửi nhiệm vụ [${task.task_code}] tới nhóm Vùng "${region.region_name}" ` +
                    `via ${usePuppeteer ? 'Puppeteer' : 'OA'} (Target: "${recipient}")`
                );
                distributedCount++;
            } else {
                context.logger.info(
                    `Đang gửi nhiệm vụ [${task.task_code}] tới nhóm Vùng "${region.region_name}" ` +
                    `via ${usePuppeteer ? 'Puppeteer' : 'OA'} (Target: "${recipient}")...`
                );
                const success = await activeProvider.sendMessage(recipient, message);
                if (success) {
                    distributedCount++;
                    context.logger.info(`Đã gửi nhiệm vụ thành công tới Vùng "${region.region_name}".`);
                } else {
                    context.logger.error(`Gửi nhiệm vụ tới Vùng "${region.region_name}" thất bại.`);
                }
            }
        }

        context.logger.info(`Đã phân phối thành công nhiệm vụ [${task.task_code}] tới ${distributedCount} Vùng.`);
        return { success: true, regionsDistributed: distributedCount };
    }
};

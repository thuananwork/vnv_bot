const db = require('../config/db');

module.exports = {
    name: 'sendReports',
    cronKey: 'scheduler.sendReports.cron',
    enabledKey: 'scheduler.sendReports.enabled',
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
        context.logger.info('Bắt đầu Job: Gửi báo cáo Zalo...');

        // 1. Quét toàn bộ các báo cáo được tạo trong ngày hôm nay
        const todayStr = new Date().toLocaleDateString('sv');
        const reports = await db.all(`
            SELECT rep.*, r.zalo_group_id, r.zalo_group_name, r.region_name, c.cluster_name
            FROM reports rep
            LEFT JOIN regions r ON rep.region_id = r.id AND rep.report_type = 'region'
            LEFT JOIN clusters c ON rep.cluster_id = c.id AND rep.report_type = 'cluster'
            JOIN tasks t ON rep.task_id = t.id
            WHERE t.publish_date = ? OR date(rep.created_at) = ?
        `, [todayStr, todayStr]);

        if (reports.length === 0) {
            context.logger.warn(`Không tìm thấy báo cáo nào được tạo hôm nay (${todayStr}) để gửi Zalo.`);
            return { status: 'success', message: 'No reports to send today' };
        }

        context.logger.info(`Đã tìm thấy ${reports.length} báo cáo cần gửi qua Zalo.`);

        // 2. Thực hiện gửi báo cáo
        const isSafeMode = process.env.SAFE_MODE === 'true';
        const { oaProvider, puppeteerProvider } = require('../services/zalo');
        
        const puppeteerEnabledRow = await db.get("SELECT value FROM local_config WHERE key = 'zalo.puppeteer.enabled'");
        const usePuppeteer = puppeteerEnabledRow ? puppeteerEnabledRow.value === 'true' : false;
        const activeProvider = usePuppeteer ? puppeteerProvider : oaProvider;

        // Nhóm BĐH nhận báo cáo Cụm
        const bdhGroupName = 'BĐH SỨ GIẢ TOÀN QUỐC - VNV';
        const bdhGroupIdRow = await db.get("SELECT value FROM local_config WHERE key = 'zalo.bdh.group_id'");
        const bdhGroupId = bdhGroupIdRow ? bdhGroupIdRow.value : 'bdh_group_id_default';

        // Nhóm CỤM 5 nhận báo cáo Vùng
        const cumGroupName = 'CỤM 5';
        const cumGroupIdRow = await db.get("SELECT value FROM local_config WHERE key = 'zalo.cum.group_id'");
        const cumGroupId = cumGroupIdRow ? cumGroupIdRow.value : 'cum_group_id_default';

        let sendCount = 0;
        for (const report of reports) {
            if (report.report_type === 'region') {
                const recipientRegion = usePuppeteer ? report.zalo_group_name : report.zalo_group_id;
                const recipientCum = usePuppeteer ? cumGroupName : cumGroupId;

                if (isSafeMode) {
                    context.logger.info(
                        `[SAFE MODE MOCK SEND] Gửi Báo cáo Vùng "${report.region_name}" ` +
                        `tới nhóm Vùng (Target: "${recipientRegion}") và Cụm (Target: "${recipientCum}")`
                    );
                    sendCount++;
                } else {
                    context.logger.info(
                        `Đang gửi Báo cáo Vùng "${report.region_name}" tới nhóm Vùng (Target: "${recipientRegion}") ` +
                        `và Cụm (Target: "${recipientCum}")...`
                    );
                    const successRegion = await activeProvider.sendMessage(recipientRegion, report.content);
                    const successCum = await activeProvider.sendMessage(recipientCum, report.content);
                    if (successRegion && successCum) {
                        sendCount++;
                        context.logger.info(`Đã gửi Báo cáo Vùng "${report.region_name}" thành công.`);
                    } else {
                        context.logger.error(`Gửi Báo cáo Vùng "${report.region_name}" thất bại.`);
                    }
                }
            } else if (report.report_type === 'cluster') {
                const recipientBdh = usePuppeteer ? bdhGroupName : bdhGroupId;
                const messageWithTag = `@Phạm Minh Tú\n${report.content}`;

                if (isSafeMode) {
                    context.logger.info(
                        `[SAFE MODE MOCK SEND] Gửi Báo cáo Cụm "${report.cluster_name}" ` +
                        `tới nhóm điều hành BĐH (Target: "${recipientBdh}")`
                    );
                    sendCount++;
                } else {
                    context.logger.info(
                        `Đang gửi Báo cáo Cụm "${report.cluster_name}" tới nhóm điều hành BĐH (Target: "${recipientBdh}")...`
                    );
                    const successBdh = await activeProvider.sendMessage(recipientBdh, messageWithTag);
                    if (successBdh) {
                        sendCount++;
                        context.logger.info(`Đã gửi Báo cáo Cụm "${report.cluster_name}" thành công.`);
                    } else {
                        context.logger.error(`Gửi Báo cáo Cụm "${report.cluster_name}" thất bại.`);
                    }
                }
            }
        }

        context.logger.info(`Đã hoàn thành gửi ${sendCount} báo cáo qua Zalo.`);
        return {
            success: true,
            totalReports: reports.length,
            sentCount: sendCount
        };
    }
};

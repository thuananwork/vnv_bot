const db = require('../config/db');
const { generateRegionReport, generateClusterReport } = require('./reports_v2');
const { syncRegionMatrixSheet } = require('./sheet_matrix_sync');

class DailyStateMachine {
    /**
     * Lấy hoặc khởi tạo trạng thái ngày
     * @param {string} workDate 'YYYY-MM-DD'
     */
    async getOrCreateDailyOperation(workDate) {
        let op = await db.get('SELECT * FROM daily_operations WHERE work_date = ?', [workDate]);
        if (!op) {
            await db.run(`
                INSERT INTO daily_operations (work_date, state, task_forwarded, cluster_report_status)
                VALUES (?, 'IDLE', 0, 'PENDING')
            `, [workDate]);
            op = await db.get('SELECT * FROM daily_operations WHERE work_date = ?', [workDate]);
        }
        return op;
    }

    /**
     * Chuyển trạng thái
     */
    async transitionState(workDate, newState) {
        await db.run(
            'UPDATE daily_operations SET state = ?, updated_at = CURRENT_TIMESTAMP WHERE work_date = ?',
            [newState, workDate]
        );
        console.log(`[STATE MACHINE] [${workDate}] Chuyển trạng thái -> ${newState}`);
    }

    /**
     * 10h00 - 15h00: Forward Nhiệm vụ ngày từ Cụm/BĐH sang 7 Vùng
     */
    async forwardDailyTask(workDate, sourceGroup, taskContent) {
        const op = await this.getOrCreateDailyOperation(workDate);
        
        // Tạo hoặc lấy task ID
        const taskCode = 'NV-' + workDate.replace(/-/g, '');
        await db.run(`
            INSERT OR REPLACE INTO tasks (task_code, title, description, publish_date, source_group, status)
            VALUES (?, ?, ?, ?, ?, 'active')
        `, [taskCode, `Nhiệm vụ ngày ${workDate}`, taskContent, workDate, sourceGroup]);

        // Cập nhật trạng thái
        await db.run(`
            UPDATE daily_operations 
            SET task_forwarded = 1, task_source_group = ?, task_content = ?, state = 'TASK_FORWARDED', updated_at = CURRENT_TIMESTAMP
            WHERE work_date = ?
        `, [sourceGroup, taskContent, workDate]);

        console.log(`[STATE MACHINE] Đã phân phối nhiệm vụ ngày ${workDate} tới 7 Vùng.`);
        return { success: true, taskCode, forwardedTo: [25, 26, 27, 28, 29, 30, 31] };
    }

    /**
     * 21h30 - 22h30: Đánh giá kết quả nộp bài, đồng bộ Google Sheet và sinh báo cáo tổng hợp
     */
    async executeEveningCycle(workDate, options = {}) {
        const dryRun = options.dryRun !== false; // Mặc định chạy an toàn (dryRun) nếu không chỉ định
        await this.transitionState(workDate, 'EVALUATING');

        const regions = await db.all("SELECT id FROM regions WHERE status = 'active' ORDER BY id ASC");
        const regionResults = [];

        // 1. Đồng bộ Google Sheet và sinh Báo cáo cho 7 Vùng
        for (const r of regions) {
            // A. Cập nhật ma trận Sheet
            const sheetRes = await syncRegionMatrixSheet(r.id, workDate, { dryRun });
            
            // B. Sinh báo cáo Vùng (Mẫu 1)
            const repRes = await generateRegionReport(r.id, workDate);

            regionResults.push({
                regionId: r.id,
                totalMembers: repRes.totalMembers,
                completed: repRes.totalCompleted,
                incomplete: repRes.totalIncomplete,
                sheetSynced: sheetRes.success
            });
        }

        await this.transitionState(workDate, 'SHEET_SYNCED');

        // 2. Sinh Báo cáo tổng hợp Cụm 5 (Mẫu 2)
        const clusterReport = await generateClusterReport(5, workDate);

        await this.transitionState(workDate, 'REPORTS_DISPATCHED');

        return {
            workDate,
            state: 'REPORTS_DISPATCHED',
            regions: regionResults,
            clusterReport: {
                totalMembers: clusterReport.totalClusterMembers,
                completed: clusterReport.totalClusterCompleted,
                incomplete: clusterReport.totalClusterIncomplete,
                content: clusterReport.content
            }
        };
    }
}

module.exports = new DailyStateMachine();

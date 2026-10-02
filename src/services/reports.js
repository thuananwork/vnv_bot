const db = require('../config/db');

class ReportService {
    /**
     * Sinh báo cáo và lưu trữ cho một Vùng (Region) cụ thể
     * @param {number} regionId 
     * @param {number} taskId 
     * @returns {Promise<Object>}
     */
    async generateRegionReport(regionId, taskId) {
        try {
            // 1. Lấy thông tin Vùng
            const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
            if (!region) throw new Error(`Không tìm thấy Vùng ID ${regionId}`);

            // Lấy thông tin Task
            const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
            if (!task) throw new Error(`Không tìm thấy Nhiệm vụ ID ${taskId}`);

            // 2. Tính toán tổng số sứ giả hoạt động trong Vùng
            const totalMembersRow = await db.get(
                "SELECT COUNT(*) as count FROM members WHERE region_id = ? AND status = 'Active'",
                [regionId]
            );
            const totalMembers = totalMembersRow ? totalMembersRow.count : 0;

            // 3. Tính toán số sứ giả đã nộp và được phê duyệt ('approved' hoặc 'OK')
            const completedRow = await db.get(
                `SELECT COUNT(DISTINCT s.member_id) as count 
                 FROM submissions s
                 JOIN members m ON s.member_id = m.id
                 WHERE m.region_id = ? AND s.task_id = ? AND (s.status = 'approved' OR s.status = 'OK') AND m.status = 'Active'`,
                [regionId, taskId]
            );
            const totalCompleted = completedRow ? completedRow.count : 0;
            const totalFailed = Math.max(0, totalMembers - totalCompleted);

            // 4. Tạo nội dung báo cáo chuẩn hóa
            const percent = totalMembers > 0 ? ((totalCompleted / totalMembers) * 100).toFixed(1) : '0.0';
            const content = `Báo cáo Vùng: ${region.region_name}\n` +
                            `Nhiệm vụ: ${task.title} (${task.task_code})\n` +
                            `Ngày: ${task.publish_date}\n` +
                            `------------------------------------\n` +
                            `- Tổng số Sứ giả: ${totalMembers}\n` +
                            `- Đã hoàn thành: ${totalCompleted} (${percent}%)\n` +
                            `- Chưa hoàn thành: ${totalFailed}\n` +
                            `Trạng thái Google Sheet: ${region.sheet_id ? 'Đã liên kết' : 'Chưa liên kết'}`;

            // 5. Ghi nhận báo cáo vào CSDL (Đảm bảo tính Idempotent: xóa bản cũ nếu có)
            const workDate = task.publish_date || new Date().toLocaleDateString('sv');
            await db.run('DELETE FROM reports WHERE region_id = ? AND task_id = ?', [regionId, taskId]);
            const insertResult = await db.run(
                `INSERT INTO reports (task_id, report_type, region_id, work_date, total_members, total_completed, total_incomplete, content, created_at)
                 VALUES (?, 'region', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [taskId, regionId, workDate, totalMembers, totalCompleted, totalFailed, content]
            );

            return {
                id: insertResult.id,
                regionId,
                taskId,
                totalMembers,
                totalCompleted,
                totalFailed,
                content
            };
        } catch (err) {
            console.error(`[REPORT SERVICE] Lỗi khi sinh báo cáo cho Vùng ${regionId}:`, err);
            throw err;
        }
    }

    /**
     * Sinh báo cáo và lưu trữ cho một Cụm (Cluster) cụ thể
     * @param {number} clusterId 
     * @param {number} taskId 
     * @returns {Promise<Object>}
     */
    async generateClusterReport(clusterId, taskId) {
        try {
            // Lấy thông tin Cụm
            const cluster = await db.get('SELECT * FROM clusters WHERE id = ?', [clusterId]);
            if (!cluster) throw new Error(`Không tìm thấy Cụm ID ${clusterId}`);

            // Lấy thông tin Task
            const task = await db.get('SELECT * FROM tasks WHERE id = ?', [taskId]);
            if (!task) throw new Error(`Không tìm thấy Nhiệm vụ ID ${taskId}`);

            // 1. Tính tổng sứ giả hoạt động trong toàn Cụm
            const totalMembersRow = await db.get(
                `SELECT COUNT(*) as count 
                 FROM members m
                 JOIN regions r ON m.region_id = r.id
                 WHERE r.cluster_id = ? AND m.status = 'Active' AND r.status = 'active'`,
                [clusterId]
            );
            const totalMembers = totalMembersRow ? totalMembersRow.count : 0;

            // 2. Tính số sứ giả hoàn thành trong toàn Cụm ('approved' hoặc 'OK')
            const completedRow = await db.get(
                `SELECT COUNT(DISTINCT s.member_id) as count 
                 FROM submissions s
                 JOIN members m ON s.member_id = m.id
                 JOIN regions r ON m.region_id = r.id
                 WHERE r.cluster_id = ? AND s.task_id = ? AND (s.status = 'approved' OR s.status = 'OK') 
                   AND m.status = 'Active' AND r.status = 'active'`,
                [clusterId, taskId]
            );
            const totalCompleted = completedRow ? completedRow.count : 0;
            const totalFailed = Math.max(0, totalMembers - totalCompleted);

            // 3. Tạo nội dung báo cáo chuẩn hóa cho Cụm
            const percent = totalMembers > 0 ? ((totalCompleted / totalMembers) * 100).toFixed(1) : '0.0';
            const content = `Báo cáo Cụm: ${cluster.cluster_name}\n` +
                            `Nhiệm vụ: ${task.title} (${task.task_code})\n` +
                            `Ngày: ${task.publish_date}\n` +
                            `------------------------------------\n` +
                            `- Tổng số Sứ giả: ${totalMembers}\n` +
                            `- Đã hoàn thành: ${totalCompleted} (${percent}%)\n` +
                            `- Chưa hoàn thành: ${totalFailed}`;

            // 4. Lưu báo cáo vào CSDL (Đảm bảo tính Idempotent)
            const workDate = task.publish_date || new Date().toLocaleDateString('sv');
            await db.run('DELETE FROM reports WHERE cluster_id = ? AND task_id = ?', [clusterId, taskId]);
            const insertResult = await db.run(
                `INSERT INTO reports (task_id, report_type, cluster_id, work_date, total_members, total_completed, total_incomplete, content, created_at)
                 VALUES (?, 'cluster', ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
                [taskId, clusterId, workDate, totalMembers, totalCompleted, totalFailed, content]
            );

            return {
                id: insertResult.id,
                clusterId,
                taskId,
                totalMembers,
                totalCompleted,
                totalFailed,
                content
            };
        } catch (err) {
            console.error(`[REPORT SERVICE] Lỗi khi sinh báo cáo cho Cụm ${clusterId}:`, err);
            throw err;
        }
    }

    /**
     * Sinh báo cáo hàng ngày cho tất cả các Vùng hoạt động và các Cụm
     * @param {number} taskId 
     * @returns {Promise<Object>}
     */
    async generateDailyReports(taskId) {
        try {
            const activeRegions = await db.all("SELECT id FROM regions WHERE status = 'active'");
            const allClusters = await db.all("SELECT id FROM clusters");

            let regionReportsCount = 0;
            let clusterReportsCount = 0;

            // Chạy sinh báo cáo Vùng
            for (const r of activeRegions) {
                await this.generateRegionReport(r.id, taskId);
                regionReportsCount++;
            }

            // Chạy sinh báo cáo Cụm
            for (const c of allClusters) {
                await this.generateClusterReport(c.id, taskId);
                clusterReportsCount++;
            }

            return {
                success: true,
                regionReportsCount,
                clusterReportsCount
            };
        } catch (err) {
            console.error(`[REPORT SERVICE] Lỗi khi chạy tổng hợp báo cáo hàng ngày:`, err);
            throw err;
        }
    }
}

module.exports = new ReportService();

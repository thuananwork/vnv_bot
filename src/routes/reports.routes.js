const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');
const audit = require('../services/audit');
const { syncRegionSheet } = require('../services/sheet_sync');
const reportService = require('../services/reports_v2');

// GET /api/reports
router.get('/', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, regionId, all: isAll } = req.userScope;
    try {
        let query = `
            SELECT rep.*, t.task_code, c.cluster_name, r.region_name 
            FROM reports rep 
            LEFT JOIN tasks t ON rep.task_id = t.id
            LEFT JOIN clusters c ON rep.cluster_id = c.id
            LEFT JOIN regions r ON rep.region_id = r.id
        `;
        let params = [];

        if (!isAll) {
            if (role === 'cluster_leader') {
                query += ` WHERE rep.cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?)
                           OR rep.region_id IN (SELECT id FROM regions WHERE cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?))`;
                params.push(managerId, managerId);
            } else if (role === 'region_leader') {
                query += ' WHERE (rep.region_id IN (SELECT id FROM regions WHERE manager_id = ?) OR rep.region_id = ?)';
                params.push(managerId, regionId || 0);
            }
        }

        query += ' ORDER BY rep.created_at DESC';
        const reports = await db.all(query, params);
        res.json(reports);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách báo cáo.' });
    }
});

// POST /api/reports/generate
router.post('/generate', auth.requireAuth, async (req, res) => {
    const { task_id, region_id, cluster_id, work_date } = req.body;
    try {
        let workDate = work_date;
        if (!workDate && task_id) {
            const task = await db.get('SELECT publish_date FROM tasks WHERE id = ?', [task_id]);
            if (task) workDate = task.publish_date;
        }
        if (!workDate) {
            workDate = new Date().toISOString().split('T')[0];
        }

        if (region_id) {
            const report = await reportService.generateRegionReport(region_id, workDate);
            await audit.logAction(req.session.user.id, 'GENERATE_REPORT', `report:${report.id}`, { type: 'region', region_id, workDate }, req);
            return res.status(201).json({ message: 'Sinh báo cáo Vùng thành công.', report });
        } else if (cluster_id) {
            const report = await reportService.generateClusterReport(cluster_id, workDate);
            await audit.logAction(req.session.user.id, 'GENERATE_REPORT', `report:${report.id}`, { type: 'cluster', cluster_id, workDate }, req);
            return res.status(201).json({ message: 'Sinh báo cáo Cụm thành công.', report });
        } else {
            return res.status(400).json({ error: 'Vui lòng chọn Vùng hoặc Cụm cần sinh báo cáo.' });
        }
    } catch (err) {
        res.status(500).json({ error: 'Lỗi sinh báo cáo: ' + err.message });
    }
});

// POST /api/reports/:id/sync-sheet
router.post('/:id/sync-sheet', auth.requireAuth, async (req, res) => {
    const reportId = req.params.id;
    try {
        const report = await db.get(`
            SELECT rep.*, r.sheet_id, r.sheet_name, r.sheet_url, r.cluster_id AS region_cluster_id
            FROM reports rep 
            LEFT JOIN regions r ON rep.region_id = r.id 
            WHERE rep.id = ?
        `, [reportId]);

        if (!report) {
            return res.status(404).json({ error: 'Không tìm thấy báo cáo vùng hợp lệ.' });
        }
        
        const reportClusterId = report.report_type === 'cluster' ? report.cluster_id : report.region_cluster_id;

        if (req.session.user.role !== 'admin') {
            const { role, id: userId } = req.session.user;
            if (role === 'cluster_leader') {
                const managedCluster = await db.get('SELECT id FROM clusters WHERE manager_id = ?', [userId]);
                if (!managedCluster || managedCluster.id !== reportClusterId) {
                    return res.status(403).json({ error: 'Bạn không có quyền đồng bộ báo cáo ngoài cụm quản lý.' });
                }
            } else if (role === 'region_leader') {
                const userRegionId = req.session.user.managed_region_id;
                let isAllowed = userRegionId && userRegionId === report.region_id;
                if (!isAllowed) {
                    const managedRegion = await db.get('SELECT id FROM regions WHERE manager_id = ?', [userId]);
                    if (managedRegion && managedRegion.id === report.region_id) isAllowed = true;
                }
                if (!isAllowed) {
                    return res.status(403).json({ error: 'Bạn không có quyền đồng bộ báo cáo ngoài vùng quản lý.' });
                }
            }
        }

        let syncSuccess = false;
        if (report.report_type === 'cluster') {
            const childRegions = await db.all('SELECT id, sheet_id, sheet_name FROM regions WHERE cluster_id = ? AND sheet_id IS NOT NULL', [report.cluster_id]);
            if (childRegions.length === 0) {
                return res.status(400).json({ error: 'Không có vùng nào thuộc cụm này được cấu hình Google Sheet.' });
            }
            
            console.log(`[SHEET SYNC] Đang đồng bộ báo cáo cụm ID ${reportId} sang Google Sheets của ${childRegions.length} vùng...`);
            let allSync = true;
            for (const r of childRegions) {
                const ok = await syncRegionSheet(r.id, report.task_id);
                if (!ok) allSync = false;
            }
            syncSuccess = allSync;
        } else {
            if (!report.sheet_id) {
                return res.status(400).json({ error: 'Vùng này chưa được cấu hình Google Sheet.' });
            }
            console.log(`[SHEET SYNC] Đang đồng bộ báo cáo ID ${reportId} sang Google Sheet "${report.sheet_name}" (ID: ${report.sheet_id})...`);
            syncSuccess = await syncRegionSheet(report.region_id, report.task_id);
        }
        
        if (!syncSuccess) {
            return res.status(500).json({ error: 'Đồng bộ Google Sheet thất bại. Vui lòng kiểm tra lại cấu hình hoặc log.' });
        }
        
        await db.run('UPDATE reports SET sent_at = CURRENT_TIMESTAMP WHERE id = ?', [reportId]);
        await audit.logAction(req.session.user.id, 'SYNC_SHEET', `report:${reportId}`, `Đồng bộ Sheet thành công cho báo cáo ID ${reportId}`, req);

        const targetName = report.report_type === 'cluster' ? `Cụm ID ${report.cluster_id}` : `Google Sheet "${report.sheet_name}"`;
        res.json({ message: `Đã đồng bộ báo cáo thành công sang ${targetName}.` });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi đồng bộ Google Sheet.' });
    }
});

// POST /api/reports/cluster/auto-synthesize
// Tự động tổng hợp báo cáo Cụm 5 từ danh sách tin nhắn của các Trưởng/Phó Vùng
router.post('/cluster/auto-synthesize', auth.requireAuth, async (req, res) => {
    try {
        const { workDate, rawReports, clusterId = 5 } = req.body;
        const targetDate = workDate || new Date().toISOString().split('T')[0];
        const { parseRegionReport, synthesizeClusterReport } = require('../services/cluster_synthesizer');

        let parsedReports = [];
        if (Array.isArray(rawReports) && rawReports.length > 0) {
            for (const text of rawReports) {
                const p = parseRegionReport(text);
                if (p) parsedReports.push(p);
            }
        }

        const cluster = await db.get('SELECT * FROM clusters WHERE id = ?', [clusterId]) || { leader_name: 'Nguyễn Thuận An' };
        const result = await synthesizeClusterReport({
            parsedReports,
            workDate: targetDate,
            clusterLeaderName: cluster.leader_name || 'Nguyễn Thuận An',
            clusterId
        });

        // Lưu vào bảng reports
        let task = await db.get("SELECT id FROM tasks WHERE publish_date = ?", [targetDate]);
        const taskId = task ? task.id : 1;
        await db.run('DELETE FROM reports WHERE cluster_id = ? AND work_date = ?', [clusterId, targetDate]);
        const insertRes = await db.run(`
            INSERT INTO reports (task_id, report_type, cluster_id, work_date, total_members, total_completed, total_incomplete, content)
            VALUES (?, 'cluster', ?, ?, ?, ?, ?, ?)
        `, [taskId, clusterId, targetDate, result.totalClusterMembers, result.totalClusterCompleted, result.totalClusterIncomplete, result.content]);

        res.json({
            success: true,
            reportId: insertRes.id,
            ...result
        });
    } catch (err) {
        console.error('[AUTO SYNTHESIZE] Error:', err);
        res.status(500).json({ error: 'Lỗi khi tổng hợp báo cáo Cụm: ' + err.message });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');

// GET /api/dashboard/summary
router.get('/summary', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, regionId, all: isAll } = req.userScope;
    try {
        let stats = {
            clusters: 0,
            regions: 0,
            members: 0,
            submissions: 0,
            tasks: 0
        };

        if (isAll) {
            const clusterCnt = await db.get('SELECT COUNT(*) as count FROM clusters');
            const regionCnt = await db.get('SELECT COUNT(*) as count FROM regions');
            const memberCnt = await db.get('SELECT COUNT(*) as count FROM members');
            const submissionCnt = await db.get('SELECT COUNT(*) as count FROM submissions');
            const taskCnt = await db.get('SELECT COUNT(*) as count FROM tasks');
            
            stats.clusters = clusterCnt.count;
            stats.regions = regionCnt.count;
            stats.members = memberCnt.count;
            stats.submissions = submissionCnt.count;
            stats.tasks = taskCnt.count;
        } else if (role === 'cluster_leader') {
            const cluster = await db.get('SELECT id FROM clusters WHERE manager_id = ?', [managerId]);
            if (cluster) {
                const regionCnt = await db.get('SELECT COUNT(*) as count FROM regions WHERE cluster_id = ?', [cluster.id]);
                const memberCnt = await db.get('SELECT COUNT(*) as count FROM members WHERE region_id IN (SELECT id FROM regions WHERE cluster_id = ?)', [cluster.id]);
                const submissionCnt = await db.get('SELECT COUNT(*) as count FROM submissions WHERE member_id IN (SELECT id FROM members WHERE region_id IN (SELECT id FROM regions WHERE cluster_id = ?))', [cluster.id]);
                const taskCnt = await db.get('SELECT COUNT(DISTINCT task_id) as count FROM submissions WHERE member_id IN (SELECT id FROM members WHERE region_id IN (SELECT id FROM regions WHERE cluster_id = ?))', [cluster.id]);

                stats.clusters = 1;
                stats.regions = regionCnt.count;
                stats.members = memberCnt.count;
                stats.submissions = submissionCnt.count;
                stats.tasks = taskCnt.count;
            }
        } else if (role === 'region_leader') {
            const region = await db.get('SELECT id FROM regions WHERE manager_id = ? OR id = ?', [managerId, regionId || 0]);
            if (region) {
                const memberCnt = await db.get('SELECT COUNT(*) as count FROM members WHERE region_id = ?', [region.id]);
                const submissionCnt = await db.get('SELECT COUNT(*) as count FROM submissions WHERE member_id IN (SELECT id FROM members WHERE region_id = ?)', [region.id]);
                const taskCnt = await db.get('SELECT COUNT(DISTINCT task_id) as count FROM submissions WHERE member_id IN (SELECT id FROM members WHERE region_id = ?)', [region.id]);

                stats.clusters = 0;
                stats.regions = 1;
                stats.members = memberCnt.count;
                stats.submissions = submissionCnt.count;
                stats.tasks = taskCnt.count;
            }
        }
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi truy vấn dữ liệu thống kê.' });
    }
});

// GET /api/dashboard/overview?date=YYYY-MM-DD
router.get('/overview', auth.requireAuth, auth.checkScope, async (req, res) => {
    try {
        const { role, managerId, regionId, all: isAll } = req.userScope;
        const workDate = req.query.date || new Date().toLocaleDateString('sv');

        let regions = [];
        if (isAll) {
            regions = await db.all('SELECT id, region_name, sheet_id, sheet_name, leader_name, deputy_name FROM regions WHERE status = "active" ORDER BY id ASC');
        } else if (role === 'cluster_leader') {
            const cluster = await db.get('SELECT id FROM clusters WHERE manager_id = ?', [managerId]);
            if (cluster) {
                regions = await db.all('SELECT id, region_name, sheet_id, sheet_name, leader_name, deputy_name FROM regions WHERE cluster_id = ? AND status = "active" ORDER BY id ASC', [cluster.id]);
            }
        } else if (role === 'region_leader') {
            regions = await db.all('SELECT id, region_name, sheet_id, sheet_name, leader_name, deputy_name FROM regions WHERE (manager_id = ? OR id = ?) AND status = "active" ORDER BY id ASC', [managerId, regionId || 0]);
        }

        const regionStats = [];
        let totalMembersAll = 0;
        let completedAll = 0;

        for (const reg of regions) {
            const totalRow = await db.get(
                'SELECT COUNT(*) as cnt FROM members WHERE region_id = ? AND status = "Active"',
                [reg.id]
            );
            const total = totalRow ? totalRow.cnt : 0;

            const completedRow = await db.get(
                'SELECT COUNT(*) as cnt FROM submissions WHERE region_id = ? AND work_date = ? AND status = "OK"',
                [reg.id, workDate]
            );
            const completed = completedRow ? completedRow.cnt : 0;

            const pct = total > 0 ? Math.round((completed / total) * 100) : 0;

            totalMembersAll += total;
            completedAll += completed;

            regionStats.push({
                id: reg.id,
                name: reg.region_name,
                leader_name: reg.leader_name,
                deputy_name: reg.deputy_name,
                total,
                completed,
                incomplete: Math.max(0, total - completed),
                rate: pct
            });
        }

        const incompleteAll = Math.max(0, totalMembersAll - completedAll);
        const rateAll = totalMembersAll > 0 ? Math.round((completedAll / totalMembersAll) * 100) : 0;

        res.json({
            success: true,
            workDate,
            totals: {
                totalMembers: totalMembersAll,
                completed: completedAll,
                incomplete: incompleteAll,
                rate: rateAll
            },
            regions: regionStats
        });
    } catch (err) {
        res.status(500).json({ success: false, error: 'Lỗi tải tổng quan: ' + err.message });
    }
});

module.exports = router;


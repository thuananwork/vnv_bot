const express = require('express');
const router = express.Router();
const auth = require('../middlewares/auth');
const { healthProvider, reloadScheduler, runner, configProvider } = require('../scheduler');

// GET /api/scheduler/status
router.get('/status', auth.requireAuth, async (req, res) => {
    try {
        const enabled = await configProvider.isSchedulerEnabled();
        const timezone = await configProvider.getTimezone();
        const uptime = healthProvider.getUptime();
        const metrics = await healthProvider.getMetrics();
        
        const jobsList = require('../scheduler/jobs');
        const jobsStatus = [];
        for (const job of jobsList) {
            const status = await healthProvider.getJobStatus(job);
            jobsStatus.push(status);
        }
        
        const globalStatus = healthProvider.getGlobalStatus(jobsStatus, enabled);
        
        res.json({
            enabled,
            timezone,
            globalStatus,
            uptime,
            schedulerVersion: '1.0.0',
            metrics,
            jobs: jobsStatus
        });
    } catch (err) {
        console.error('[API SCHEDULER STATUS] Lỗi khi lấy trạng thái:', err);
        res.status(500).json({ error: 'Lỗi khi lấy trạng thái bộ định thời.' });
    }
});

// POST /api/scheduler/reload
router.post('/reload', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    try {
        const result = await reloadScheduler();
        res.json(result);
    } catch (err) {
        console.error('[API SCHEDULER RELOAD] Lỗi khi nạp lại cấu hình:', err);
        res.status(500).json({ error: 'Không thể nạp lại cấu hình Scheduler.', details: err.message });
    }
});

module.exports = router;

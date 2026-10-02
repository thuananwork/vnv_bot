const express = require('express');
const router = express.Router();

const authRoutes = require('./auth.routes');
const dashboardRoutes = require('./dashboard.routes');
const usersRoutes = require('./users.routes');
const clustersRoutes = require('./clusters.routes');
const regionsRoutes = require('./regions.routes');
const tasksRoutes = require('./tasks.routes');
const membersRoutes = require('./members.routes');
const submissionsRoutes = require('./submissions.routes');
const reportsRoutes = require('./reports.routes');
const auditRoutes = require('./audit.routes');
const schedulerRoutes = require('./scheduler.routes');
const systemRoutes = require('./system.routes');
const webhooksRoutes = require('./webhooks.routes');
const actionsV2Routes = require('./actions_v2');

// Mount child routers
router.use('/auth', authRoutes);
router.use('/dashboard', dashboardRoutes);
router.use('/users', usersRoutes);
router.use('/clusters', clustersRoutes);
router.use('/regions', regionsRoutes);
router.use('/tasks', tasksRoutes);
router.use('/members', membersRoutes);
router.use('/submissions', submissionsRoutes);
router.use('/reports', reportsRoutes);
router.use('/audit-logs', auditRoutes);
router.use('/scheduler', schedulerRoutes);
router.use('/webhooks', webhooksRoutes);
router.use('/v2', actionsV2Routes);

// System routes mounted under /api (/api/health, /api/ready, /api/live-reload, /api/system/backup, etc.)
router.use('/', systemRoutes);

if (process.env.NODE_ENV === 'test') {
    router.post('/test/reset-rate-limiters', (req, res) => {
        if (typeof authRoutes.resetLoginRateLimiters === 'function') {
            authRoutes.resetLoginRateLimiters();
        }
        res.json({ ok: true });
    });
}

module.exports = router;

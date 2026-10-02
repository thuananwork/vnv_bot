const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');

// GET /api/audit-logs
router.get('/', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    try {
        const logs = await db.all(`
            SELECT a.*, u.username, u.full_name 
            FROM audit_logs a 
            LEFT JOIN users u ON a.user_id = u.id 
            ORDER BY a.created_at DESC 
            LIMIT 200
        `);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách nhật ký.' });
    }
});

module.exports = router;

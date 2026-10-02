const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');
const audit = require('../services/audit');

// GET /api/submissions
router.get('/', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, regionId, all: isAll } = req.userScope;
    try {
        let query = `
            SELECT s.*, m.real_name, m.real_name as zalo_name, r.region_name, t.task_code, t.title as task_title 
            FROM submissions s 
            LEFT JOIN members m ON s.member_id = m.id
            LEFT JOIN regions r ON m.region_id = r.id
            LEFT JOIN tasks t ON s.task_id = t.id
        `;
        let params = [];

        if (!isAll) {
            if (role === 'cluster_leader') {
                query += ' WHERE r.cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?)';
                params.push(managerId);
            } else if (role === 'region_leader') {
                query += ' WHERE (r.manager_id = ? OR r.id = ?)';
                params.push(managerId, regionId || 0);
            }
        }

        query += ' ORDER BY s.submitted_at DESC';
        const submissions = await db.all(query, params);
        res.json(submissions);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách nộp bài.' });
    }
});

// POST /api/submissions
router.post('/', auth.requireAuth, async (req, res) => {
    const { task_id, member_id, submission_type, raw_content, status, notes } = req.body;
    if (!task_id || !member_id) {
        return res.status(400).json({ error: 'Vui lòng chọn Nhiệm vụ và Sứ giả.' });
    }
    const zaloMsgId = `manual_sub_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    try {
        const result = await db.run(
            `INSERT INTO submissions (task_id, member_id, zalo_msg_id, submission_type, raw_content, status, notes, submitted_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`,
            [task_id, member_id, zaloMsgId, submission_type || 'manual', raw_content || '', status || 'approved', notes || 'Tạo thủ công']
        );
        await audit.logAction(req.session.user.id, 'CREATE_SUBMISSION', `submission:${result.id}`, { task_id, member_id, status }, req);
        res.status(201).json({ message: 'Thêm bài nộp thủ công thành công.', id: result.id });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi tạo bài nộp thủ công.' });
    }
});

// PUT /api/submissions/:id/status
router.put('/:id/status', auth.requireAuth, async (req, res) => {
    const subId = req.params.id;
    const { status, notes } = req.body;
    if (!['approved', 'rejected', 'pending_review'].includes(status)) {
        return res.status(400).json({ error: 'Trạng thái không hợp lệ.' });
    }
    try {
        await db.run(
            'UPDATE submissions SET status = ?, notes = ?, processed_at = CURRENT_TIMESTAMP WHERE id = ?',
            [status, notes || '', subId]
        );
        await audit.logAction(req.session.user.id, 'REVIEW_SUBMISSION', `submission:${subId}`, { status, notes }, req);
        res.json({ message: 'Cập nhật trạng thái duyệt bài nộp thành công.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi cập nhật bài nộp.' });
    }
});

module.exports = router;

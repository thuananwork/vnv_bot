const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');
const audit = require('../services/audit');

// GET /api/tasks
router.get('/', auth.requireAuth, async (req, res) => {
    try {
        const tasks = await db.all('SELECT * FROM tasks ORDER BY publish_date DESC');
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách tasks.' });
    }
});

// POST /api/tasks
router.post('/', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const { task_code, title, description, publish_date, status } = req.body;
    if (!task_code || !publish_date) {
        return res.status(400).json({ error: 'Mã nhiệm vụ và ngày phát hành không được bỏ trống.' });
    }
    try {
        const result = await db.run(
            'INSERT INTO tasks (task_code, title, description, publish_date, status) VALUES (?, ?, ?, ?, ?)',
            [task_code, title || task_code, description || '', publish_date, status || 'active']
        );
        await audit.logAction(req.session.user.id, 'CREATE_TASK', `task:${result.id}`, { task_code, title, publish_date }, req);
        res.status(201).json({ message: 'Tạo nhiệm vụ thành công.', id: result.id });
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Mã nhiệm vụ này đã tồn tại.' });
        }
        res.status(500).json({ error: 'Lỗi khi tạo nhiệm vụ.' });
    }
});

// PUT /api/tasks/:id
router.put('/:id', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const taskId = req.params.id;
    const { task_code, title, description, publish_date, status } = req.body;
    try {
        await db.run(
            'UPDATE tasks SET task_code = ?, title = ?, description = ?, publish_date = ?, status = ? WHERE id = ?',
            [task_code, title, description, publish_date, status, taskId]
        );
        await audit.logAction(req.session.user.id, 'UPDATE_TASK', `task:${taskId}`, { task_code, title, status }, req);
        res.json({ message: 'Cập nhật nhiệm vụ thành công.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi cập nhật nhiệm vụ.' });
    }
});

// DELETE /api/tasks/:id
router.delete('/:id', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const taskId = req.params.id;
    try {
        await db.run('DELETE FROM tasks WHERE id = ?', [taskId]);
        await audit.logAction(req.session.user.id, 'DELETE_TASK', `task:${taskId}`, `Đã xóa nhiệm vụ ID ${taskId}`, req);
        res.json({ message: 'Xóa nhiệm vụ thành công.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi xóa nhiệm vụ.' });
    }
});

module.exports = router;

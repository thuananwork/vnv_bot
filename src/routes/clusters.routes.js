const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');
const audit = require('../services/audit');

function extractSpreadsheetId(sheetId, sheetUrl) {
    const raw = (sheetId || sheetUrl || '').trim();
    if (!raw) return null;
    const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : raw;
}

// GET /api/clusters
router.get('/', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, regionId, all: isAll } = req.userScope;
    try {
        let query = `
            SELECT c.*, u.full_name as manager_name 
            FROM clusters c 
            LEFT JOIN users u ON c.manager_id = u.id
        `;
        let params = [];

        if (!isAll) {
            if (role === 'cluster_leader') {
                query += ' WHERE c.manager_id = ?';
                params.push(managerId);
            } else if (role === 'region_leader') {
                query += ' WHERE c.id IN (SELECT cluster_id FROM regions WHERE manager_id = ? OR id = ?)';
                params.push(managerId, regionId || 0);
            }
        }

        const clusters = await db.all(query, params);
        const mapped = clusters.map(c => ({
            ...c,
            sheet_url: c.sheet_url || (c.sheet_id ? `https://docs.google.com/spreadsheets/d/${c.sheet_id}/edit` : null)
        }));
        res.json(mapped);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách cụm.' });
    }
});

// GET /api/clusters/:id
router.get('/:id', auth.requireAuth, async (req, res) => {
    const clusterId = req.params.id;
    try {
        const cluster = await db.get(`
            SELECT c.*, u.full_name as manager_name 
            FROM clusters c 
            LEFT JOIN users u ON c.manager_id = u.id
            WHERE c.id = ?
        `, [clusterId]);
        if (!cluster) {
            return res.status(404).json({ error: 'Không tìm thấy cụm.' });
        }
        res.json({
            ...cluster,
            sheet_url: cluster.sheet_url || (cluster.sheet_id ? `https://docs.google.com/spreadsheets/d/${cluster.sheet_id}/edit` : null)
        });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy thông tin cụm.' });
    }
});

// POST /api/clusters
router.post('/', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const { cluster_name, manager_id } = req.body;
    if (!cluster_name) {
        return res.status(400).json({ error: 'Tên cụm không được bỏ trống.' });
    }

    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            if (manager_id) {
                const mgrUser = await db.get('SELECT role FROM users WHERE id = ?', [manager_id]);
                if (!mgrUser) {
                    await db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Người quản lý được gán không tồn tại.' });
                }
                if (mgrUser.role !== 'cluster_leader') {
                    await db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Chỉ có tài khoản vai trò Trưởng Cụm mới được gán quản lý Cụm.' });
                }
            }

            const result = await db.run(
                'INSERT INTO clusters (cluster_name, manager_id) VALUES (?, ?)',
                [cluster_name, manager_id || null]
            );

            if (manager_id) {
                await db.run('UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [manager_id]);
            }

            await audit.logAction(req.session.user.id, 'CREATE_CLUSTER', `cluster:${result.id}`, { cluster_name, manager_id }, req);
            await db.run('COMMIT');
            res.status(201).json({ message: 'Tạo cụm thành công.', id: result.id });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Tên cụm hoặc Trưởng Cụm này đã được gán cho cụm khác.' });
        }
        res.status(500).json({ error: 'Lỗi khi tạo cụm.' });
    }
});

// PUT /api/clusters/:id
router.put('/:id', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const clusterId = req.params.id;
    const { cluster_name, manager_id, sheet_id, sheet_url, sheet_name } = req.body;
    const cleanSheetId = extractSpreadsheetId(sheet_id, sheet_url);

    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            const currentCluster = await db.get('SELECT manager_id FROM clusters WHERE id = ?', [clusterId]);
            if (!currentCluster) {
                await db.run('ROLLBACK');
                return res.status(404).json({ error: 'Không tìm thấy cụm.' });
            }

            const oldManagerId = currentCluster.manager_id;
            const newManagerId = manager_id !== undefined ? (manager_id ? parseInt(manager_id) : null) : oldManagerId;

            if (newManagerId && newManagerId !== oldManagerId) {
                const mgrUser = await db.get('SELECT role FROM users WHERE id = ?', [newManagerId]);
                if (!mgrUser) {
                    await db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Người quản lý được gán không tồn tại.' });
                }
                if (mgrUser.role !== 'cluster_leader') {
                    await db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Chỉ có tài khoản vai trò Trưởng Cụm mới được gán quản lý Cụm.' });
                }
            }

            await db.run(
                `UPDATE clusters 
                 SET cluster_name = COALESCE(?, cluster_name), 
                     manager_id = ?, 
                     sheet_id = COALESCE(?, sheet_id),
                     sheet_url = COALESCE(?, sheet_url),
                     sheet_name = COALESCE(?, sheet_name),
                     updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [cluster_name || null, newManagerId, cleanSheetId || null, sheet_url || null, sheet_name || null, clusterId]
            );

            if (oldManagerId !== newManagerId) {
                if (oldManagerId) {
                    await db.run('UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [oldManagerId]);
                }
                if (newManagerId) {
                    await db.run('UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newManagerId]);
                }
            }

            await audit.logAction(req.session.user.id, 'UPDATE_CLUSTER', `cluster:${clusterId}`, { cluster_name, manager_id, sheet_url }, req);
            await db.run('COMMIT');
            res.json({ message: 'Cập nhật cụm thành công.' });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Tên cụm hoặc Trưởng Cụm này đã được gán cho cụm khác.' });
        }
        res.status(500).json({ error: 'Lỗi khi cập nhật cụm.' });
    }
});

// POST /api/clusters/:id/sheet-link: Cập nhật nhanh liên kết Google Sheet cho Cụm (Admin)
router.post('/:id/sheet-link', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const clusterId = req.params.id;
    const { sheet_url, sheet_id, sheet_name } = req.body;
    const cleanSheetId = extractSpreadsheetId(sheet_id, sheet_url);

    try {
        const cluster = await db.get('SELECT * FROM clusters WHERE id = ?', [clusterId]);
        if (!cluster) {
            return res.status(404).json({ error: 'Không tìm thấy cụm.' });
        }

        await db.run(
            `UPDATE clusters 
             SET sheet_url = ?, 
                 sheet_id = ?, 
                 sheet_name = COALESCE(?, sheet_name), 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [sheet_url ? sheet_url.trim() : null, cleanSheetId || null, sheet_name ? sheet_name.trim() : null, clusterId]
        );

        if (req.session && req.session.user) {
            await audit.logAction(
                req.session.user.id,
                'UPDATE_CLUSTER_SHEET_LINK',
                `cluster:${clusterId}`,
                `Cập nhật link Sheet cho Cụm ${clusterId}: ${sheet_url || cleanSheetId}`,
                req
            );
        }

        const updated = await db.get('SELECT * FROM clusters WHERE id = ?', [clusterId]);
        const fullSheetUrl = updated.sheet_url || (updated.sheet_id ? `https://docs.google.com/spreadsheets/d/${updated.sheet_id}/edit` : null);

        res.json({
            success: true,
            message: `Đã cập nhật liên kết Google Sheet cho ${cluster.cluster_name} thành công!`,
            data: {
                ...updated,
                sheet_url: fullSheetUrl
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi cập nhật liên kết Sheet: ' + err.message });
    }
});

// DELETE /api/clusters/:id
router.delete('/:id', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const clusterId = req.params.id;
    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            const currentCluster = await db.get('SELECT manager_id FROM clusters WHERE id = ?', [clusterId]);
            if (currentCluster) {
                await db.run('DELETE FROM clusters WHERE id = ?', [clusterId]);
                if (currentCluster.manager_id) {
                    await db.run('UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [currentCluster.manager_id]);
                }
                await audit.logAction(req.session.user.id, 'DELETE_CLUSTER', `cluster:${clusterId}`, `Đã xóa cụm ID ${clusterId}`, req);
            }
            await db.run('COMMIT');
            res.json({ message: 'Xóa cụm thành công.' });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi xóa cụm.' });
    }
});

module.exports = router;

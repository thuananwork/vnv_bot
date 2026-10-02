const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');
const audit = require('../services/audit');

// GET /api/regions
router.get('/', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, regionId, all: isAll } = req.userScope;
    try {
        let query = `
            SELECT r.*, c.cluster_name, u.full_name as manager_name 
            FROM regions r 
            LEFT JOIN clusters c ON r.cluster_id = c.id
            LEFT JOIN users u ON r.manager_id = u.id
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

        const regions = await db.all(query, params);
        const { getExpectedMonthTab } = require('../utils/sheet_time');
        const currentMonthTab = getExpectedMonthTab();

        const mapped = regions.map(r => {
            const sheetUrl = r.sheet_url || (r.sheet_id ? `https://docs.google.com/spreadsheets/d/${r.sheet_id}/edit` : null);
            const activeTab = r.sheet_name || currentMonthTab;
            return {
                ...r,
                sheet_url: sheetUrl,
                sheet_name: activeTab,
                current_month_tab: activeTab,
                display_sheet_tab: activeTab
            };
        });

        res.json(mapped);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách vùng.' });
    }
});

function extractSpreadsheetId(sheetId, sheetUrl) {
    const raw = (sheetId || sheetUrl || '').trim();
    if (!raw) return null;
    const match = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : raw;
}

// POST /api/regions
router.post('/', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const { region_name, cluster_id, manager_id, zalo_group_id, zalo_group_name, sheet_id, sheet_url, sheet_name } = req.body;
    if (!region_name || !zalo_group_id || !zalo_group_name) {
        return res.status(400).json({ error: 'Thiếu thông tin vùng bắt buộc.' });
    }
    const cleanSheetId = extractSpreadsheetId(sheet_id, sheet_url);

    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            if (manager_id) {
                const mgrUser = await db.get('SELECT role FROM users WHERE id = ?', [manager_id]);
                if (!mgrUser) {
                    await db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Người quản lý được gán không tồn tại.' });
                }
                if (mgrUser.role !== 'region_leader') {
                    await db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Chỉ có tài khoản vai trò Trưởng Vùng mới được gán quản lý Vùng.' });
                }
            }

            const result = await db.run(
                `INSERT INTO regions (region_name, cluster_id, manager_id, zalo_group_id, zalo_group_name, sheet_id, sheet_url, sheet_name) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [region_name, cluster_id || null, manager_id || null, zalo_group_id, zalo_group_name, cleanSheetId || null, sheet_url || null, sheet_name || null]
            );

            if (manager_id) {
                await db.run('UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [manager_id]);
            }

            await audit.logAction(req.session.user.id, 'CREATE_REGION', `region:${result.id}`, { region_name, cluster_id, manager_id }, req);
            await db.run('COMMIT');
            res.status(201).json({ message: 'Tạo vùng thành công.', id: result.id });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            if (err.message.includes('sheet_id')) {
                return res.status(400).json({ error: 'Google Sheet ID này đã được liên kết với một Vùng khác.' });
            }
            if (err.message.includes('manager_id')) {
                return res.status(400).json({ error: 'Trưởng Vùng này đã được phân công quản lý một Vùng khác.' });
            }
            return res.status(400).json({ error: 'Tên vùng hoặc Zalo Group ID đã tồn tại.' });
        }
        res.status(500).json({ error: 'Lỗi khi tạo vùng.' });
    }
});

// PUT /api/regions/:id
router.put('/:id', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const regionId = req.params.id;
    const { region_name, cluster_id, manager_id, zalo_group_id, zalo_group_name, status, sheet_id, sheet_url, sheet_name } = req.body;
    const cleanSheetId = extractSpreadsheetId(sheet_id, sheet_url);

    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            const currentRegion = await db.get('SELECT manager_id FROM regions WHERE id = ?', [regionId]);
            if (!currentRegion) {
                await db.run('ROLLBACK');
                return res.status(404).json({ error: 'Không tìm thấy vùng.' });
            }

            const oldManagerId = currentRegion.manager_id;
            const newManagerId = manager_id ? parseInt(manager_id) : null;

            if (newManagerId) {
                const mgrUser = await db.get('SELECT role FROM users WHERE id = ?', [newManagerId]);
                if (!mgrUser) {
                    await db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Người quản lý được gán không tồn tại.' });
                }
                if (mgrUser.role !== 'region_leader') {
                    await db.run('ROLLBACK');
                    return res.status(400).json({ error: 'Chỉ có tài khoản vai trò Trưởng Vùng mới được gán quản lý Vùng.' });
                }
            }

            await db.run(
                `UPDATE regions 
                 SET region_name = ?, cluster_id = ?, manager_id = ?, zalo_group_id = ?, zalo_group_name = ?, status = ?, sheet_id = ?, sheet_url = ?, sheet_name = ?, updated_at = CURRENT_TIMESTAMP 
                 WHERE id = ?`,
                [region_name, cluster_id || null, newManagerId, zalo_group_id, zalo_group_name, status || 'active', cleanSheetId || null, sheet_url || null, sheet_name || null, regionId]
            );

            if (oldManagerId !== newManagerId) {
                if (oldManagerId) {
                    await db.run('UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [oldManagerId]);
                }
                if (newManagerId) {
                    await db.run('UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newManagerId]);
                }
            }

            await audit.logAction(req.session.user.id, 'UPDATE_REGION', `region:${regionId}`, { region_name, cluster_id, manager_id, status }, req);
            await db.run('COMMIT');
            res.json({ message: 'Cập nhật vùng thành công.' });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        if (err.message && err.message.includes('UNIQUE constraint failed')) {
            if (err.message.includes('sheet_id')) {
                return res.status(400).json({ error: 'Google Sheet ID này đã được liên kết với một Vùng khác.' });
            }
            if (err.message.includes('manager_id')) {
                return res.status(400).json({ error: 'Trưởng Vùng này đã được phân công quản lý một Vùng khác.' });
            }
            return res.status(400).json({ error: 'Tên vùng hoặc Zalo Group ID đã tồn tại.' });
        }
        res.status(500).json({ error: 'Lỗi khi cập nhật vùng.' });
    }
});

// DELETE /api/regions/:id
router.delete('/:id', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const regionId = req.params.id;
    try {
        await db.run('BEGIN IMMEDIATE');
        try {
            const currentRegion = await db.get('SELECT manager_id FROM regions WHERE id = ?', [regionId]);
            if (currentRegion) {
                await db.run('DELETE FROM regions WHERE id = ?', [regionId]);
                if (currentRegion.manager_id) {
                    await db.run('UPDATE users SET session_version = session_version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [currentRegion.manager_id]);
                }
                await audit.logAction(req.session.user.id, 'DELETE_REGION', `region:${regionId}`, `Đã xóa vùng ID ${regionId}`, req);
            }
            await db.run('COMMIT');
            res.json({ message: 'Xóa vùng thành công.' });
        } catch (dbErr) {
            await db.run('ROLLBACK');
            throw dbErr;
        }
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi xóa vùng.' });
    }
});

// GET /api/regions/:id
router.get('/:id', auth.requireAuth, async (req, res) => {
    const regionId = req.params.id;
    try {
        const region = await db.get(`
            SELECT r.*, c.cluster_name, u.full_name as manager_name 
            FROM regions r 
            LEFT JOIN clusters c ON r.cluster_id = c.id
            LEFT JOIN users u ON r.manager_id = u.id
            WHERE r.id = ?
        `, [regionId]);
        if (!region) {
            return res.status(404).json({ error: 'Không tìm thấy vùng.' });
        }
        const { getExpectedMonthTab } = require('../utils/sheet_time');
        const currentMonthTab = getExpectedMonthTab();
        const activeTab = region.sheet_name || currentMonthTab;
        const sheetUrl = region.sheet_url || (region.sheet_id ? `https://docs.google.com/spreadsheets/d/${region.sheet_id}/edit` : null);
        res.json({
            success: true,
            data: {
                ...region,
                sheet_url: sheetUrl,
                sheet_name: activeTab,
                current_month_tab: activeTab
            },
            ...region,
            sheet_url: sheetUrl,
            sheet_name: activeTab,
            current_month_tab: activeTab
        });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy thông tin vùng.' });
    }
});

// POST /api/regions/bulk-month-tab: Đổi tab tháng đồng loạt cho toàn bộ các Vùng và Cụm (Admin/Cluster)
router.post('/bulk-month-tab', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    const { new_sheet_name, apply_clusters = true, auto_duplicate = false } = req.body;
    
    if (!new_sheet_name || typeof new_sheet_name !== 'string' || !new_sheet_name.trim()) {
        return res.status(400).json({ error: 'Tên tab tháng mới không hợp lệ.' });
    }

    const cleanTab = new_sheet_name.trim();

    try {
        // 1. Cập nhật cho toàn bộ các Vùng active
        const regions = await db.all("SELECT id, region_name, sheet_id, sheet_name FROM regions WHERE status = 'active' ORDER BY id ASC");
        await db.run(
            `UPDATE regions 
             SET sheet_name = ?, 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE status = 'active'`,
            [cleanTab]
        );

        // 2. Cập nhật cho Cụm nếu được yêu cầu
        let clustersUpdated = 0;
        if (apply_clusters) {
            const clusterRes = await db.run(
                `UPDATE clusters 
                 SET sheet_name = ?, 
                     updated_at = CURRENT_TIMESTAMP`,
                [cleanTab]
            );
            clustersUpdated = clusterRes.changes || 0;
        }

        // 3. Xóa cache metadata của Google Sheets Client
        const GoogleSheetsClient = require('../services/google/sheets');
        GoogleSheetsClient.clearMetadataCache();

        // 4. Nếu có yêu cầu tự động tạo tab mới trên Google Sheet bằng cách nhân bản tab cũ
        const duplicateResults = [];
        if (auto_duplicate === true) {
            const { getPreviousMonthTab } = require('../utils/sheet_time');
            for (const r of regions) {
                if (!r.sheet_id) continue;
                try {
                    const fallbackSource = r.sheet_name || getPreviousMonthTab();
                    const dup = await GoogleSheetsClient.duplicateMonthTab(r.sheet_id, fallbackSource, cleanTab);
                    duplicateResults.push({
                        regionId: r.id,
                        regionName: r.region_name,
                        success: true,
                        message: dup.message || 'Đã nhân bản tab thành công'
                    });
                } catch (dupErr) {
                    duplicateResults.push({
                        regionId: r.id,
                        regionName: r.region_name,
                        success: false,
                        error: dupErr.message
                    });
                }
            }
        }

        // 5. Ghi nhận audit log
        if (req.session && req.session.user) {
            await audit.logAction(
                req.session.user.id,
                'BULK_UPDATE_MONTH_TAB',
                'system:sheets',
                `Đổi tab tháng đồng loạt sang "${cleanTab}" cho ${regions.length} vùng và ${clustersUpdated} cụm (auto_duplicate: ${auto_duplicate})`,
                req
            );
        }

        res.json({
            success: true,
            message: `Đã áp dụng thành công Tab tháng "${cleanTab}" cho ${regions.length} Vùng${apply_clusters ? ' và Cụm' : ''}!`,
            data: {
                new_sheet_name: cleanTab,
                updated_regions: regions.length,
                updated_clusters: clustersUpdated,
                duplicate_results: duplicateResults
            }
        });
    } catch (err) {
        console.error('Lỗi khi đổi tab tháng đồng loạt:', err);
        res.status(500).json({ error: 'Lỗi đổi tab tháng đồng loạt: ' + err.message });
    }
});

// POST /api/regions/:id/sheet-link: Cập nhật nhanh liên kết Google Sheet cho Vùng (Admin / Trưởng Vùng)
router.post('/:id/sheet-link', auth.requireAuth, async (req, res) => {
    const regionId = req.params.id;
    const user = req.session.user;

    // Cho phép Admin, Cluster Leader và Trưởng / Phó Vùng quản lý vùng này
    if (user && user.role === 'region_leader' && user.managed_region_id && String(user.managed_region_id) !== String(regionId)) {
        return res.status(403).json({ error: 'Bạn chỉ có quyền cập nhật liên kết sheet của vùng mình.' });
    }

    const { sheet_url, sheet_id, sheet_name } = req.body;
    const cleanSheetId = extractSpreadsheetId(sheet_id, sheet_url);

    try {
        const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
        if (!region) {
            return res.status(404).json({ error: 'Không tìm thấy vùng.' });
        }

        await db.run(
            `UPDATE regions 
             SET sheet_url = ?, 
                 sheet_id = ?, 
                 sheet_name = COALESCE(?, sheet_name), 
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [sheet_url ? sheet_url.trim() : null, cleanSheetId || null, sheet_name ? sheet_name.trim() : null, regionId]
        );

        if (req.session && req.session.user) {
            await audit.logAction(
                req.session.user.id,
                'UPDATE_REGION_SHEET_LINK',
                `region:${regionId}`,
                `Cập nhật link Sheet cho Vùng ${regionId}: ${sheet_url || cleanSheetId}`,
                req
            );
        }

        const updated = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
        const fullSheetUrl = updated.sheet_url || (updated.sheet_id ? `https://docs.google.com/spreadsheets/d/${updated.sheet_id}/edit` : null);

        res.json({
            success: true,
            message: `Đã cập nhật liên kết Google Sheet cho ${region.region_name} thành công!`,
            data: {
                ...updated,
                sheet_url: fullSheetUrl
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi cập nhật liên kết Sheet: ' + err.message });
    }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');
const onDemandService = require('../services/on_demand_actions');
const { generateRegionReport, generateClusterReport } = require('../services/reports_v2');
const { getExpectedMonthTab, getPreviousMonthTab } = require('../utils/sheet_time');
const GoogleSheetsClient = require('../services/google/sheets');
const { syncRegionMatrixSheet } = require('../services/sheet_matrix_sync');
const { cleanZaloSenderName } = require('../utils/name_cleaner');

// 1. Lấy danh sách 7 Vùng và cấu hình khung giờ
router.get('/regions', async (req, res) => {
    try {
        const regions = await db.all(`
            SELECT r.*, 
                   COUNT(m.id) as total_members,
                   SUM(CASE WHEN m.role IN ('LEADER', 'DEPUTY') THEN 1 ELSE 0 END) as leaders_count
            FROM regions r
            LEFT JOIN members m ON r.id = m.region_id AND m.status = 'Active'
            GROUP BY r.id
            ORDER BY r.id ASC
        `);
        const currentMonthTab = getExpectedMonthTab();
        const mapped = regions.map(r => ({
            ...r,
            sheet_url: r.sheet_url || (r.sheet_id ? `https://docs.google.com/spreadsheets/d/${r.sheet_id}/edit` : null),
            current_month_tab: currentMonthTab
        }));
        res.json({ success: true, data: mapped });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 1.1 Lấy thông tin chi tiết 1 Vùng kèm Google Sheet URL
router.get('/regions/:id', async (req, res) => {
    try {
        const regionId = req.params.id;
        const region = await db.get(`
            SELECT r.*, 
                   COUNT(m.id) as total_members,
                   SUM(CASE WHEN m.role IN ('LEADER', 'DEPUTY') THEN 1 ELSE 0 END) as leaders_count
            FROM regions r
            LEFT JOIN members m ON r.id = m.region_id AND m.status = 'Active'
            WHERE r.id = ?
            GROUP BY r.id
        `, [regionId]);

        if (!region) {
            return res.status(404).json({ success: false, error: 'Không tìm thấy Vùng' });
        }
        const currentMonthTab = getExpectedMonthTab();
        const sheetUrl = region.sheet_url || (region.sheet_id ? `https://docs.google.com/spreadsheets/d/${region.sheet_id}/edit` : null);
        res.json({
            success: true,
            data: {
                ...region,
                sheet_url: sheetUrl,
                current_month_tab: currentMonthTab
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 2. Cập nhật khung giờ làm việc riêng cho từng Vùng
router.post('/regions/:id/settings', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    try {
        const regionId = req.params.id;
        const { task_start_time, task_end_time, report_start_time, report_end_time, sheet_name } = req.body;

        await db.run(`
            UPDATE regions 
            SET task_start_time = COALESCE(?, task_start_time),
                task_end_time = COALESCE(?, task_end_time),
                report_start_time = COALESCE(?, report_start_time),
                report_end_time = COALESCE(?, report_end_time),
                sheet_name = COALESCE(?, sheet_name),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `, [task_start_time, task_end_time, report_start_time, report_end_time, sheet_name, regionId]);

        const updated = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
        res.json({ success: true, message: 'Đã cập nhật khung giờ thành công', data: updated });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 3. Lấy danh sách Sứ giả & Trạng thái nộp bài của Vùng
router.get('/regions/:id/members', async (req, res) => {
    try {
        const regionId = req.params.id;
        const date = req.query.date || new Date().toLocaleDateString('sv');

        const memberQuery = `
            SELECT m.*, 
                   COALESCE(s.status, 'NO_RESPONSE') as submission_status,
                   s.notes as submission_notes,
                   s.submitted_at,
                   COALESCE(
                       (SELECT im.zalo_display_name FROM identity_mappings im WHERE im.member_id = m.id AND im.zalo_user_id LIKE 'alias_%' ORDER BY im.confidence_score DESC, im.id DESC LIMIT 1),
                       (SELECT im.zalo_display_name FROM identity_mappings im WHERE im.member_id = m.id AND im.zalo_user_id NOT LIKE 'real_%' ORDER BY im.confidence_score DESC, im.id DESC LIMIT 1),
                       (SELECT im.zalo_display_name FROM identity_mappings im WHERE im.member_id = m.id ORDER BY im.confidence_score DESC, im.id DESC LIMIT 1),
                       m.real_name
                   ) as mapped_zalo_name
            FROM members m
            LEFT JOIN submissions s ON m.id = s.member_id AND s.work_date = ?
            WHERE m.region_id = ? AND m.status = 'Active'
            ORDER BY 
                CASE 
                    WHEN m.role = 'LEADER' THEN 1 
                    WHEN m.role = 'DEPUTY' THEN 2 
                    ELSE 3 
                END ASC, 
                m.sheet_row_index ASC, 
                m.id ASC
        `;

        let members = await db.all(memberQuery, [date, regionId]);

        if (members.length === 0) {
            try {
                const { syncMembersFromSheet } = require('../services/sheet_member_sync');
                await syncMembersFromSheet(regionId);
                members = await db.all(memberQuery, [date, regionId]);
            } catch (e) {}
        }

        const cleanedMembers = members.map(m => ({
            ...m,
            mapped_zalo_name: cleanZaloSenderName(m.mapped_zalo_name || m.real_name, m.real_name)
        }));

        const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
        let customStatuses = [];
        if (req.session && req.session.user) {
            customStatuses = await db.all('SELECT * FROM user_custom_statuses WHERE user_id = ? ORDER BY id ASC', [req.session.user.id]);
        }
        if (customStatuses.length === 0 && region && region.manager_id) {
            customStatuses = await db.all('SELECT * FROM user_custom_statuses WHERE user_id = ? ORDER BY id ASC', [region.manager_id]);
        }
        if (customStatuses.length === 0) {
            customStatuses = await db.all('SELECT * FROM user_custom_statuses WHERE user_id = 1 ORDER BY id ASC');
        }
        const configRow = await db.get("SELECT value FROM local_config WHERE key = 'completed_text'");
        const completedText = configRow?.value || 'Ok';

        res.json({ 
            success: true, 
            regionId, 
            date, 
            data: cleanedMembers,
            settings: { completed_text: completedText },
            custom_statuses: customStatuses
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4. NÚT 1: [CHIA SẺ NHIỆM VỤ]
router.post('/regions/:id/forward-task', auth.requireAuth, async (req, res) => {
    try {
        const regionId = req.params.id;
        const { workDate, taskContent, sourceGroup } = req.body;

        const result = await onDemandService.forwardTask({
            regionId,
            workDate,
            taskContent,
            sourceGroup
        });

        res.json({ success: true, message: 'Đã chia sẻ nhiệm vụ thành công', data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4.1 Kiểm tra trạng thái Tab Google Sheet theo ngày làm việc
router.get('/regions/:id/check-sheet-tab', async (req, res) => {
    try {
        const regionId = req.params.id;
        const workDate = req.query.workDate || new Date().toLocaleDateString('sv');
        const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
        if (!region) return res.status(404).json({ success: false, error: 'Không tìm thấy Vùng' });

        const expectedTab = getExpectedMonthTab(workDate);
        if (!region.sheet_id) {
            return res.json({
                success: true,
                hasSheet: false,
                exists: false,
                expectedTab,
                message: 'Vùng chưa cấu hình liên kết Google Sheet'
            });
        }

        const check = await GoogleSheetsClient.checkTabExists(region.sheet_id, expectedTab);
        res.json({
            success: true,
            hasSheet: true,
            exists: check.exists,
            expectedTab,
            currentTabs: check.currentTabs || [],
            latestTab: check.latestTab || null,
            regionId: region.id,
            regionName: region.region_name,
            sheetId: region.sheet_id
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4.2 Tự động tạo tab tháng mới bằng cách nhân bản từ tab cũ
router.post('/regions/:id/create-sheet-tab', auth.requireAuth, async (req, res) => {
    try {
        const regionId = req.params.id;
        const { workDate, sourceTab } = req.body;
        const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
        if (!region) return res.status(404).json({ success: false, error: 'Không tìm thấy Vùng' });
        if (!region.sheet_id) return res.status(400).json({ success: false, error: 'Vùng chưa liên kết Google Sheet' });

        const targetDate = workDate || new Date().toLocaleDateString('sv');
        const expectedTab = getExpectedMonthTab(targetDate);
        const fallbackSource = sourceTab || getPreviousMonthTab(targetDate);

        const dupResult = await GoogleSheetsClient.duplicateMonthTab(region.sheet_id, fallbackSource, expectedTab);

        await db.run('UPDATE regions SET sheet_name = ? WHERE id = ?', [expectedTab, region.id]);

        res.json({
            success: true,
            message: `Đã tạo thành công tab "${expectedTab}" trên Google Sheet!`,
            data: dupResult
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 4.3 Ghi bù dữ liệu ngày chưa đồng bộ lên Google Sheet
router.post('/regions/:id/sync-pending-sheet', auth.requireAuth, async (req, res) => {
    try {
        const regionId = req.params.id;
        const { workDate } = req.body;
        const targetDate = workDate || new Date().toLocaleDateString('sv');

        const syncResult = await syncRegionMatrixSheet(regionId, targetDate);
        if (syncResult.success && !syncResult.tabMissing && !syncResult.skipped) {
            await db.run(
                "UPDATE submissions SET sheet_synced = 1 WHERE region_id = ? AND work_date = ?",
                [regionId, targetDate]
            );
            return res.json({
                success: true,
                message: `Đã ghi bù thành công ngày ${targetDate} lên Google Sheet!`,
                data: syncResult
            });
        } else {
            return res.status(400).json({
                success: false,
                error: syncResult.message || 'Chưa thể ghi lên Google Sheet do thiếu tab hoặc cấu hình'
            });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5. NÚT 2: [QUÉT BÀI & XUẤT BÁO CÁO VÙNG] (MẪU 1)
router.post('/regions/:id/run-report', auth.requireAuth, async (req, res) => {
    try {
        const regionId = req.params.id;
        const { workDate, simulatedMessages, dryRun, skipSheet, showBrowser } = req.body;

        const result = await onDemandService.scanAndReportRegion({
            regionId,
            workDate,
            simulatedMessages,
            dryRun: dryRun === true,
            skipSheet: skipSheet === true,
            showBrowser: showBrowser === true
        });

        if (!result.success) {
            return res.json({ 
                success: false, 
                cancelled: result.cancelled === true,
                error: result.error || 'Chưa thể quét bài từ Zalo', 
                data: result 
            });
        }

        res.json({ success: true, message: 'Đã hoàn tất quét và tạo báo cáo Vùng', data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 5.1 DỪNG QUÉT BÁO CÁO THEO YÊU CẦU
router.post('/regions/:id/stop-scan', auth.requireAuth, async (req, res) => {
    try {
        const { zaloAnchorScanner } = require('../services/zalo_anchor_scanner');
        await zaloAnchorScanner.cancelScan();
        res.json({ success: true, message: 'Đã gửi lệnh dừng quét bài và đóng tab Zalo' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 6. NÚT DÀNH CHO TRƯỞNG CỤM: [TỔNG HỢP & GỬI BÁO CÁO CỤM 5] (MẪU 2)
router.post('/cluster/run-report', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    try {
        const { workDate, dryRun } = req.body;

        const result = await onDemandService.aggregateAndDispatchCluster({
            clusterId: 5,
            workDate,
            dryRun: dryRun === true
        });

        res.json({ success: true, message: 'Đã tổng hợp Báo cáo Cụm 5 thành công', data: result });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 7. Lấy bản xem trước Báo cáo (Preview Report Text)
router.get('/preview/report', async (req, res) => {
    try {
        const { type, regionId, workDate } = req.query;
        const date = workDate || new Date().toLocaleDateString('sv');

        if (type === 'cluster') {
            const clusterRep = await generateClusterReport(5, date);
            return res.json({ success: true, type: 'cluster', content: clusterRep.content });
        } else {
            const targetRegionId = parseInt(regionId || '27', 10);
            const regionRep = await generateRegionReport(targetRegionId, date);
            return res.json({ success: true, type: 'region', regionId: targetRegionId, content: regionRep.content });
        }
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// 8. TÍNH NĂNG MỞ ĐĂNG NHẬP ZALO (QUÉT MÃ QR TRỰC TIẾP TRÊN UI)
const zaloBrowserManager = require('../services/zalo_browser_manager');

router.post('/zalo/open-login', auth.requireAuth, async (req, res) => {
    try {
        const result = await zaloBrowserManager.openLoginWindow();
        res.json(result);
    } catch (err) {
        console.error('Lỗi khi mở Zalo Login:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/zalo/status', (req, res) => {
    try {
        const status = zaloBrowserManager.getSessionStatus();
        res.json({ success: true, data: status });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/zalo/draft', auth.requireAuth, async (req, res) => {
    try {
        const { groupName, messageText, screenshotPath } = req.body;
        const result = await zaloBrowserManager.draftMessageToChat(groupName, messageText, screenshotPath);
        res.json(result);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});



// 9. QUẢN LÝ BẢN ĐỒ ÁNH XẠ TÊN (NAME MAPPINGS)
function normalizeNameAlias(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

router.get('/regions/:id/name-mappings', async (req, res) => {
    try {
        const regionId = req.params.id;
        const rows = await db.all(`
            SELECT m.id, m.real_name, m.sheet_row_index, m.role,
                   (
                       SELECT im.zalo_display_name 
                       FROM identity_mappings im 
                       WHERE im.member_id = m.id AND im.zalo_user_id LIKE 'alias_%'
                       LIMIT 1
                   ) as alias_zalo_name
            FROM members m
            WHERE m.region_id = ? AND m.status = 'Active'
            ORDER BY 
                CASE 
                    WHEN m.role = 'LEADER' THEN 1 
                    WHEN m.role = 'DEPUTY' THEN 2 
                    ELSE 3 
                END ASC, 
                m.sheet_row_index ASC,
                m.id ASC
        `, [regionId]);

        const mappings = {};
        rows.forEach(r => {
            mappings[r.real_name] = r.alias_zalo_name || r.real_name;
        });

        res.json({ success: true, regionId, mappings, list: rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/regions/:id/name-mappings', auth.requireAuth, async (req, res) => {
    try {
        const regionId = req.params.id;
        const mappings = req.body.mappings || {};
        let updatedCount = 0;

        for (const [realName, zaloNameRaw] of Object.entries(mappings)) {
            const zaloName = (zaloNameRaw || '').trim();
            if (!realName || !zaloName) continue;

            let member = await db.get(
                'SELECT id FROM members WHERE region_id = ? AND real_name = ?',
                [regionId, realName.trim()]
            );

            if (!member) {
                const maxRow = await db.get('SELECT MAX(sheet_row_index) as max_row FROM members WHERE region_id = ?', [regionId]);
                const nextRow = (maxRow && maxRow.max_row) ? (maxRow.max_row + 1) : 4;
                const newMember = await db.run(
                    'INSERT INTO members (region_id, sheet_row_index, real_name, role, status) VALUES (?, ?, ?, ?, ?)',
                    [regionId, nextRow, realName.trim(), 'EMISSARY', 'Active']
                );
                member = { id: newMember.id };
            }

            if (member) {
                const cleanZalo = cleanZaloSenderName(zaloName, realName);
                if (!cleanZalo || cleanZalo.length > 35 || cleanZalo.toLowerCase().includes('báo cáo')) continue;
                const normAlias = normalizeNameAlias(cleanZalo);
                const normReal = normalizeNameAlias(realName);
                const normRaw = (zaloName && zaloName.length <= 35 && !zaloName.toLowerCase().includes('báo cáo')) ? normalizeNameAlias(zaloName) : null;
                const zaloUserId = `alias_${regionId}_${Buffer.from(cleanZalo).toString('hex').slice(0, 16)}`;

                // 1. Luôn đảm bảo có real_name mapping
                await db.run(`
                    INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                    VALUES (?, ?, ?, ?, 1.0)
                `, [member.id, `real_${member.id}`, realName.trim(), normReal]);

                // 2. Xoá mọi mapping rác cũ bị dính tên (concatenated) hoặc mapping sai khác không mong muốn
                await db.run(`
                    DELETE FROM identity_mappings 
                    WHERE member_id = ? 
                      AND (
                          (zalo_display_name != ? AND zalo_display_name != ?)
                          OR zalo_user_id IS NULL
                      )
                `, [member.id, cleanZalo, realName.trim()]);

                if (normAlias !== normReal) {
                    const existing = await db.get(
                        "SELECT id FROM identity_mappings WHERE member_id = ? AND zalo_user_id LIKE 'alias_%'",
                        [member.id]
                    );

                    if (existing) {
                        await db.run(
                            "UPDATE identity_mappings SET zalo_user_id = ?, zalo_display_name = ?, normalized_alias = ?, confidence_score = 1.0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                            [zaloUserId, cleanZalo, normAlias, existing.id]
                        );
                    } else {
                        await db.run(`
                            INSERT INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                            VALUES (?, ?, ?, ?, 1.0)
                        `, [member.id, zaloUserId, cleanZalo, normAlias]);
                    }
                } else {
                    // Nếu tên Zalo bằng tên thật, xoá bỏ alias cũ để hệ thống dùng tên thật chuẩn
                    await db.run(
                        "DELETE FROM identity_mappings WHERE member_id = ? AND zalo_user_id LIKE 'alias_%'",
                        [member.id]
                    );
                }

                // Nếu tên gốc có tiền tố khác tên sạch, lưu thêm raw alias
                if (normRaw && normRaw !== normAlias && normRaw !== normReal) {
                    await db.run(`
                        INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                        VALUES (?, ?, ?, ?, 0.95)
                    `, [member.id, `raw_${regionId}_${Buffer.from(zaloName).toString('hex').slice(0, 16)}`, cleanZalo, normRaw]);
                }

                updatedCount++;
            }
        }

        res.json({ success: true, message: `Đã lưu thành công ánh xạ tên cho ${updatedCount} sứ giả!`, updatedCount });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/v2/regions/:id/auto-guess-mappings (Bot tự động vào Zalo đoán mapping tên Sứ giả)
router.post('/regions/:id/auto-guess-mappings', auth.requireAuth, async (req, res) => {
    try {
        const regionId = req.params.id;
        const { autoGuessRegionZaloMappings } = require('../services/zalo_auto_mapper');
        const result = await autoGuessRegionZaloMappings(regionId);
        res.json(result);
    } catch (err) {
        console.error('Lỗi khi tự động đoán mapping Zalo:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/v2/cluster/auto-guess-mappings (Bot tự động quét lần lượt các Vùng của Cụm để mapping tên)
router.post('/cluster/auto-guess-mappings', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    try {
        const { autoGuessRegionZaloMappings } = require('../services/zalo_auto_mapper');
        const zaloBrowserManager = require('../services/zalo_browser_manager');
        const clusterRegions = await db.all('SELECT id, region_name FROM regions WHERE is_active = 1 ORDER BY id ASC');
        const results = [];
        let totalMatched = 0;
        let totalSaved = 0;

        for (const r of clusterRegions) {
            try {
                const resRegion = await autoGuessRegionZaloMappings(r.id);
                results.push(resRegion);
                if (resRegion.matchedCount) totalMatched += resRegion.matchedCount;
                if (resRegion.savedCount) totalSaved += resRegion.savedCount;
            } catch (rErr) {
                results.push({ regionId: r.id, success: false, error: rErr.message });
            }
        }

        // Khi mapping xong toàn bộ Cụm, tự động tắt trình duyệt Zalo
        try {
            await zaloBrowserManager.closeBrowser();
        } catch (oErr) {}

        res.json({
            success: true,
            totalRegions: clusterRegions.length,
            totalMatched,
            totalSaved,
            results
        });
    } catch (err) {
        console.error('Lỗi khi tự động đoán mapping Zalo cả Cụm:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/v2/regions/:id/sync-sheet-members
router.post('/regions/:id/sync-sheet-members', auth.requireAuth, async (req, res) => {
    try {
        const regionId = parseInt(req.params.id, 10);
        const { role, id: userId } = req.session.user;
        if (role === 'region_leader') {
            const userManagedRegionId = req.session.user.managed_region_id;
            if (userManagedRegionId && userManagedRegionId !== regionId) {
                return res.status(403).json({ success: false, error: 'Bạn chỉ có quyền đồng bộ dữ liệu Vùng của mình.' });
            }
            if (!userManagedRegionId) {
                const region = await db.get('SELECT manager_id FROM regions WHERE id = ?', [regionId]);
                if (region && region.manager_id && region.manager_id !== userId) {
                    return res.status(403).json({ success: false, error: 'Bạn chỉ có quyền đồng bộ dữ liệu Vùng của mình.' });
                }
            }
        }

        const sheetMemberSync = require('../services/sheet_member_sync');
        const result = await sheetMemberSync.syncMembersFromSheet(regionId, {
            userId: req.session.user.id,
            req
        });
        res.json(result);
    } catch (err) {
        console.error('[API SYNC REGION SHEET MEMBERS ERROR]:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

// POST /api/v2/cluster/sync-all-sheet-members
router.post('/cluster/sync-all-sheet-members', auth.requireAuth, auth.isClusterOrAdmin, async (req, res) => {
    try {
        const sheetMemberSync = require('../services/sheet_member_sync');
        const result = await sheetMemberSync.syncAllRegionsMembers({
            userId: req.session.user.id,
            req
        });
        res.json(result);
    } catch (err) {
        console.error('[API SYNC ALL SHEET MEMBERS ERROR]:', err);
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = router;


const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const db = require('../config/db');
const auth = require('../middlewares/auth');
const audit = require('../services/audit');
const metrics = require('../utils/metrics');

// Live Reload SSE Clients
const liveReloadClients = new Set();
const webDir = path.join(__dirname, '../web');

if (fs.existsSync(webDir)) {
    let watchDebounceTimer = null;
    try {
        fs.watch(webDir, (eventType, filename) => {
            if (!filename) return;
            clearTimeout(watchDebounceTimer);
            watchDebounceTimer = setTimeout(() => {
                const isCss = filename.endsWith('.css');
                const signal = isCss ? 'reload-css' : 'reload';
                for (const clientRes of liveReloadClients) {
                    clientRes.write(`data: ${signal}\n\n`);
                }
            }, 100);
        });
    } catch (err) {}
}

router.get('/live-reload', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    liveReloadClients.add(res);

    req.on('close', () => {
        liveReloadClients.delete(res);
    });
});

// ==================== AUTO-SHUTDOWN COORDINATOR ====================
// ĐÃ TẮT HOÀN TOÀN: Giữ máy chủ Backend luôn chạy ổn định 24/7 để phục vụ quét bài, test role và lên lịch tự động.
// Người dùng có thể dừng Bot bất cứ lúc nào bằng cách đóng cửa sổ dòng lệnh (hoặc nhấn Ctrl+C).
const isAutoShutdownDisabled = true;

function scheduleAutoShutdown(delayMs = 3500, reason = 'Cửa sổ trình duyệt đã đóng') {
    // Đã vô hiệu hóa: không tự động tắt server khi thao tác trên web
    return;
}

function cancelAutoShutdown() {
    // Không cần thực thi
}

// POST /api/system/heartbeat: Web định kỳ gửi ping mỗi 2-3s để giữ trạng thái kết nối
router.post('/system/heartbeat', (req, res) => {
    res.json({ ok: true, active: true });
});

// POST /api/system/client-disconnect: Trình duyệt rời trang (không tắt backend)
router.post('/system/client-disconnect', (req, res) => {
    res.status(204).end();
});

// GET /api/system/license-status
router.get('/system/license-status', async (req, res) => {
    try {
        const remoteLicense = require('../services/remote_license');
        const status = await remoteLicense.getLicenseStatus(req.query.force === 'true');
        res.json(status);
    } catch (e) {
        res.json({ allowed: true, message: 'Hệ thống đang hoạt động bình thường.' });
    }
});

// GET /api/health
router.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.floor(process.uptime()),
        version: process.env.APP_VERSION || '2.0.0'
    });
});

async function checkWithTimeout(promise, timeoutMs) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve('failed (timeout)'), timeoutMs);
        promise.then(
            () => { clearTimeout(timer); resolve('ok'); },
            () => { clearTimeout(timer); resolve('failed'); }
        ).catch(() => { clearTimeout(timer); resolve('failed'); });
    });
}

// GET /api/ready
router.get('/ready', async (req, res) => {
    const checks = {
        sqlite: await checkWithTimeout(db.get('SELECT 1'), 100),
        queue: await checkWithTimeout(db.get("SELECT COUNT(*) FROM zalo_message_queue"), 50),
        worker: await checkWithTimeout(new Promise((resolve, reject) => {
            const puppeteerProvider = require('../services/zalo/providers/puppeteer_provider');
            if (puppeteerProvider.enabled && !puppeteerProvider.workerProcess) reject();
            else resolve();
        }), 100),
        zaloWeb: 'ok',
        google: process.env.SAFE_MODE === 'true' ? 'ok' : await checkWithTimeout(new Promise(async (resolve, reject) => {
            try {
                const sheets = require('../services/google/sheets');
                const metadata = await sheets.getSheetsMetadata(process.env.GOOGLE_SHEET_ID || 'dummy');
                if (metadata) resolve(); else reject();
            } catch (err) {
                reject(err);
            }
        }), 500)
    };

    const isReady = Object.values(checks).every(v => v === 'ok');
    if (isReady) {
        res.json({ status: 'ready', checks });
    } else {
        res.status(503).json({ status: 'not_ready', checks });
    }
});

// Manual backup DB handler
const handleBackupDb = async (req, res) => {
    try {
        const backupDir = path.join(__dirname, '../../backups');
        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }
        const dbPath = path.join(__dirname, '../../data/vnv_bot.db');
        const now = new Date();
        const dateStr = now.toISOString().replace(/[:.]/g, '-').slice(0, 19);
        const fileName = `vnv_bot_backup_${dateStr}.db`;
        const backupFile = path.join(backupDir, fileName);
        
        fs.copyFileSync(dbPath, backupFile);

        if (req.session && req.session.user) {
            await audit.logAction(req.session.user.id, 'BACKUP_DB', 'system:database', `Đã sao lưu DB thành công vào ${fileName}`, req);
        }
        
        res.setHeader('Content-Type', 'application/x-sqlite3');
        res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
        res.sendFile(backupFile);
    } catch (err) {
        if (!res.headersSent) {
            res.status(500).json({ error: 'Lỗi khi sao lưu Database: ' + err.message });
        }
    }
};

// GET /api/system/backup
router.get('/system/backup', auth.requireAuth, auth.isClusterOrAdmin, handleBackupDb);

// ==================== CẤU HÌNH HỆ THỐNG / SETTINGS ====================
const DEFAULT_SETTINGS = {
    completed_text: 'Ok',
    incomplete_text: '',
    late_text: 'Xin làm muộn',
    enable_sheet_colors: 'false',
    highlight_late: 'false',
    color_completed: '#ffffff',
    color_no_response: '#ff0000',
    color_late: '#4a86e8',
};

// GET /api/system/settings
router.get('/system/settings', auth.requireAuth, async (req, res) => {
    try {
        const rows = await db.all('SELECT key, value FROM local_config');
        const configMap = {};
        for (const r of rows) {
            configMap[r.key] = r.value;
        }

        const isColorsEnabled = configMap.enable_sheet_colors !== undefined 
            ? configMap.enable_sheet_colors === 'true' 
            : (configMap.highlight_late === 'true');

        const settings = {
            completed_text: configMap.completed_text !== undefined ? configMap.completed_text : DEFAULT_SETTINGS.completed_text,
            incomplete_text: configMap.incomplete_text !== undefined ? configMap.incomplete_text : DEFAULT_SETTINGS.incomplete_text,
            late_text: configMap.late_text !== undefined ? configMap.late_text : DEFAULT_SETTINGS.late_text,
            enable_sheet_colors: isColorsEnabled,
            highlight_late: isColorsEnabled,
            color_completed: configMap.color_completed || DEFAULT_SETTINGS.color_completed,
            color_no_response: configMap.color_no_response || DEFAULT_SETTINGS.color_no_response,
            color_late: configMap.color_late || DEFAULT_SETTINGS.color_late,
        };

        let customStatuses = [];
        if (req.session && req.session.user) {
            const userId = req.session.user.id;
            const initKey = `user_${userId}_statuses_initialized`;
            const initialized = await db.get('SELECT value FROM local_config WHERE key = ?', [initKey]);

            if (!initialized) {
                const existingStatuses = await db.all('SELECT status_name FROM user_custom_statuses WHERE user_id = ?', [userId]);
                const existingNames = new Set((existingStatuses || []).map(s => s.status_name.toLowerCase().trim()));

                // Khởi tạo các trạng thái ban đầu đầy đủ khớp với bảng điều hành vùng
                const starterStatuses = [
                    { name: 'Hoàn thành', color: '#10B981', text: 'Ok', behavior: 'ON_TIME' },
                    { name: 'Làm muộn / Bổ sung', color: '#F59E0B', text: 'Xin làm muộn', behavior: 'LATE_COMPLETED' },
                    { name: 'Chưa nộp', color: '#6B7280', text: 'Chưa nộp', behavior: 'INCOMPLETE' },
                    { name: 'Đi quân sự', color: '#8B5CF6', text: 'Đi quân sự', behavior: 'ON_LEAVE' },
                    { name: 'Ôn thi / Đi viện', color: '#EC4899', text: 'Ôn thi/Đi viện', behavior: 'ON_LEAVE' },
                    { name: 'Xin nghỉ', color: '#EF4444', text: 'Xin nghỉ', behavior: 'ON_LEAVE' }
                ];
                for (const s of starterStatuses) {
                    if (!existingNames.has(s.name.toLowerCase())) {
                        await db.run(
                            'INSERT INTO user_custom_statuses (user_id, status_name, color_hex, text_value, behavior_type) VALUES (?, ?, ?, ?, ?)',
                            [userId, s.name, s.color, s.text, s.behavior]
                        );
                    }
                }
                await db.run(
                    'INSERT OR REPLACE INTO local_config (key, value, updated_at) VALUES (?, "true", CURRENT_TIMESTAMP)',
                    [initKey]
                );
            }

            customStatuses = await db.all(
                'SELECT * FROM user_custom_statuses WHERE user_id = ? ORDER BY id ASC',
                [userId]
            );

            // Đồng bộ 1-1 với settings văn bản
            for (const cs of customStatuses) {
                const nameLower = (cs.status_name || '').toLowerCase().trim();
                if (nameLower.includes('hoàn thành') && settings.completed_text !== undefined) {
                    cs.text_value = settings.completed_text;
                } else if ((nameLower.includes('chưa nộp') || nameLower.includes('không phản hồi')) && settings.incomplete_text !== undefined) {
                    cs.text_value = settings.incomplete_text;
                } else if (nameLower.includes('làm muộn') && settings.late_text !== undefined) {
                    cs.text_value = settings.late_text;
                }
            }
        }

        res.json({ success: true, settings, custom_statuses: customStatuses });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi tải cấu hình: ' + err.message });
    }
});

// POST /api/system/settings
router.post('/system/settings', auth.requireAuth, async (req, res) => {
    try {
        const settings = req.body || {};
        if (settings.enable_sheet_colors !== undefined) {
            settings.highlight_late = settings.enable_sheet_colors;
        } else if (settings.highlight_late !== undefined) {
            settings.enable_sheet_colors = settings.highlight_late;
        }

        const keys = [
            'completed_text', 'incomplete_text', 'late_text',
            'enable_sheet_colors', 'highlight_late', 'color_completed', 'color_no_response',
            'color_late'
        ];

        for (const k of keys) {
            if (settings[k] !== undefined) {
                const val = typeof settings[k] === 'boolean' ? String(settings[k]) : String(settings[k]);
                await db.run(
                    'INSERT INTO local_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP) ' +
                    'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP',
                    [k, val]
                );
            }
        }

        if (req.session && req.session.user) {
            const userId = req.session.user.id;
            if (settings.incomplete_text !== undefined) {
                await db.run(
                    'UPDATE user_custom_statuses SET text_value = ? WHERE (LOWER(status_name) LIKE "%chưa nộp%" OR LOWER(status_name) LIKE "%không phản hồi%")',
                    [String(settings.incomplete_text).trim()]
                );
            }
            if (settings.late_text !== undefined) {
                await db.run(
                    'UPDATE user_custom_statuses SET text_value = ? WHERE (LOWER(status_name) LIKE "%làm muộn%" OR LOWER(status_name) LIKE "%xin làm muộn%")',
                    [String(settings.late_text).trim()]
                );
            }
            if (settings.completed_text !== undefined) {
                await db.run(
                    'UPDATE user_custom_statuses SET text_value = ? WHERE LOWER(status_name) LIKE "%hoàn thành%"',
                    [String(settings.completed_text).trim()]
                );
            }
            await audit.logAction(req.session.user.id, 'UPDATE_SETTINGS', 'system:settings', 'Cập nhật cấu hình text và màu sắc Google Sheet', req);
        }

        res.json({ success: true, message: 'Đã lưu cấu hình thành công!' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lưu cấu hình: ' + err.message });
    }
});

// POST /api/system/settings/reset
router.post('/system/settings/reset', auth.requireAuth, async (req, res) => {
    try {
        const keys = Object.keys(DEFAULT_SETTINGS);
        for (const k of keys) {
            await db.run('DELETE FROM local_config WHERE key = ?', [k]);
        }

        if (req.session && req.session.user) {
            const userId = req.session.user.id;
            await db.run('DELETE FROM user_custom_statuses WHERE user_id = ?', [userId]);
            await db.run('DELETE FROM local_config WHERE key = ?', [`user_${userId}_statuses_initialized`]);
        }

        res.json({ success: true, message: 'Đã khôi phục cài đặt mặc định!', settings: DEFAULT_SETTINGS });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khôi phục cài đặt: ' + err.message });
    }
});

// ==================== TRẠNG THÁI MÀU TÙY CHỈNH THEO TÀI KHOẢN ====================
// POST /api/system/custom-status: Thêm trạng thái tùy chỉnh cho tài khoản hiện tại
function detectBehaviorType(statusName) {
    if (!statusName) return 'CUSTOM';
    const lower = statusName.toLowerCase().trim();

    // 1. Làm trễ / Nộp bù (trễ, muộn, bù, bổ sung, late, delay)
    if (/(?:trễ|muộn|bù|bổ\s*sung|late|delay|tre|muon|bu|bo\s*sung)/i.test(lower)) {
        return 'LATE_COMPLETED';
    }

    // 2. Hoàn thành đúng hạn (hoàn thành, đúng hạn, xong, ok, on time, đã hoàn thành, oke, x)
    if (/(?:hoàn\s*thành|đã\s*hoàn\s*thành|đúng\s*hạn|on\s*time|da\s*hoan\s*thanh|hoan\s*thanh|dung\s*han|\bxong\b|\bok\b|\boke\b|\bx\b)/i.test(lower)) {
        return 'ON_TIME';
    }

    // 3. Chưa làm / Không phản hồi (chưa, không, vắng, thiếu)
    if (/(?:chưa|không|vắng|thiếu|chua|khong|vang|thieu|no\s*response)/i.test(lower)) {
        return 'INCOMPLETE';
    }

    // 4. Xin hoãn / Xin phép (phép, hoãn, nghỉ, quân sự, ôn thi, viện)
    if (/(?:phép|hoãn|nghỉ|quân\s*sự|ôn\s*thi|viện|phep|hoan|nghi|quan\s*su|on\s*thi|vien)/i.test(lower)) {
        return 'ON_LEAVE';
    }

    return 'CUSTOM';
}

router.post('/system/custom-status', auth.requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const { status_name, color_hex, text_value, behavior_type } = req.body;
        if (!status_name || !status_name.trim()) {
            return res.status(400).json({ error: 'Tên trạng thái không được để trống.' });
        }
        if (!color_hex || !/^#[0-9a-fA-F]{6}$/i.test(color_hex.trim())) {
            return res.status(400).json({ error: 'Mã màu hex không hợp lệ.' });
        }

        const bType = behavior_type || detectBehaviorType(status_name);
        const result = await db.run(
            'INSERT INTO user_custom_statuses (user_id, status_name, color_hex, text_value, behavior_type) VALUES (?, ?, ?, ?, ?)',
            [userId, status_name.trim(), color_hex.trim(), (text_value !== undefined ? text_value : status_name).trim(), bType]
        );

        const created = await db.get('SELECT * FROM user_custom_statuses WHERE id = ?', [result.id]);
        res.status(201).json({ success: true, message: 'Đã thêm trạng thái màu mới!', status: created });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi thêm trạng thái: ' + err.message });
    }
});

// PUT /api/system/custom-status/:id: Cập nhật màu/tên trạng thái của tài khoản hiện tại
router.put('/system/custom-status/:id', auth.requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const statusId = req.params.id;
        const { status_name, color_hex, text_value, behavior_type } = req.body;

        const existing = await db.get('SELECT * FROM user_custom_statuses WHERE id = ? AND user_id = ?', [statusId, userId]);
        if (!existing) {
            return res.status(404).json({ error: 'Không tìm thấy trạng thái hoặc bạn không có quyền sửa.' });
        }

        if (color_hex && !/^#[0-9a-fA-F]{6}$/i.test(color_hex.trim())) {
            return res.status(400).json({ error: 'Mã màu hex không hợp lệ.' });
        }

        const bType = behavior_type !== undefined ? behavior_type : (status_name ? detectBehaviorType(status_name) : (existing.behavior_type || 'CUSTOM'));

        await db.run(
            `UPDATE user_custom_statuses 
             SET status_name = COALESCE(?, status_name),
                 color_hex = COALESCE(?, color_hex),
                 text_value = ?,
                 behavior_type = ?
             WHERE id = ? AND user_id = ?`,
            [
                status_name !== undefined ? status_name.trim() : null,
                color_hex ? color_hex.trim() : null,
                text_value !== undefined ? text_value.trim() : (existing.text_value || ''),
                bType,
                statusId,
                userId
            ]
        );

        if (color_hex) {
            const nameLower = (status_name || existing.status_name || '').toLowerCase().trim();
            if (nameLower.includes('hoàn thành')) {
                await db.run('INSERT INTO local_config (key, value, updated_at) VALUES ("color_completed", ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP', [color_hex.trim()]);
            } else if (nameLower.includes('không phản hồi') || nameLower.includes('chưa nộp')) {
                await db.run('INSERT INTO local_config (key, value, updated_at) VALUES ("color_no_response", ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP', [color_hex.trim()]);
            } else if (nameLower.includes('xin làm muộn') || nameLower.includes('làm muộn')) {
                await db.run('INSERT INTO local_config (key, value, updated_at) VALUES ("color_late", ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP', [color_hex.trim()]);
            }
        }

        if (text_value !== undefined) {
            const nameLower = (status_name || existing.status_name || '').toLowerCase().trim();
            if (nameLower.includes('hoàn thành')) {
                await db.run('INSERT INTO local_config (key, value, updated_at) VALUES ("completed_text", ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP', [text_value.trim()]);
            } else if (nameLower.includes('không phản hồi') || nameLower.includes('chưa nộp')) {
                await db.run('INSERT INTO local_config (key, value, updated_at) VALUES ("incomplete_text", ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP', [text_value.trim()]);
            } else if (nameLower.includes('xin làm muộn') || nameLower.includes('làm muộn')) {
                await db.run('INSERT INTO local_config (key, value, updated_at) VALUES ("late_text", ?, CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP', [text_value.trim()]);
            }
        }

        const updated = await db.get('SELECT * FROM user_custom_statuses WHERE id = ?', [statusId]);
        res.json({ success: true, message: 'Đã cập nhật trạng thái!', status: updated });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi cập nhật trạng thái: ' + err.message });
    }
});

// DELETE /api/system/custom-status/:id: Xóa trạng thái của tài khoản hiện tại
router.delete('/system/custom-status/:id', auth.requireAuth, async (req, res) => {
    try {
        const userId = req.session.user.id;
        const statusId = req.params.id;

        const existing = await db.get('SELECT * FROM user_custom_statuses WHERE id = ? AND user_id = ?', [statusId, userId]);
        if (!existing) {
            return res.status(404).json({ error: 'Không tìm thấy trạng thái hoặc bạn không có quyền xóa.' });
        }

        await db.run('DELETE FROM user_custom_statuses WHERE id = ? AND user_id = ?', [statusId, userId]);
        res.json({ success: true, message: 'Đã xóa trạng thái thành công!' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi xóa trạng thái: ' + err.message });
    }
});

module.exports = router;


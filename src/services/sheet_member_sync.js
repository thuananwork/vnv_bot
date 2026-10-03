require('../utils/env_loader');
const db = require('../config/db');
const GoogleSheetsClient = require('./google/sheets');
const audit = require('./audit');

/**
 * Chuẩn hóa chuỗi tiếng Việt để so sánh tên
 */
function normalizeString(str) {
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

/**
 * Trích xuất ghi chú xin hoãn/nghỉ/quân sự từ các ô trên hàng của Sứ giả
 * @param {Array<string>} cells - Danh sách các ô trong hàng (A đến AZ)
 * @returns {string|null}
 */
function extractLeaveNoteFromRow(cells) {
    if (!Array.isArray(cells)) return null;
    // cells[0]: STT, cells[1]: Ngày vào, cells[2]: Họ tên, cells[3...]: các cột ngày & ghi chú
    const afterNameCells = cells.slice(3);
    for (const cell of afterNameCells) {
        if (!cell || typeof cell !== 'string') continue;
        const trimmed = cell.trim();
        if (trimmed.length < 4) continue;
        const lower = trimmed.toLowerCase();
        if (lower === 'oke' || lower === 'ok' || /^\d+$/.test(trimmed)) continue;

        const leaveKeywords = [
            'quân sự', 'quan su',
            'xin hoãn', 'xin hoan',
            'hoãn', 'hoan',
            'nghỉ', 'nghi',
            'xin nghỉ', 'xin off', 'off',
            'ôn thi', 'on thi', 'lịch thi', 'lich thi', 'thi cử',
            'nhập viện', 'đi viện', 'nằm viện', 'ốm', 'bệnh',
            'gia đình', 'việc bận', 'bận việc',
            'bảo lưu', 'bao luu',
            'đến ngày', 'den ngay', 'hết tuần', 'het tuan', 'hết tháng', 'het thang',
            'dừng hoạt động', 'dung hoat dong', 'thôi vai trò', 'thoi vai tro'
        ];
        if (leaveKeywords.some(k => lower.includes(k))) {
            return trimmed.replace(/\t+/g, ' ').replace(/\s+/g, ' ');
        }
    }
    return null;
}

/**
 * Kiểm tra xem một chuỗi có phải là tên người hợp lệ không (loại bỏ header/placeholder)
 */
function isValidMemberName(name) {
    if (!name || typeof name !== 'string') return false;
    const clean = name.trim();
    if (clean.length < 3) return false;

    // Lọc bỏ các số thuần túy hoặc STT
    if (/^\d+$/.test(clean)) return false;

    const norm = normalizeString(clean);
    const INVALID_HEADERS = [
        'stt', 'ho va ten', 'ho ten', 'ten su gia', 'su gia', 'ho ten su gia',
        'vai tro', 'chuc vu', 'ghi chu', 'tong so', 'ngay', 'nhom', 'nhom 1',
        'nhom 2', 'nhom 3', 'nhom 4', 'ban dieu hanh', 'danh sach', 'thanh vien',
        'truong vung', 'pho vung', 'tong cong'
    ];

    if (INVALID_HEADERS.includes(norm)) return false;
    if (norm.startsWith('nhom ') || norm.startsWith('to ') || norm.startsWith('stt ')) return false;

    // Tên tiếng Việt thường có ít nhất 2 từ
    const words = clean.split(/\s+/).filter(Boolean);
    if (words.length < 2) return false;

    return true;
}

/** Per-region mutex map to serialize sync calls per region */
const syncMutexMap = new Map();

function runWithSyncLock(regionId, fn) {
    const key = String(regionId);
    const prev = syncMutexMap.get(key) || Promise.resolve();
    // Chain fn after prev completes (success or failure) — ensures serial execution
    const next = prev.then(fn, () => fn());
    // Store the tail of chain; swallow rejections so the chain stays alive for future calls
    syncMutexMap.set(key, next.catch(() => {}));
    return next;
}

/**
 * Đồng bộ danh sách Sứ giả từ Google Sheet vào cơ sở dữ liệu cho 1 Vùng
 * @param {number} regionId 
 * @param {Object} [options]
 * @param {number} [options.userId] ID người thực hiện (để ghi audit log)
 * @param {Object} [options.req] Express request object
 * @returns {Promise<Object>}
 */
async function syncMembersFromSheet(regionId, options = {}) {
    return runWithSyncLock(regionId, () => _doSyncMembersFromSheet(regionId, options));
}

async function _doSyncMembersFromSheet(regionId, options = {}) {
    const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
    if (!region) {
        throw new Error(`Không tìm thấy Vùng với ID ${regionId}`);
    }

    if (!region.sheet_id) {
        throw new Error(`Vùng "${region.region_name}" chưa được liên kết Google Sheet ID.`);
    }

    const { getExpectedMonthTab } = require('../utils/sheet_time');
    const currentMonthTab = getExpectedMonthTab();
    const tabName = region.sheet_name || currentMonthTab;
    const fullRange = `${tabName}!A4:AZ80`;
    console.log(`[SHEET MEMBER SYNC] Bắt đầu đọc danh sách Sứ giả từ Google Sheet: ${region.sheet_id} (${fullRange})...`);

    // 1. Đọc một lần toàn bộ bảng (A: STT, B: Ngày vào, C: Họ tên, D..AZ: Trạng thái & Ghi chú)
    let fullRows = [];
    try {
        fullRows = await GoogleSheetsClient.getValues(region.sheet_id, fullRange);
    } catch (err) {
        throw new Error(`Không thể kết nối Google Sheet của ${region.region_name}: ${err.message}`);
    }

    const rowMap = new Map();
    const gridData = [];
    fullRows.forEach((row, idx) => {
        const rowIndex = 4 + idx;
        rowMap.set(rowIndex, row);
        const rawName = (row[2] || '').trim(); // Cột C (index 2) là Họ và Tên
        if (rawName) {
            gridData.push({
                rowIndex,
                value: rawName,
                strikethrough: false
            });
        }
    });

    if (!gridData || gridData.length === 0) {
        return {
            success: true,
            regionId,
            regionName: region.region_name,
            message: 'Không tìm thấy dữ liệu tên nhân sự trong dải C4:C80 trên Google Sheet.',
            added: [],
            updated: [],
            deactivated: [],
            totalOnSheet: 0
        };
    }

    // 2. Lấy danh sách thành viên hiện có trong SQLite của Vùng
    const currentMembers = await db.all('SELECT * FROM members WHERE region_id = ?', [regionId]);
    const memberMap = new Map();
    currentMembers.forEach(m => {
        memberMap.set(normalizeString(m.real_name), m);
    });

    const normLeader = normalizeString(region.leader_name);
    const normDeputy = normalizeString(region.deputy_name);

    const added = [];
    const updated = [];
    const deactivated = [];
    let validCountOnSheet = 0;

    let inTransaction = false;
    try {
        await db.run('BEGIN IMMEDIATE');
        inTransaction = true;
        for (const item of gridData) {
            const rawName = (item.value || '').trim();
            if (!isValidMemberName(rawName)) continue;

            validCountOnSheet++;
            const normName = normalizeString(rawName);
            const isRetired = item.strikethrough === true;
            const existingMember = memberMap.get(normName);

            const rowCells = rowMap.get(item.rowIndex) || [];
            const joinDate = (rowCells[1] || '').trim() || null;
            const sheetNote = extractLeaveNoteFromRow(rowCells);

            if (isRetired) {
                // Sứ giả bị gạch ngang trên Sheet -> Lưu Inactive kèm sheet_note
                if (existingMember) {
                    await db.run(
                        "UPDATE members SET status = 'Inactive', sheet_note = ?, sheet_row_index = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        [sheetNote, item.rowIndex, existingMember.id]
                    );
                    deactivated.push({ id: existingMember.id, name: rawName, reason: sheetNote || 'Gạch ngang trên Sheet' });
                } else {
                    await db.run(
                        `INSERT INTO members (region_id, sheet_row_index, real_name, role, join_date, status, sheet_note)
                         VALUES (?, ?, ?, 'EMISSARY', ?, 'Inactive', ?)`,
                        [regionId, item.rowIndex, rawName, joinDate, sheetNote]
                    );
                    deactivated.push({ name: rawName, reason: sheetNote || 'Gạch ngang trên Sheet' });
                }
                continue;
            }

            // Sứ giả đang hoạt động bình thường
            if (existingMember) {
                // Đã có trong DB: Kiểm tra xem có cần cập nhật sheet_row_index hoặc kích hoạt lại không
                let needUpdate = false;
                let newStatus = existingMember.status;
                let newRowIndex = existingMember.sheet_row_index;

                if (existingMember.status !== 'Active') {
                    newStatus = 'Active';
                    needUpdate = true;
                }
                if (existingMember.sheet_row_index !== item.rowIndex) {
                    newRowIndex = item.rowIndex;
                    needUpdate = true;
                }
                if (existingMember.sheet_note !== sheetNote) {
                    needUpdate = true;
                }

                if (needUpdate) {
                    await db.run(
                        "UPDATE members SET sheet_row_index = ?, status = ?, sheet_note = ?, join_date = COALESCE(join_date, ?), updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        [newRowIndex, newStatus, sheetNote, joinDate, existingMember.id]
                    );
                    updated.push({ id: existingMember.id, name: rawName, rowIndex: newRowIndex, oldRow: existingMember.sheet_row_index, sheetNote });
                }
            } else {
                // Chưa có trong DB -> Thêm mới vào members
                let role = 'EMISSARY';
                if (normLeader && normName === normLeader) {
                    role = 'LEADER';
                } else if (normDeputy && normName === normDeputy) {
                    role = 'DEPUTY';
                }

                const insertRes = await db.run(
                    `INSERT INTO members (region_id, sheet_row_index, real_name, role, join_date, status, sheet_note)
                     VALUES (?, ?, ?, ?, ?, 'Active', ?)`,
                    [regionId, item.rowIndex, rawName, role, joinDate, sheetNote]
                );

                const newMemberId = insertRes.id;

                // Tự động tạo identity mapping cho tên thật
                await db.run(
                    `INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                     VALUES (?, ?, ?, ?, 1.0)`,
                    [newMemberId, `real_${newMemberId}`, rawName, normName]
                );

                added.push({ id: newMemberId, name: rawName, rowIndex: item.rowIndex, role });
                memberMap.set(normName, { id: newMemberId, real_name: rawName, sheet_row_index: item.rowIndex, status: 'Active' });
            }
        }

        await db.run('COMMIT');
        inTransaction = false;
    } catch (err) {
        if (inTransaction) {
            try {
                await db.run('ROLLBACK');
            } catch (rbErr) {
                console.warn('[SHEET MEMBER SYNC] Lỗi rollback:', rbErr.message);
            }
        }
        throw err;
    }

    // 3. Ghi audit log
    const actorId = options.userId || (options.req?.session?.user?.id) || 1;
    await audit.logAction(actorId, 'SYNC_MEMBERS_FROM_SHEET', `region:${regionId}`, {
        region_name: region.region_name,
        sheet_id: region.sheet_id,
        total_on_sheet: validCountOnSheet,
        added_count: added.length,
        updated_count: updated.length,
        deactivated_count: deactivated.length
    }, options.req || null);

    const totalActive = await db.get("SELECT COUNT(*) as count FROM members WHERE region_id = ? AND status = 'Active'", [regionId]);

    return {
        success: true,
        regionId,
        regionName: region.region_name,
        totalOnSheet: validCountOnSheet,
        added,
        updated,
        deactivated,
        totalActive: totalActive ? totalActive.count : 0,
        message: `Đồng bộ thành công ${region.region_name}: Thêm mới ${added.length}, Cập nhật ${updated.length}, Ngừng HĐ ${deactivated.length}.`
    };
}

/**
 * Đồng bộ danh sách Sứ giả cho toàn bộ các Vùng trong Cụm
 */
async function syncAllRegionsMembers(options = {}) {
    const regions = await db.all("SELECT id, region_name FROM regions WHERE status = 'active' AND sheet_id IS NOT NULL ORDER BY id ASC");
    const results = [];

    for (const r of regions) {
        try {
            const res = await syncMembersFromSheet(r.id, options);
            results.push(res);
        } catch (err) {
            results.push({
                success: false,
                regionId: r.id,
                regionName: r.region_name,
                error: err.message
            });
        }
    }

    const totalAdded = results.reduce((sum, r) => sum + (r.added?.length || 0), 0);
    const totalUpdated = results.reduce((sum, r) => sum + (r.updated?.length || 0), 0);
    const totalDeactivated = results.reduce((sum, r) => sum + (r.deactivated?.length || 0), 0);

    return {
        success: true,
        regionsProcessed: results.length,
        totalAdded,
        totalUpdated,
        totalDeactivated,
        details: results,
        message: `Đã đồng bộ toàn Cụm: Thêm mới ${totalAdded}, Cập nhật ${totalUpdated}, Ngừng HĐ ${totalDeactivated}.`
    };
}

module.exports = {
    isValidMemberName,
    syncMembersFromSheet,
    syncAllRegionsMembers
};

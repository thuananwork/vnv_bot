const db = require('../config/db');
const GoogleSheetsClient = require('./google/sheets');
const { executeGoogleApiWithRetry } = require('./google/retry');

/**
 * Chuyển đổi số thứ tự cột (1-based) thành chữ cái cột A1 Notation
 * 1 -> A, 4 -> D, 27 -> AA, 34 -> AH
 */
function indexToColumnLetter(colIndex) {
    let letter = '';
    while (colIndex > 0) {
        let temp = (colIndex - 1) % 26;
        letter = String.fromCharCode(65 + temp) + letter;
        colIndex = Math.floor((colIndex - temp) / 26);
    }
    return letter;
}

/**
 * Lấy chữ cái cột trên Sheet cho ngày trong tháng (Ngày 1 = Cột D)
 * @param {number} dayOfMonth (1 đến 31)
 * @returns {string} Ví dụ: 1 -> 'D', 16 -> 'S', 31 -> 'AH'
 */
function getColumnForDay(dayOfMonth) {
    const colIndex = 3 + dayOfMonth; // Ngày 1 ở cột 4 (D)
    return indexToColumnLetter(colIndex);
}

function hexToRgbRatio(hex) {
    if (!hex) return { red: 1.0, green: 1.0, blue: 1.0 };
    let c = hex.replace('#', '').trim();
    if (c.length === 3) {
        c = c.split('').map(x => x + x).join('');
    }
    const num = parseInt(c, 16);
    if (isNaN(num)) return { red: 1.0, green: 1.0, blue: 1.0 };
    return {
        red: Math.round((((num >> 16) & 255) / 255) * 100) / 100,
        green: Math.round((((num >> 8) & 255) / 255) * 100) / 100,
        blue: Math.round(((num & 255) / 255) * 100) / 100
    };
}

/**
 * Đồng bộ kết quả nộp bài của một Vùng lên ma trận Google Sheet thực tế
 * @param {number} regionId 
 * @param {string} workDate 'YYYY-MM-DD'
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function syncRegionMatrixSheet(regionId, workDate, options = {}) {
    const dryRun = options.dryRun === true;
    const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
    if (!region) throw new Error(`Không tìm thấy Vùng ID ${regionId}`);

    // Đọc cấu hình văn bản & màu sắc từ local_config
    const configRows = await db.all('SELECT key, value FROM local_config');
    const config = {};
    for (const r of configRows) config[r.key] = r.value;

    // Bật/tắt tô màu Google Sheets: Mặc định TẮT (false), chỉ điền chữ không tô màu ô
    const enableSheetColors = (config.enable_sheet_colors !== undefined)
        ? (config.enable_sheet_colors === 'true')
        : (config.highlight_late === 'true');
    const completedText = config.completed_text !== undefined ? config.completed_text : 'Ok';
    const incompleteText = config.incomplete_text !== undefined ? config.incomplete_text : '';
    const lateText = config.late_text !== undefined ? config.late_text : '';
    const lateNoResponseText = config.late_no_response_text || 'Làm muộn không phản hồi';
    const lateWithPermissionText = config.late_with_permission_text || 'Làm muộn có xin phép';

    // Đọc màu sắc từ bảng màu tùy chỉnh (user_custom_statuses) nếu có
    let customStatuses = [];
    try {
        if (region.manager_id) {
            customStatuses = await db.all('SELECT * FROM user_custom_statuses WHERE user_id = ? ORDER BY id ASC', [region.manager_id]);
        }
        if (!customStatuses || customStatuses.length === 0) {
            customStatuses = await db.all('SELECT * FROM user_custom_statuses WHERE user_id = 1 ORDER BY id ASC');
        }
        if (!customStatuses || customStatuses.length === 0) {
            customStatuses = await db.all('SELECT * FROM user_custom_statuses ORDER BY id ASC');
        }
    } catch (e) {
        console.warn('[SHEET MATRIX SYNC] Không thể tải user_custom_statuses:', e.message);
    }

    const findStatusRecord = (behaviorType, keywords = []) => {
        let found = customStatuses.find(s => s.behavior_type === behaviorType);
        if (found) return found;
        const kwList = Array.isArray(keywords) ? keywords : [keywords];
        if (kwList.length > 0) {
            found = customStatuses.find(s => {
                const lower = (s.status_name || '').toLowerCase();
                return kwList.some(k => lower.includes(k.toLowerCase()));
            });
        }
        return found || null;
    };

    const statusOnTime = findStatusRecord('ON_TIME', ['hoàn thành', 'đúng hạn', 'xong', 'ok', 'on time', 'đã hoàn thành', 'oke', 'x']);
    const statusLateCompleted = findStatusRecord('LATE_COMPLETED', ['trễ', 'muộn', 'bù', 'bổ sung', 'late', 'delay', 'làm muộn', 'nộp bù']);
    const statusIncomplete = findStatusRecord('INCOMPLETE', ['chưa', 'không', 'vắng', 'thiếu', 'chưa nộp', 'không phản hồi', 'chưa làm']);
    const statusMilitary = findStatusRecord('ON_LEAVE', ['quân sự', 'nghĩa vụ']);
    const statusExam = findStatusRecord('ON_LEAVE', ['ôn thi', 'lịch thi', 'đi viện', 'nhập viện', 'viện']);
    const statusOff = findStatusRecord('ON_LEAVE', ['nghỉ', 'xin nghỉ']);
    const statusPermission = findStatusRecord('ON_LEAVE', ['phép', 'xin phép', 'hoãn']);

    const colorCompleted = statusOnTime ? hexToRgbRatio(statusOnTime.color_hex) : hexToRgbRatio(config.color_completed || '#10b981');
    const colorLate = statusLateCompleted ? hexToRgbRatio(statusLateCompleted.color_hex) : hexToRgbRatio(config.color_late || '#f59e0b');
    const colorNoResponse = statusIncomplete ? hexToRgbRatio(statusIncomplete.color_hex) : null;

    const [year, monthStr, dayStr] = workDate.split('-');
    const day = parseInt(dayStr, 10);
    const targetCol = getColumnForDay(day);
    const colIndex0 = 2 + day; // 0-based column index (Ngày 1: 2+1 = 3, tức cột D)

    // Lấy toàn bộ thành viên của Vùng cùng hàng sheet của họ
    let members = await db.all(
        "SELECT * FROM members WHERE region_id = ? AND status = 'Active' ORDER BY sheet_row_index ASC",
        [regionId]
    );

    if (members.length === 0) {
        try {
            const { syncMembersFromSheet } = require('./sheet_member_sync');
            console.log(`[SHEET MATRIX SYNC] Vùng ${regionId} chưa có thành viên, tự động đồng bộ từ Google Sheet...`);
            await syncMembersFromSheet(regionId);
            members = await db.all(
                "SELECT * FROM members WHERE region_id = ? AND status = 'Active' ORDER BY sheet_row_index ASC",
                [regionId]
            );
        } catch (syncErr) {
            console.warn(`[SHEET MATRIX SYNC] Không thể tự động kéo thành viên Vùng ${regionId}:`, syncErr.message);
        }
    }

    if (members.length === 0) {
        return { 
            success: false, 
            rowsUpdated: 0, 
            message: 'Không tìm thấy danh sách thành viên hoạt động cho Vùng này. Vui lòng bấm [Đồng bộ Sheet] hoặc kiểm tra liên kết Google Trang tính.' 
        };
    }

    // Lấy danh sách nộp bài trong ngày
    const submissions = await db.all(
        "SELECT * FROM submissions WHERE region_id = ? AND work_date = ?",
        [regionId, workDate]
    );
    const subMap = new Map();
    submissions.forEach(s => subMap.set(s.member_id, s));

    const minRow = Math.min(...members.map(m => m.sheet_row_index));
    const maxRow = Math.max(...members.map(m => m.sheet_row_index));
    const rowCount = maxRow - minRow + 1;

    // Khởi tạo mảng giá trị cột
    const columnValues = Array.from({ length: rowCount }, () => ['']);
    const valueRanges = [];
    const formatRequests = [];

    if (options.skipSheet) {
        console.log(`[SHEET MATRIX SYNC] Bỏ qua ghi Google Sheet (skipSheet=true) theo yêu cầu cho Vùng ${regionId}, ngày ${workDate}`);
        return {
            success: true,
            skipped: true,
            range: null,
            rowsUpdated: 0,
            message: 'Đã bỏ qua ghi Google Sheet theo yêu cầu'
        };
    }

    const { getExpectedMonthTab } = require('../utils/sheet_time');
    const expectedTab = getExpectedMonthTab(workDate);
    let tabName = expectedTab;
    if (region.sheet_name && !region.sheet_name.match(/^T\d+\/\d+$/i)) {
        tabName = region.sheet_name;
    }

    let numericSheetId = 0;
    if (region.sheet_id) {
        try {
            const check = await GoogleSheetsClient.checkTabExists(region.sheet_id, tabName);
            const isSafeMode = process.env.SAFE_MODE === 'true';
            if (check.exists) {
                numericSheetId = check.tabId || 0;
            } else if ((dryRun || isSafeMode) && check.error) {
                console.log(`[SHEET MATRIX SYNC] [DRY_RUN/SAFE_MODE] Bỏ qua lỗi check tab (${check.error}), tiếp tục giả lập ghi vào tab "${tabName}"`);
            } else {
                console.warn(`[SHEET MATRIX SYNC] Cảnh báo: Google Sheet (${region.sheet_id}) chưa có tab "${tabName}". Hiện có: [${(check.currentTabs || []).join(', ')}]`);
                return {
                    success: false,
                    tabMissing: true,
                    expectedTab: tabName,
                    currentTabs: check.currentTabs || [],
                    latestTab: check.latestTab,
                    spreadsheetId: region.sheet_id,
                    message: `Google Sheet chưa có tab tháng mới "${tabName}". Dữ liệu được lưu trong hệ thống bot, chưa ghi vào Sheet.`
                };
            }
        } catch (e) {
            console.error('[SHEET MATRIX SYNC] Lỗi kiểm tra tab:', e.message);
        }
    }

    const onlyMemberIds = Array.isArray(options.onlyMemberIds) && options.onlyMemberIds.length > 0
        ? new Set(options.onlyMemberIds)
        : null;

    // Điền dữ liệu chính xác vào hàng tương ứng của từng thành viên
    for (const mem of members) {
        if (onlyMemberIds && !onlyMemberIds.has(mem.id)) {
            continue;
        }
        const offset = mem.sheet_row_index - minRow;
        const rowIndex0 = mem.sheet_row_index - 1; // 0-based row index
        const sub = subMap.get(mem.id);

        let cellText = '';
        let cellColor = null;

        const isLateSubmission = sub && (
            sub.status === 'SUPPLEMENT' ||
            sub.status === 'LATE_COMPLETED' || 
            (sub.status === 'OK' && sub.notes && /(?:nộp\s*bù|làm\s*bù|gửi\s*bù|bù\s*ngày|bổ\s*sung)/i.test(sub.notes))
        );
        const isOnTimeSubmission = sub && (sub.status === 'OK' || sub.status === 'SUPPLEMENT' || sub.status === 'LATE_COMPLETED') && !isLateSubmission;

        if (isOnTimeSubmission) {
            cellText = (statusOnTime && statusOnTime.text_value !== undefined && statusOnTime.text_value !== '')
                ? statusOnTime.text_value
                : completedText;
            cellColor = colorCompleted;
        } else if (isLateSubmission) {
            // Nộp bù / làm trễ
            if (statusLateCompleted) {
                // Người dùng CÓ trạng thái Làm trễ / Nộp bù
                cellText = (statusLateCompleted.text_value !== undefined && statusLateCompleted.text_value !== '')
                    ? statusLateCompleted.text_value
                    : completedText;
                cellColor = colorLate;
            } else {
                // Người dùng ĐÃ XÓA dòng làm trễ (chỉ còn Hoàn thành xanh lá như Vùng 29):
                // -> Vẫn ghi chữ hoàn thành (ví dụ Ok), nhưng TUYỆT ĐỐI KHÔNG TÔ MÀU XANH LÁ của người đúng hạn!
                cellText = completedText;
                cellColor = null; // Giữ nguyên màu nền mặc định của Google Sheet
            }
        } else if (sub && sub.status === 'LATE_REQUEST') {
            const note = (sub.notes || '').toLowerCase();
            if (lateText === '') {
                cellText = '';
            } else if (note.includes('quân sự') || note.includes('nghĩa vụ')) {
                cellText = (statusMilitary && statusMilitary.text_value !== undefined) ? statusMilitary.text_value : (sub.notes || 'Đi quân sự');
            } else if (note.includes('ôn thi') || note.includes('lịch thi') || note.includes('đi viện') || note.includes('nhập viện')) {
                cellText = (statusExam && statusExam.text_value !== undefined) ? statusExam.text_value : (sub.notes || 'Ôn thi/Đi viện');
            } else if (note.includes('phép') || note.includes('xin phép')) {
                cellText = (statusPermission && statusPermission.text_value !== undefined) ? statusPermission.text_value : (sub.notes || lateWithPermissionText);
            } else {
                cellText = (statusLateCompleted && statusLateCompleted.text_value !== undefined) ? statusLateCompleted.text_value : (sub.notes || lateText);
            }

            if (note.includes('quân sự') || note.includes('nghĩa vụ')) {
                cellColor = statusMilitary ? hexToRgbRatio(statusMilitary.color_hex) : hexToRgbRatio('#8b5cf6');
            } else if (note.includes('ôn thi') || note.includes('lịch thi') || note.includes('đi viện') || note.includes('nhập viện')) {
                cellColor = statusExam ? hexToRgbRatio(statusExam.color_hex) : hexToRgbRatio('#ec4899');
            } else if (note.includes('phép') || note.includes('xin phép')) {
                cellColor = statusPermission ? hexToRgbRatio(statusPermission.color_hex) : hexToRgbRatio('#8b5cf6');
            } else {
                cellColor = colorLate;
            }
        } else if (sub && sub.status === 'OFF') {
            cellText = (statusOff && statusOff.text_value !== undefined) ? statusOff.text_value : (sub.notes || 'Xin nghỉ');
            cellColor = statusOff ? hexToRgbRatio(statusOff.color_hex) : hexToRgbRatio('#ef4444');
        } else {
            // Chưa làm / không phản hồi
            if (statusIncomplete) {
                cellText = (statusIncomplete.text_value !== undefined) ? statusIncomplete.text_value : '';
                cellColor = (cellText && statusIncomplete.color_hex) ? colorNoResponse : null;
            } else {
                // Người dùng không cấu hình trạng thái chưa làm/không phản hồi (hoặc đã xóa trạng thái này)
                // -> Để trống ô trên Google Sheet, TUYỆT ĐỐI không ghi chữ và không tô màu
                cellText = '';
                cellColor = null;
            }
        }

        columnValues[offset] = [cellText];

        valueRanges.push({
            range: `${tabName}!${targetCol}${mem.sheet_row_index}`,
            values: [[cellText]]
        });

        if (enableSheetColors && cellColor) {
            formatRequests.push({
                repeatCell: {
                    range: {
                        sheetId: numericSheetId,
                        startRowIndex: rowIndex0,
                        endRowIndex: rowIndex0 + 1,
                        startColumnIndex: colIndex0,
                        endColumnIndex: colIndex0 + 1
                    },
                    cell: {
                        userEnteredFormat: {
                            backgroundColor: cellColor,
                            horizontalAlignment: 'CENTER',
                            textFormat: {
                                fontFamily: 'Times New Roman',
                                fontSize: 12,
                                bold: false,
                                italic: false
                            }
                        }
                    },
                    fields: 'userEnteredFormat(backgroundColor,horizontalAlignment,textFormat)'
                }
            });
        }
    }

    const range = `${tabName}!${targetCol}${minRow}:${targetCol}${maxRow}`;
    console.log(`[SHEET MATRIX SYNC] Chuẩn bị ghi ${columnValues.length} ô vào dải: ${range} trên Spreadsheet ID: ${region.sheet_id || 'LOCAL_MOCK'}`);

    const client = GoogleSheetsClient.getClient();
    const isSafeMode = process.env.SAFE_MODE === 'true';

    if (dryRun || !region.sheet_id || isSafeMode || !client) {
        console.log(`[SHEET MATRIX SYNC] [LOCAL/SAFE MODE] Đã cập nhật thành công giả lập ${columnValues.length} ô vào ${range}. Format requests: ${formatRequests.length}`);
        
        await db.run(
            "UPDATE submissions SET sheet_synced = 1 WHERE region_id = ? AND work_date = ?",
            [regionId, workDate]
        );

        return {
            success: true,
            range,
            rowsUpdated: columnValues.length,
            targetCol,
            formatsPrepared: formatRequests.length,
            dryRun: true,
            mode: isSafeMode ? 'SAFE_MODE' : 'DRY_RUN'
        };
    }

    // Ghi qua Google Sheets API bằng batchUpdate (đảm bảo chỉ ghi đúng ô của từng sứ giả, không đè lên các dòng tiêu đề phụ/dòng trống)
    let apiUpdateSuccess = true;
    let apiUpdateError = null;
    try {
        await executeGoogleApiWithRetry(() => client.spreadsheets.values.batchUpdate({
            spreadsheetId: region.sheet_id,
            resource: {
                valueInputOption: 'USER_ENTERED',
                data: valueRanges
            }
        }));
    } catch (apiErr) {
        apiUpdateSuccess = false;
        apiUpdateError = apiErr.message;
        console.warn(`[SHEET MATRIX SYNC] Cảnh báo Google Sheets API: ${apiErr.message}. Tiếp tục lưu trữ cục bộ.`);
    }

    // Thực hiện format màu sắc hàng loạt nếu có requests
    if (formatRequests.length > 0 && apiUpdateSuccess) {
        try {
            console.log(`[SHEET MATRIX SYNC] Đang áp dụng định dạng màu sắc Google Sheets (${formatRequests.length} ô)...`);
            await executeGoogleApiWithRetry(() => client.spreadsheets.batchUpdate({
                spreadsheetId: region.sheet_id,
                resource: {
                    requests: formatRequests
                }
            }));
            console.log(`[SHEET MATRIX SYNC] ✅ Đã tô màu và định dạng thành công ${formatRequests.length} ô trên Sheet.`);
        } catch (fmtErr) {
            console.warn(`[SHEET MATRIX SYNC] Cảnh báo khi format màu: ${fmtErr.message}`);
        }
    }

    if (!apiUpdateSuccess) {
        return {
            success: false,
            range,
            rowsUpdated: 0,
            error: apiUpdateError,
            message: `Lỗi ghi Google Sheet: ${apiUpdateError}. Dữ liệu báo cáo đã được lưu an toàn trong Bot.`
        };
    }

    await db.run(
        "UPDATE submissions SET sheet_synced = 1 WHERE region_id = ? AND work_date = ?",
        [regionId, workDate]
    );

    return {
        success: true,
        range,
        rowsUpdated: columnValues.length,
        formatsApplied: formatRequests.length,
        targetCol,
        dryRun: false
    };
}

/**
 * Đồng bộ kết quả báo cáo của các Vùng lên Google Sheet của Cụm
 * @param {number} clusterId
 * @param {string} workDate 'YYYY-MM-DD'
 * @param {Object} [options]
 * @returns {Promise<Object>}
 */
async function syncClusterMatrixSheet(clusterId = 5, workDate, options = {}) {
    const dryRun = options.dryRun === true;
    const cluster = await db.get('SELECT * FROM clusters WHERE id = ?', [clusterId]);
    if (!cluster) throw new Error(`Không tìm thấy Cụm ID ${clusterId}`);

    const [year, monthStr, dayStr] = workDate.split('-');
    const day = parseInt(dayStr, 10);
    const targetCol = getColumnForDay(day);

    const regions = await db.all("SELECT * FROM regions WHERE cluster_id = ? AND status = 'active' ORDER BY id ASC", [clusterId]);
    const reports = await db.all("SELECT * FROM reports WHERE report_type = 'region' AND work_date = ?", [workDate]);
    const reportedRegionIds = new Set(reports.map(r => r.region_id));

    const { getExpectedMonthTab } = require('../utils/sheet_time');
    const tabName = getExpectedMonthTab(workDate);

    console.log(`[CLUSTER SHEET SYNC] Đồng bộ Cụm ${clusterId} (Ngày ${workDate}) lên Spreadsheet ID: ${cluster.sheet_id || 'LOCAL_MOCK'}`);

    const clusterUpdates = regions.map(r => ({
        regionId: r.id,
        regionName: r.region_name,
        reported: reportedRegionIds.has(r.id),
        statusText: reportedRegionIds.has(r.id) ? '✓' : 'Chưa nộp'
    }));

    return {
        success: true,
        clusterId,
        workDate,
        tabName,
        targetCol,
        regionsChecked: regions.length,
        regionsReported: reportedRegionIds.size,
        details: clusterUpdates,
        dryRun: dryRun || !cluster.sheet_id
    };
}

module.exports = {
    indexToColumnLetter,
    getColumnForDay,
    syncRegionMatrixSheet,
    syncClusterMatrixSheet,
    hexToRgbRatio
};

let _google = null;
function getGoogle() {
    if (!_google) {
        _google = require('googleapis').google;
    }
    return _google;
}
const { getAuthClient } = require('./auth');
const { executeGoogleApiWithRetry } = require('./retry');

// Bộ nhớ đệm lưu thông tin cấu trúc Sheets (TTL 5 phút)
const metadataCache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

class GoogleSheetsClient {
    constructor() {
        this.sheetsClient = null;
        this.fakeSpreadsheets = {}; // key: spreadsheetId, value: { [sheetName]: rows[] }
    }

    /**
     * Khởi tạo và trả về Google Sheets API Client
     * @returns {Object|null}
     */
    getClient() {
        if (this.sheetsClient) {
            return this.sheetsClient;
        }

        const auth = getAuthClient();
        if (!auth) {
            return null; // Trả về null để kích hoạt chế độ Giả lập (Mock)
        }

        const google = getGoogle();
        this.sheetsClient = google.sheets({
            version: 'v4',
            auth
        });
        return this.sheetsClient;
    }

    /**
     * Lấy danh sách metadata của các tab trong Spreadsheet (sử dụng cache)
     * @param {string} spreadsheetId 
     * @returns {Promise<Array<Object>>}
     */
    async getSheetsMetadata(spreadsheetId) {
        const client = this.getClient();
        const now = Date.now();
        const cached = metadataCache.get(spreadsheetId);
        if (cached && cached.expiresAt > now) {
            return cached.sheetsMetadata;
        }

        let sheetsMetadata;
        if (!client) {
            // Chế độ giả lập: dùng fakeSpreadsheets
            const sheets = this.fakeSpreadsheets[spreadsheetId] || {};
            sheetsMetadata = Object.keys(sheets).map((title, idx) => ({ title, sheetId: idx + 1 }));
            if (sheetsMetadata.length === 0) {
                sheetsMetadata = [{ title: 'Sheet1', sheetId: 0 }];
            }
        } else {
            console.log(`[GOOGLE SHEETS CLIENT] Cache Miss. Đang tải metadata từ Google API cho ID: "${spreadsheetId}"`);
            const response = await executeGoogleApiWithRetry(() =>
                client.spreadsheets.get({
                    spreadsheetId
                })
            );
            sheetsMetadata = response.data.sheets.map(s => s.properties);
        }

        metadataCache.set(spreadsheetId, {
            expiresAt: now + CACHE_TTL_MS,
            sheetsMetadata
        });

        return sheetsMetadata;
    }

    /**
     * Đảm bảo tab tồn tại, nếu chưa có thì tạo mới
     * @param {Object} syncContext 
     */
    async ensureSheet(syncContext) {
        const client = this.getClient();
        const { spreadsheetId, sheetName } = syncContext;

        const sheetsMeta = await this.getSheetsMetadata(spreadsheetId);
        const existing = sheetsMeta.find(s => s.title === sheetName);

        if (existing) {
            syncContext.sheetId = existing.sheetId;
            syncContext.createdSheet = false;
            return;
        }

        // Tạo tab mới nếu chưa tồn tại
        console.log(`[GOOGLE SHEETS CLIENT] Tab "${sheetName}" chưa tồn tại. Đang tiến hành tạo mới...`);
        syncContext.createdSheet = true;

        // Invalid cache trước khi ghi (áp dụng cả khi chạy giả lập)
        metadataCache.delete(spreadsheetId);

        if (!client) {
            // Giả lập: thêm tab vào fakeSpreadsheets
            if (!this.fakeSpreadsheets[spreadsheetId]) {
                this.fakeSpreadsheets[spreadsheetId] = {};
            }
            if (!this.fakeSpreadsheets[spreadsheetId][sheetName]) {
                this.fakeSpreadsheets[spreadsheetId][sheetName] = [];
            }
            syncContext.sheetId = Math.floor(Math.random() * 100000);
            return;
        }

        const result = await executeGoogleApiWithRetry(() =>
            client.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: {
                    requests: [
                        {
                            addSheet: {
                                properties: { title: sheetName }
                            }
                        }
                    ]
                }
            })
        );

        // Lấy sheetId của tab mới tạo
        const newSheetProperties = result.data.replies[0].addSheet.properties;
        syncContext.sheetId = newSheetProperties.sheetId;
        
        if (result.data.spreadsheetId) {
            syncContext.providerRequestId = result.data.spreadsheetId; // google request id fallback
        }
    }

    /**
     * Cấu hình định dạng cho Tab (Bold header, freeze row, resize columns)
     * @param {Object} syncContext 
     */
    async formatSheet(syncContext) {
        const client = this.getClient();
        const { spreadsheetId, sheetId, sheetName } = syncContext;

        console.log(`[GOOGLE SHEETS CLIENT] Đang định dạng cho Tab: "${sheetName}" (ID: ${sheetId})...`);

        if (!client) {
            return;
        }

        await executeGoogleApiWithRetry(() =>
            client.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: {
                    requests: [
                        // 1. Đóng băng dòng đầu tiên (Frozen Row 1)
                        {
                            updateSheetProperties: {
                                properties: {
                                    sheetId: sheetId,
                                    gridProperties: {
                                        frozenRowCount: 1
                                    }
                                },
                                fields: 'gridProperties.frozenRowCount'
                            }
                        },
                        // 2. Định dạng in đậm tiêu đề (Bold header)
                        {
                            repeatCell: {
                                range: {
                                    sheetId: sheetId,
                                    startRowIndex: 0,
                                    endRowIndex: 1,
                                    startColumnIndex: 0,
                                    endColumnIndex: 10
                                },
                                cell: {
                                    userEnteredFormat: {
                                        textFormat: {
                                            bold: true
                                        },
                                        backgroundColor: {
                                            red: 0.9,
                                            green: 0.9,
                                            blue: 0.9
                                        }
                                    }
                                },
                                fields: 'userEnteredFormat(textFormat.bold,backgroundColor)'
                            }
                        },
                        // 3. Tự động co giãn cột cho vừa khít nội dung
                        {
                            autoResizeDimensions: {
                                dimensions: {
                                    sheetId: sheetId,
                                    dimension: 'COLUMNS',
                                    startIndex: 0,
                                    endIndex: 10
                                }
                            }
                        }
                    ]
                }
            })
        );
    }

    /**
     * Ghi đè dữ liệu báo cáo vào ô dải
     * @param {Object} syncContext 
     * @returns {Promise<Object>}
     */
    async updateValues(syncContext) {
        const client = this.getClient();
        const { spreadsheetId, sheetName, rows } = syncContext;

        console.log(`[GOOGLE SHEETS CLIENT] Đang ghi ${rows.length} dòng dữ liệu vào Tab "${sheetName}"...`);

        if (!client) {
            // Mock mode delay
            await new Promise(resolve => setTimeout(resolve, 50));
            if (!this.fakeSpreadsheets[spreadsheetId]) {
                this.fakeSpreadsheets[spreadsheetId] = {};
            }
            this.fakeSpreadsheets[spreadsheetId][sheetName] = rows;
            return {
                providerRequestId: 'mock-request-' + Date.now(),
                rowsSynced: rows.length
            };
        }

        const range = `${sheetName}!A1`;
        const result = await executeGoogleApiWithRetry(() =>
            client.spreadsheets.values.update({
                spreadsheetId,
                range,
                valueInputOption: 'USER_ENTERED',
                resource: {
                    values: rows
                }
            })
        );

        return {
            providerRequestId: result.config ? result.config.headers['x-goog-api-client'] || null : null,
            rowsSynced: result.data.updatedRows || rows.length
        };
    }

    /**
     * Lấy giá trị các ô trong một dải (A1 Notation)
     * @param {string} spreadsheetId 
     * @param {string} range Ví dụ: 'T8/26!C4:C80'
     * @returns {Promise<Array<Array<string>>>}
     */
    async getValues(spreadsheetId, range) {
        const client = this.getClient();
        if (!client) {
            return [];
        }
        const response = await executeGoogleApiWithRetry(() =>
            client.spreadsheets.values.get({
                spreadsheetId,
                range
            })
        );
        return response.data.values || [];
    }

    /**
     * Lấy dữ liệu lưới ô chi tiết kèm định dạng (như strikethrough gạch ngang)
     * @param {string} spreadsheetId 
     * @param {string} range Ví dụ: 'T8/26!C4:C80'
     * @returns {Promise<Array<{ rowIndex: number, value: string, strikethrough: boolean }>>}
     */
    async getGridData(spreadsheetId, range) {
        if (this.mockGridData && this.mockGridData[spreadsheetId]) {
            return this.mockGridData[spreadsheetId];
        }

        const client = this.getClient();
        if (!client) {
            return [];
        }

        const response = await executeGoogleApiWithRetry(() =>
            client.spreadsheets.get({
                spreadsheetId,
                ranges: [range],
                includeGridData: true
            })
        );

        const results = [];
        const sheets = response.data.sheets || [];
        for (const sheet of sheets) {
            const dataList = sheet.data || [];
            for (const data of dataList) {
                const startRow = (data.startRow !== undefined) ? data.startRow : 0;
                const rowData = data.rowData || [];
                rowData.forEach((row, idx) => {
                    const currentRow1Based = startRow + idx + 1;
                    if (!row || !row.values || row.values.length === 0) return;
                    const cell = row.values[0];
                    const value = (cell.formattedValue || '').trim();
                    const textFormat = cell.effectiveFormat?.textFormat || {};
                    const strikethrough = textFormat.strikethrough === true;
                    if (value) {
                        results.push({
                            rowIndex: currentRow1Based,
                            value,
                            strikethrough
                        });
                    }
                });
            }
        }
        return results;
    }

    /**
     * Giả lập dữ liệu gridData (Dành cho kiểm thử / Safe Mode)
     */
    setMockGridData(spreadsheetId, data) {
        if (!this.mockGridData) this.mockGridData = {};
        this.mockGridData[spreadsheetId] = data;
    }

    /**
     * Reset fake spreadsheets (Dành riêng cho Testing để reset sandbox)
     */
    resetFakeSpreadsheets() {
        this.fakeSpreadsheets = {};
        this.mockGridData = {};
    }

    /**
     * Kiểm tra xem spreadsheetId có trong cache không (Dành riêng cho Testing)
     * @param {string} spreadsheetId 
     * @returns {boolean}
     */
    hasMetadataCache(spreadsheetId) {
        return metadataCache.has(spreadsheetId);
    }

    /**
     * Kiểm tra xem tab có tồn tại trên Spreadsheet hay không
     * @param {string} spreadsheetId 
     * @param {string} tabTitle Ví dụ 'T10/26'
     * @returns {Promise<{ exists: boolean, currentTabs: string[], tabId?: number, latestTab?: string }>}
     */
    async checkTabExists(spreadsheetId, tabTitle) {
        if (!spreadsheetId) {
            return { exists: false, currentTabs: [], message: 'Chưa liên kết Google Sheet' };
        }
        try {
            const meta = await this.getSheetsMetadata(spreadsheetId);
            const currentTabs = meta.map(s => s.title);
            const found = meta.find(s => s.title === tabTitle);
            const latestTab = currentTabs.length > 0 ? currentTabs[currentTabs.length - 1] : null;
            return {
                exists: !!found,
                tabId: found ? found.sheetId : null,
                currentTabs,
                latestTab
            };
        } catch (err) {
            console.error(`[GOOGLE SHEETS CLIENT] Lỗi kiểm tra tab "${tabTitle}":`, err.message);
            return {
                exists: false,
                currentTabs: [],
                error: err.message
            };
        }
    }

    /**
     * Nhân bản một tab tháng cũ thành tab tháng mới
     * @param {string} spreadsheetId 
     * @param {string} sourceTabTitle Ví dụ 'T9/26'
     * @param {string} newTabTitle Ví dụ 'T10/26'
     * @returns {Promise<{ success: boolean, newSheetId?: number, message?: string }>}
     */
    async duplicateMonthTab(spreadsheetId, sourceTabTitle, newTabTitle) {
        const client = this.getClient();
        const meta = await this.getSheetsMetadata(spreadsheetId);
        let sourceSheet = meta.find(s => s.title === sourceTabTitle);
        if (!sourceSheet) {
            // Lọc các tab có định dạng tháng T{tháng}/{năm} để ưu tiên tab tháng gần nhất
            const monthTabs = meta.filter(s => s.title.match(/^T\d+\/\d+$/i));
            if (monthTabs.length > 0) {
                sourceSheet = monthTabs[monthTabs.length - 1];
            } else if (meta.length > 0) {
                sourceSheet = meta[meta.length - 1]; // Lấy tab cuối cùng nếu không tìm thấy tab tháng
            }
        }

        if (!sourceSheet) {
            throw new Error(`Không tìm thấy tab nguồn để nhân bản trên Spreadsheet ID: ${spreadsheetId}`);
        }

        metadataCache.delete(spreadsheetId);

        if (!client) {
            // Giả lập (Mock Mode)
            if (!this.fakeSpreadsheets[spreadsheetId]) {
                this.fakeSpreadsheets[spreadsheetId] = {};
            }
            const sourceRows = this.fakeSpreadsheets[spreadsheetId][sourceSheet.title] || [];
            this.fakeSpreadsheets[spreadsheetId][newTabTitle] = JSON.parse(JSON.stringify(sourceRows));
            await this.formatNewMonthTab(spreadsheetId, newTabTitle);
            const newSheetId = Math.floor(Math.random() * 100000);
            return {
                success: true,
                newSheetId,
                title: newTabTitle,
                message: `Đã nhân bản tab "${sourceSheet.title}" thành "${newTabTitle}" và cập nhật ngày/thứ (Mock Mode)`
            };
        }

        // Gọi API duplicateSheet
        const result = await executeGoogleApiWithRetry(() =>
            client.spreadsheets.batchUpdate({
                spreadsheetId,
                resource: {
                    requests: [
                        {
                            duplicateSheet: {
                                sourceSheetId: sourceSheet.sheetId,
                                newSheetName: newTabTitle
                            }
                        }
                    ]
                }
            })
        );

        const newProps = result.data.replies[0]?.duplicateSheet?.properties;

        // Cập nhật ngày, thứ và xóa nội dung thừa cho tháng mới
        await this.formatNewMonthTab(spreadsheetId, newTabTitle);

        return {
            success: true,
            newSheetId: newProps?.sheetId,
            title: newProps?.title || newTabTitle
        };
    }

    /**
     * Tự động cập nhật hàng ngày, hàng thứ và dọn sạch dữ liệu cũ cho tab tháng mới
     * - Cập nhật chính xác thứ trong tuần (T2, T3, ..., CN) theo lịch tháng mới.
     * - Nếu tháng có < 31 ngày (vd: 30 ngày), xóa nội dung cột ngày 31.
     * - Xóa dữ liệu điểm danh tháng cũ, giữ nguyên 100% cột STT, Ngày tham gia, Họ & Tên và Tổng ngày làm việc.
     * @param {string} spreadsheetId 
     * @param {string} newTabTitle Ví dụ 'T10/26'
     */
    async formatNewMonthTab(spreadsheetId, newTabTitle) {
        const client = this.getClient();
        const match = newTabTitle.match(/^T(\d+)\/(\d+)$/i);
        if (!match) return;

        const month = parseInt(match[1], 10);
        let year = parseInt(match[2], 10);
        if (year < 100) year += 2000;

        const daysInMonth = new Date(year, month, 0).getDate();
        const dowMap = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

        const weekdaysRow = [];
        const daysRow = [];
        const emptyAttendanceRow = [];

        for (let d = 1; d <= 31; d++) {
            if (d <= daysInMonth) {
                const curDate = new Date(year, month - 1, d);
                weekdaysRow.push(dowMap[curDate.getDay()]);
                daysRow.push(String(d));
            } else {
                // Tháng không có ngày 31 (hoặc 29, 30 đối với tháng 2): Xóa nội dung
                weekdaysRow.push('');
                daysRow.push('');
            }
            emptyAttendanceRow.push('');
        }

        if (!client) {
            // Giả lập (Mock Mode)
            if (this.fakeSpreadsheets[spreadsheetId] && this.fakeSpreadsheets[spreadsheetId][newTabTitle]) {
                const rows = this.fakeSpreadsheets[spreadsheetId][newTabTitle];
                for (let i = 0; i < rows.length; i++) {
                    const r = rows[i];
                    const isDateRow = r && r.length > 5 && (r[3] === '1' || r[3] === 1) && (r[4] === '2' || r[4] === 2);
                    if (isDateRow) {
                        r.splice(3, 31, ...daysRow);
                        if (i > 0 && rows[i - 1]) {
                            rows[i - 1].splice(3, 31, ...weekdaysRow);
                        }
                    } else if (i >= 4 && r && r[2] && typeof r[2] === 'string' && r[2].trim().length >= 3 && !r[2].includes('Họ')) {
                        r.splice(3, 31, ...emptyAttendanceRow);
                    }
                }
            }
            return;
        }

        // Thực thi trên Google Sheets API
        try {
            const res = await executeGoogleApiWithRetry(() =>
                client.spreadsheets.values.get({
                    spreadsheetId,
                    range: `${newTabTitle}!A1:AH80`
                })
            );

            const rows = res.data.values || [];
            const updateData = [];

            for (let i = 0; i < rows.length; i++) {
                const r = rows[i];
                const isDateRow = r && r.length > 5 && (r[3] === '1' || r[3] === 1) && (r[4] === '2' || r[4] === 2);
                if (isDateRow) {
                    // Dòng ngày (1-based index là i + 1)
                    updateData.push({
                        range: `${newTabTitle}!D${i + 1}:AH${i + 1}`,
                        values: [daysRow]
                    });
                    // Dòng thứ (1-based index là i)
                    if (i > 0) {
                        updateData.push({
                            range: `${newTabTitle}!D${i}:AH${i}`,
                            values: [weekdaysRow]
                        });
                    }
                } else if (i >= 4 && r && r[2] && typeof r[2] === 'string' && r[2].trim().length >= 3 && !r[2].includes('Họ')) {
                    // Dòng thành viên -> xóa sạch các ô điểm danh cũ
                    updateData.push({
                        range: `${newTabTitle}!D${i + 1}:AH${i + 1}`,
                        values: [emptyAttendanceRow]
                    });
                }
            }

            if (updateData.length > 0) {
                await executeGoogleApiWithRetry(() =>
                    client.spreadsheets.values.batchUpdate({
                        spreadsheetId,
                        resource: {
                            valueInputOption: 'USER_ENTERED',
                            data: updateData
                        }
                    })
                );
                console.log(`[GOOGLE SHEETS CLIENT] ✨ Đã cập nhật xong ngày, thứ và làm sạch điểm danh cũ cho tab "${newTabTitle}" (${updateData.length} dải ô)`);
            }
        } catch (fmtErr) {
            console.warn(`[GOOGLE SHEETS CLIENT] Cảnh báo: Không thể tự động định dạng ngày/thứ cho tab "${newTabTitle}":`, fmtErr.message);
        }
    }

    /**
     * Kiểm tra xem spreadsheetId có trong cache không (Dành riêng cho Testing)
     * @param {string} spreadsheetId 
     * @returns {boolean}
     */
    hasMetadataCache(spreadsheetId) {
        return metadataCache.has(spreadsheetId);
    }

    /**
     * Xóa sạch cache metadata (Dành riêng cho Testing)
     */
    clearMetadataCache() {
        metadataCache.clear();
    }
}

module.exports = new GoogleSheetsClient();

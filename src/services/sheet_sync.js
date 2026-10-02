const db = require('../config/db');
const lockManager = require('../scheduler/lock');
const GoogleSheetsClient = require('./google/sheets');

/**
 * Đảm bảo bảng lịch sử đồng bộ và cấu hình mặc định tồn tại trong cơ sở dữ liệu
 */
async function ensureHistoryTableAndConfig() {
    // 1. Tạo bảng sheet_sync_history nếu chưa có
    await db.run(`
        CREATE TABLE IF NOT EXISTS sheet_sync_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            report_id INTEGER NOT NULL,
            region_id INTEGER NOT NULL,
            task_id INTEGER NOT NULL,
            started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            completed_at DATETIME,
            status TEXT CHECK(status IN ('pending', 'syncing', 'retrying', 'success', 'failed', 'cancelled')) NOT NULL,
            sheet_name TEXT NOT NULL,
            sheet_id TEXT NOT NULL,
            provider_request_id TEXT,
            rows_synced INTEGER DEFAULT 0,
            dry_run INTEGER DEFAULT 0,
            error_message TEXT,
            retry_attempts INTEGER DEFAULT 0,
            execution_time_ms INTEGER,
            FOREIGN KEY (report_id) REFERENCES reports(id) ON DELETE CASCADE,
            FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
            FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
        );
    `);

    // 2. Tạo Index tối ưu
    await db.run(`
        CREATE INDEX IF NOT EXISTS idx_sync_history_region ON sheet_sync_history(region_id, started_at);
    `);

    // 3. Seed các cấu hình mặc định cho đồng bộ Google Sheets
    await db.run("INSERT OR IGNORE INTO local_config (key, value) VALUES ('scheduler.sheet.lock.ttl', '120000')");
    await db.run("INSERT OR IGNORE INTO local_config (key, value) VALUES ('scheduler.sheet.delay.min', '1500')");
    await db.run("INSERT OR IGNORE INTO local_config (key, value) VALUES ('scheduler.sheet.delay.max', '2500')");
    await db.run("INSERT OR IGNORE INTO local_config (key, value) VALUES ('scheduler.sheet.parallel', '3')");
}

/**
 * Đồng bộ dữ liệu báo cáo nộp bài của một Vùng (Region) lên Google Sheets
 * @param {number} regionId - ID của Vùng
 * @param {number} taskId - ID của Nhiệm vụ cần đồng bộ
 * @param {Object} [options] - Các cấu hình bổ sung
 * @param {boolean} [options.dryRun=false] - Chế độ chạy thử nghiệm không gọi API thật
 * @returns {Promise<boolean>}
 */
async function syncRegionSheet(regionId, taskId, options = {}) {
    const dryRun = options.dryRun === true;
    let lockKey = null;
    let historyId = null;
    const startTime = Date.now();

    try {
        // 0. Đảm bảo hạ tầng DB sẵn sàng
        await ensureHistoryTableAndConfig();

        // 1. Kiểm tra sự tồn tại của Vùng cấu hình
        const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
        if (!region) {
            console.error(`[SHEET SYNC] Lỗi: Vùng ID ${regionId} không tồn tại.`);
            return false;
        }

        if (!region.sheet_id) {
            console.warn(`[SHEET SYNC] Vùng "${region.region_name}" chưa cấu hình sheet_id. Bỏ qua.`);
            return false;
        }

        // 2. Tìm hoặc tự động tạo báo cáo SQLite làm liên kết dữ liệu
        let report = await db.get('SELECT id FROM reports WHERE region_id = ? AND task_id = ?', [regionId, taskId]);
        let reportId = null;
        if (report) {
            reportId = report.id;
        } else {
            console.log(`[SHEET SYNC] Chưa tìm thấy báo cáo SQLite cho Vùng ${regionId} và Task ${taskId}. Đang tự động tạo...`);
            const reportService = require('./reports');
            const newReport = await reportService.generateRegionReport(regionId, taskId);
            reportId = newReport.id;
        }

        // 3. Thực hiện lấy khóa nguyên tử sử dụng LockManager
        lockKey = `lock:sheet:${reportId}`;
        const rowLockTtl = await db.get("SELECT value FROM local_config WHERE key = 'scheduler.sheet.lock.ttl'");
        const lockTtl = rowLockTtl ? parseInt(rowLockTtl.value, 10) : 120000;

        console.log(`[SHEET SYNC] Đang yêu cầu khóa: "${lockKey}" (TTL: ${lockTtl}ms)...`);
        const acquired = await lockManager.acquireLock(lockKey, lockTtl);
        if (!acquired) {
            console.warn(`[SHEET SYNC] Không thể lấy khóa "${lockKey}". Tác vụ đồng bộ đang chạy ở tiến trình khác. Bỏ qua.`);
            return false;
        }

        // 4. Lấy Task details để cấu hình Tab Name động
        const task = await db.get('SELECT task_code, publish_date FROM tasks WHERE id = ?', [taskId]);
        const taskCode = task ? task.task_code : `TASK_${taskId}`;
        const publishDate = task ? task.publish_date : new Date().toLocaleDateString('sv');
        const sheetName = `${taskCode} - ${publishDate}`;

        // 5. Ghi nhận lịch sử ở trạng thái 'syncing' vào DB
        const insertHistory = await db.run(`
            INSERT INTO sheet_sync_history (
                report_id, region_id, task_id, started_at, status, sheet_name, sheet_id, dry_run
            ) VALUES (?, ?, ?, CURRENT_TIMESTAMP, 'syncing', ?, ?, ?)
        `, [reportId, regionId, taskId, sheetName, region.sheet_id, dryRun ? 1 : 0]);
        historyId = insertHistory.id;

        // 6. Truy vấn danh sách sứ giả cùng trạng thái nộp bài
        const submissions = await db.all(`
            SELECT m.real_name, 
                   COALESCE((SELECT zalo_display_name FROM identity_mappings WHERE member_id = m.id LIMIT 1), m.real_name) as zalo_name, 
                   s.status, s.notes, s.submitted_at 
            FROM members m
            LEFT JOIN submissions s ON m.id = s.member_id AND s.task_id = ?
            WHERE m.region_id = ? AND m.status = 'Active'
            ORDER BY m.real_name ASC
        `, [taskId, regionId]);

        // Định dạng dữ liệu dòng cột
        const rows = submissions.map(sub => [
            sub.real_name,
            sub.zalo_name,
            (sub.status === 'approved' || sub.status === 'OK') ? 'ĐÃ HOÀN THÀNH' : (sub.status === 'pending_review' ? 'ĐANG CHỜ DUYỆT' : 'CHƯA NỘP'),
            sub.notes || '',
            sub.submitted_at ? new Date(sub.submitted_at).toLocaleString('vi-VN') : ''
        ]);
        rows.unshift(['Họ Tên Sứ Giả', 'Tên Zalo', 'Trạng Thái', 'Ghi Chú', 'Thời Gian Gửi']);

        // 7. Tạo đối tượng context giao dịch (syncContext)
        const syncContext = {
            spreadsheetId: region.sheet_id,
            sheetName,
            sheetId: null,
            createdSheet: false,
            rows,
            startedAt: startTime,
            providerRequestId: null,
            rowsSynced: 0
        };

        // 8. Thực thi đồng bộ (phân biệt chế độ Dry Run)
        if (dryRun) {
            console.log(`[SHEET SYNC] [DRY RUN] Đang chạy giả lập cho Tab "${sheetName}" trên Sheet ID "${region.sheet_id}". Bỏ qua API.`);
            // Giả lập kết quả
            syncContext.rowsSynced = rows.length;
            syncContext.providerRequestId = 'dry-run-req-' + Date.now();
            await new Promise(resolve => setTimeout(resolve, 300)); // Delay mô phỏng
        } else {
            // Thực hiện thật qua Client v4
            // A. Đảm bảo tab tồn tại
            await GoogleSheetsClient.ensureSheet(syncContext);

            // B. Định dạng tab nếu mới tạo
            if (syncContext.createdSheet) {
                await GoogleSheetsClient.formatSheet(syncContext);
            }

            // C. Cập nhật dữ liệu (idempotent values write)
            const result = await GoogleSheetsClient.updateValues(syncContext);
            syncContext.providerRequestId = result.providerRequestId;
            syncContext.rowsSynced = result.rowsSynced;
        }

        // 9. Đồng bộ thành công, cập nhật lịch sử
        const executionTimeMs = Date.now() - startTime;
        await db.run(`
            UPDATE sheet_sync_history 
            SET completed_at = CURRENT_TIMESTAMP,
                status = 'success',
                provider_request_id = ?,
                rows_synced = ?,
                execution_time_ms = ?
            WHERE id = ?
        `, [syncContext.providerRequestId, syncContext.rowsSynced, executionTimeMs, historyId]);

        console.log(`[SHEET SYNC] Đồng bộ thành công Vùng "${region.region_name}". Thời gian: ${executionTimeMs}ms.`);
        
        // 10. Giải phóng khóa an toàn
        await lockManager.releaseLock(lockKey);
        return true;
    } catch (err) {
        console.error(`[SHEET SYNC] Lỗi khi đồng bộ Vùng ID ${regionId}:`, err);
        const executionTimeMs = Date.now() - startTime;
        
        if (historyId) {
            try {
                await db.run(`
                    UPDATE sheet_sync_history 
                    SET completed_at = CURRENT_TIMESTAMP,
                        status = 'failed',
                        error_message = ?,
                        execution_time_ms = ?
                    WHERE id = ?
                `, [err.message || String(err), executionTimeMs, historyId]);
            } catch (dbErr) {
                console.error('[SHEET SYNC] Không thể cập nhật lịch sử thất bại vào DB:', dbErr);
            }
        }

        // Giải phóng khóa an toàn khi lỗi
        if (lockKey) {
            await lockManager.releaseLock(lockKey);
        }
        return false;
    }
}

module.exports = {
    syncRegionSheet
};

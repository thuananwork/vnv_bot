const path = require('path');
const fs = require('fs');
const db = require('../config/db');

const credentialsPath = path.join(__dirname, '../../data/credentials.json');

let google = null;
try {
    google = require('googleapis').google;
} catch (e) {
    console.warn('[SHEET SYNC] Thư viện "googleapis" chưa được cài đặt. Hệ thống sẽ kích hoạt chế độ giả lập đồng bộ.');
}

let sheetsClient = null;

// Khởi tạo Google Sheets API client
function getSheetsClient() {
    if (!google) return null;
    if (sheetsClient) return sheetsClient;

    if (!fs.existsSync(credentialsPath)) {
        console.warn('[SHEET SYNC] Cảnh báo: File credentials.json không tồn tại ở data/. Kích hoạt chế độ giả lập đồng bộ Google Sheets.');
        return null;
    }

    try {
        const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
        const auth = new google.auth.JWT(
            credentials.client_email,
            null,
            credentials.private_key,
            ['https://www.googleapis.com/auth/spreadsheets']
        );
        sheetsClient = google.sheets({ version: 'v4', auth });
        return sheetsClient;
    } catch (err) {
        console.error('[SHEET SYNC] Lỗi khi tạo Google Sheets Client:', err);
        return null;
    }
}

/**
 * Đồng bộ dữ liệu báo cáo nộp bài của một Region lên Google Sheet riêng biệt của Region đó
 * @param {number} regionId - ID của Region
 * @param {number} taskId - ID của Task cần đồng bộ
 */
async function syncRegionSheet(regionId, taskId) {
    try {
        // Lấy thông tin cấu hình Google Sheet lưu trực tiếp tại bảng regions
        const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
        if (!region) {
            console.error(`[SHEET SYNC] Lỗi: Vùng ID ${regionId} không tồn tại.`);
            return false;
        }

        if (!region.sheet_id) {
            console.warn(`[SHEET SYNC] Vùng "${region.region_name}" chưa cấu hình sheet_id. Bỏ qua đồng bộ.`);
            return false;
        }

        // Lấy danh sách Sứ giả trong Vùng này cùng trạng thái nộp bài tương ứng
        const submissions = await db.all(`
            SELECT m.real_name, m.zalo_name, s.status, s.notes, s.submitted_at 
            FROM members m
            LEFT JOIN submissions s ON m.id = s.member_id AND s.task_id = ?
            WHERE m.region_id = ?
            ORDER BY m.real_name ASC
        `, [taskId, regionId]);

        const client = getSheetsClient();
        if (!client) {
            // Chế độ giả lập (Mock) khi thiếu file cấu hình hoặc thư viện
            console.log(`[GIẢ LẬP SYNC] Đồng bộ thành công lên Google Sheet của Vùng "${region.region_name}":`);
            console.log(` - Sheet Name: ${region.sheet_name || 'N/A'}`);
            console.log(` - Sheet ID: ${region.sheet_id}`);
            console.log(` - URL: ${region.sheet_url || 'N/A'}`);
            console.log(` - Số lượng dòng ghi nhận: ${submissions.length} Sứ giả`);
            return true;
        }

        // Chuẩn bị dữ liệu ghi nhận
        const rows = submissions.map(sub => [
            sub.real_name,
            sub.zalo_name,
            sub.status === 'approved' ? 'ĐÃ HOÀN THÀNH' : (sub.status === 'pending_review' ? 'ĐANG CHỜ DUYỆT' : 'CHƯA NỘP'),
            sub.notes || '',
            sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : ''
        ]);

        // Thêm tiêu đề cột ở dòng đầu
        rows.unshift(['Họ Tên Sứ Giả', 'Tên Zalo', 'Trạng Thái', 'Ghi Chú', 'Thời Gian Gửi']);

        const range = `${region.sheet_name || 'Trang tính 1'}!A1:E${rows.length + 1}`;

        await client.spreadsheets.values.update({
            spreadsheetId: region.sheet_id,
            range: range,
            valueInputOption: 'USER_ENTERED',
            resource: { values: rows }
        });

        console.log(`[SHEET SYNC] Đã xuất báo cáo thành công sang Google Sheet của Vùng "${region.region_name}"`);
        return true;
    } catch (err) {
        console.error(`[SHEET SYNC] Lỗi khi đồng bộ Google Sheet cho Vùng ID ${regionId}:`, err);
        return false;
    }
}

module.exports = {
    syncRegionSheet
};

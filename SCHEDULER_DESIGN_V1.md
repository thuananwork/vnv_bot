# Thiết kế Bộ Định Thời (Scheduler Design) - VNV-Bot V2

Tài liệu này mô tả chi tiết cơ chế thiết lập thời gian (Scheduler) tự động của VNV-Bot V2 để đảm bảo các tiến trình giao việc, tổng hợp báo cáo và đồng bộ dữ liệu diễn ra chính xác theo thời gian biểu quy định.

---

## 1. Biểu đồ Thời gian vận hành hàng ngày (Daily Timeline)

Hệ thống Scheduler chạy liên tục và kích hoạt 4 tác vụ quan trọng vào các khung giờ cố định trong ngày:

```
08:00                             21:00       21:05          21:10
  │                                 │           │              │
  ▼                                 ▼           ▼              ▼
[ Giao nhiệm vụ ]            [ Tổng hợp số liệu ]  [ Xuất Sheet ]  [ Gửi báo cáo Zalo ]
```

* **08:00 - Giao nhiệm vụ:** Tự động lấy nhiệm vụ trong ngày gửi đến toàn bộ các nhóm Zalo của các Vùng.
* **21:00 - Tổng hợp số liệu:** Tính toán tỷ lệ hoàn thành, sinh báo cáo Vùng & Cụm lưu vào database.
* **21:05 - Xuất Google Sheet:** Đẩy dữ liệu báo cáo chi tiết lên Google Sheet của từng Vùng.
* **21:10 - Gửi báo cáo Zalo:** Gửi các mẫu báo cáo chuẩn hóa vào các nhóm Zalo tương ứng.

---

## 2. Thiết kế Kỹ thuật chi tiết từng Tác vụ

### Tác vụ 1: Giao nhiệm vụ (08:00)
* **API kích hoạt nội bộ:** `POST /api/scheduler/distribute`
* **Logic xử lý:**
  1. Truy vấn bảng `tasks` lấy nhiệm vụ có `publish_date` bằng ngày hiện tại.
  2. Lấy danh sách toàn bộ các vùng đang hoạt động (`status = 'active'`) từ bảng `regions`.
  3. Lặp qua từng vùng và gửi nội dung nhiệm vụ (tiêu đề, mô tả chi tiết) vào nhóm Zalo tương ứng qua `zalo_group_id`.

### Tác vụ 2: Tổng hợp báo cáo (21:00)
* **API kích hoạt nội bộ:** `POST /api/scheduler/summarize`
* **Logic xử lý:**
  1. Lặp qua từng Vùng, đếm tổng số Sứ giả (`members`), số Sứ giả đã hoàn thành (`submissions.status = 'approved'`), và chưa hoàn thành.
  2. Tạo bản ghi báo cáo cấp Vùng (`report_type = 'region'`) trong bảng `reports`.
  3. Tổng hợp số liệu của tất cả các Vùng thuộc từng Cụm, tạo bản ghi báo cáo cấp Cụm (`report_type = 'cluster'`).

### Tác vụ 3: Xuất Google Sheet (21:05)
* **API kích hoạt nội bộ:** `POST /api/scheduler/sync-sheets`
* **Logic xử lý:**
  1. Lấy tất cả báo cáo Vùng vừa được tạo lúc 21:00.
  2. Gọi dịch vụ `syncRegionSheet(regionId, taskId)` để đẩy dữ liệu nộp bài trực tiếp lên trang tính Google tương ứng của từng vùng thông qua Google Sheets API.

### Tác vụ 4: Gửi báo cáo Zalo (21:10)
* **API kích hoạt nội bộ:** `POST /api/scheduler/send-reports`
* **Logic xử lý:**
  1. Gửi báo cáo Vùng vào nhóm chat Zalo của chính Vùng đó (để sứ giả đối soát) và nhóm chat của Trưởng Cụm (`CỤM 5`).
  2. Gửi báo cáo tổng hợp cấp Cụm vào nhóm điều hành `BĐH SỨ GIẢ TOÀN QUỐC - VNV` kèm thẻ tag điều phối viên (ví dụ: `@Phạm Minh Tú`).

---

## 3. Lựa chọn Công nghệ & Cơ chế Chống chạy trùng lặp

### Thư viện lên lịch trình (Cron engine)
Sử dụng thư viện `node-cron` tích hợp trực tiếp vào ứng dụng Node.js chạy ngầm:
```javascript
const cron = require('node-cron');

// 08:00 hàng ngày
cron.schedule('0 8 * * *', async () => {
    await triggerTaskDistribution();
});

// 21:00 hàng ngày
cron.schedule('0 21 * * *', async () => {
    await triggerSummary();
});

// 21:05 hàng ngày
cron.schedule('5 21 * * *', async () => {
    await triggerSheetSync();
});

// 21:10 hàng ngày
cron.schedule('10 21 * * *', async () => {
    await triggerReportDelivery();
});
```

### Cơ chế bảo mật và chống chạy trùng lặp (Locks)
Để tránh trường hợp chạy song song nhiều tiến trình (clustering/PM2) dẫn đến gửi lặp tin nhắn nhiệm vụ hay báo cáo cho người dùng, Scheduler áp dụng cơ chế **DB Lock** thông qua bảng `local_config`:

1. Khi một tác vụ định thời chạy, nó sẽ thực hiện truy vấn kiểm tra và cập nhật khóa:
   `INSERT OR IGNORE INTO local_config (key, value, updated_at) VALUES ('lock:distribute:2026-06-25', 'running', CURRENT_TIMESTAMP)`
2. Nếu truy vấn chèn thành công (không bị trùng khóa chính), tiến trình được phép chạy tiếp. Khi chạy xong, cập nhật trạng thái khóa thành `done`.
3. Nếu chèn thất bại, chứng tỏ tiến trình khác đang xử lý tác vụ này. Bỏ qua tác vụ hiện tại để tránh trùng lặp.

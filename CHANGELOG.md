# Nhật Ký Thay Đổi (Changelog) - VNV Bot

Tất cả các thay đổi lớn đối với dự án VNV Bot sẽ được ghi nhận tại tệp này.

## [2.1.0] - 2026-09-17

### Loại Bỏ Hoàn Toàn Zalo OA (100% Zalo Web Puppeteer)
- **Xóa bỏ triệt để Zalo OA:** Loại bỏ toàn bộ code, module và cấu hình liên quan đến Zalo OA (Zalo Official Account). Hệ thống không còn sử dụng hay yêu cầu bất kỳ Access Token, Refresh Token hay App Secret nào của Zalo OA.
- **Xóa Job Làm Mới Token:** Gỡ bỏ hoàn toàn tác vụ định kỳ `zaloRefreshToken.job.js` khỏi bộ lập lịch (Scheduler) và bảng cấu hình `local_config`.
- **Làm Sạch Màn Hình Khởi Động:** Bảng kiểm tra tự động khi chạy `VNV-Bot.bat` chuyển từ hiển thị `OAuth` sang hiển thị trực quan `Zalo Web...........OK`, khởi động siêu tốc dưới 1 giây mà không còn cảnh báo token hết hạn.

### Quét Báo Cáo Theo Mốc Neo Bằng Ô Tìm Kiếm Zalo (In-Chat Search)
- **Tìm Kiếm Nhiệm Vụ Bằng Từ Khóa:** Tự động mở ô Tìm kiếm trong trò chuyện Zalo Web (`.search-message-entry`), nhập từ khóa chuẩn `KẾ HOẠCH LÀM VIỆC SỨ GIẢ` để định vị tức thì bài đăng nhiệm vụ của ngày cần quét.
- **Nhảy Thẳng Đến Mốc Neo (Zero Blind Scroll):** Click trực tiếp vào kết quả tìm kiếm để nhảy đến tin nhắn giao việc trong ~1.5 giây, sau đó quét xuôi xuống dưới để thu thập 100% bài nộp của Sứ giả mà không sợ bị trôi tin nhắn hay cuộn mù.
- **Tự Động Soạn Nháp Báo Cáo:** Soạn sẵn báo cáo đã phân tích vào khung chat của nhóm Vùng tương ứng, giữ nguyên nút Gửi để Trưởng vùng/Trưởng cụm kiểm tra và phê duyệt.

## [2.0.0] - 2026-07-02

### Thay đổi Kiến Trúc Nổi Bật (Desktop Packaging)
- **Chuyển đổi Mô Hình Triển Khai:** Chuyển đổi từ chạy trên VPS (phụ thuộc PM2, Nginx, Nginx Reverse Proxy, cấu hình SSL) sang phân phối dưới dạng gói Desktop chạy cục bộ trên máy Windows của từng đơn vị.
- **Tiết Kiệm Chi Phí:** Loại bỏ hoàn toàn chi phí thuê VPS, duy trì tên miền và máy chủ. Bot chạy trực tiếp trên Windows 10/11 thông qua launcher.
- **Đóng Gói Tự Chứa (Self-contained):** Dự án được đóng gói thành một thư mục duy nhất dạng `.zip`, người dùng chỉ cần giải nén là có thể sử dụng.

### Tính Năng Mới & Cải Tiến
- **Mã Kiểm Tra Môi Trường (`check_env.js`):** Tự động xác thực phiên bản Node.js (yêu cầu >= 20.6.0, khuyên dùng LTS 22+), kiểm tra npm, sự tồn tại của cấu hình `.env`, Google credentials, và khả năng kết nối cơ sở dữ liệu SQLite trước khi khởi động.
- **Launcher Tích Hợp Kiểm Tra Lỗi:** File `VNV-Bot.bat` tự động gọi mã kiểm tra môi trường trước khi chạy bot. Nếu phát hiện thiếu file cấu hình hoặc sai phiên bản Node, sẽ hiển thị thông báo lỗi thân thiện và dừng chạy thay vì sập bất thường.
- **Tập Trung Hóa Thư Mục Cấu Hình (`config/`):** Chuyển các file nhạy cảm `.env` và `credentials.json` vào thư mục `config/` giúp thư mục gốc gọn gàng và dễ quản lý.
- **Tự Động Hóa Nâng Cấp (`update.bat`):** Script nâng cấp một click giúp tự động sao lưu phiên bản cũ, copy database và file cấu hình sang phiên bản mới, hỗ trợ phục hồi dữ liệu tự động nếu xảy ra lỗi.
- **File VERSION Nhanh:** Bổ sung file `VERSION` ở root để quản trị viên/hỗ trợ viên kiểm tra nhanh phiên bản đang chạy mà không cần mở code.
- **Credentials Mẫu:** Bổ sung `config/credentials.example.json` để làm mẫu định dạng tệp khóa Google API Service Account cho khách hàng.

### Giữ Nguyên Toàn Bộ Lõi Nghiệp Vụ
- Hệ thống SQLite State Management lưu trạng thái.
- Hàng đợi tin nhắn Zalo Queue hoạt động không bị ảnh hưởng.
- Bộ định thời Scheduler thực thi các tác vụ tổng hợp và gửi báo cáo đúng giờ.
- Đồng bộ dữ liệu real-time lên Google Sheets.
- Nhật ký hoạt động chi tiết (Logging & Audit Logs) và kiểm tra chất lượng tự động (Quality Gate).

---
*Phiên bản trước đó:*
- **v1.0.0:** Phiên bản đầu tiên chạy trên máy chủ VPS, quản lý bởi PM2 và Nginx proxy.

# 📖 VNV-BOT V2: HƯỚNG DẪN SỬ DỤNG NHANH (CHEATSHEET)
> **Hệ Thống Tự Động Hóa Quét Bài Nộp Zalo, Cập Nhật Google Sheets & Xuất Bản Báo Cáo Hàng Ngày**

---

## ⚡ 1. KHỞI ĐỘNG & ĐĂNG NHẬP
1. Nhấp đúp chuột vào file **`VNV-Bot.bat`** (hoặc **`VNV-Bot.exe`**).
2. Cửa sổ lệnh mở ra và trình duyệt web sẽ tự động mở trang đăng nhập tại: `http://localhost:3000/#login`.
3. Nhập tài khoản tương ứng với vai trò của bạn:

| Vai trò | Tên đăng nhập | Mật khẩu | Phạm vi quản lý |
| :--- | :--- | :--- | :--- |
| **Trưởng Vùng 25 → 31** | Tài khoản Trưởng Vùng được cấp | Mật khẩu riêng được bàn giao | Quản lý riêng Vùng & Google Sheet của Vùng |
| **Phó Vùng 25 → 31** | Tài khoản Phó Vùng được cấp | Mật khẩu riêng được bàn giao | Toàn quyền điều hành Vùng & Google Sheet của Vùng |
| **Trưởng Cụm 5** | Tài khoản Trưởng Cụm được cấp | Mật khẩu riêng được bàn giao | Quản lý Cụm 5, giám sát tổng hợp 7 Vùng |

*(Khi không còn sử dụng Bot: Chỉ cần đóng cửa sổ lệnh dòng lệnh đen hoặc nhấn `Ctrl + C`)*

---

## 📱 2. KẾT NỐI ZALO LẦN ĐẦU (Chỉ làm 1 lần duy nhất)
- Trên thanh tiêu đề góc phải màn hình, bấm nút **`[Mở Zalo]`**.
- Trình duyệt Chrome riêng biệt của Zalo sẽ mở ra. Dùng app Zalo trên điện thoại quét mã QR để đăng nhập.
- **Sau khi đăng nhập xong**: Bạn có thể thu nhỏ cửa sổ Zalo xuống thanh taskbar. Phiên Zalo được lưu tự động vĩnh viễn trên máy tính của bạn, từ nay về sau bot sẽ tự dùng lại mà không cần quét lại mã.

---

## 🏆 3. QUY TRÌNH HÀNG NGÀY CHO TRƯỞNG VÙNG (Chưa đầy 1 phút)
*(Khung giờ báo cáo chuẩn: 21h00 - 22h30 hàng ngày)*

- **BƯỚC 1**: Đăng nhập tài khoản Trưởng Vùng -> Truy cập mục **`Không Gian Vùng`**.
- **BƯỚC 2**: Bấm nút màu xanh nổi bật: **`[⚡ Quét Bài & Báo Cáo]`** -> Chọn **"Đồng ý"** trên hộp thoại.
  - 🤖 **Bot sẽ tự động thực hiện tuần tự 4 bước chuẩn**:
    1. Tự mở Zalo Web toàn màn hình và kiểm tra kết nối sẵn sàng.
    2. Gõ `SỨ GIẢ VÙNG [XX]` vào ô tìm kiếm Zalo và nhấp mở chính xác nhóm chat Sứ giả Vùng của bạn.
    3. Nhấp ô tìm kiếm trong nhóm chat (`.search-message-entry`), tìm đúng mốc tin nhắn Báo cáo hôm trước hoặc `KẾ HOẠCH LÀM VIỆC` của ngày cần quét và nhảy thẳng tới đó.
    4. Quét xuôi dòng từ mốc nhiệm vụ, tự đối soát nhân sự, ghi nhận Google Sheet và soạn sẵn Báo Cáo Hàng Ngày (Mẫu 1) vào ô chat nhóm Zalo dưới dạng Bản Nháp.
- **BƯỚC 3**: Chuyển sang cửa sổ chat Zalo, xem lướt qua nội dung báo cáo nháp trong khung chat và bấm nút **`[Gửi]`** (hoặc nhấn `Enter`).
  > 🛡️ **Cam kết an toàn**: Bot tuyệt đối **KHÔNG TỰ Ý BẤM GỬI**, bạn luôn là người cuối cùng kiểm duyệt trước khi phát hành báo cáo.

---

## 🏢 4. QUY TRÌNH HÀNG NGÀY CHO TRƯỞNG CỤM 5
- **BƯỚC 1**: Đăng nhập tài khoản `cum5` -> Truy cập **`Không Gian Cụm`**.
- **BƯỚC 2**: Bấm nút **`[🚀 Tổng Hợp & Bắn Báo Cáo Cụm 5]`** -> Chọn **"Đồng ý"**.
  - Bot tự động tổng hợp số liệu nộp bài của cả 7 Vùng (Vùng 25 → 31).
  - Tự tính toán tỷ lệ hoàn thành, danh sách chưa nộp, danh sách xin hoãn/quân sự.
  - Tự soạn Báo Cáo Cụm (Mẫu 2) có gắn tag **`@Phạm Minh Tú`** ở cuối báo cáo.
  - Tự điền bản nháp vào khung chat nhóm **`CỤM 5`** trên Zalo.
- **BƯỚC 3**: Kiểm tra lại và bấm **`[Gửi]`**.

---

## 🎨 5. TÍNH NĂNG MỞ RỘNG HỮU ÍCH

### Thêm Màu Sắc Trạng Thái Tùy Chỉnh (Lưu riêng theo tài khoản)
- Vào mục **Cài Đặt** -> Tại bảng màu trạng thái Google Sheet, bấm **`[+ Thêm trạng thái màu mới]`**.
- Nhập tên trạng thái (ví dụ: *Nghỉ ốm*, *Xin phép nghỉ lễ*,...) và chọn mã màu sắc bạn thích -> Bấm Lưu.
- Trạng thái màu này sẽ được lưu riêng cho tài khoản của bạn.

---

## 📞 HỖ TRỢ KỸ THUẬT & ĐỒNG BỘ SHEET
- **Cách cập nhật Sứ giả mới từ Google Sheet về Bot (2 cách đều được)**:
  - **Cách 1 (Khuyên dùng)**: Vào menu **Danh Sách Sứ Giả** (`#members`) -> Bấm nút **`[🔄 Đồng bộ từ Google Sheet]`** ở thanh công cụ góc trên.
  - **Cách 2**: Tại **Không Gian Vùng** (`#region-workspace`) -> Bấm nút **`[🔄 Đồng bộ Sheet]`** trên thanh công cụ phía trên.
- **Nếu Zalo báo lỗi chưa mở hoặc chưa đăng nhập**: Bấm nút **`[Mở Zalo]`** trên góc phải để kiểm tra trạng thái đăng nhập.
- Sau khi bấm Đồng bộ, Bot sẽ nạp ngay các sứ giả mới vào hệ thống và tự động loại bỏ các sứ giả bị gạch ngang.

# 🚀 HƯỚNG DẪN DÀNH CHO TRƯỞNG VÙNG MỚI - VNV BOT V2
> *Dành cho Trưởng Vùng / Phó Vùng nhận gói bot chạy trên máy tính cá nhân*

---

## 📦 1. Khởi Động Bot (Chỉ 1 Click)

1. Bạn nhận được thư mục (hoặc file nén `.zip`) `VNV-Bot-v2.0.0`.
   - Nếu là file `.zip`, hãy **Giải nén (Extract all)** ra một thư mục trên máy tính.
2. Nhấp đúp chuột vào file:
   👉 **`VNV-Bot.exe`** (hoặc `VNV-Bot.bat`)
3. **Bot sẽ tự động chuẩn bị tất cả**:
   - Nếu máy bạn chưa có Node.js runtime, Bot sẽ **tự động tải bản portable về máy** trong vài giây mà bạn không cần phải tự cài đặt thủ công gì cả.
   - Trình duyệt web sẽ **tự động mở lên** màn hình đăng nhập tại: `http://localhost:3000`.

---

## 🔑 2. Danh Sách Tài Khoản Đăng Nhập

| Vai trò | Tên đăng nhập | Mật khẩu | Phạm vi quản lý |
| :--- | :--- | :--- | :--- |
| **Trưởng Vùng 25 → 31** | Tài khoản Trưởng Vùng được cấp | Mật khẩu riêng được bàn giao | Quản lý Vùng, quét bài, duyệt báo cáo |
| **Phó Vùng 25 → 31** | Tài khoản Phó Vùng được cấp | Mật khẩu riêng được bàn giao | Toàn quyền điều hành Vùng, quét bài, duyệt báo cáo |

*(Mỗi tài khoản được bảo mật và phân quyền đúng phạm vi quản lý riêng của Vùng mình).*

---

## 📱 3. Kết Nối Zalo & Tự Động Khớp Tên (Chỉ cần làm 1 lần)

1. Sau khi đăng nhập vào Web, nhìn lên góc trên bên phải màn hình, bấm nút: **`[Mở Zalo]`**.
2. Một cửa sổ Google Chrome riêng của Zalo sẽ mở ra.
3. Bạn dùng ứng dụng Zalo trên điện thoại quét mã QR để đăng nhập.
4. **Xong!** Từ các lần sau trở đi, Zalo sẽ tự động duy trì đăng nhập trên máy tính của bạn, không cần phải quét mã lại.
5. **Khớp tên Zalo tự động (Mapping)**:
   - Vào menu **`Không Gian Vùng`** hoặc **`Thành viên Vùng`**.
   - Bấm nút **`[🔍 Quét & Map tên Zalo]`**.
   - Bot sẽ tự mở Zalo, mở danh sách thành viên nhóm chat của Vùng và tự động đối soát tên hiển thị Zalo với tên thật của Sứ giả trên Google Sheet.
   - Khi hoàn tất, cửa sổ Zalo tự đóng và giao diện bot hiển thị thông báo thành công. Bạn không cần phải điền tên Zalo thủ công!

---

## ⚡ 4. Quy Trình Quét Báo Cáo Hàng Ngày (Khung giờ 21h00 - 22h30)

Mỗi tối khi đến giờ báo cáo, bạn chỉ cần làm đúng **3 bước (chưa đầy 1 phút)**:

- **Bước 1**: Vào menu **`Không Gian Vùng`**.
- **Bước 2**: Nhấp vào nút màu xanh lớn: **`[⚡ Quét Bài & Báo Cáo]`** $\rightarrow$ bấm **Đồng ý**.
  - 🤖 **Bot sẽ tự động làm hết mọi việc**:
    1. Tự mở Zalo và tìm đúng nhóm chat `SỨ GIẢ VÙNG [XX]`.
    2. Tự nhảy đến tin nhắn kế hoạch/nhiệm vụ trong ngày và quét xuôi xuống toàn bộ các bài nộp, ảnh minh chứng thật (loại trừ icon Like/thả tim).
    3. Tự động nhận diện bài **nộp bù** (nếu có bài nộp bù ngày cũ, bot tự động điền `Oke` và tô màu cam vào đúng cột ngày cũ trên Google Sheet).
    4. Tự đối soát với danh sách Sứ giả, tự động điền trạng thái `'Oke'` lên Google Sheet.
    5. Tự động soạn sẵn toàn bộ nội dung Báo Cáo Vùng (Mẫu 1) vào ô chat nhóm Zalo dưới dạng **Bản Nháp**.
  - 🛑 **Cơ chế Dừng Quét tức thì**: Trong lúc bot đang quét, nếu bạn cần dừng khẩn cấp (ví dụ muốn đổi ngày quét), nút quét sẽ chuyển sang màu đỏ **`[Dừng quét (Bấm để dừng)]`**. Bạn chỉ cần bấm vào nút này là bot sẽ dừng ngay lập tức mà không treo trình duyệt.
- **Bước 3**: Chuyển sang cửa sổ Zalo, xem lại nội dung bản nháp trong ô chat và bấm **Gửi** (hoặc nhấn `Enter`).
  > 🛡️ **An toàn tuyệt đối**: Bot không tự bấm gửi, bạn luôn là người duyệt cuối cùng trước khi báo cáo được gửi đi.

---

## 🎨 5. Tùy Chỉnh Trạng Thái Google Sheets (Mục Cài Đặt)

Trưởng / Phó Vùng có thể tùy biến cách hiển thị trên Google Sheet theo ý mình tại menu **`Cài đặt`** (`http://localhost:3000/#settings`):

- **Giao diện hợp nhất theo thẻ trạng thái**: Mỗi trạng thái bao gồm Tên hiển thị, Ký hiệu ghi Sheet, và Màu sắc ô.
- **Tùy chỉnh ký hiệu ghi Sheet**: Chữ hiển thị khi hoàn thành (mặc định là `Oke`), khi chưa nộp (để trống), hoặc các trạng thái khác (Quân sự, Ôn thi, Xin nghỉ...).
- **Bảng màu 80 ô chuẩn Google Sheets**: Bấm `[Đổi màu]` trên thẻ để chọn màu nền từ 8 dải màu chuẩn của Google Sheets.
- **Thêm / Xóa trạng thái linh hoạt**: Bấm `[+ Thêm trạng thái mới]` để tạo trạng thái riêng, hoặc bấm `[Xóa]` để gỡ bỏ trạng thái không còn dùng.
- **Nút công tắc Bật / Tắt tô màu ô**: 
  - Nếu **TẮT** (mặc định): Bot chỉ điền chữ (`Oke`) vào ô, giữ nguyên màu nền ban đầu của bảng tính.
  - Nếu **BẬT**: Bot sẽ vừa điền chữ vừa tô màu nền ô theo đúng mã màu bạn đã chọn từ bảng 80 màu.

---

## 📝 6. Cách Ghi Chú Sứ Giả Xin Hoãn / Quân Sự / Nghỉ Phép

Nếu trong Vùng có Sứ giả xin hoãn làm nhiệm vụ:
- Bạn **không cần phải cấu hình phức tạp trong bot**, chỉ cần **ghi chú trực tiếp lên Google Sheet** tại dòng của bạn đó (ở ô ngày xin nghỉ hoặc cột Ghi chú bên phải).
- Cú pháp ghi tự nhiên, ví dụ:
  - `học quân sự xin hoãn đến 23/08/2026`
  - `Bận việc gia đình đến hết tháng 8`
  - `ôn thi đến 25/09`
  - `nhập viện`, `đi viện`, `xin nghỉ`...
- **Bot sẽ tự động**:
  - Đọc ghi chú từ Sheet về và đưa vào mục **6. Lý do -> * Xin làm muộn/bổ sung**.
  - Không xếp bạn đó vào diện "Không phản hồi".
  - Nếu Trưởng Vùng xin hoãn, bot tự động đổi tên người ký báo cáo sang Phó Vùng.

---

## 🛑 7. Cách Tắt Bot

Khi đã báo cáo xong và không dùng bot nữa:
- Bạn chỉ cần **Đóng cửa sổ dòng lệnh đen** (hoặc nhấn tổ hợp phím `Ctrl + C`).
- Bot sẽ tắt sạch hoàn toàn, không chạy ngầm gây tốn RAM máy tính.

# PROOF OF CONCEPT (POC)
# ZALO WEB CONNECTOR FOR VNV-BOT V2

- **Version:** 1.0 (Technical Proof)
- **Status:** Pending Validation
- **Objective:** Verify real-time message collection from Zalo Web without scrolling back or scanning history.

---

## 1. POC OBJECTIVES

Mục đích của tài liệu và mã nguyên mẫu này là giải quyết rủi ro kỹ thuật lớn nhất của dự án VNV-Bot V2: **Thu thập dữ liệu thời gian thực từ Zalo Web một cách tin cậy và không vi phạm chính sách của Zalo.**

Cụ thể, POC này sẽ chứng minh:
1. **Lắng nghe tin nhắn mới thời gian thực:** Bot có thể bắt được các sự kiện tin nhắn mới tức thì ngay khi có người gửi vào nhóm chat.
2. **Trích xuất thông tin chi tiết:** Bot lấy được:
   - **Tên người gửi** (Sender Name).
   - **Nội dung tin nhắn** (Text content).
   - **Trạng thái đính kèm** (Có ảnh hay không).
3. **Tuân thủ nguyên tắc không quét ngược (No History Scanning):** Bot chỉ hoạt động dựa trên sự kiện đẩy đến (push-event), không thực hiện hành động tìm kiếm theo ngày, không quét lịch sử cũ và không scroll ngược trang.
4. **Hiệu năng tải cao (High Concurrency handling):** Chứng minh cơ chế Event Listening vẫn hoạt động mượt mà, không bỏ sót tin nhắn ngay cả khi nhóm chat có hàng chục người nhắn liên tục.

---

## 2. TECHNICAL DESIGN FOR THE PROTOTYPE

Chúng tôi thiết kế một mã chạy thử nghiệm (prototype) tối giản sử dụng **Node.js** và **Puppeteer-Core** kết hợp **DOM MutationObserver** để chứng minh tính khả thi.

### 2.1 Cơ chế hoạt động của Prototype
1. **Khởi chạy trình duyệt thật (Non-headless Mode):**
   Puppeteer khởi chạy trình duyệt Google Chrome hoặc Edge có sẵn trên máy người dùng, hiển thị cửa sổ trực quan để người dùng quét mã QR đăng nhập vào `https://chat.zalo.me`. Session sẽ được lưu lại tại thư mục `./zalo_session` cục bộ để không phải quét lại lần sau.
2. **Đợi người dùng chọn nhóm chat cần giám sát:**
   Để tối giản hóa phần mềm kiểm chứng, sau khi đăng nhập, người dùng click chọn nhóm chat muốn test trên giao diện Zalo Web.
3. **Tiêm (Inject) MutationObserver:**
   Khi Bot phát hiện người dùng đã vào một nhóm chat, Bot sẽ tự động tiêm một script chạy ngầm bên trong trang web. Script này sử dụng `MutationObserver` lắng nghe các nút DOM tin nhắn mới được chèn vào container tin nhắn của Zalo Web (thông thường là thẻ có class chứa các cụm tin nhắn hoặc list tin nhắn chat).
4. **Trích xuất và Ghi log:**
   Mỗi khi có tin nhắn mới, `MutationObserver` bắt sự kiện lập tức, bóc tách tên người gửi, text tin nhắn và xác định xem có thẻ hình ảnh (`<img>` hoặc class ảnh) hay không, sau đó đẩy ngược dữ liệu ra console của Terminal Node.js.

---

## 3. PROTOTYPE SOURCE CODE (`poc_zalo.js`)

Mã nguồn của prototype tối giản được đặt trong file [poc_zalo.js](file:///Users/lynhuanh/Documents/project_ThuanAn/vnv_bot/poc_zalo.js). 

Mã này thực hiện:
- Tìm đường dẫn thực thi của Google Chrome trên Windows / MacOS.
- Khởi chạy trình duyệt và mở Zalo Web.
- Tự động phát hiện vùng chat hiện tại.
- Lắng nghe và in ra màn hình terminal định dạng:
  ```text
  [NEW MESSAGE] Time: 15:58:30 | Sender: Thanh Trà | Image: NO | Text: DONE nhiệm vụ rồi ạ!
  ```

---

## 4. VERIFICATION PLAN

Cách thực hiện kiểm chứng độ tin cậy của POC:
1. **Bước 1:** Chạy script `node poc_zalo.js`.
2. **Bước 2:** Quét mã QR để đăng nhập Zalo của bạn.
3. **Bước 3:** Click vào một group chat bất kỳ dùng để test.
4. **Bước 4:** Nhờ 2-3 người bạn nhắn tin liên tục vào group đó, xen kẽ gửi ảnh và nhắn các từ khóa `DONE`, `OK`.
5. **Bước 5:** Quan sát màn hình console để kiểm chứng tốc độ phản hồi và độ chính xác của Bot.

---
**END OF ZALO_CONNECTOR_POC**

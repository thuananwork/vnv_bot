# QUY TẮC BẤT DI BẤT DỊCH CHO VNV-BOT (AGENTS & WORKSPACE RULES)

## 1. QUY TRÌNH CHUẨN KHI THAO TÁC TRÊN ZALO WEB (BẮT BUỘC 100%)
Khi bot mở Zalo Web hoặc thực hiện bất kỳ thao tác quét bài nào cho Vùng, bot **PHẢI** tuân thủ chính xác 4 bước sau:

- **Bước 1: Khởi động Chrome an toàn & Chờ Zalo sẵn sàng**
  - Tự động dọn dẹp các tiến trình Chrome mồ côi giữ profile `zalo_session/`, xóa sạch các lockfile (`SingletonLock`, `SingletonCookie`, `SingletonSocket`, `LOCK`, `DevToolsActivePort`), chờ 600ms giải phóng handle và có cơ chế tự động thử lại (retry) nếu lần 1 bị kẹt.
  - Mở cửa sổ Chrome ở chế độ toàn màn hình (`maximized`).
  - Kiểm tra định kỳ (tối đa 25 giây) cho đến khi ô tìm kiếm `#contact-search-input` hoặc danh sách hội thoại xuất hiện.
  - Nếu Zalo chưa đăng nhập (xuất hiện mã QR), dừng lại và nhắc người dùng quét mã.

- **Bước 2: Tìm kiếm Group Vùng**
  - Nhấp vào ô tìm kiếm chung của Zalo (`#contact-search-input`).
  - Nhập từ khóa: `SỨ GIẢ VÙNG [XX]` (sử dụng phương thức chèn ký tự trực tiếp vào DOM `document.execCommand('insertText')` kèm sự kiện `input` & `change` để chống bị Unikey/EVKey nuốt ký tự "V").
  - Đợi danh sách `#searchResultList` hiển thị kết quả.

- **Bước 3: Mở khung chat của Vùng**
  - Nhấp vào kết quả `SỨ GIẢ VÙNG [XX]` (hoặc `VÙNG [XX]`) trong `#searchResultList`.
  - Đọc tiêu đề `#chatViewTitle` để xác nhận khung chat của Vùng đã được mở thành công trên màn hình.
  - KHÔNG BAO GIỜ bỏ qua hoặc trả về `true` nếu chưa xác nhận được tiêu đề nhóm.

- **Bước 4: Xác Định Mốc Neo Chuẩn Xác & Quét Xuôi Dòng (Quy luật quét đa ngày & nộp bù)**
  - **Mở ô Tìm kiếm trong cuộc trò chuyện (In-Chat Search):** Nhấp nút `.search-message-entry` hoặc icon kính lúp trên thanh header (dự phòng `Ctrl+F`).
  - **Xác định Mốc bắt đầu quét (Nhất quán cho cả ngày hôm nay và ngày cũ):**
    - **Ưu tiên hàng đầu (từ ngày thứ 2 trở đi, hoặc quét nhiều ngày cũ liên tiếp):** Tìm và nhảy tới tin nhắn **Báo cáo tổng hợp của ngày hôm trước** (`prevDate = workDate - 1`). Giúp quét trọn vẹn từ sau báo cáo hôm trước đến cuối ngày / nhiệm vụ ngày hôm sau, thu thập toàn bộ các bài nộp sớm, nộp trong ngày và nộp bù.
    - **Fallback dự phòng (ngày đầu chạy bot, hoặc lâu ngày mới chạy lại):** Tìm và nhảy tới tin nhắn **Nhiệm vụ của chính ngày cần quét** (`KẾ HOẠCH LÀM VIỆC ngày DD/MM`).
  - **TUYỆT ĐỐI KHÔNG CUỘN NGƯỢC LÊN (No Blind Scroll Up):** Cấm hoàn toàn hành vi cuộn ngược mù lên trên (`scrollTop = 0`).
  - **CHỈ CUỘN XUỐNG DƯỚI (Downward Scanning):** Từ mốc bắt đầu vừa định vị, bot chỉ cuộn XUỐNG để thu thập bài nộp:
    - **Nếu quét ngày HÔM NAY (ngày mới nhất):** Cuộn xuôi dòng cho đến **CUỐI NGÀY** (tin nhắn mới nhất của nhóm chat).
    - **Nếu quét NGÀY CŨ (ví dụ chạy trễ ngày 14, 15, 16, 17):** Cuộn xuôi dòng cho đến khi gặp **NHIỆM VỤ ĐẦU NGÀY CỦA NGÀY SAU ĐÓ 1 NGÀY** (`nextDate = workDate + 1`). (Tuyệt đối không dừng ở Báo cáo ngày của chính ngày đang quét để thu thập trọn vẹn bài nộp bù đêm hoặc sáng hôm sau). Nếu ngày tiếp theo chưa có nhiệm vụ thì cuộn đến tin nhắn mới nhất.
  - **Cơ chế Dừng Quét Tức Thì (Cancel on 2nd Click):** Nút quét chuyển thành nút màu đỏ `Dừng quét (Bấm để dừng)`, nếu người dùng nhấp lần 2 sẽ gửi lệnh `POST /api/v2/regions/:id/stop-scan` để dừng bot ngay lập tức mà không treo trình duyệt.
  - **Nhận diện bài nộp chính xác (Anti-False-Positive & Makeup Detection):**
    - **Ghi nhận thành công = TIN NHẮN văn bản:** Chỉ tính là nộp bài hoàn thành khi có tin nhắn văn bản xác nhận (chứa các từ khóa: `gửi nhiệm vụ`, `gửi nv`, `nộp nv`, `nộp nhiệm vụ`, `hoàn thành`, `done`, `xong`, `đã làm`, `báo cáo nv`, `báo cáo nvu`...). **TUYỆT ĐỐI KHÔNG dùng ảnh để tự động tính hoàn thành** (loại bỏ hoàn toàn false-positive từ ảnh/sticker).
    - Phân biệt rõ tin nhắn nhắc nhở/thông báo (`nhá các bạn`, `nhé cả nhà`, `nhắc nhở`...) của Trưởng vùng/thành viên với bài nộp thực tế (cần chứa các từ khóa: `gửi nhiệm vụ`, `gửi nv`, `nộp nv`, `nộp nhiệm vụ`, `hoàn thành`, `done`, `xong`, `đã làm`...).
    - **Nhận diện bài nộp bù / gửi bù chuẩn xác 100%:** Hỗ trợ đầy đủ các từ khóa nộp bù (`gửi bù`, `nộp bù`, `làm bù`, `bù nhiệm vụ`, `bù nv`, `bù bài`, `bù ngày`, `trả nv`, `trả bài`...).
      - Nếu bài nộp bù chỉ rõ ngày khớp với ngày đang quét (ví dụ: Mai Thủy "Em gửi bù nhiệm vụ ngày 16/9 ạ" khi đang quét ngày 16/9), bot tự động tính là Hoàn thành cho ngày đó.
      - **Nộp bù xuyên ngày:** Nếu đang quét ngày mới (ví dụ ngày 17) mà có tin nhắn nộp bù ngày cũ (ví dụ: "Em gửi bù nhiệm vụ ngày 14/9 ạ"), bot ghi nhận vào mục 7 (*Bổ sung*) của Báo cáo ngày 17, đồng thời **tự động cập nhật Hoàn thành (`Oke`) và tô màu chuẩn vào cột ngày cũ (ngày 14) trên Google Sheets** và SQLite.
    - Tự động đọc và kiểm tra hiệu lực ghi chú xin hoãn từ Google Sheet (`isLeaveNoteValidForDate`): Nếu xin hoãn ngắn hạn đã quá hạn so với ngày quét thì không tính là xin hoãn, đảm bảo số lượng hoàn thành và người ký báo cáo (Trưởng/Phó Vùng) chính xác 100%.
  - Đối soát với bảng thành viên (`members`), tự động cập nhật bảng điểm danh lên Google Sheet (`T9/26!S6:S33`).
  - Tạo Báo cáo Vùng chuẩn và tự động soạn bản nháp vào khung chat Zalo để Trưởng/Phó Vùng kiểm duyệt trước khi bấm gửi.

---

## 2. NGUYÊN TẮC KIẾN TRÚC & HỆ THỐNG
- **100% Không dùng Zalo OA:** Tuyệt đối không thêm lại Zalo OA, access token, refresh token hay zaloRefreshToken.job.js.
- **Đồng bộ Thư mục Phát hành:** Bất kỳ thay đổi nào trong `src/` hoặc `docs/` đều phải được đồng bộ sang `dist/VNV-Bot-v2.0.0/`.


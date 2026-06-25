# Thiết kế Submission Engine - VNV-Bot V2

Tài liệu này mô tả chi tiết cơ chế chấm điểm và phê duyệt tự động/thủ công của bộ công cụ Submission Engine trong VNV-Bot V2 cho cả 4 loại nhiệm vụ cốt lõi.

---

## 1. Phân loại và Quy trình Chấm điểm Nhiệm vụ

Quy trình chấm điểm phụ thuộc hoàn toàn vào cấu hình của từng nhiệm vụ (`submission_type` trong cơ sở dữ liệu):

```
                       [ Tin nhắn nộp bài ]
                                │
         ┌──────────────────────┼──────────────────────┐
         ▼                      ▼                      ▼
    [ Nhiệm vụ Ảnh ]    [ Nhiệm vụ Từ khóa ]    [ Nhiệm vụ Link ]
         │                      │                      │
         ├──────────────────────┤                      ▼
         ▼                      ▼             [ Regex URL Check ]
    [ Chấp nhận ]          [ Khớp từ khóa ]            │
         │                      │                      ▼
         ▼                      ▼              [ Chờ phê duyệt ]
     (APPROVED)             (APPROVED)          (PENDING REVIEW)
                                                       │
                                                       ▼
                                              [ Trưởng Vùng Duyệt ]
                                                       │
                                              ┌────────┴────────┐
                                              ▼                 ▼
                                          (APPROVED)        (REJECTED)
```

### A. Nhiệm vụ Ảnh (Image Task)
* **Kịch bản:** Sứ giả chụp ảnh màn hình kết quả hoàn thành (ví dụ: chụp màn hình đã tương tác, chia sẻ tin bài) rồi gửi vào nhóm Zalo của Vùng.
* **Cơ chế nhận diện:**
  * Webhook nhận diện loại tin nhắn `msg_type === 'image'`.
  * Không sử dụng công nghệ OCR (đọc chữ trên ảnh) hay AI để tránh tải nặng hệ thống và lỗi sai số.
* **Cách chấm điểm:**
  * **Tự động Phê duyệt (Auto-Approved):** Hệ thống gán trạng thái `approved` ngay lập tức.
  * Sứ giả được tính là `DONE` trong ngày đối với nhiệm vụ này.

### B. Nhiệm vụ Từ khóa (Keyword Task)
* **Kịch bản:** Sứ giả gửi tin nhắn văn bản báo cáo đã hoàn thành nhiệm vụ theo quy ước.
* **Cơ chế nhận diện:**
  * Sử dụng biểu thức chính quy (Regex) không phân biệt hoa thường để kiểm tra sự tồn tại của các cụm từ sau trong nội dung tin nhắn:
    * `\b(done)\b`
    * `\b(ok)\b`
    * `\b(xong)\b`
    * `\b(đã làm)\b`
* **Cách chấm điểm:**
  * **Tự động Phê duyệt (Auto-Approved):** Nếu khớp từ khóa, gán trạng thái `approved`.
  * Nếu không khớp từ khóa: Bỏ qua tin nhắn (coi như là tin nhắn thảo luận thông thường trong nhóm).

### C. Nhiệm vụ Link (Link Task)
* **Kịch bản:** Sứ giả gửi đường dẫn liên kết chứng minh đã thực hiện (ví dụ: link bài viết Facebook đã chia sẻ, link video Tiktok).
* **Cơ chế nhận diện:**
  * Sử dụng Regex kiểm tra định dạng URL hợp lệ:
    * `/^https?:\/\/[^\s/$.?#].[^\s]*$/i`
* **Cách chấm điểm:**
  * **Chờ phê duyệt (Pending Review):** Do nội dung link cần kiểm tra thực tế (tránh trường hợp sứ giả gửi link rác hoặc link không đúng nội dung yêu cầu), trạng thái ban đầu sẽ được gán là `pending_review`.
  * **Duyệt thủ công:** Trưởng Vùng xem danh sách chờ duyệt trên Dashboard, kiểm tra tính đúng đắn của liên kết và nhấn nút **Phê duyệt (Approve)** hoặc **Từ chối (Reject)**.

### D. Nhiệm vụ Thủ công (Manual Task)
* **Kịch bản:** Nhiệm vụ phức tạp không thể nhận diện tự động hoặc sứ giả gặp sự cố không thể tự tương tác báo cáo trên Zalo.
* **Cơ chế ghi nhận:**
  * Hệ thống khởi tạo trạng thái mặc định của mọi Sứ giả đối với nhiệm vụ này là `pending_review` (chưa hoàn thành nhưng trong trạng thái chờ cập nhật).
* **Cách chấm điểm:**
  * **Cập nhật thủ công:** Trưởng Vùng trao đổi trực tiếp hoặc đối soát bằng cách khác, sau đó truy cập Dashboard quản trị để tích chọn hoàn thành thủ công cho Sứ giả. Hệ thống sẽ ghi đè trạng thái thành `approved` kèm theo ghi chú thích hợp (ví dụ: "Đã xác nhận qua điện thoại").

---

## 2. Lưu trữ Trạng thái trong SQLite

Bảng `submissions` lưu trữ kết quả kiểm tra với cấu trúc cột như sau:

* `submission_type`: Loại nhiệm vụ (`image`, `keyword`, `manual`, `link`).
* `status`: Trạng thái duyệt (`pending_review`, `approved`, `rejected`).
* `notes`: Ghi chú lý do từ chối hoặc các lý do đặc biệt do Trưởng Vùng điền trực tiếp.
* `processed_at`: Lưu mốc thời gian hệ thống tự động chấm điểm hoặc mốc thời gian Trưởng Vùng nhấn duyệt trên giao diện Web Dashboard.

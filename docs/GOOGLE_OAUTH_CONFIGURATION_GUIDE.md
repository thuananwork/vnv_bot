# HƯỚNG DẪN CẤU HÌNH GOOGLE OAUTH HYBRID AUTHENTICATION — VNV-BOT V2

Tài liệu này hướng dẫn chi tiết cách cấu hình Google OAuth 2.0 cho ứng dụng VNV-Bot V2 trên mô hình triển khai chính thức **Local Standalone Windows**.

---

## 1. Tạo OAuth Client ID Trên Google Cloud Console

1. Truy cập [Google Cloud Console](https://console.cloud.google.com/).
2. Chọn dự án (Project) của bạn hoặc tạo một dự án mới.
3. Điều hướng đến **APIs & Services > Credentials**.
4. Nhấn **Create Credentials** và chọn **OAuth client ID**.
5. Chọn loại ứng dụng (**Application type**): `Web application`.
6. Điền thông tin chính xác cho mô hình Local Standalone Windows:
   - **Name**: `VNV-Bot V2 Local`
   - **Authorized redirect URIs** (BẮT BUỘC KHỚP 100%):
     ```text
     http://localhost:3000/api/auth/google/callback
     ```
   - *Lưu ý về Authorized JavaScript origins*: Vì VNV-Bot V2 xử lý luồng Google OAuth hoàn toàn ở phía Server (Authorization Code Grant + PKCE qua endpoint backend `/api/auth/google`), ứng dụng **KHÔNG** yêu cầu đăng ký Authorized JavaScript origins. Mục này có thể để trống.
7. Nhấn **Create** để lấy `Client ID` và `Client Secret`.

---

## 2. Cấu Hình Biến Môi Trường Canonical (`.env`)

VNV-Bot V2 sử dụng bộ tên biến môi trường chuẩn **Canonical**. Thêm các biến sau vào tệp `config/.env`:

```env
# ==========================================
# GOOGLE OAUTH CONFIGURATION (CANONICAL)
# ==========================================
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret
GOOGLE_OAUTH_REDIRECT_URI=http://localhost:3000/api/auth/google/callback

# Domain email được phép đăng nhập (phân cách bằng dấu phẩy)
ALLOWED_EMAIL_DOMAINS=vnv.vn,gmail.com

# Key mã hóa Session (Dài tối thiểu 32 ký tự, hỗ trợ rotate phân cách bằng dấu phẩy)
SESSION_SECRET=super_secret_session_key_minimum_32_characters_long

# Cấu hình Cookie cho môi trường Local Standalone (Bắt buộc false cho localhost HTTP)
COOKIE_SECURE=false
```

---

## 3. Cấu Hình Biến Session Secret & Secret Rotation (`SESSION_SECRET`)

### 3.1 Quy Tắc Cấu Hình
- **Tên biến môi trường**: `SESSION_SECRET` (Sử dụng duy nhất biến này cho cả active secret và rotation list).
- **Độ dài tối thiểu**: Phần tử secret chính (đầu tiên) bắt buộc phải có độ dài từ **32 ký tự trở lên**.
- **Cơ chế Secret Rotation**: Khi cần đổi secret mà không muốn ngắt phiên đăng nhập của người dùng active, cung cấp danh sách secret phân cách bằng dấu phẩy `,`:
  ```env
  SESSION_SECRET=new_secret_minimum_32_characters_long,old_secret_minimum_32_characters_long
  ```
  Express-session sẽ sử dụng secret đầu tiên để tạo chữ ký cho cookie phiên mới, đồng thời dùng các secret phía sau để kiểm tra tính hợp lệ của cookie phiên cũ.

### 3.2 Lệnh Tạo Secret An Toàn
Bạn có thể tạo chuỗi cryptographically secure secret ngẫu nhiên bằng lệnh Node.js trên Windows PowerShell / CMD:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Sao chép chuỗi kết quả và dán vào tệp `config/.env` tại biến `SESSION_SECRET`.

---

## 4. Quy Tắc Nghiêm Cấm Sử Dụng Legacy Environment Variables

⚠️ **CẢNH BÁO NGUY HIỂM**:
Không được sử dụng các tên biến cũ (Legacy) dưới đây trong tệp `.env`:
- ❌ `GOOGLE_CLIENT_ID`
- ❌ `GOOGLE_CLIENT_SECRET`
- ❌ `GOOGLE_REDIRECT_URI`

Nếu ứng dụng phát hiện bất kỳ biến legacy nào tồn tại trong môi trường, hệ thống sẽ **Fail-Fast** và lập tức dừng tiến trình khởi động để tránh nhầm lẫn cấu hình.

---

## 5. Cấu Hình Domain Whitelist (`ALLOWED_EMAIL_DOMAINS`)

Biến `ALLOWED_EMAIL_DOMAINS` kiểm soát danh sách tên miền email được phép đăng nhập vào hệ thống:
- Cú pháp: Danh sách các domain phân cách bởi dấu phẩy `,`.
- Ví dụ: `ALLOWED_EMAIL_DOMAINS=vnv.vn,gmail.com`
- Tự động chuẩn hóa: Chuẩn hóa Unicode NFC, khoảng trắng và chữ hoa/thường; đồng thời áp dụng quy tắc canonical riêng cho địa chỉ Gmail (loại bỏ biến thể dot/plus-tag và quy đổi `googlemail.com` thành `gmail.com`).

---

## 6. Hướng Dẫn Chạy Local Trực Tiếp Trên Windows (Primary Deployment Mode)

1. Mở PowerShell hoặc Command Prompt tại thư mục dự án `d:\Project\vnv_bot`.
2. Kiểm tra tệp `config/.env` đã có đầy đủ các biến môi trường canonical ở Mục 2.
3. Đảm bảo cổng HTTP (mặc định 3000) không bị chiếm dụng.
4. Khởi động ứng dụng trên Windows:
   ```powershell
   npm run dev
   ```
   hoặc:
   ```powershell
   node src/index.js
   ```
5. Mở trình duyệt và truy cập `http://localhost:3000` để sử dụng ứng dụng.

---

## 7. Các Lỗi Cấu Hình Phổ Biến & Cách Chẩn Đoán (Troubleshooting)

| Dấu hiệu / Lỗi | Nguyên nhân phổ biến | Cách xử lý |
|---|---|---|
| **Server dừng ngay khi khởi động (`FATAL: Thiếu các biến cấu hình bắt buộc`)** | Thiếu biến canonical `GOOGLE_OAUTH_*` hoặc đang dùng tên biến legacy `GOOGLE_CLIENT_*`. | Kiểm tra lại tệp `config/.env`, đổi tên key thành `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_OAUTH_REDIRECT_URI`. |
| **Lỗi `redirect_uri_mismatch` từ Google** | `GOOGLE_OAUTH_REDIRECT_URI` trong `.env` không khớp 100% với Redirect URI khai báo trên Google Cloud Console. | Kiểm tra từng ký tự, port, và đường dẫn `http://localhost:3000/api/auth/google/callback`. |
| **Lỗi 403 `Email domain is not allowed`** | Domain email Google đăng nhập không nằm trong danh sách `ALLOWED_EMAIL_DOMAINS`. | Bổ sung domain của email đó vào biến `ALLOWED_EMAIL_DOMAINS` trong `config/.env`. |
| **Lỗi `Phần tử đầu tiên của SESSION_SECRET phải dài tối thiểu 32 ký tự`** | Phần tử đầu tiên trong `SESSION_SECRET` ngắn hơn 32 ký tự. | Tạo secret mới dài từ 32 ký tự trở lên theo hướng dẫn ở Mục 3.2. |

---

## 8. Optional Server Deployment — Not Part of the Current Approved Release

Mô hình triển khai Server bên ngoài (VPS, Cloud Hosting, HTTPS, PM2) **KHÔNG** thuộc phạm vi phát hành được duyệt hiện tại:
- Yêu cầu cấu hình thêm domain HTTPS, reverse proxy (Nginx/Cloudflare), `COOKIE_SECURE=true`, và PM2 process manager.
- **Mọi hình thức triển khai Server bên ngoài bắt buộc phải có sự phê duyệt riêng bằng văn bản từ Product Owner.**

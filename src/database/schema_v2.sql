-- ============================================================================
-- VNV-BOT V2: COMPLETE DATABASE SCHEMA DEFINITION
-- ============================================================================

PRAGMA foreign_keys = ON;

-- 1. Bảng lưu trữ cấu hình hệ thống
CREATE TABLE IF NOT EXISTS local_config (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Bảng quản trị người dùng (users)
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    zalo_id TEXT UNIQUE,
    role TEXT NOT NULL CHECK(role IN ('admin', 'cluster_leader', 'region_leader')),
    is_active INTEGER NOT NULL DEFAULT 1,
    last_login TIMESTAMP,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    email TEXT UNIQUE CHECK(email IS NULL OR email = lower(email)),
    google_id TEXT UNIQUE,
    avatar_url TEXT CHECK(avatar_url IS NULL OR length(avatar_url) <= 2048),

    auth_method TEXT NOT NULL CHECK(auth_method IN ('local', 'google')),
    approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('approved', 'disabled')),

    approved_by INTEGER,
    approved_at TIMESTAMP,
    first_login_at TIMESTAMP,
    last_google_sync TIMESTAMP,

    session_version INTEGER NOT NULL DEFAULT 1,
    name_source TEXT NOT NULL DEFAULT 'google' CHECK(name_source IN ('google', 'manual')),
    login_count INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- 3. Bảng quản lý Cụm (clusters)
CREATE TABLE IF NOT EXISTS clusters (
    id INTEGER PRIMARY KEY,
    cluster_name TEXT UNIQUE NOT NULL,
    leader_name TEXT NOT NULL DEFAULT 'Nguyễn Thuận An',
    manager_id INTEGER,
    sheet_id TEXT,
    sheet_name TEXT DEFAULT 'T9/26',
    sheet_url TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Bảng quản lý 7 Vùng (regions) với cấu hình khung giờ riêng từng vùng
CREATE TABLE IF NOT EXISTS regions (
    id INTEGER PRIMARY KEY,                 -- 25, 26, 27, 28, 29, 30, 31
    region_name TEXT UNIQUE NOT NULL,       -- "Vùng 27"
    cluster_id INTEGER NOT NULL DEFAULT 5,
    manager_id INTEGER,
    zalo_group_id TEXT UNIQUE NOT NULL,     -- Zalo Group ID / Group Name
    zalo_group_name TEXT NOT NULL,          -- "Vùng 27"
    leader_name TEXT NOT NULL DEFAULT 'Trưởng Vùng', -- "Phạm Quang Đại"
    deputy_name TEXT,                       -- "Nguyễn Thị Thanh Trà"
    sheet_id TEXT,                          -- Google Spreadsheet ID
    sheet_name TEXT DEFAULT 'T9/26',        -- Tên trang tính / Tab (mặc định tab tháng hiện tại)
    sheet_url TEXT,
    task_start_time TEXT DEFAULT '10:00',   -- Giờ bắt đầu ca lấy nhiệm vụ
    task_end_time TEXT DEFAULT '15:00',     -- Giờ kết thúc ca lấy nhiệm vụ
    report_start_time TEXT DEFAULT '21:00', -- Giờ bắt đầu ca quét báo cáo
    report_end_time TEXT DEFAULT '22:30',   -- Giờ kết thúc ca quét báo cáo
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE
);

-- 5. Bảng Danh bạ Thành viên Master Registry (members)
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region_id INTEGER NOT NULL,
    sheet_row_index INTEGER NOT NULL,       -- Vị trí hàng trên Google Sheet (R4, R5, R8..R24+)
    real_name TEXT NOT NULL,                -- Họ tên chuẩn trên Google Sheet
    role TEXT NOT NULL DEFAULT 'EMISSARY' CHECK(role IN ('LEADER', 'DEPUTY', 'EMISSARY')),
    join_date TEXT,                         -- Ngày trở thành sứ giả (cột B trên sheet)
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    sheet_note TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
);

-- 6. Bảng Ánh xạ Định danh (identity_mappings)
CREATE TABLE IF NOT EXISTS identity_mappings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id INTEGER NOT NULL,
    zalo_user_id TEXT,                      -- ID cố định của tài khoản Zalo nếu có
    zalo_display_name TEXT NOT NULL,        -- Nickname hiển thị ("Thanh Trà ❤️")
    normalized_alias TEXT NOT NULL,         -- Tên thường không dấu ("thanh tra")
    confidence_score REAL DEFAULT 1.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    UNIQUE(member_id, zalo_user_id)
);

-- 7. Bảng Sự kiện Tin nhắn thô (raw_events)
CREATE TABLE IF NOT EXISTS raw_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zalo_msg_id TEXT UNIQUE NOT NULL,
    zalo_group_id TEXT NOT NULL,
    sender_zalo_id TEXT NOT NULL,
    sender_zalo_name TEXT,
    msg_type TEXT NOT NULL CHECK(msg_type IN ('text', 'image', 'photo', 'link', 'attachment')),
    content_text TEXT,
    timestamp_ms INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 8. Bảng Nhiệm vụ ngày (tasks)
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_code TEXT UNIQUE NOT NULL,         -- 'TSK-C5-20260616-01'
    title TEXT,
    description TEXT NOT NULL,
    publish_date TEXT NOT NULL,             -- 'YYYY-MM-DD'
    source_group TEXT,                      -- 'CỤM 5' hoặc 'TỔNG BĐH KÊNH SỨ GIẢ - VNV'
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 9. Bảng Ghi nhận kết quả nộp bài (submissions)
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    member_id INTEGER NOT NULL,
    region_id INTEGER NOT NULL,
    work_date TEXT NOT NULL,                -- 'YYYY-MM-DD'
    status TEXT NOT NULL CHECK(status IN ('OK', 'NO_RESPONSE', 'LATE_REQUEST', 'SUPPLEMENT', 'OFF')),
    evidence_event_id INTEGER,
    raw_content TEXT,
    notes TEXT,                             -- Lý do: "Học quân sự nên hoãn đến 10/08/2026"
    supplement_dates_json TEXT,             -- Danh sách ngày nộp bù: '["2026-05-28", "2026-05-30"]'
    sheet_synced INTEGER DEFAULT 0,         -- 0: Chưa ghi sheet, 1: Đã ghi sheet
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
    FOREIGN KEY (evidence_event_id) REFERENCES raw_events(id) ON DELETE SET NULL,
    UNIQUE(work_date, member_id)
);

-- 10. Bảng Quản lý Báo cáo đã xuất bản (reports)
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER NOT NULL,
    report_type TEXT NOT NULL CHECK(report_type IN ('region', 'cluster')),
    cluster_id INTEGER,
    region_id INTEGER,
    work_date TEXT NOT NULL,
    total_members INTEGER NOT NULL,
    total_completed INTEGER NOT NULL,
    total_incomplete INTEGER NOT NULL,
    content TEXT NOT NULL,                  -- Nội dung văn bản chuẩn (Mẫu 1 hoặc Mẫu 2)
    sent_to_group_id TEXT,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE CASCADE,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE,
    CHECK ((report_type = 'region' AND region_id IS NOT NULL AND cluster_id IS NULL) OR (report_type = 'cluster' AND cluster_id IS NOT NULL AND region_id IS NULL))
);

-- 11. Bảng Quản lý Trạng thái Ngày (daily_operations FSM)
CREATE TABLE IF NOT EXISTS daily_operations (
    work_date TEXT PRIMARY KEY,             -- 'YYYY-MM-DD'
    state TEXT NOT NULL DEFAULT 'IDLE' CHECK(state IN ('IDLE', 'TASK_FORWARDED', 'EVALUATED', 'SHEET_SYNCED', 'REPORTS_DISPATCHED')),
    task_forwarded INTEGER DEFAULT 0,
    task_source_group TEXT,
    task_content TEXT,
    cluster_report_status TEXT DEFAULT 'PENDING',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 12. Bảng Hàng đợi Tin nhắn Zalo (zalo_message_queue)
CREATE TABLE IF NOT EXISTS zalo_message_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL DEFAULT 'puppeteer',
    group_id TEXT,
    message_text TEXT,
    raw_payload TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'processing', 'completed', 'failed')),
    attempts INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    request_id TEXT,
    parent_request_id TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    updated_at TIMESTAMP
);

-- 13. Bảng Nhật ký Kiểm toán (audit_logs)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 14. Bảng Phiên bản Di trú Database (schema_migrations)
CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 15. Bảng Màu sắc Trạng thái Tùy chỉnh theo Tài khoản (user_custom_statuses)
CREATE TABLE IF NOT EXISTS user_custom_statuses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    status_name TEXT NOT NULL,
    color_hex TEXT NOT NULL,
    text_value TEXT,
    behavior_type TEXT NOT NULL DEFAULT 'CUSTOM',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- 16. Bảng Mẫu Format Nhiệm vụ & Báo cáo Zalo (task_templates)
CREATE TABLE IF NOT EXISTS task_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region_id INTEGER,
    template_type TEXT NOT NULL,
    keyword TEXT NOT NULL,
    sample_content TEXT,
    date_pattern TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE CASCADE
);

-- Chỉ mục
CREATE INDEX IF NOT EXISTS idx_members_region ON members(region_id);
CREATE INDEX IF NOT EXISTS idx_identity_alias ON identity_mappings(normalized_alias);
CREATE INDEX IF NOT EXISTS idx_submissions_date_member ON submissions(work_date, member_id);
CREATE INDEX IF NOT EXISTS idx_submissions_region_date ON submissions(region_id, work_date);
CREATE INDEX IF NOT EXISTS idx_reports_work_date ON reports(work_date);
CREATE INDEX IF NOT EXISTS idx_user_custom_statuses_uid ON user_custom_statuses(user_id);
CREATE INDEX IF NOT EXISTS idx_task_templates_type ON task_templates(template_type, is_active);


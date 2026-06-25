-- Kích hoạt kiểm tra khóa ngoại trong SQLite
PRAGMA foreign_keys = ON;

-- 1. Bảng lưu trữ cấu hình cục bộ của Agent
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
    is_active INTEGER DEFAULT 1,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Bảng quản lý Cụm (clusters)
CREATE TABLE IF NOT EXISTS clusters (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    cluster_name TEXT UNIQUE NOT NULL,
    manager_id INTEGER UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 4. Bảng quản lý Vùng (regions)
CREATE TABLE IF NOT EXISTS regions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    region_name TEXT UNIQUE NOT NULL,
    cluster_id INTEGER,
    manager_id INTEGER UNIQUE,
    zalo_group_id TEXT UNIQUE NOT NULL,
    zalo_group_name TEXT NOT NULL,
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'inactive')),
    sheet_id TEXT UNIQUE,
    sheet_url TEXT,
    sheet_name TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE SET NULL,
    FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
);

-- 5. Bảng Mapping danh sách Sứ giả (members)
CREATE TABLE IF NOT EXISTS members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    real_name TEXT NOT NULL,
    zalo_name TEXT NOT NULL,
    zalo_id TEXT UNIQUE,
    region_id INTEGER,
    role TEXT DEFAULT 'Sứ giả',
    status TEXT DEFAULT 'Active' CHECK(status IN ('Active', 'Inactive')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE SET NULL
);

-- 6. Bảng lưu trữ nhiệm vụ ngày (tasks)
CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_code TEXT UNIQUE NOT NULL,
    zalo_source_msg_id TEXT UNIQUE,
    title TEXT,
    description TEXT NOT NULL,
    publish_date TEXT NOT NULL, -- Định dạng YYYY-MM-DD
    status TEXT DEFAULT 'active' CHECK(status IN ('active', 'closed')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 7. Bảng ghi nhận kết quả nộp bài của Sứ giả (submissions)
CREATE TABLE IF NOT EXISTS submissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    member_id INTEGER,
    zalo_msg_id TEXT UNIQUE NOT NULL,
    submission_type TEXT CHECK(submission_type IN ('image', 'keyword', 'manual')),
    raw_content TEXT,
    status TEXT DEFAULT 'pending_review' CHECK(status IN ('pending_review', 'approved', 'rejected')),
    notes TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    processed_at TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE SET NULL
);

-- 8. Bảng lưu trữ lịch sử báo cáo đã kết xuất (reports)
CREATE TABLE IF NOT EXISTS reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    task_id INTEGER,
    report_type TEXT NOT NULL CHECK(report_type IN ('region', 'cluster')),
    cluster_id INTEGER,
    region_id INTEGER,
    total_members INTEGER,
    total_completed INTEGER,
    total_failed INTEGER,
    content TEXT NOT NULL,
    sent_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE,
    FOREIGN KEY (cluster_id) REFERENCES clusters(id) ON DELETE SET NULL,
    FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE SET NULL,
    CHECK ((report_type = 'region' AND region_id IS NOT NULL AND cluster_id IS NULL) OR (report_type = 'cluster' AND cluster_id IS NOT NULL AND region_id IS NULL))
);

-- 9. Bảng lưu nhật ký audit log của Admin (audit_logs)
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    details TEXT NOT NULL,
    ip_address TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Chỉ mục tối ưu hóa hiệu năng truy vấn
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_regions_cluster_id ON regions(cluster_id);
CREATE INDEX IF NOT EXISTS idx_members_region_id ON members(region_id);
CREATE INDEX IF NOT EXISTS idx_submissions_task_id ON submissions(task_id);
CREATE INDEX IF NOT EXISTS idx_submissions_member_id ON submissions(member_id);
CREATE INDEX IF NOT EXISTS idx_reports_task_id ON reports(task_id);

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = process.env.DB_PATH || path.join(dbDir, 'vnv_bot.db');
const db = new sqlite3.Database(dbPath);

// Kích hoạt ràng buộc khóa ngoại và tối ưu hóa WAL
db.run('PRAGMA foreign_keys = ON;');
db.run('PRAGMA journal_mode = WAL;');
db.run('PRAGMA synchronous = NORMAL;');
db.configure('busyTimeout', 5000);
db.run('PRAGMA optimize;');

// Khai báo các helper trả về Promise để xử lý async/await thuận tiện
function run(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve({ id: this.lastID, changes: this.changes });
        });
    });
}

function get(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

function all(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });
}

// Hàm seed các cấu hình mặc định cho Scheduler và Vùng/Cụm sản xuất (chỉ chạy ngoài test)
async function seedDefaultData() {
    const seedPath = fs.existsSync(path.join(__dirname, '../database/seed_v2.sql')) 
        ? path.join(__dirname, '../database/seed_v2.sql') 
        : path.join(__dirname, '../database/seed.sql');
    if (fs.existsSync(seedPath)) {
        const seedSql = fs.readFileSync(seedPath, 'utf8');
        await new Promise((resolve, reject) => {
            db.exec(seedSql, (err) => {
                if (err) {
                    console.error('Lỗi khi nạp file seed:', err);
                    reject(err);
                } else {
                    console.log(`Đã nạp thành công dữ liệu seed mặc định (${path.basename(seedPath)}).`);
                    resolve();
                }
            });
        });

        // Nạp toàn bộ danh bạ và ánh xạ 7 vùng
        try {
            const { seedAllRegions } = require('../database/seed_all_regions_mappings');
            await seedAllRegions();
        } catch (seedErr) {
            console.warn('Lưu ý: Không thể chạy seedAllRegions:', seedErr.message);
        }
    }
}

const { getMigrationChecksum } = require('../utils/migration_manifest');

async function seedMigrationRecord() {
    try {
        const currentChecksum = getMigrationChecksum();
        const existing = await get("SELECT version, checksum FROM schema_migrations WHERE version = '2026_07_oauth_v21'");

        if (existing) {
            return;
        }

        await run(
            "INSERT OR IGNORE INTO schema_migrations (version, checksum) VALUES ('2026_07_oauth_v21', ?)",
            [currentChecksum]
        );
    } catch (e) {}
}

async function runSchemaMigrations() {
    try {
        await run("ALTER TABLE clusters ADD COLUMN sheet_id TEXT");
    } catch (e) {}
    try {
        await run("ALTER TABLE clusters ADD COLUMN sheet_name TEXT DEFAULT 'T9/26'");
    } catch (e) {}
    try {
        await run("ALTER TABLE clusters ADD COLUMN sheet_url TEXT");
    } catch (e) {}
    try {
        await run("ALTER TABLE members ADD COLUMN sheet_note TEXT");
    } catch (e) {}
    try {
        await run(`
            CREATE TABLE IF NOT EXISTS user_custom_statuses (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                status_name TEXT NOT NULL,
                color_hex TEXT NOT NULL,
                text_value TEXT,
                behavior_type TEXT NOT NULL DEFAULT 'CUSTOM',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_user_custom_statuses_uid ON user_custom_statuses(user_id)");
        try {
            await run("ALTER TABLE user_custom_statuses ADD COLUMN behavior_type TEXT NOT NULL DEFAULT 'CUSTOM'");
        } catch (colErr) {}
    } catch (e) {}
    try {
        await run(`
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
            )
        `);
        await run("CREATE INDEX IF NOT EXISTS idx_task_templates_type ON task_templates(template_type, is_active)");

        const existingTpl = await get("SELECT COUNT(*) as cnt FROM task_templates");
        if (!existingTpl || existingTpl.cnt === 0) {
            await run(`
                INSERT INTO task_templates (template_type, keyword, sample_content, date_pattern) VALUES 
                ('daily_task', 'KẾ HOẠCH LÀM VIỆC SỨ GIẢ', 'KẾ HOẠCH LÀM VIỆC SỨ GIẢ\nHôm nay, T3 ngày 15/09/2026\n⸻HÀNG NGÀY⸻\n👉 Nhiệm vụ hôm nay:\n1. Like bài viết + cmt', 'ngày\\s+(\\d{1,2}/\\d{1,2}/\\d{4})'),
                ('member_report', 'gửi báo cáo nv', 'Nguyễn Ngân Vinh gửi báo cáo nv 15/09/2026', '(\\d{1,2}/\\d{1,2}/\\d{4})'),
                ('bot_summary', 'Báo cáo ngày', 'Báo cáo ngày 15/9/2026\n------HÀNG NGÀY-------\nVÙNG 31', 'ngày\\s+(\\d{1,2}/\\d{1,2}/\\d{4})')
            `);
        }
    } catch (e) {}
}

// Hàm khởi tạo cơ sở dữ liệu và seed dữ liệu mặc định
async function initDb() {
    // 1. Kiểm tra nhanh (Fast Path): nếu database đã có bảng users thì chỉ cần chạy migration cập nhật (< 5ms)
    try {
        const usersTable = await get("SELECT name FROM sqlite_master WHERE type='table' AND name='users'");
        if (usersTable) {
            await runSchemaMigrations();
            await seedMigrationRecord();
            return;
        }
    } catch (checkErr) {}

    // 2. Lần đầu tiên khởi chạy hoặc database mới: Nạp đầy đủ schema và seed mặc định
    return new Promise((resolve, reject) => {
        const schemaPath = path.join(__dirname, '../database/schema_v2.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        db.exec(schema, async (err) => {
            if (err) {
                console.error(`Lỗi khi nạp file ${path.basename(schemaPath)}:`, err);
                reject(err);
            } else {
                console.log(`Cấu trúc database SQLite (${path.basename(schemaPath)}) đã sẵn sàng.`);
                try {
                    await runSchemaMigrations();
                    await seedMigrationRecord();
                    await seedDefaultData();
                    await seedAdmin();
                    resolve();
                } catch (seedErr) {
                    console.error('Lỗi khi seed dữ liệu:', seedErr);
                    reject(seedErr);
                }
            }
        });
    });
}

// Hàm khởi tạo tài khoản quản trị mặc định (admin, trưởng cụm, trưởng vùng)
async function seedAdmin() {
    const adminUsername = 'admin';
    const existingAdmin = await get('SELECT id FROM users WHERE username = ?', [adminUsername]);
    if (!existingAdmin) {
        const defaultPassword = process.env.ADMIN_PASSWORD || 'admin';
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(defaultPassword, salt);
        await run(
            `INSERT INTO users (username, password_hash, full_name, role, is_active, auth_method, name_source) 
             VALUES (?, ?, ?, 'admin', 1, 'local', 'manual')`,
            [adminUsername, hash, 'System Administrator']
        );
        console.log(`Đã khởi tạo tài khoản admin mặc định: admin / ${process.env.ADMIN_PASSWORD ? '********' : 'admin'}`);
    }

    // Danh sách tài khoản mặc định
    const defaultAccounts = [
        { username: 'cum5', password: 'cum5', fullName: 'Nguyễn Thuận An', role: 'cluster_leader', clusterId: 5 },
        { username: 'truongvung31', password: 'truongvung31', fullName: 'Nguyễn Thanh Tân', role: 'region_leader', regionId: 31 },
    ];

    for (const acc of defaultAccounts) {
        let u = await get('SELECT id FROM users WHERE username = ?', [acc.username]);
        if (!u) {
            const hash = bcrypt.hashSync(acc.password, 10);
            const res = await run(
                `INSERT INTO users (username, password_hash, full_name, role, is_active, approval_status, auth_method, name_source)
                 VALUES (?, ?, ?, ?, 1, 'approved', 'local', 'manual')`,
                [acc.username, hash, acc.fullName, acc.role]
            );
            u = { id: res.id };
        }
        if (acc.regionId && !acc.username.startsWith('phovung')) {
            await run('UPDATE regions SET manager_id = ? WHERE id = ?', [u.id, acc.regionId]);
        }
        if (acc.clusterId && acc.username === 'cum5') {
            await run('UPDATE clusters SET manager_id = ? WHERE id = ?', [u.id, acc.clusterId]);
        }
    }
}

function close() {
    return new Promise((resolve, reject) => {
        db.close((err) => {
            if (err) reject(err);
            else resolve();
        });
    });
}

module.exports = {
    db,
    run,
    get,
    all,
    initDb,
    close
};

const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const dbDir = path.join(__dirname, '../../data');
if (!fs.existsSync(dbDir)) {
    fs.mkdirSync(dbDir, { recursive: true });
}

const dbPath = path.join(dbDir, 'vnv_bot.db');
const db = new sqlite3.Database(dbPath);

// Kích hoạt ràng buộc khóa ngoại
db.run('PRAGMA foreign_keys = ON;');
db.run('PRAGMA journal_mode = WAL;');
db.configure('busyTimeout', 5000);

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

// Hàm khởi tạo cơ sở dữ liệu và seed dữ liệu mặc định
async function initDb() {
    return new Promise((resolve, reject) => {
        const schemaPath = path.join(__dirname, '../database/schema.sql');
        const schema = fs.readFileSync(schemaPath, 'utf8');
        
        db.exec(schema, async (err) => {
            if (err) {
                console.error('Lỗi khi nạp file schema.sql:', err);
                reject(err);
            } else {
                console.log('Cấu trúc database SQLite đã sẵn sàng.');
                try {
                    await seedAdmin();
                    resolve();
                } catch (seedErr) {
                    console.error('Lỗi khi seed tài khoản Admin:', seedErr);
                    reject(seedErr);
                }
            }
        });
    });
}

// Hàm khởi tạo tài khoản quản trị mặc định (admin/admin hoặc cấu hình qua env)
async function seedAdmin() {
    const adminUsername = 'admin';
    const existingAdmin = await get('SELECT id FROM users WHERE username = ?', [adminUsername]);
    if (!existingAdmin) {
        const defaultPassword = process.env.ADMIN_PASSWORD || 'admin';
        const salt = bcrypt.genSaltSync(10);
        const hash = bcrypt.hashSync(defaultPassword, salt);
        await run(
            `INSERT INTO users (username, password_hash, full_name, role, is_active) 
             VALUES (?, ?, ?, 'admin', 1)`,
            [adminUsername, hash, 'System Administrator']
        );
        console.log(`Đã khởi tạo tài khoản admin mặc định: admin / ${process.env.ADMIN_PASSWORD ? '********' : 'admin'}`);
    }
}

module.exports = {
    db,
    run,
    get,
    all,
    initDb
};

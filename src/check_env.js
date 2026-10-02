/**
 * VNV Bot V2 - Environment Pre-flight Check Script
 * 
 * Kiểm tra các yêu cầu hệ thống trước khi khởi động Bot.
 * Đảm bảo các cấu hình cơ bản hợp lệ và SQLite kết nối được.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const CONFIG_DIR = path.join(ROOT, 'config');
const ENV_PATH = path.join(CONFIG_DIR, '.env');
const ENV_EXAMPLE_PATH = path.join(CONFIG_DIR, '.env.example');
const CREDENTIALS_PATH = path.join(CONFIG_DIR, 'credentials.json');
const DATA_DIR = path.join(ROOT, 'data');
const DB_PATH_DEFAULT = path.join(DATA_DIR, 'vnv_bot.db');

const isQuiet = process.argv.includes('--quiet');

if (!isQuiet) {
    console.log('============================================');
    console.log('       VNV BOT ENVIRONMENT SELF-CHECK       ');
    console.log('============================================');
}

let hasFailed = false;

// 1. Kiểm tra Node.js Version
const nodeVersion = process.version; // e.g. "v22.11.0"
const versionParts = nodeVersion.substring(1).split('.').map(Number);
const major = versionParts[0];
const minor = versionParts[1];

if (major < 20 || (major === 20 && minor < 6)) {
    console.log(`[FAIL] Node.js version: ${nodeVersion}`);
    console.log(`       Yêu cầu Node.js phiên bản >= 20.6.0 để hỗ trợ load .env tự động.`);
    hasFailed = true;
} else if (major < 22) {
    if (!isQuiet) console.log(`[PASS] Node.js version: ${nodeVersion} (Lưu ý: Khuyên dùng Node.js LTS 22+ để đạt độ ổn định cao nhất)`);
} else {
    if (!isQuiet) console.log(`[PASS] Node.js version: ${nodeVersion}`);
}

// 2. Kiểm tra npm
if (!isQuiet) {
    try {
        const npmVersion = execSync('npm -v', { stdio: 'pipe' }).toString().trim();
        console.log(`[PASS] npm version: v${npmVersion}`);
    } catch (err) {
        console.log('[FAIL] npm không hoạt động hoặc chưa được cài đặt.');
        hasFailed = true;
    }
}

// 3. Kiểm tra .env
if (!fs.existsSync(ENV_PATH)) {
    console.log('[WARN] Không tìm thấy file config/.env');
    if (fs.existsSync(ENV_EXAMPLE_PATH)) {
        try {
            fs.copyFileSync(ENV_EXAMPLE_PATH, ENV_PATH);
            console.log('       -> Đã tự động tạo config/.env từ .env.example.');
            console.log('       -> Vui lòng chỉnh sửa các tham số cấu hình trong config/.env');
            if (process.platform === 'win32') {
                execSync(`start notepad "${ENV_PATH}"`, { stdio: 'ignore' });
            }
        } catch (err) {
            console.log(`       -> Không thể copy .env.example: ${err.message}`);
        }
    } else {
        console.log('       -> Không tìm thấy config/.env.example để tạo mẫu.');
    }
    hasFailed = true;
} else {
    if (!isQuiet) console.log('[PASS] File config/.env tồn tại');
    
    // Kiểm tra cấu hình SESSION_SECRET
    try {
        const envContent = fs.readFileSync(ENV_PATH, 'utf8');
        const secretMatch = envContent.match(/^SESSION_SECRET\s*=\s*(.+)$/m);
        if (!secretMatch || !secretMatch[1] || secretMatch[1].trim() === '' || secretMatch[1].includes('<CHUOI_BI_MAT_SESSION_GIA_TRI_ROTATE_CACH_NHAU_BOI_DAU_PHAY>')) {
            console.log('[FAIL] Chưa cấu hình SESSION_SECRET trong config/.env');
            console.log('       -> Vui lòng điền chuỗi ký tự bí mật bảo mật cho SESSION_SECRET.');
            hasFailed = true;
        } else {
            if (!isQuiet) console.log('[PASS] SESSION_SECRET đã được thiết lập');
        }
    } catch (e) {
        console.log(`[FAIL] Không thể đọc file config/.env: ${e.message}`);
        hasFailed = true;
    }
}

// 4. Kiểm tra credentials.json
if (!fs.existsSync(CREDENTIALS_PATH)) {
    console.log('[FAIL] Không tìm thấy file config/credentials.json (Google API Key)');
    console.log('       -> Bot yêu cầu credentials.json để đồng bộ Google Sheets.');
    console.log('       -> Vui lòng đặt credentials.json của bạn vào thư mục config/.');
    hasFailed = true;
} else {
    try {
        const creds = JSON.parse(fs.readFileSync(CREDENTIALS_PATH, 'utf8'));
        if (!creds.client_email || !creds.private_key) {
            console.log('[FAIL] File config/credentials.json không đúng định dạng Google Service Account.');
            hasFailed = true;
        } else {
            if (!isQuiet) console.log('[PASS] File config/credentials.json hợp lệ');
        }
    } catch (err) {
        console.log(`[FAIL] File config/credentials.json bị lỗi cú pháp JSON: ${err.message}`);
        hasFailed = true;
    }
}

// 5. Kiểm tra SQLite
let sqlite3;
try {
    sqlite3 = require('sqlite3');
} catch (err) {
    console.log('[FAIL] Không thể tải thư viện sqlite3 (chưa được cài đặt).');
    hasFailed = true;
}

if (sqlite3) {
    if (!fs.existsSync(DATA_DIR)) {
        try {
            fs.mkdirSync(DATA_DIR, { recursive: true });
        } catch (err) {}
    }

    let dbPath = DB_PATH_DEFAULT;
    if (fs.existsSync(ENV_PATH)) {
        const envContent = fs.readFileSync(ENV_PATH, 'utf8');
        const dbPathMatch = envContent.match(/^DB_PATH\s*=\s*(.+)$/m);
        if (dbPathMatch && dbPathMatch[1]) {
            let configPath = dbPathMatch[1].trim();
            if ((configPath.startsWith('"') && configPath.endsWith('"')) || 
                (configPath.startsWith("'") && configPath.endsWith("'"))) {
                configPath = configPath.substring(1, configPath.length - 1);
            }
            dbPath = path.resolve(ROOT, configPath);
        }
    }

    const dbDir = path.dirname(dbPath);
    try {
        fs.accessSync(dbDir, fs.constants.W_OK);
        
        if (isQuiet) {
            // Khi ở chế độ quiet, bỏ qua việc thực sự kết nối SQLite và chạy SELECT 1 để tiết kiệm tài nguyên và thời gian
            // Chỉ cần require thành công và thư mục ghi được là đủ điều kiện preflight
            finishCheck();
        } else {
            const db = new sqlite3.Database(dbPath, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
                if (err) {
                    console.log(`[FAIL] Không thể mở kết nối SQLite tới: ${dbPath}. Lỗi: ${err.message}`);
                    process.exit(1);
                }
                
                db.get('SELECT 1', (err) => {
                    db.close();
                    if (err) {
                        console.log(`[FAIL] Truy vấn SQLite kiểm tra thất bại: ${err.message}`);
                        process.exit(1);
                    } else {
                        console.log('[PASS] Kết nối database SQLite hoạt động ổn định');
                        finishCheck();
                    }
                });
            });
        }
    } catch (err) {
        console.log(`[FAIL] Thư mục chứa database không có quyền ghi: ${dbDir}. Lỗi: ${err.message}`);
        hasFailed = true;
        finishCheck();
    }
} else {
    finishCheck();
}

function finishCheck() {
    if (hasFailed) {
        if (isQuiet) {
            console.log('============================================');
            console.log('       VNV BOT ENVIRONMENT SELF-CHECK       ');
            console.log('============================================');
        }
        console.log('TRẠNG THÁI: CHƯA SẴN SÀNG (FAIL)');
        console.log('Vui lòng sửa các lỗi trên trước khi khởi chạy.');
        console.log('============================================\n');
        process.exit(1);
    } else {
        if (isQuiet) {
            console.log('✔ Environment Check: PASS');
        } else {
            console.log('============================================');
            console.log('TRẠNG THÁI: SẴN SÀNG (READY)');
            console.log('Bắt đầu khởi động VNV-Bot...');
            console.log('============================================\n');
        }
        process.exit(0);
    }
}

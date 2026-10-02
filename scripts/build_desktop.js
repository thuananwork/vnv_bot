/**
 * VNV Bot V2 - Desktop Build Script
 * 
 * Đóng gói ứng dụng thành thư mục phân phối self-contained.
 * 
 * Sử dụng: node scripts/build_desktop.js
 * 
 * Kết quả: thư mục dist/VNV-Bot-v2.0.0/ chứa toàn bộ tệp cần thiết
 *          để chạy ứng dụng trên máy Windows.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = process.env.APP_VERSION || pkg.version || '2.0.0';
const DIST_NAME = `VNV-Bot-v${VERSION}`;
const DIST_DIR = path.join(ROOT, 'dist', DIST_NAME);

// Các tệp/thư mục cần sao chép
const COPY_LIST = [
    // Source code
    { src: 'src', type: 'dir' },
    // Config & Launcher
    { src: 'package.json', type: 'file' },
    { src: 'package-lock.json', type: 'file' },
    { src: 'config', type: 'dir' },
    { src: 'VNV-Bot.exe', type: 'file' },
    { src: 'VNV-Bot.bat', type: 'file' },
    { src: 'VNV-Bot-Mac.command', type: 'file' },
    { src: 'Unblock-VNV-Bot.bat', type: 'file' },
    { src: 'bin', type: 'dir' },
    { src: 'run.bat', type: 'file' },
    { src: 'update.bat', type: 'file' },
    { src: 'VERSION', type: 'file' },
    { src: 'CHANGELOG.md', type: 'file' },
    { src: 'release.json', type: 'file' },
    { src: 'docs', type: 'dir' },
    // Database & runtime data
    { src: 'data', type: 'dir' },
    { src: 'logs', type: 'emptydir' },
    { src: 'backups', type: 'emptydir' },
];

// Các tệp/thư mục KHÔNG được sao chép (không cần thiết trong bản phân phối)
const EXCLUDE_PATTERNS = [
    '.git',
    'node_modules',
    'dist',
    'zalo_session',
    'poc_zalo.js',
    'poc_zalo_debug.js',
    'scratch',
    // Test files không cần trong bản phân phối
    'src/tests/e2e_harness.test.js',
    'src/tests/fault_injection.test.js',
    'src/tests/quality_gate.js',
    // Scripts triển khai server (không cần cho desktop)
    'scripts/deploy.sh',
    'scripts/rollback.sh',
    'scripts/restore_db.sh',
    'scripts/burnin_report.sh',
    'scripts/nginx-vnv-bot.conf',
    'ecosystem.config.js',
];

function copyRecursive(src, dest, excludes = []) {
    if (!fs.existsSync(src)) return;

    const stat = fs.statSync(src);
    const relativePath = path.relative(ROOT, src);
    const normalizedRelative = relativePath.replace(/\\/g, '/');

    // Kiểm tra exclude
    for (const pattern of excludes) {
        if (normalizedRelative === pattern || normalizedRelative.startsWith(pattern + '/')) {
            return;
        }
    }

    if (stat.isDirectory()) {
        if (!fs.existsSync(dest)) {
            fs.mkdirSync(dest, { recursive: true });
        }
        const entries = fs.readdirSync(src);
        for (const entry of entries) {
            copyRecursive(path.join(src, entry), path.join(dest, entry), excludes);
        }
    } else {
        const destDir = path.dirname(dest);
        if (!fs.existsSync(destDir)) {
            fs.mkdirSync(destDir, { recursive: true });
        }
        fs.copyFileSync(src, dest);
    }
}

function build() {
    const startTime = Date.now();

    console.log('============================================');
    console.log(`  VNV Bot V2 - Desktop Build`);
    console.log(`  Version: ${VERSION}`);
    console.log('============================================\n');

    // 1. Dọn dẹp thư mục cũ
    console.log('[1/5] Dọn dẹp thư mục dist cũ...');
    if (fs.existsSync(DIST_DIR)) {
        try {
            fs.rmSync(DIST_DIR, { recursive: true, force: true });
        } catch (err) {
            // Nếu bị khóa thư mục cha (do lock CWD trên Windows), xóa sạch các file và thư mục con
            const files = fs.readdirSync(DIST_DIR);
            for (const file of files) {
                fs.rmSync(path.join(DIST_DIR, file), { recursive: true, force: true });
            }
        }
    }
    if (!fs.existsSync(DIST_DIR)) {
        fs.mkdirSync(DIST_DIR, { recursive: true });
    }

    // 2. Biên dịch VNV-Bot.exe & Sao chép tệp
    console.log('[2/5] Biên dịch VNV-Bot.exe và sao chép mã nguồn...');
    try {
        const { compile } = require('./compile_exe');
        compile();
    } catch (e) {
        console.warn('Lưu ý khi biên dịch exe:', e.message);
    }

    for (const item of COPY_LIST) {
        const srcPath = path.join(ROOT, item.src);
        const destPath = path.join(DIST_DIR, item.src);

        if (item.type === 'emptydir') {
            fs.mkdirSync(destPath, { recursive: true });
            // Tạo .gitkeep để thư mục không bị bỏ qua
            fs.writeFileSync(path.join(destPath, '.gitkeep'), '', 'utf8');
            console.log(`  [DIR]  ${item.src}/`);
        } else if (item.type === 'dir') {
            copyRecursive(srcPath, destPath, EXCLUDE_PATTERNS);
            console.log(`  [DIR]  ${item.src}/`);
        } else {
            if (fs.existsSync(srcPath)) {
                const dir = path.dirname(destPath);
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                fs.copyFileSync(srcPath, destPath);
                console.log(`  [FILE] ${item.src}`);
            } else {
                console.log(`  [SKIP] ${item.src} (không tồn tại)`);
            }
        }
    }

    // 3. Cài đặt production dependencies
    console.log('\n[3/5] Cài đặt production dependencies...');
    try {
        execSync('npm install --production --ignore-scripts=false', {
            cwd: DIST_DIR,
            stdio: 'pipe',
            timeout: 120000
        });
        console.log('  ✅ Dependencies đã cài đặt thành công.');

        // Đảm bảo các binary C++ native (node_sqlite3.node) được copy đầy đủ cho máy khác
        const sqliteBuildSrc = path.join(ROOT, 'node_modules', 'sqlite3', 'build');
        const sqliteBuildDest = path.join(DIST_DIR, 'node_modules', 'sqlite3', 'build');
        if (fs.existsSync(sqliteBuildSrc)) {
            copyRecursive(sqliteBuildSrc, sqliteBuildDest);
        }
        const connSqliteBuildSrc = path.join(ROOT, 'node_modules', 'connect-sqlite3', 'node_modules', 'sqlite3', 'build');
        const connSqliteBuildDest = path.join(DIST_DIR, 'node_modules', 'connect-sqlite3', 'node_modules', 'sqlite3', 'build');
        if (fs.existsSync(connSqliteBuildSrc)) {
            copyRecursive(connSqliteBuildSrc, connSqliteBuildDest);
        }
    } catch (err) {
        console.error('  ❌ Lỗi cài đặt dependencies:', err.message);
        process.exit(1);
    }

    // 4. Tạo README cho người dùng cuối
    console.log('[4/5] Tạo tài liệu hướng dẫn sử dụng...');
    const readme = `# VNV Bot V2 - Hướng Dẫn Sử Dụng
(Desktop Package - Node.js Runtime Required)

## Yêu Cầu Hệ Thống
- Hệ điều hành: Windows 10/11
- Môi trường chạy: Node.js LTS v22 trở lên (tải bản cài đặt MSI tại: https://nodejs.org)
- Kết nối Internet (để bot đồng bộ Google Sheets và nhận diện Zalo)

## Hướng Dẫn Thiết Lập Lần Đầu
1. Giải nén thư mục \`${DIST_NAME}\` vào một vị trí trên ổ đĩa của bạn (ví dụ: \`D:\\${DIST_NAME}\`).
2. Truy cập vào thư mục \`config/\`.
3. Sao chép tệp \`.env.example\` thành \`.env\` và điền đầy đủ các thông tin cấu hình (như \`JWT_SECRET\`, \`GOOGLE_SHEET_ID\`, các khóa bảo mật...).
4. Đặt file khóa Google Service Account của bạn (đổi tên thành \`credentials.json\`) vào thư mục \`config/\`.

## Khởi Động Bot
- Trở lại thư mục gốc và double-click vào tệp \`VNV-Bot.bat\`.
- Chương trình sẽ tự động chạy tiến trình kiểm tra môi trường (Node.js, npm, tệp cấu hình và database).
- Nếu tự kiểm tra thành công (PASS), máy chủ bot sẽ được khởi chạy.
- Mở trình duyệt web và truy cập: http://localhost:3000 để bắt đầu quản trị.
- Nhấn phím \`Ctrl+C\` tại màn hình console để dừng hoạt động của bot.

## Quy Trình Cập Nhật Phiên Bản Mới
Để nâng cấp phiên bản bot vô cùng đơn giản và an toàn nhờ công cụ tích hợp sẵn:
1. Tắt phiên bản bot cũ đang chạy (nhấn \`Ctrl+C\` hoặc đóng cửa sổ CMD).
2. Giải nén phiên bản mới này ra một thư mục riêng biệt.
3. Chạy file \`update.bat\` tại thư mục phiên bản mới này.
4. Nhập đường dẫn đầy đủ đến thư mục bot phiên bản cũ (ví dụ: \`D:\\VNV-Bot-v1.0.0\`).
5. Trình cập nhật sẽ tự động sao lưu cấu hình mới của bạn, copy toàn bộ cấu hình (\`config/.env\`, \`config/credentials.json\`) và dữ liệu cũ (\`data/vnv_bot.db\`) sang thư mục mới.
6. Khi hoàn tất, double-click \`VNV-Bot.bat\` ở thư mục mới để chạy bot.

## Cấu Trúc Thư Mục Phân Phối
\`\`\`
${DIST_NAME}/
├── VNV-Bot.bat                 ← Khởi động ứng dụng (Đã tích hợp kiểm tra môi trường)
├── update.bat                  ← Trình cập nhật tự động (backup/restore an toàn)
├── README.md                   ← Hướng dẫn sử dụng này
├── CHANGELOG.md                ← Lịch sử phiên bản
├── VERSION                     ← Tệp thông tin phiên bản nhanh
├── config/
│   ├── .env.example            ← Tệp mẫu cấu hình hệ thống
│   └── credentials.example.json ← Cấu trúc tệp credentials Google API mẫu
├── data/                       ← Dữ liệu SQLite cục bộ (chứa file vnv_bot.db)
├── logs/                       ← Thư mục lưu nhật ký hoạt động
├── backups/                    ← Thư mục lưu các bản sao lưu tự động
├── src/                        ← Mã nguồn ứng dụng
└── node_modules/               ← Thư viện dependencies rút gọn (production only)
\`\`\`

## Hỗ Trợ
Nếu xảy ra sự cố không khởi động được, hãy kiểm tra nhật ký lỗi chi tiết tại thư mục \`logs/\` hoặc mở tệp \`VERSION\` để kiểm tra số phiên bản khi cần liên hệ quản trị viên hỗ trợ.

Phiên bản hiện tại: ${VERSION}
`;
    fs.writeFileSync(path.join(DIST_DIR, 'README.md'), readme, 'utf8');
    console.log('  ✅ README.md đã được tạo.');

    // 5. Tạo build manifest & hướng dẫn sử dụng tiếng Việt
    console.log('[5/5] Tạo build manifest & hướng dẫn sử dụng nhanh...');
    
    // Copy node.exe nếu có để biến thành portable app (đảm bảo đồng bộ 100% với native sqlite3)
    const sysNode = process.execPath && fs.existsSync(process.execPath) ? process.execPath : 'C:\\Program Files\\nodejs\\node.exe';
    if (fs.existsSync(sysNode)) {
        const binDir = path.join(DIST_DIR, 'bin');
        if (!fs.existsSync(binDir)) fs.mkdirSync(binDir, { recursive: true });
        const destNode = path.join(binDir, 'node.exe');
        console.log(`  📦 Đang tích hợp Node.js runtime (${process.version}) từ "${sysNode}" vào bin/node.exe...`);
        try {
            fs.copyFileSync(sysNode, destNode);
            console.log('  ✅ Đã tích hợp Node.js runtime portable đồng bộ chuẩn với native modules!');
        } catch (err) {
            console.warn('  ⚠️ Không thể copy node.exe:', err.message);
        }
    }

    const huongDan = `===============================================================
       HƯỚNG DẪN SỬ DỤNG NHANH VNV BOT V2 (BẢN DESKTOP)
===============================================================

1. CÁCH KHỞI ĐỘNG:
   - Trên Windows: Double-click vào file "VNV-Bot.exe" (hoặc "VNV-Bot.bat").
   - Trên macOS: Double-click vào file "VNV-Bot-Mac.command".
     (Nếu macOS hiển thị cảnh báo bảo mật lần đầu, chuột phải vào file -> chọn "Open").
   - Trình duyệt sẽ tự động mở tại địa chỉ: http://localhost:3000

2. ĐĂNG NHẬP HỆ THỐNG:
   - Tài khoản Trưởng Cụm 5:
     + Username: truongcum5
     + Mật khẩu: cum5@123
   - Tài khoản Trưởng Vùng 27:
     + Username: truongvung27
     + Mật khẩu: vung27@123
   - Tài khoản Admin:
     + Username: admin
     + Mật khẩu: admin

3. TÍNH NĂNG CHÍNH:
   - Bảng Điều Hành Cụm 5: Tự động tổng hợp báo cáo các vùng, tag @Phạm Minh Tú, hỗ trợ dán vào ô chat Zalo (không tự động gửi để duyệt an toàn).
   - Bảng Điều Hành Vùng (25 -> 31): Tích chọn trạng thái hoàn thành, đồng bộ trực tiếp lên Google Sheet, sinh báo cáo Mẫu 1.
   - Quản Lý Thành Viên: Xem danh bạ 112 sứ giả, cập nhật và đồng bộ 2 chiều.

4. CÁCH TẮT BOT:
   - Đóng cửa sổ màn hình đen (Console) của VNV-Bot.
`;
    fs.writeFileSync(path.join(DIST_DIR, 'HUONG_DAN_SU_DUNG.txt'), huongDan, 'utf8');

    const buildManifest = {
        name: 'VNV-Bot-V2',
        version: VERSION,
        build_date: new Date().toISOString(),
        node_version: process.version,
        platform: process.platform,
        arch: process.arch,
        type: 'desktop'
    };
    fs.writeFileSync(
        path.join(DIST_DIR, 'build.json'),
        JSON.stringify(buildManifest, null, 2),
        'utf8'
    );

    // Tự động nén thành file .zip
    const zipOutput = path.join(ROOT, 'dist', `${DIST_NAME}.zip`);
    console.log(`\n  📦 Đang nén thành file: ${zipOutput}...`);
    try {
        if (fs.existsSync(zipOutput)) fs.unlinkSync(zipOutput);
        try {
            // Sử dụng tar bsdtar có sẵn trên Windows 10/11: siêu nhanh (~3-5 giây)
            execSync(`tar -a -c -f "${zipOutput}" "${DIST_NAME}"`, { cwd: path.join(ROOT, 'dist'), stdio: 'pipe' });
            console.log(`  ✅ Đã tạo file zip hoàn chỉnh (tar): dist/${DIST_NAME}.zip`);
        } catch (tarErr) {
            // Fallback sang PowerShell nếu tar không khả dụng
            execSync(`powershell -NoProfile -Command "Compress-Archive -Path '${DIST_DIR}' -DestinationPath '${zipOutput}' -Force"`, { stdio: 'pipe' });
            console.log(`  ✅ Đã tạo file zip hoàn chỉnh: dist/${DIST_NAME}.zip`);
        }
    } catch (zipErr) {
        console.warn('  ⚠️ Lưu ý khi nén zip:', zipErr.message);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Đếm kích thước
    let totalSize = 0;
    function calcSize(dir) {
        const entries = fs.readdirSync(dir);
        for (const entry of entries) {
            const full = path.join(dir, entry);
            const stat = fs.statSync(full);
            if (stat.isDirectory()) calcSize(full);
            else totalSize += stat.size;
        }
    }
    calcSize(DIST_DIR);

    console.log('\n============================================');
    console.log('  ✅ BUILD THÀNH CÔNG                       ');
    console.log('============================================');
    console.log(`  Output Folder: dist/${DIST_NAME}/`);
    console.log(`  Output Zip   : dist/${DIST_NAME}.zip (GỬI FILE NÀY CHO NGƯỜI KHÁC)`);
    console.log(`  Kích thước   : ${(totalSize / 1024 / 1024).toFixed(1)} MB`);
    console.log(`  Thời gian    : ${duration}s`);
    console.log('============================================');
}

if (require.main === module) {
    build();
}

module.exports = { build };


const fs = require('fs');
const path = require('path');
const assert = require('assert');

const IGNORED_DIRS = ['node_modules', '.git', 'logs', 'backups', '.gemini', '.system_generated', 'data', 'config'];

function scanDir(dir, fileList = []) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        if (IGNORED_DIRS.some(ignored => fullPath.includes(path.sep + ignored + path.sep) || fullPath.endsWith(path.sep + ignored))) {
            continue;
        }

        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
            scanDir(fullPath, fileList);
        } else {
            fileList.push(fullPath);
        }
    }
    return fileList;
}

function runSecretsAudit() {
    console.log('=========================================');
    console.log('       SECRETS AUDIT VULNERABILITY SCAN  ');
    console.log('=========================================');

    const rootDir = path.join(__dirname, '../..');
    const allFiles = scanDir(rootDir);

    const leaks = [];

    for (const filePath of allFiles) {
        const baseName = path.basename(filePath);

        // 1. Chặn file nhạy cảm
        if (baseName === '.env') {
            leaks.push(`Phát hiện tệp nhạy cảm bị commit: ${path.relative(rootDir, filePath)}`);
        }
        if (baseName === 'credentials.json') {
            leaks.push(`Phát hiện tệp credentials Google API bị commit: ${path.relative(rootDir, filePath)}`);
        }

        // Chỉ quét các file nguồn
        if (filePath.endsWith('.js') || filePath.endsWith('.json') || filePath.endsWith('.sql')) {
            const content = fs.readFileSync(filePath, 'utf8');

            // 2. Chặn Zalo OAuth Credentials thật
            const zaloSecretMatch = content.match(/zalo\.oa\.app_secret['"],\s*['"]([^'"]+)['"]/);
            if (zaloSecretMatch && zaloSecretMatch[1] && !zaloSecretMatch[1].startsWith('mock') && zaloSecretMatch[1] !== '') {
                leaks.push(`Phát hiện Zalo App Secret thật trong file: ${path.relative(rootDir, filePath)}`);
            }

            // 3. Chặn Telegram Bot Token thật
            const telegramTokenMatch = content.match(/bot[0-9]{9}:[a-zA-Z0-9_-]{35}/);
            if (telegramTokenMatch) {
                leaks.push(`Phát hiện Telegram Bot Token thực tế trong file: ${path.relative(rootDir, filePath)}`);
            }

            // 4. Chặn JWT_SECRET thật trong code
            const jwtSecretMatch = content.match(/JWT_SECRET\s*=\s*['"]([^'"]+)['"]/);
            if (jwtSecretMatch && jwtSecretMatch[1] && jwtSecretMatch[1] !== 'secret123' && jwtSecretMatch[1] !== 'vnv-bot-secret-key-2026') {
                leaks.push(`Phát hiện JWT_SECRET nhạy cảm trong file: ${path.relative(rootDir, filePath)}`);
            }
        }
    }

    if (leaks.length > 0) {
        console.error('\n🔴 PHÁT HIỆN RÒ RỈ THÔNG TIN BẢO MẬT (SECRETS LEAKED):');
        leaks.forEach(leak => console.error(`  - ${leak}`));
        process.exit(1);
    } else {
        console.log('🟢 Kiểm tra an toàn: Không phát hiện secrets/credentials nhạy cảm bị rò rỉ.');
    }
}

if (require.main === module) {
    runSecretsAudit();
}

module.exports = {
    runSecretsAudit
};

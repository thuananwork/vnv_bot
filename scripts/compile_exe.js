/**
 * Biên dịch file VNV-Bot.exe cho Trưởng Vùng
 * Sử dụng trình biên dịch C# tích hợp sẵn trên mọi máy Windows (csc.exe)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SOURCE = path.join(ROOT, 'src', 'launcher', 'VNVBotLauncher.cs');
const ASSEMBLY_INFO = path.join(ROOT, 'src', 'launcher', 'AssemblyInfo.cs');
const MANIFEST = path.join(ROOT, 'src', 'launcher', 'app.manifest');
const OUTPUT = path.join(ROOT, 'VNV-Bot.exe');

const CSC_PATHS = [
    'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319\\csc.exe',
    'C:\\Windows\\Microsoft.NET\\Framework\\v4.0.30319\\csc.exe'
];

function findCsc() {
    for (const p of CSC_PATHS) {
        if (fs.existsSync(p)) return p;
    }
    return null;
}

function compile() {
    const csc = findCsc();
    if (!csc) {
        console.error('Không tìm thấy trình biên dịch csc.exe của Windows.');
        process.exit(1);
    }

    console.log('--- BIÊN DỊCH VNV-BOT.EXE CHUẨN AN TOÀN ---');
    console.log('Trình biên dịch:', csc);
    console.log('File nguồn:', SOURCE);
    console.log('Manifest:', MANIFEST);
    console.log('AssemblyInfo:', ASSEMBLY_INFO);
    console.log('Đích đến:', OUTPUT);

    let manifestParam = '';
    if (fs.existsSync(MANIFEST)) {
        manifestParam = `/win32manifest:"${MANIFEST}"`;
    }

    let extraSources = '';
    if (fs.existsSync(ASSEMBLY_INFO)) {
        extraSources += ` "${ASSEMBLY_INFO}"`;
    }

    const cmd = `"${csc}" /target:exe /out:"${OUTPUT}" ${manifestParam} /reference:System.Windows.Forms.dll /optimize+ "${SOURCE}"${extraSources}`;
    
    try {
        execSync(cmd, { stdio: 'inherit' });
        if (fs.existsSync(OUTPUT)) {
            const stat = fs.statSync(OUTPUT);
            console.log('\n============================================');
            console.log('  ✅ BIÊN DỊCH THÀNH CÔNG VNV-Bot.exe!');
            console.log(`  Kích thước: ${(stat.size / 1024).toFixed(1)} KB`);
            console.log(`  Đường dẫn : ${OUTPUT}`);
            console.log('============================================');
        }
    } catch (err) {
        console.error('❌ Lỗi biên dịch:', err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    compile();
}

module.exports = { compile };

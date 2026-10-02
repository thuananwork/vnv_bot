const path = require('path');
const sqlite3 = require('sqlite3').verbose();

function detectBehaviorType(statusName) {
    if (!statusName) return 'CUSTOM';
    const lower = statusName.toLowerCase().trim();

    // 1. Làm trễ / Nộp bù (trễ, muộn, bù, bổ sung, late, delay)
    if (/(?:trễ|muộn|bù|bổ\s*sung|late|delay|tre|muon|bu|bo\s*sung)/i.test(lower)) {
        return 'LATE_COMPLETED';
    }

    // 2. Hoàn thành đúng hạn (hoàn thành, đúng hạn, xong, ok, on time, đã hoàn thành, oke, x)
    if (/(?:hoàn\s*thành|đã\s*hoàn\s*thành|đúng\s*hạn|on\s*time|da\s*hoan\s*thanh|hoan\s*thanh|dung\s*han|\bxong\b|\bok\b|\boke\b|\bx\b)/i.test(lower)) {
        return 'ON_TIME';
    }

    // 3. Chưa làm / Không phản hồi (chưa, không, vắng, thiếu)
    if (/(?:chưa|không|vắng|thiếu|chua|khong|vang|thieu|no\s*response)/i.test(lower)) {
        return 'INCOMPLETE';
    }

    // 4. Xin hoãn / Xin phép (phép, hoãn, nghỉ, quân sự, ôn thi, viện)
    if (/(?:phép|hoãn|nghỉ|quân\s*sự|ôn\s*thi|viện|phep|hoan|nghi|quan\s*su|on\s*thi|vien)/i.test(lower)) {
        return 'ON_LEAVE';
    }

    return 'CUSTOM';
}

async function runMigrationForDb(targetDbPath) {
    console.log(`\n--- Migrating database: ${targetDbPath} ---`);
    const db = new sqlite3.Database(targetDbPath);

    const run = (sql, params = []) => new Promise((res, rej) => db.run(sql, params, function (e) { if (e) rej(e); else res(this); }));
    const all = (sql, params = []) => new Promise((res, rej) => db.all(sql, params, (e, r) => { if (e) rej(e); else res(r); }));

    try {
        await run("ALTER TABLE user_custom_statuses ADD COLUMN behavior_type TEXT NOT NULL DEFAULT 'CUSTOM'");
        console.log('✅ Added behavior_type column to user_custom_statuses');
    } catch (e) {
        console.log('ℹ️ Column behavior_type already exists or table updated');
    }

    const rows = await all('SELECT * FROM user_custom_statuses');
    for (const r of rows) {
        const bType = detectBehaviorType(r.status_name);
        await run('UPDATE user_custom_statuses SET behavior_type = ? WHERE id = ?', [bType, r.id]);
    }

    const updated = await all('SELECT id, user_id, status_name, color_hex, text_value, behavior_type FROM user_custom_statuses');
    console.log('✅ Migrated statuses count:', updated.length);
    db.close();
}

async function run() {
    const target = process.argv[2];
    if (target) {
        await runMigrationForDb(path.resolve(target));
    } else {
        const defaultDb = path.join(__dirname, '../data/vnv_bot.db');
        await runMigrationForDb(defaultDb);
        const distDb = path.join(__dirname, '../dist/VNV-Bot-v2.0.0/data/vnv_bot.db');
        const fs = require('fs');
        if (fs.existsSync(distDb)) {
            await runMigrationForDb(distDb);
        }
    }
    process.exit(0);
}

run().catch(err => {
    console.error('Migration error:', err);
    process.exit(1);
});

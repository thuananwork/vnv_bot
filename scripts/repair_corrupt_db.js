const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');

const srcDbPath = path.join(__dirname, '../dist/VNV-Bot-v2.0.0/data/vnv_bot.db');
const targetDbPath = path.join(__dirname, '../dist/VNV-Bot-v2.0.0/data/vnv_bot_repaired.db');
const schemaPath = path.join(__dirname, '../src/database/schema_v2.sql');

async function repair() {
    console.log('--- BẮT ĐẦU PHỤC HỒI DATABASE VNV-BOT ---');
    if (fs.existsSync(targetDbPath)) {
        fs.unlinkSync(targetDbPath);
    }

    const srcDb = new sqlite3.Database(srcDbPath);
    const targetDb = new sqlite3.Database(targetDbPath);
    // 1. Tạo schema chuẩn trong database mới
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    await new Promise((resolve, reject) => {
        targetDb.exec(schemaSql, (err) => {
            if (err) reject(err);
            else resolve();
        });
    });
    await new Promise(r => targetDb.run('PRAGMA foreign_keys = OFF;', () => r()));

    // Đảm bảo mọi bảng và cột từ DB cũ đều tồn tại trong DB mới
    const allSrcTables = await new Promise((resolve) => {
        srcDb.all("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'", (e, r) => resolve(r || []));
    });
    for (const t of allSrcTables) {
        if (t.sql) {
            await new Promise(r => targetDb.run(t.sql.replace('CREATE TABLE', 'CREATE TABLE IF NOT EXISTS'), () => r()));
        }
    }
    console.log('✅ Đã tạo cấu trúc bảng sạch trong vnv_bot_repaired.db');

    // 2. Chuyển toàn bộ dữ liệu từ các bảng lành lặn
    const tables = [
        'users',
        'clusters',
        'regions',
        'members',
        'identity_mappings',
        'tasks',
        'submissions',
        'reports',
        'audit_logs',
        'daily_operations',
        'schema_migrations',
        'local_config',
        'zalo_message_queue',
        'processed_messages',
        'user_custom_statuses',
        'sheet_sync_history',
        'task_templates'
    ];

    for (const table of tables) {
        try {
            const rows = await new Promise((resolve, reject) => {
                srcDb.all(`SELECT * FROM ${table}`, (err, data) => {
                    if (err) reject(err);
                    else resolve(data);
                });
            });

            let validRows = rows;
            if (table === 'submissions') {
                validRows = rows.filter(r => r.region_id && r.member_id && r.work_date && typeof r.work_date === 'string' && r.work_date.includes('-'));
            } else if (table === 'reports') {
                validRows = rows.filter(r => r.region_id && r.work_date && typeof r.work_date === 'string' && r.content && r.total_members != null);
            }

            if (validRows && validRows.length > 0) {
                const sample = validRows[0];
                const cols = Object.keys(sample);
                const placeholders = cols.map(() => '?').join(', ');
                const insertSql = `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${placeholders})`;

                await new Promise((resolve, reject) => {
                    targetDb.serialize(() => {
                        targetDb.run('BEGIN TRANSACTION');
                        const stmt = targetDb.prepare(insertSql);
                        for (const row of validRows) {
                            const values = cols.map(c => row[c]);
                            stmt.run(values);
                        }
                        stmt.finalize();
                        targetDb.run('COMMIT', (commitErr) => {
                            if (commitErr) reject(commitErr);
                            else resolve();
                        });
                    });
                });
                console.log(`✅ [${table}]: Phục hồi thành công ${validRows.length}/${rows.length} bản ghi.`);
            } else {
                console.log(`ℹ️ [${table}]: Bảng rỗng (0 bản ghi).`);
            }
        } catch (tableErr) {
            console.warn(`⚠️ [${table}]: Lỗi đọc bảng từ DB cũ: ${tableErr.message}`);
        }
    }

    // 3. Phục hồi tối đa dữ liệu từ raw_events (bảng bị lỗi disk image)
    try {
        console.log('🔄 Đang thử cứu dữ liệu từ raw_events...');
        // Đọc từng khối 50 dòng để né block hỏng
        let offset = 0;
        let salvagedCount = 0;
        let hasMore = true;

        while (hasMore && offset < 5000) {
            try {
                const batch = await new Promise((resolve, reject) => {
                    srcDb.all(`SELECT * FROM raw_events LIMIT 50 OFFSET ${offset}`, (err, data) => {
                        if (err) reject(err);
                        else resolve(data || []);
                    });
                });
                if (batch.length === 0) {
                    hasMore = false;
                    break;
                }
                const sample = batch[0];
                const cols = Object.keys(sample);
                const placeholders = cols.map(() => '?').join(', ');
                const insertSql = `INSERT OR IGNORE INTO raw_events (${cols.join(', ')}) VALUES (${placeholders})`;

                await new Promise((resolve) => {
                    targetDb.serialize(() => {
                        targetDb.run('BEGIN TRANSACTION');
                        const stmt = targetDb.prepare(insertSql);
                        for (const row of batch) {
                            stmt.run(cols.map(c => row[c]));
                        }
                        stmt.finalize();
                        targetDb.run('COMMIT', () => resolve());
                    });
                });
                salvagedCount += batch.length;
                offset += 50;
            } catch (batchErr) {
                // Gặp trang hỏng: nhảy qua 50 dòng tiếp theo để cứu các dòng còn lại
                offset += 50;
            }
        }
        console.log(`✅ [raw_events]: Đã cứu được ${salvagedCount} bản ghi an toàn.`);
    } catch (e) {
        console.log('ℹ️ Bỏ qua raw_events hỏng (sẽ được tự động nạp mới khi quét).');
    }

    // 4. Kiểm tra toàn vẹn database mới
    const checkResult = await new Promise((resolve, reject) => {
        targetDb.all('PRAGMA integrity_check;', (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
        });
    });

    console.log('🔍 Kết quả kiểm tra toàn vẹn database mới:', checkResult);
    srcDb.close();
    targetDb.close();

    if (checkResult && checkResult[0] && checkResult[0].integrity_check === 'ok') {
        console.log('🎉 Database mới ĐẠT CHUẨN TOÀN VẸN 100%!');
        return true;
    }
    return false;
}

repair().then(ok => {
    if (ok) process.exit(0);
    else process.exit(1);
}).catch(err => {
    console.error('Lỗi phục hồi:', err);
    process.exit(1);
});

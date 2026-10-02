const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const path = require('path');

const dbPath = path.join(__dirname, '../data/vnv_bot.db');
const db = new sqlite3.Database(dbPath);

const accounts = [
    { username: 'cum5', password: 'cum5', fullName: 'Nguyễn Thuận An', role: 'cluster_leader', clusterId: 5 },
    { username: 'truongvung25', password: 'truongvung25', fullName: 'Nguyễn Ngọc Bảo Trâm', role: 'region_leader', regionId: 25 },
    { username: 'truongvung26', password: 'truongvung26', fullName: 'Trần Hoàng Vũ', role: 'region_leader', regionId: 26 },
    { username: 'truongvung27', password: 'truongvung27', fullName: 'Phạm Quang Đại', role: 'region_leader', regionId: 27 },
    { username: 'truongvung28', password: 'truongvung28', fullName: 'Trưởng Vùng 28', role: 'region_leader', regionId: 28 },
    { username: 'truongvung29', password: 'truongvung29', fullName: 'Vũ Thanh Hiền', role: 'region_leader', regionId: 29 },
    { username: 'truongvung30', password: 'truongvung30', fullName: 'Lê Thị Thanh Phương', role: 'region_leader', regionId: 30 },
    { username: 'truongvung31', password: 'truongvung31', fullName: 'Nguyễn Thanh Tân', role: 'region_leader', regionId: 31 },
    // 7 Phó Vùng trực thuộc Vùng 25 -> 31
    { username: 'phovung25', password: 'phovung25', fullName: 'Nguyễn Trần Yến Nhi', role: 'region_leader', regionId: 25 },
    { username: 'phovung26', password: 'phovung26', fullName: 'Mai Thị Hồng Lý', role: 'region_leader', regionId: 26 },
    { username: 'phovung27', password: 'phovung27', fullName: 'Nguyễn Thị Thanh Trà', role: 'region_leader', regionId: 27 },
    { username: 'phovung28', password: 'phovung28', fullName: 'Trương Nhật My', role: 'region_leader', regionId: 28 },
    { username: 'phovung29', password: 'phovung29', fullName: 'Lê Kim Chi', role: 'region_leader', regionId: 29 },
    { username: 'phovung30', password: 'phovung30', fullName: 'Nguyễn Thị Thanh Trúc', role: 'region_leader', regionId: 30 },
    { username: 'phovung31', password: 'phovung31', fullName: 'Kiều Minh Trang', role: 'region_leader', regionId: 31 },
];

db.serialize(async () => {
    console.log('--- ĐANG KHỞI TẠO TÀI KHOẢN MỚI ---');

    for (const acc of accounts) {
        const hash = bcrypt.hashSync(acc.password, 10);
        
        db.get('SELECT id FROM users WHERE username = ?', [acc.username], (err, existing) => {
            if (existing) {
                db.run(
                    'UPDATE users SET password_hash = ?, full_name = ?, role = ?, approval_status = "approved" WHERE id = ?',
                    [hash, acc.fullName, acc.role, existing.id],
                    (updateErr) => {
                        console.log(`✓ Đã cập nhật tài khoản: ${acc.username} (ID: ${existing.id})`);
                        if (acc.regionId && !acc.username.startsWith('phovung')) {
                            db.run('UPDATE regions SET manager_id = ? WHERE id = ?', [existing.id, acc.regionId]);
                        }
                        if (acc.clusterId) {
                            db.run('UPDATE clusters SET manager_id = ? WHERE id = ?', [existing.id, acc.clusterId]);
                        }
                    }
                );
            } else {
                db.run(
                    `INSERT INTO users (username, password_hash, full_name, role, is_active, approval_status, auth_method, name_source)
                     VALUES (?, ?, ?, ?, 1, 'approved', 'local', 'manual')`,
                    [acc.username, hash, acc.fullName, acc.role],
                    function(insertErr) {
                        const newId = this.lastID;
                        console.log(`✓ Đã tạo mới tài khoản: ${acc.username} (ID: ${newId})`);
                        if (acc.regionId && !acc.username.startsWith('phovung')) {
                            db.run('UPDATE regions SET manager_id = ? WHERE id = ?', [newId, acc.regionId]);
                        }
                        if (acc.clusterId) {
                            db.run('UPDATE clusters SET manager_id = ? WHERE id = ?', [newId, acc.clusterId]);
                        }
                    }
                );
            }
        });
    }

    setTimeout(() => {
        db.all('SELECT id, username, full_name, role FROM users ORDER BY id ASC', (err, rows) => {
            console.log('\nDANH SÁCH TÀI KHOẢN HIỆN TẠI:');
            console.table(rows);
            db.close();
        });
    }, 1500);
});

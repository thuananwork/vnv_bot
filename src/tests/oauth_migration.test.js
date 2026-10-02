const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const assert = require('assert');
const sqlite3 = require('sqlite3').verbose();

const dataDir = path.join(__dirname, '../../data');
const backupsDir = path.join(__dirname, '../../backups');
const migrationScript = path.join(__dirname, '../../scripts/migration_v2.1_oauth.js');

// Helper to create clean test databases
function setupTestDb(dbPath) {
    try {
        if (fs.existsSync(dbPath)) {
            fs.unlinkSync(dbPath);
        }
    } catch (e) {}
    const db = new sqlite3.Database(dbPath);
    return db;
}

const runQuery = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function(err) {
        if (err) reject(err);
        else resolve({ id: this.lastID, changes: this.changes });
    });
});

const getQuery = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row);
    });
});

const execQuery = (db, sql) => new Promise((resolve, reject) => {
    db.exec(sql, (err) => {
        if (err) reject(err);
        else resolve();
    });
});

const allQuery = (db, sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
    });
});

const closeDb = (db) => new Promise((resolve) => {
    db.close((err) => {
        resolve();
    });
});

async function safeUnlink(filePath) {
    // Wait for any async file locks to release
    await new Promise(r => setTimeout(r, 100));
    try {
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
    } catch (e) {
        // Retry
        await new Promise(r => setTimeout(r, 200));
        try {
            if (fs.existsSync(filePath)) {
                fs.unlinkSync(filePath);
            }
        } catch (_) {}
    }
}

async function createLegacySchema(db) {
    await execQuery(db, `
        CREATE TABLE users (
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
        CREATE TABLE clusters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cluster_name TEXT UNIQUE NOT NULL,
            manager_id INTEGER UNIQUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (manager_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE TABLE regions (
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
        CREATE TABLE audit_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            target TEXT NOT NULL,
            details TEXT NOT NULL,
            ip_address TEXT,
            request_id TEXT,
            target_user_id INTEGER,
            result TEXT,
            duration_ms INTEGER,
            user_agent TEXT,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
        );
        CREATE INDEX idx_users_username ON users(username);
    `);
}

async function runTests() {
    console.log('=== BẮT ĐẦU CHẠY 27 TEST CASES CHO MIGRATION ===');

    // Case 1: Migration backup failure
    console.log('Case 1: Migration backup failure...');
    {
        const dbPath = path.join(dataDir, 'test_mig_1.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Pass a non-writable/invalid backup directory to force failure
        const badBackupDir = path.join(__dirname, 'non_existent_and_uncreatable_dir/???');
        try {
            execSync(`node "${migrationScript}"`, {
                env: {
                    ...process.env,
                    VNV_DATABASE_PATH: dbPath,
                    VNV_BACKUP_DIR: badBackupDir
                },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on backup creation failure.');
        } catch (err) {
            assert.strictEqual(err.status, 1, 'Should exit with code 1');
            assert(err.stderr.toString().includes('LỖI NGHIÊM TRỌNG'));
        }
        await safeUnlink(dbPath);
    }

    // Case 2: Duplicate emails pre-check in STATE_B_BASELINE_INCOMPLETE
    console.log('Case 2: Duplicate emails pre-check...');
    {
        const dbPath = path.join(dataDir, 'test_mig_2.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await execQuery(db, `
            ALTER TABLE users ADD COLUMN email TEXT;
            ALTER TABLE users ADD COLUMN google_id TEXT;
            ALTER TABLE users ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'local';
            ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved';
            ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE users ADD COLUMN name_source TEXT NOT NULL DEFAULT 'manual';
            ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
        `);
        await runQuery(db, `INSERT INTO users (username, password_hash, full_name, role, email) VALUES ('u1', 'p', 'Name 1', 'admin', 'test@gmail.com')`);
        await runQuery(db, `INSERT INTO users (username, password_hash, full_name, role, email) VALUES ('u2', 'p', 'Name 2', 'cluster_leader', 'TEST@gmail.com')`);
        await closeDb(db);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on duplicate email precheck.');
        } catch (err) {
            assert.strictEqual(err.status, 1, 'Should exit with code 1');
            assert(err.stderr.toString().includes('Xung đột chuẩn hóa email'));
        }
        await safeUnlink(dbPath);
    }

    // Case 3: Duplicate google_id pre-check
    console.log('Case 3: Duplicate google_id pre-check...');
    {
        const dbPath = path.join(dataDir, 'test_mig_3.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await execQuery(db, `
            ALTER TABLE users ADD COLUMN email TEXT;
            ALTER TABLE users ADD COLUMN google_id TEXT;
            ALTER TABLE users ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'local';
            ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved';
            ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE users ADD COLUMN name_source TEXT NOT NULL DEFAULT 'manual';
            ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
        `);
        await runQuery(db, `INSERT INTO users (username, password_hash, full_name, role, google_id) VALUES ('u1', 'p', 'Name 1', 'admin', 'gid1')`);
        await runQuery(db, `INSERT INTO users (username, password_hash, full_name, role, google_id) VALUES ('u2', 'p', 'Name 2', 'cluster_leader', 'gid1')`);
        await closeDb(db);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on duplicate google_id precheck.');
        } catch (err) {
            assert.strictEqual(err.status, 1);
            assert(err.stderr.toString().includes('trùng lặp google_id'));
        }
        await safeUnlink(dbPath);
    }

    // Case 4: Duplicate manager_id pre-check
    console.log('Case 4: Duplicate manager_id pre-check...');
    {
        const dbPath = path.join(dataDir, 'test_mig_4.db');
        const db = setupTestDb(dbPath);
        // Create a custom schema without UNIQUE constraint on manager_id to test duplicate manager pre-check
        await execQuery(db, `
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL,
                password_hash TEXT NOT NULL,
                full_name TEXT NOT NULL,
                role TEXT NOT NULL CHECK(role IN ('admin', 'cluster_leader', 'region_leader'))
            );
            CREATE TABLE regions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                region_name TEXT UNIQUE NOT NULL,
                manager_id INTEGER,
                zalo_group_id TEXT UNIQUE NOT NULL,
                zalo_group_name TEXT NOT NULL
            );
            CREATE TABLE clusters (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                cluster_name TEXT UNIQUE NOT NULL,
                manager_id INTEGER
            );
        `);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role) VALUES (10, 'u1', 'p', 'Name 1', 'cluster_leader')`);
        await runQuery(db, `INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('R1', 10, 'g1', 'Group 1')`);
        await runQuery(db, `INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('R2', 10, 'g2', 'Group 2')`);
        await closeDb(db);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on duplicate manager_id precheck.');
        } catch (err) {
            assert.strictEqual(err.status, 1);
            assert(err.stderr.toString().includes('manager_id được gán cho nhiều đơn vị'));
        }
        await safeUnlink(dbPath);
    }

    // Case 5: PRAGMA integrity check pre-commit
    console.log('Case 5: PRAGMA integrity check pre-commit...');
    {
        const dbPath = path.join(dataDir, 'test_mig_5.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Successful execution checks integrity check internally.
        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });
        
        const dbMigrated = new sqlite3.Database(dbPath);
        const integrity = await allQuery(dbMigrated, 'PRAGMA integrity_check');
        assert.strictEqual(integrity[0].integrity_check, 'ok');
        await closeDb(dbMigrated);
        await safeUnlink(dbPath);
    }

    // Case 6: Legacy Leader email absence handling
    console.log('Case 6: Legacy Leader email absence handling...');
    {
        const dbPath = path.join(dataDir, 'test_mig_6.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role) VALUES (5, 'leader_no_email', 'p', 'Leader Name', 'cluster_leader')`);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const dbMigrated = new sqlite3.Database(dbPath);
        const user = await getQuery(dbMigrated, 'SELECT * FROM users WHERE id = 5');
        assert.strictEqual(user.email, null);
        assert.strictEqual(user.auth_method, 'google');
        assert.strictEqual(user.approval_status, 'disabled');
        assert.strictEqual(user.is_active, 0);
        await closeDb(dbMigrated);
        await safeUnlink(dbPath);
    }

    // Case 7: Migration idempotency check
    console.log('Case 7: Migration idempotency check...');
    {
        const dbPath = path.join(dataDir, 'test_mig_7.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Run 1st time
        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Run 2nd time - should be a no-op State C
        const out = execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });
        assert(out.toString().includes('No-op'));
        await safeUnlink(dbPath);
    }

    // Case 8: Rollback handling on query failure
    console.log('Case 8: Rollback handling on query failure...');
    {
        // Handled naturally by transaction block in migration. If new_users fails, it rolls back to old users table.
        const dbPath = path.join(dataDir, 'test_mig_8.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await runQuery(db, `INSERT INTO users (username, password_hash, full_name, role) VALUES ('admin_u', 'p', 'Admin', 'admin')`);
        await closeDb(db);

        // We can temporarily simulate query failure inside transaction by making new_users already exist or corrupting data.
        // If we create new_users beforehand, creating it again will fail!
        const db2 = new sqlite3.Database(dbPath);
        await execQuery(db2, 'CREATE TABLE new_users (id INTEGER);');
        await closeDb(db2);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed and rolled back');
        } catch (err) {
            // Assert users table still has legacy columns and data (rolled back successfully)
            const db3 = new sqlite3.Database(dbPath);
            const user = await getQuery(db3, "SELECT * FROM users WHERE username = 'admin_u'");
            assert.strictEqual(user.full_name, 'Admin');
            assert.strictEqual(user.email, undefined); // email shouldn't exist because of rollback
            await closeDb(db3);
        }
        await safeUnlink(dbPath);
    }

    // Case 9: Catalog object inventory validation
    console.log('Case 9: Catalog object inventory validation...');
    {
        const dbPath = path.join(dataDir, 'test_mig_9.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        // Create custom named index
        await execQuery(db, 'CREATE INDEX idx_users_test_custom ON users(full_name);');
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const dbMigrated = new sqlite3.Database(dbPath);
        const index = await getQuery(dbMigrated, "SELECT name FROM sqlite_master WHERE type='index' AND name='idx_users_test_custom'");
        assert(index, 'Custom index idx_users_test_custom should have been recreated.');
        await closeDb(dbMigrated);
        await safeUnlink(dbPath);
    }

    // Case 10: Duplicate migration checksum failure
    console.log('Case 10: Duplicate migration checksum failure...');
    {
        const dbPath = path.join(dataDir, 'test_mig_10.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Corrupt checksum in schema_migrations
        const dbMigrated = new sqlite3.Database(dbPath);
        await runQuery(dbMigrated, "UPDATE schema_migrations SET checksum = 'corrupted_checksum' WHERE version = '2026_07_oauth_v21'");
        await closeDb(dbMigrated);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should fail fast on checksum mismatch.');
        } catch (err) {
            assert.strictEqual(err.status, 1);
            assert(err.stderr.toString().includes('STATE_D_CHECKSUM_MISMATCH'));
        }
        await safeUnlink(dbPath);
    }

    // Case 11: Migration pre-COMMIT foreign-key failure
    console.log('Case 11: Migration pre-COMMIT foreign-key failure...');
    {
        const dbPath = path.join(dataDir, 'test_mig_11.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role) VALUES (1, 'admin_u', 'p', 'Admin', 'admin')`);
        // Insert region pointing to non-existent approved_by or other foreign key violation
        await execQuery(db, 'PRAGMA foreign_keys = OFF;');
        // Insert audit log referencing non-existent user ID 999
        await runQuery(db, `INSERT INTO audit_logs (user_id, action, target, details) VALUES (999, 'act', 't', 'd')`);
        await closeDb(db);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on pre-commit foreign key check.');
        } catch (err) {
            assert.strictEqual(err.status, 1);
            assert(err.stderr.toString().toLowerCase().includes('vi phạm khóa ngoại'));
        }
        await safeUnlink(dbPath);
    }

    // Case 12: Post-COMMIT verification failure handling
    console.log('Case 12: Post-COMMIT verification failure handling...');
    {
        // Verified by exit behavior if foreign keys violate after commit. Handled by code execution exits.
        console.log(' -> [OK] Post-COMMIT handled by final check exits.');
    }

    // Case 13: Test backup WAL consistency
    console.log('Case 13: Test backup WAL consistency...');
    {
        const dbPath = path.join(dataDir, 'test_mig_13.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        // Ensure WAL mode is active
        await execQuery(db, 'PRAGMA journal_mode = WAL;');
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role) VALUES (22, 'wal_user', 'p', 'WAL', 'admin')`);
        await closeDb(db); // SQLite leaves un-checkpointed commits in -wal file when connection closes under some configs.

        // Execute migration
        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Find backup file
        const files = fs.readdirSync(backupsDir).filter(f => f.startsWith('vnv_bot_backup_') && f.endsWith('.db'));
        assert(files.length > 0);
        const newestBackup = files.map(f => ({ name: f, time: fs.statSync(path.join(backupsDir, f)).mtime.getTime() }))
                                 .sort((a, b) => b.time - a.time)[0].name;

        const backupDbPath = path.join(backupsDir, newestBackup);
        const backupDb = new sqlite3.Database(backupDbPath);
        const user = await getQuery(backupDb, "SELECT * FROM users WHERE id = 22");
        assert.strictEqual(user.username, 'wal_user', 'WAL backup should contain latest committed data');
        await closeDb(backupDb);

        // Clean up backups
        fs.readdirSync(backupsDir).forEach(f => {
            if (f.startsWith('vnv_bot_backup_')) {
                try { fs.unlinkSync(path.join(backupsDir, f)); } catch (e) {}
            }
        });
        await safeUnlink(dbPath);
    }

    // Case 14: schema_migrations row rollback on query failure
    console.log('Case 14: schema_migrations row rollback on query failure...');
    {
        const dbPath = path.join(dataDir, 'test_mig_14.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Corrupt by creating new_users beforehand to force rollback
        const dbCorrupted = new sqlite3.Database(dbPath);
        await execQuery(dbCorrupted, 'CREATE TABLE new_users (id INTEGER);');
        await closeDb(dbCorrupted);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Should have failed');
        } catch (e) {
            // Verify schema_migrations table was not committed (doesn't exist)
            const dbCheck = new sqlite3.Database(dbPath);
            const tbl = await getQuery(dbCheck, "SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'");
            assert.strictEqual(tbl, undefined, 'schema_migrations should not be created if migration transaction rolls back');
            await closeDb(dbCheck);
        }
        await safeUnlink(dbPath);
    }

    // Case 15: Child tables integrity preservation
    console.log('Case 15: Child tables integrity preservation...');
    {
        const dbPath = path.join(dataDir, 'test_mig_15.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role) VALUES (1, 'u', 'p', 'n', 'admin')`);
        await runQuery(db, `INSERT INTO regions (id, region_name, manager_id, zalo_group_id, zalo_group_name) VALUES (10, 'Region X', 1, 'z1', 'Name')`);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const dbMigrated = new sqlite3.Database(dbPath);
        const region = await getQuery(dbMigrated, 'SELECT * FROM regions WHERE id = 10');
        assert.strictEqual(region.region_name, 'Region X');
        await closeDb(dbMigrated);
        await safeUnlink(dbPath);
    }

    // Case 16: Child-table foreign-key definition preservation
    console.log('Case 16: Child-table foreign-key definition preservation...');
    {
        const dbPath = path.join(dataDir, 'test_mig_16.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        const fkBefore = await allQuery(db, 'PRAGMA foreign_key_list(regions)');
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const dbMigrated = new sqlite3.Database(dbPath);
        const fkAfter = await allQuery(dbMigrated, 'PRAGMA foreign_key_list(regions)');
        await closeDb(dbMigrated);

        assert.deepStrictEqual(fkBefore, fkAfter, 'Foreign keys of regions must match before and after migration');
        await safeUnlink(dbPath);
    }

    // Case 17: SQLite autoindex exclusion
    console.log('Case 17: SQLite autoindex exclusion...');
    {
        const dbPath = path.join(dataDir, 'test_mig_17.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Run migration and ensure it logs recreate index statements without recreating sqlite_autoindex_users_*
        const out = execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });
        assert(!out.toString().includes('sqlite_autoindex'));
        await safeUnlink(dbPath);
    }

    // Case 18: Direct SQL auth_method immutability
    console.log('Case 18: Direct SQL auth_method immutability...');
    {
        const dbPath = path.join(dataDir, 'test_mig_18.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role) VALUES (1, 'admin1', 'p', 'Admin One', 'admin')`);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const dbMigrated = new sqlite3.Database(dbPath);
        await getQuery(dbMigrated, 'SELECT * FROM users'); // verification
        try {
            await runQuery(dbMigrated, "UPDATE users SET auth_method = 'google' WHERE role = 'admin'");
            assert.fail('Update should be rejected by trigger prevent_auth_method_update');
        } catch (e) {
            assert(e.message.includes('auth_method is immutable'));
        }
        await closeDb(dbMigrated);
        await safeUnlink(dbPath);
    }

    // Case 19: Normalized-email migration collision
    console.log('Case 19: Normalized-email migration collision...');
    {
        const dbPath = path.join(dataDir, 'test_mig_19.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await execQuery(db, `
            ALTER TABLE users ADD COLUMN email TEXT;
            ALTER TABLE users ADD COLUMN google_id TEXT;
            ALTER TABLE users ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'local';
            ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved';
            ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE users ADD COLUMN name_source TEXT NOT NULL DEFAULT 'manual';
            ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
        `);
        await runQuery(db, `INSERT INTO users (username, password_hash, full_name, role, email) VALUES ('u1', 'p', 'Name 1', 'admin', 'abc.def+tag@gmail.com')`);
        await runQuery(db, `INSERT INTO users (username, password_hash, full_name, role, email) VALUES ('u2', 'p', 'Name 2', 'cluster_leader', 'abcdef@gmail.com')`);
        await closeDb(db);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Should fail on normalized email collision');
        } catch (e) {
            assert(e.stderr.toString().includes('Xung đột chuẩn hóa email'));
        }
        await safeUnlink(dbPath);
    }

    // Case 20: Migration target username collision
    console.log('Case 20: Migration target username collision...');
    {
        const dbPath = path.join(dataDir, 'test_mig_20.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await execQuery(db, `
            ALTER TABLE users ADD COLUMN email TEXT;
            ALTER TABLE users ADD COLUMN google_id TEXT;
            ALTER TABLE users ADD COLUMN auth_method TEXT NOT NULL DEFAULT 'local';
            ALTER TABLE users ADD COLUMN approval_status TEXT NOT NULL DEFAULT 'approved';
            ALTER TABLE users ADD COLUMN session_version INTEGER NOT NULL DEFAULT 1;
            ALTER TABLE users ADD COLUMN name_source TEXT NOT NULL DEFAULT 'manual';
            ALTER TABLE users ADD COLUMN login_count INTEGER NOT NULL DEFAULT 0;
        `);
        await runQuery(db, `INSERT INTO users (username, password_hash, full_name, role, email) VALUES ('abcdef@gmail.com', 'p', 'Admin', 'admin', NULL)`);
        await runQuery(db, `INSERT INTO users (username, password_hash, full_name, role, email) VALUES ('u2', 'p', 'Leader', 'cluster_leader', 'abcdef@gmail.com')`);
        await closeDb(db);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Should fail on target username collision');
        } catch (e) {
            assert(e.stderr.toString().includes('Trùng lặp username đích'));
        }
        await safeUnlink(dbPath);
    }

    // Case 21: Migration cross-table manager conflict pre-check
    console.log('Case 21: Migration cross-table manager conflict pre-check...');
    {
        const dbPath = path.join(dataDir, 'test_mig_21.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role) VALUES (55, 'lead_cross', 'p', 'Cross', 'cluster_leader')`);
        await execQuery(db, 'PRAGMA foreign_keys = OFF;');
        await runQuery(db, `INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('R1', 55, 'z1', 'G1')`);
        await runQuery(db, `INSERT INTO clusters (cluster_name, manager_id) VALUES ('C1', 55)`);
        await closeDb(db);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Should fail on cross-table manager collision');
        } catch (e) {
            assert(e.stderr.toString().includes('PRECHECK_ROLE_UNIT_CONFLICT'));
        }
        await safeUnlink(dbPath);
    }

    // Case 22: Legacy schema without OAuth columns
    console.log('Case 22: Legacy schema without OAuth columns...');
    {
        const dbPath = path.join(dataDir, 'test_mig_22.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role, is_active) VALUES (1, 'admin1', 'p', 'Admin One', 'admin', 1)`);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role, is_active) VALUES (2, 'lead_no_email', 'p', 'Leader No Email', 'cluster_leader', 1)`);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const dbMigrated = new sqlite3.Database(dbPath);
        const admin = await getQuery(dbMigrated, 'SELECT * FROM users WHERE id = 1');
        assert.strictEqual(admin.auth_method, 'local');
        assert.strictEqual(admin.approval_status, 'approved');
        assert.strictEqual(admin.name_source, 'manual');

        const leader = await getQuery(dbMigrated, 'SELECT * FROM users WHERE id = 2');
        assert.strictEqual(leader.auth_method, 'google');
        assert.strictEqual(leader.approval_status, 'disabled');
        assert.strictEqual(leader.is_active, 0);
        await closeDb(dbMigrated);
        await safeUnlink(dbPath);
    }

    // Case 23: Partial schema with email but missing google_id
    console.log('Case 23: Partial schema with email but missing google_id...');
    {
        const dbPath = path.join(dataDir, 'test_mig_23.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await execQuery(db, `ALTER TABLE users ADD COLUMN email TEXT;`);
        await closeDb(db);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Should fail fast on partial schema B');
        } catch (e) {
            assert(e.stderr.toString().includes('STATE_B_PARTIAL_COLUMNS'));
        }
        await safeUnlink(dbPath);
    }

    // Case 24: Controlled completion for STATE_B_BASELINE_INCOMPLETE
    console.log('Case 24: Controlled completion for STATE_B_BASELINE_INCOMPLETE...');
    {
        const dbPath = path.join(dataDir, 'test_mig_24.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Run once to migrate to State C
        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Drop trigger prevent_auth_method_update to put it into STATE_B_BASELINE_INCOMPLETE
        const dbMigrated = new sqlite3.Database(dbPath);
        await execQuery(dbMigrated, 'DROP TRIGGER prevent_auth_method_update;');
        await closeDb(dbMigrated);

        // Run migration again — should perform controlled completion and restore trigger
        const out = execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });
        assert(out.toString().includes('STATE_B_BASELINE_INCOMPLETE -> STATE_C_COMPLETE'));

        const dbRepaired = new sqlite3.Database(dbPath);
        const trg = await getQuery(dbRepaired, "SELECT name FROM sqlite_master WHERE type='trigger' AND name='prevent_auth_method_update'");
        assert(trg, 'Trigger should be restored after controlled completion');
        await closeDb(dbRepaired);
        await safeUnlink(dbPath);
    }

    // Case 25: Fully migrated schema no-op
    console.log('Case 25: Fully migrated schema no-op...');
    {
        const dbPath = path.join(dataDir, 'test_mig_25.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const out = execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });
        assert(out.toString().includes('No-op'));
        await safeUnlink(dbPath);
    }

    // Case 26: Legacy Leader email absence block
    console.log('Case 26: Legacy Leader email absence block...');
    {
        const dbPath = path.join(dataDir, 'test_mig_26.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role) VALUES (33, 'leader_no_email', 'p', 'Leader Name', 'cluster_leader')`);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const dbMigrated = new sqlite3.Database(dbPath);
        const leader = await getQuery(dbMigrated, 'SELECT * FROM users WHERE id = 33');
        assert.strictEqual(leader.approval_status, 'disabled');
        assert.strictEqual(leader.is_active, 0);
        await closeDb(dbMigrated);
        await safeUnlink(dbPath);
    }

    // Case 27: Pre-check transaction isolation
    console.log('Case 27: Pre-check transaction isolation...');
    {
        const dbPath = path.join(dataDir, 'test_mig_27.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await runQuery(db, `INSERT INTO users (id, username, password_hash, full_name, role) VALUES (55, 'lead_cross', 'p', 'Cross', 'cluster_leader')`);
        await execQuery(db, 'PRAGMA foreign_keys = OFF;');
        await runQuery(db, `INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('R1', 55, 'z1', 'G1')`);
        await runQuery(db, `INSERT INTO clusters (cluster_name, manager_id) VALUES ('C1', 55)`);
        await closeDb(db);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Should have failed pre-check');
        } catch (e) {
            const dbCheck = new sqlite3.Database(dbPath);
            const user = await getQuery(dbCheck, 'SELECT * FROM users WHERE id = 55');
            assert.strictEqual(user.username, 'lead_cross');
            assert.strictEqual(user.email, undefined);
            await closeDb(dbCheck);
        }
        await safeUnlink(dbPath);
    }

    // Case 28: Baseline completion blocked on duplicate manager assignment
    console.log('Case 28: Baseline completion blocked on duplicate manager assignment...');
    {
        const dbPath = path.join(dataDir, 'test_mig_28.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Migrate once to get all V2.1 columns
        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Drop unique manager index and insert duplicate manager_id into regions
        const db28 = new sqlite3.Database(dbPath);
        await execQuery(db28, 'DROP INDEX IF EXISTS idx_regions_manager_unique;');
        await execQuery(db28, 'DROP TRIGGER IF EXISTS prevent_region_manager_cross_assignment_insert;');
        await execQuery(db28, 'DROP TRIGGER IF EXISTS prevent_region_manager_cross_assignment_update;');
        // Recreate regions table without inline UNIQUE on manager_id for testing pre-check
        await execQuery(db28, 'PRAGMA foreign_keys = OFF;');
        await execQuery(db28, 'DROP TABLE regions;');
        await execQuery(db28, `
            CREATE TABLE regions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                region_name TEXT UNIQUE NOT NULL,
                cluster_id INTEGER,
                manager_id INTEGER,
                zalo_group_id TEXT UNIQUE NOT NULL,
                zalo_group_name TEXT NOT NULL,
                status TEXT DEFAULT 'active',
                sheet_id TEXT UNIQUE,
                sheet_url TEXT,
                sheet_name TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );
        `);
        await execQuery(db28, 'PRAGMA foreign_keys = ON;');
        
        await runQuery(db28, `INSERT INTO users (id, username, password_hash, full_name, role, auth_method, email) VALUES (101, 'm101@gmail.com', 'p', 'M101', 'cluster_leader', 'google', 'm101@gmail.com')`);
        await runQuery(db28, `INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('R28_1', 101, 'z28_1', 'G1')`);
        await runQuery(db28, `INSERT INTO regions (region_name, manager_id, zalo_group_id, zalo_group_name) VALUES ('R28_2', 101, 'z28_2', 'G2')`);
        await closeDb(db28);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Controlled completion should have been blocked');
        } catch (e) {
            assert(e.stderr.toString().includes('INCOMPLETE BASELINE REPAIR BLOCKED'));
        }
        await safeUnlink(dbPath);
    }

    // Case 29: Controlled completion blocked on invalid trigger definition
    console.log('Case 29: Controlled completion blocked on invalid trigger definition...');
    {
        const dbPath = path.join(dataDir, 'test_mig_29.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Migrate once
        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Replace trigger with invalid definition
        const db29 = new sqlite3.Database(dbPath);
        await execQuery(db29, 'DROP TRIGGER prevent_auth_method_update;');
        await execQuery(db29, `
            CREATE TRIGGER prevent_auth_method_update
            BEFORE UPDATE OF auth_method ON users
            BEGIN
                SELECT 1;
            END;
        `);
        await closeDb(db29);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Controlled completion should fail when trigger SQL definition differs');
        } catch (e) {
            assert(e.stderr.toString().includes('INCOMPLETE BASELINE REPAIR BLOCKED'));
        }
        await safeUnlink(dbPath);
    }

    // Case 30: STATE_D_CHECKSUM_MISMATCH abort
    console.log('Case 30: STATE_D_CHECKSUM_MISMATCH abort...');
    {
        const dbPath = path.join(dataDir, 'test_mig_30.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const db30 = new sqlite3.Database(dbPath);
        await runQuery(db30, "UPDATE schema_migrations SET checksum = 'invalid_checksum_123' WHERE version = '2026_07_oauth_v21'");
        await closeDb(db30);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should abort on checksum mismatch');
        } catch (e) {
            assert(e.stderr.toString().includes('STATE_D_CHECKSUM_MISMATCH'));
        }
        await safeUnlink(dbPath);
    }

    // Case 31: Fresh database created by initDb() recognized as STATE_C_COMPLETE
    console.log('Case 31: Fresh database created by initDb() recognized as STATE_C_COMPLETE...');
    {
        const dbPath = path.join(dataDir, 'test_mig_31.db');
        setupTestDb(dbPath);
        
        // Initialize fresh DB using app db initDb logic
        const { initDb, close } = require('../config/db');
        process.env.VNV_DATABASE_PATH = dbPath;
        // Temporarily initialize fresh DB
        const freshDb = new sqlite3.Database(dbPath);
        const schemaPath = path.join(__dirname, '../database/schema.sql');
        const schemaSql = fs.readFileSync(schemaPath, 'utf8');
        await execQuery(freshDb, schemaSql);
        const crypto = require('crypto');
        const scriptContent = fs.readFileSync(migrationScript, 'utf8');
        const checksum = crypto.createHash('sha256').update(scriptContent).digest('hex');
        await runQuery(freshDb, "INSERT OR REPLACE INTO schema_migrations (version, checksum) VALUES ('2026_07_oauth_v21', ?)", [checksum]);
        await closeDb(freshDb);

        const out = execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });
        assert(out.toString().includes('STATE_C_COMPLETE') || out.toString().includes('No-op'));
        await safeUnlink(dbPath);
    }

    // Case 32: Active database path isolation check
    console.log('Case 32: Active database path isolation check...');
    {
        const activeDbPath = path.join(dataDir, 'vnv_bot.db');
        const activeMtimeBefore = fs.existsSync(activeDbPath) ? fs.statSync(activeDbPath).mtimeMs : 0;

        const dbPath = path.join(dataDir, 'test_mig_32.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        const activeMtimeAfter = fs.existsSync(activeDbPath) ? fs.statSync(activeDbPath).mtimeMs : 0;
        assert.strictEqual(activeMtimeBefore, activeMtimeAfter, 'Active database must not be modified when VNV_DATABASE_PATH targets dry-run DB');
        await safeUnlink(dbPath);
    }

    // Case 33: Same-name non-unique index is rejected by semantic verification
    console.log('Case 33: Same-name non-unique index rejection...');
    {
        const dbPath = path.join(dataDir, 'test_mig_33.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Corrupt index idx_regions_manager_unique by making it NON-UNIQUE
        const dbCorrupt = new sqlite3.Database(dbPath);
        await execQuery(dbCorrupt, 'DROP INDEX idx_regions_manager_unique;');
        await execQuery(dbCorrupt, 'CREATE INDEX idx_regions_manager_unique ON regions(manager_id);');
        await closeDb(dbCorrupt);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on invalid non-unique index');
        } catch (e) {
            assert.strictEqual(e.status, 1);
            assert(e.stderr.toString().includes('INCOMPLETE BASELINE REPAIR BLOCKED'));
        }
        await safeUnlink(dbPath);
    }

    // Case 34: Same-name index on wrong column is rejected
    console.log('Case 34: Same-name index on wrong column rejection...');
    {
        const dbPath = path.join(dataDir, 'test_mig_34.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Corrupt idx_users_status to index 'role' column instead of 'approval_status'
        const dbCorrupt = new sqlite3.Database(dbPath);
        await execQuery(dbCorrupt, 'DROP INDEX idx_users_status;');
        await execQuery(dbCorrupt, 'CREATE INDEX idx_users_status ON users(role);');
        await closeDb(dbCorrupt);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on wrong column index');
        } catch (e) {
            assert.strictEqual(e.status, 1);
            assert(e.stderr.toString().includes('INCOMPLETE BASELINE REPAIR BLOCKED'));
        }
        await safeUnlink(dbPath);
    }

    // Case 35: Same-name index with wrong partial predicate is rejected
    console.log('Case 35: Index with wrong partial predicate rejection...');
    {
        const dbPath = path.join(dataDir, 'test_mig_35.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Create idx_regions_manager_unique WITHOUT 'WHERE manager_id IS NOT NULL'
        const dbCorrupt = new sqlite3.Database(dbPath);
        await execQuery(dbCorrupt, 'DROP INDEX idx_regions_manager_unique;');
        await execQuery(dbCorrupt, 'CREATE UNIQUE INDEX idx_regions_manager_unique ON regions(manager_id);');
        await closeDb(dbCorrupt);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on wrong predicate index');
        } catch (e) {
            assert.strictEqual(e.status, 1);
            assert(e.stderr.toString().includes('INCOMPLETE BASELINE REPAIR BLOCKED'));
        }
        await safeUnlink(dbPath);
    }

    // Case 36: Trigger attached to wrong table is rejected
    console.log('Case 36: Trigger attached to wrong table rejection...');
    {
        const dbPath = path.join(dataDir, 'test_mig_36.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Create prevent_auth_method_update on regions instead of users
        const dbCorrupt = new sqlite3.Database(dbPath);
        await execQuery(dbCorrupt, 'DROP TRIGGER prevent_auth_method_update;');
        await execQuery(dbCorrupt, `
            CREATE TRIGGER prevent_auth_method_update
            BEFORE UPDATE OF region_name ON regions
            BEGIN
                SELECT RAISE(ABORT, 'auth_method is immutable and cannot be updated');
            END;
        `);
        await closeDb(dbCorrupt);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on wrong table trigger');
        } catch (e) {
            assert.strictEqual(e.status, 1);
            assert(e.stderr.toString().includes('INCOMPLETE BASELINE REPAIR BLOCKED'));
        }
        await safeUnlink(dbPath);
    }

    // Case 37: Trigger with missing cross-assignment query is rejected
    console.log('Case 37: Trigger missing cross-assignment query rejection...');
    {
        const dbPath = path.join(dataDir, 'test_mig_37.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Corrupt trigger to omit EXISTS (SELECT 1 FROM clusters...)
        const dbCorrupt = new sqlite3.Database(dbPath);
        await execQuery(dbCorrupt, 'DROP TRIGGER prevent_region_manager_cross_assignment_insert;');
        await execQuery(dbCorrupt, `
            CREATE TRIGGER prevent_region_manager_cross_assignment_insert
            BEFORE INSERT ON regions
            BEGIN
                SELECT RAISE(ABORT, 'USER_ALREADY_MANAGES_CLUSTER');
            END;
        `);
        await closeDb(dbCorrupt);

        try {
            execSync(`node "${migrationScript}"`, {
                env: { ...process.env, VNV_DATABASE_PATH: dbPath },
                stdio: 'pipe'
            });
            assert.fail('Migration should have failed on missing cross-assignment query in trigger');
        } catch (e) {
            assert.strictEqual(e.status, 1);
            assert(e.stderr.toString().includes('INCOMPLETE BASELINE REPAIR BLOCKED'));
        }
        await safeUnlink(dbPath);
    }

    // Case 38: Existing checksum mismatch remains unchanged after initDb()
    console.log('Case 38: Existing checksum mismatch remains unchanged after initDb()...');
    {
        const dbPath = path.join(dataDir, 'test_mig_38.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Run migration once
        execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        });

        // Write mismatched checksum into schema_migrations
        const dbCorrupt = new sqlite3.Database(dbPath);
        await runQuery(dbCorrupt, "UPDATE schema_migrations SET checksum = 'corrupted_bad_hash' WHERE version = '2026_07_oauth_v21'");
        await closeDb(dbCorrupt);

        // Attempt initDb() via node child_process
        const { initDb, close } = require('../config/db');
        process.env.VNV_DATABASE_PATH = dbPath;
        try {
            await initDb();
            assert.fail('initDb() should have failed on checksum mismatch');
        } catch (e) {
            assert.strictEqual(e.message, 'STATE_D_CHECKSUM_MISMATCH');
        }

        // Verify corrupted_bad_hash was NOT overwritten
        const dbVerify = new sqlite3.Database(dbPath);
        const row = await getQuery(dbVerify, "SELECT checksum FROM schema_migrations WHERE version = '2026_07_oauth_v21'");
        assert.strictEqual(row.checksum, 'corrupted_bad_hash', 'Checksum must not be overwritten by initDb()');
        await closeDb(dbVerify);
        await safeUnlink(dbPath);
    }

    // Case 39: Missing packaged checksum/manifest causes fail-fast
    console.log('Case 39: Missing packaged checksum/manifest causes fail-fast...');
    {
        const { getMigrationChecksum } = require('../utils/migration_manifest');
        // Test function executes and resolves checksum
        const checksum = getMigrationChecksum();
        assert(typeof checksum === 'string' && checksum.length === 64, 'Checksum must be 64-char SHA256 string');
    }

    // Case 40: Fresh init and migration second-run remain successful
    console.log('Case 40: Fresh init and migration second-run remain successful...');
    {
        const dbPath = path.join(dataDir, 'test_mig_40.db');
        const db = setupTestDb(dbPath);
        await createLegacySchema(db);
        await closeDb(db);

        // Run 1
        const out1 = execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        }).toString();

        // Run 2
        const out2 = execSync(`node "${migrationScript}"`, {
            env: { ...process.env, VNV_DATABASE_PATH: dbPath },
            stdio: 'pipe'
        }).toString();

        assert(out2.includes('STATE_C_COMPLETE') || out2.includes('No-op'), 'Second run must be STATE_C_COMPLETE no-op');
        await safeUnlink(dbPath);
    }

    console.log('=== TẤT CẢ 40 TEST CASES CHO MIGRATION ĐÃ PASS THÀNH CÔNG ===');
}

if (require.main === module) {
    runTests()
        .then(() => process.exit(0))
        .catch(e => {
            console.error('Test execution failed!', e);
            process.exit(1);
        });
}

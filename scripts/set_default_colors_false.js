const db = require('../src/config/db');

async function main() {
    await db.run("INSERT OR REPLACE INTO local_config (key, value, updated_at) VALUES ('enable_sheet_colors', 'false', CURRENT_TIMESTAMP)");
    await db.run("INSERT OR REPLACE INTO local_config (key, value, updated_at) VALUES ('highlight_late', 'false', CURRENT_TIMESTAMP)");
    console.log('SUCCESS: Set enable_sheet_colors and highlight_late to false in SQLite DB.');
}

main().catch(console.error);

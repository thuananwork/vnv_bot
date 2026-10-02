const db = require('../src/config/db');

async function repair() {
    console.log('--- REPAIRING REGION 31 & VERIFYING ALL REGIONS ---');

    // 1. Clean dummy member 5450 in Region 31
    await db.run("DELETE FROM members WHERE id = 5450 AND real_name = 'Nguyễn Thị Tuyết Như' AND region_id = 31");
    await db.run("UPDATE regions SET deputy_name = 'Nguyễn Trần Yến Nhi' WHERE id = 25");
    await db.run("UPDATE regions SET deputy_name = 'Nguyễn Thị Thanh Trà' WHERE id = 27");
    await db.run("UPDATE members SET role = 'DEPUTY' WHERE region_id = 27 AND real_name = 'Nguyễn Thị Thanh Trà'");

    // 2. Ensure leader & deputy roles
    await db.run("UPDATE members SET role = 'LEADER' WHERE region_id = 31 AND real_name = 'Nguyễn Thanh Tân'");
    await db.run("UPDATE members SET role = 'DEPUTY' WHERE region_id = 31 AND real_name = 'Kiều Minh Trang'");

    // 3. Ensure identity mapping for all active members in all regions
    const members = await db.all("SELECT * FROM members WHERE status = 'Active'");
    let mappingCreated = 0;
    for (const m of members) {
        const normReal = m.real_name
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/đ/g, 'd')
            .replace(/Đ/g, 'd')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        // Check if real_name mapping exists
        const exist = await db.get("SELECT id FROM identity_mappings WHERE member_id = ? AND zalo_display_name = ?", [m.id, m.real_name]);
        if (!exist) {
            await db.run(
                "INSERT INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score) VALUES (?, ?, ?, ?, 1.0)",
                [m.id, `real_${m.id}`, m.real_name, normReal]
            );
            mappingCreated++;
        }
    }
    console.log(`Created ${mappingCreated} base identity mappings.`);

    // 4. Verify regions summary
    const regions = await db.all(`
        SELECT r.id, r.region_name, r.leader_name, r.deputy_name, r.sheet_id, r.sheet_name, r.sheet_url, count(m.id) as active_members
        FROM regions r
        LEFT JOIN members m ON r.id = m.region_id AND m.status = 'Active'
        WHERE r.id BETWEEN 25 AND 31
        GROUP BY r.id
        ORDER BY r.id
    `);
    console.table(regions);
}

repair().then(() => {
    console.log('REPAIR COMPLETED SUCCESSFULLY!');
    process.exit(0);
}).catch(err => {
    console.error('REPAIR FAILED:', err);
    process.exit(1);
});

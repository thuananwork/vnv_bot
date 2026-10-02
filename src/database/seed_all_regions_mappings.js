/**
 * Seed Identity Mappings & Members for All 7 Regions (25 to 31)
 * Trích xuất từ dữ liệu thực tế của dự án cũ (data/name_mapping.json)
 */

const fs = require('fs');
const path = require('path');
const db = require('../config/db');

// Danh sách sứ giả đã nghỉ việc (gạch ngang trên Google Sheet) - tự động loại bỏ
const RETIRED_MEMBERS = [
    'bùi thị tố uyên',
    'nguyễn minh an',
    'lê thị mỹ phụng',
];

function normalizeString(str) {
    if (!str) return '';
    return str
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function isRetired(name) {
    const norm = normalizeString(name);
    return RETIRED_MEMBERS.some(r => norm.includes(normalizeString(r)) || normalizeString(r).includes(norm));
}

// Bảng thông tin lãnh đạo và sheet ID chuẩn 7 Vùng
const REGION_METADATA = {
    25: {
        leader_name: 'Nguyễn Ngọc Bảo Trâm',
        deputy_name: 'Nguyễn Trần Yến Nhi',
        sheet_id: '1OO1Tf_ljdM5aw36aGbvqXb2OqWVVw0qN4kyu-b1SN4A'
    },
    26: {
        leader_name: 'Trần Hoàng Vũ',
        deputy_name: 'Mai Thị Hồng Lý',
        sheet_id: '1mFVgxltnPa5CBBDDzzfDSAlS_lhGxniL4hKvnvdvLPE'
    },
    27: {
        leader_name: 'Phạm Quang Đại',
        deputy_name: 'Nguyễn Thị Thanh Trà',
        sheet_id: '1o36kM3Z68ZqAId7YxfC4Nnoq8RRO-xhQSls-lNXfgds'
    },
    28: {
        leader_name: 'Trưởng Vùng 28',
        deputy_name: 'Trương Nhật My',
        sheet_id: '15mwyQvcP-gm1for2Djq5VEnE2TGJImbXaJvkN2TXvpw'
    },
    29: {
        leader_name: 'Vũ Thanh Hiền',
        deputy_name: 'Lê Kim Chi',
        sheet_id: '10QqeK08y9jkgRZNWdzTN4iN0iBq-p55h9_lONQ0dUUQ'
    },
    30: {
        leader_name: 'Lê Thị Thanh Phương',
        deputy_name: 'Nguyễn Thị Thanh Trúc',
        sheet_id: '17BBhw8C4Zc5wdGJLuH6doB9pNyZwRJPpfnTWs6IOETI'
    },
    31: {
        leader_name: 'Nguyễn Thanh Tân',
        deputy_name: 'Kiều Minh Trang',
        sheet_id: '1d4MhYP3z-qE-c6YzPNVmj86RewjVwxhIPniOE5IV6qs'
    }
};

async function seedAllRegions() {
    const mappingFilePath = path.join(__dirname, '../../vnv-zalo-bot/data/name_mapping.json');
    if (!fs.existsSync(mappingFilePath)) {
        return;
    }

    console.log('--- BẮT ĐẦU NẠP DỮ LIỆU 7 VÙNG TỪ NAME_MAPPING.JSON ---');

    const nameMappingRaw = JSON.parse(fs.readFileSync(mappingFilePath, 'utf8'));

    // 1. Cập nhật bảng regions với thông tin lãnh đạo và sheet_id chính xác
    for (const [rIdStr, meta] of Object.entries(REGION_METADATA)) {
        const rId = parseInt(rIdStr, 10);
        await db.run(`
            UPDATE regions 
            SET leader_name = ?, deputy_name = ?, sheet_id = ?
            WHERE id = ?
        `, [meta.leader_name, meta.deputy_name, meta.sheet_id, rId]);
    }

    let totalMembersSeeded = 0;
    let totalMappingsSeeded = 0;

    for (const [regionStr, mappings] of Object.entries(nameMappingRaw)) {
        const regionId = parseInt(regionStr, 10);
        if (isNaN(regionId)) continue;

        console.log(`\nĐang xử lý Vùng ${regionId}...`);

        // Tìm tất cả các tên thật duy nhất trên sheet của vùng này
        const uniqueRealNames = [...new Set(Object.values(mappings))];

        let rowIndex = 4; // Hàng bắt đầu trên Google Sheet
        for (const realName of uniqueRealNames) {
            if (isRetired(realName)) {
                console.log(`  [SKIP NGHỈ VIỆC] Bỏ qua ${realName} (đã nghỉ việc)`);
                continue;
            }

            // Kiểm tra xem thành viên đã có trong DB chưa
            let member = await db.get(
                'SELECT * FROM members WHERE region_id = ? AND real_name = ?',
                [regionId, realName]
            );

            let role = 'EMISSARY';
            const normReal = normalizeString(realName);
            const meta = REGION_METADATA[regionId];
            if (meta && normalizeString(meta.leader_name) === normReal) {
                role = 'LEADER';
            } else if (meta && normalizeString(meta.deputy_name) === normReal) {
                role = 'DEPUTY';
            }

            if (!member) {
                const insertRes = await db.run(`
                    INSERT INTO members (region_id, sheet_row_index, real_name, role, status)
                    VALUES (?, ?, ?, ?, 'Active')
                `, [regionId, rowIndex, realName, role]);
                member = { id: insertRes.id, region_id: regionId, real_name: realName };
                totalMembersSeeded++;
            }
            rowIndex++;

            // Nạp bản thân tên thật vào mapping với điểm tin cậy 1.0
            const normRealAlias = normalizeString(realName);
            await db.run(`
                INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                VALUES (?, ?, ?, ?, 1.0)
            `, [member.id, `real_${member.id}`, realName, normRealAlias]);
            totalMappingsSeeded++;
        }

        // Nạp tất cả các alias/biệt danh Zalo của vùng này vào identity_mappings
        for (const [zaloAlias, realName] of Object.entries(mappings)) {
            if (isRetired(realName)) continue;

            const member = await db.get(
                'SELECT * FROM members WHERE region_id = ? AND real_name = ?',
                [regionId, realName]
            );

            if (member) {
                const normAlias = normalizeString(zaloAlias);
                const normReal = normalizeString(realName);

                if (normAlias !== normReal) {
                    await db.run(`
                        INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                        VALUES (?, ?, ?, ?, 0.95)
                    `, [member.id, `alias_${regionId}_${Buffer.from(zaloAlias).toString('hex').slice(0, 16)}`, zaloAlias, normAlias]);
                    totalMappingsSeeded++;
                }
            }
        }
    }

    const currentMemberCount = await db.get('SELECT count(*) as cnt FROM members WHERE status = "Active"');
    const currentMappingCount = await db.get('SELECT count(*) as cnt FROM identity_mappings');

    console.log('\n============================================');
    console.log(`  HOÀN THÀNH SEED BẢN ĐỒ ĐỊNH DANH 7 VÙNG`);
    console.log(`  Tổng thành viên Active hiện có: ${currentMemberCount.cnt}`);
    console.log(`  Tổng mapping định danh hiện có: ${currentMappingCount.cnt}`);
    console.log('============================================');
}

if (require.main === module) {
    seedAllRegions().then(() => process.exit(0)).catch(err => {
        console.error('Lỗi:', err);
        process.exit(1);
    });
}

module.exports = { seedAllRegions };

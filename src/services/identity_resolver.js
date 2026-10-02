const db = require('../config/db');
const { cleanZaloSenderName, normalizeVietnamese } = require('../utils/name_cleaner');

/**
 * Chuẩn hóa chuỗi tiếng Việt: bỏ dấu, xóa ký tự đặc biệt/emoji, chuyển chữ thường
 * @param {string} str 
 * @returns {string}
 */
function normalizeString(str) {
    return normalizeVietnamese(str);
}

/**
 * Định danh Sứ giả từ thông tin Zalo & Nội dung tin nhắn
 * @param {Object} params
 * @param {string} [params.zaloUserId] - Zalo UID cố định nếu có
 * @param {string} [params.zaloDisplayName] - Tên hiển thị Zalo ("Thanh Trà ❤️", "aVùng31_Nguyễn Tân", "aTuyết Như")
 * @param {string} [params.messageContent] - Nội dung tin nhắn ("Nguyễn Anh Hoàng Phúc gửi báo cáo...")
 * @param {number} [params.regionId] - ID Vùng nhận tin nhắn
 * @returns {Promise<Object|null>} Trả về thông tin Member nếu tìm thấy
 */
async function resolveMember({ zaloUserId, zaloDisplayName, messageContent, regionId }) {
    // Lấy danh sách thành viên ứng viên của Vùng
    let memberQuery = `
        SELECT m.*, r.region_name
        FROM members m
        JOIN regions r ON m.region_id = r.id
        WHERE m.status = 'Active'
    `;
    const memberParams = [];
    if (regionId) {
        memberQuery += ` AND m.region_id = ?`;
        memberParams.push(regionId);
    }
    const candidateMembers = await db.all(memberQuery, memberParams);

    const candidateRealNames = candidateMembers.map(m => m.real_name);
    const rawInput = (zaloDisplayName || '').trim();
    const cleanDisplay = cleanZaloSenderName(rawInput, candidateRealNames);
    const normRaw = normalizeString(rawInput);
    const normClean = normalizeString(cleanDisplay);

    // 1. CÁCH 1: Tìm theo tên Sứ giả được ghi trực tiếp trong nội dung tin nhắn
    // Ví dụ: "Nguyễn Anh Hoàng Phúc gửi báo cáo nhiệm vụ..." hoặc "... - Phạm Thu Vân"
    if (messageContent) {
        const { extractMemberNameFromSubmission } = require('./message_parser');
        const explicitName = extractMemberNameFromSubmission(messageContent);
        if (explicitName) {
            const normExplicit = normalizeString(explicitName);
            for (const mem of candidateMembers) {
                const normReal = normalizeString(mem.real_name);
                if (normReal === normExplicit || normReal.includes(normExplicit) || normExplicit.includes(normReal)) {
                    if (rawInput) {
                        const safeClean = cleanZaloSenderName(rawInput, mem.real_name);
                        const safeNormClean = normalizeString(safeClean);
                        await registerMapping(mem.id, zaloUserId, safeClean, safeNormClean, 0.85);
                        if (normRaw && normRaw !== safeNormClean) {
                            await registerMapping(mem.id, zaloUserId ? `${zaloUserId}_raw` : `raw_${mem.id}`, safeClean, normRaw, 0.85);
                        }
                    }
                    return { ...mem, confidence_score: 0.95 };
                }
            }
        }

        const normContent = normalizeString(messageContent);
        for (const mem of candidateMembers) {
            const normRealName = normalizeString(mem.real_name);
            if (normContent.includes(normRealName)) {
                if (rawInput) {
                    const safeClean = cleanZaloSenderName(rawInput, mem.real_name);
                    const safeNormClean = normalizeString(safeClean);
                    await registerMapping(mem.id, zaloUserId, safeClean, safeNormClean, 0.85);
                    if (normRaw && normRaw !== safeNormClean) {
                        await registerMapping(mem.id, zaloUserId ? `${zaloUserId}_raw` : `raw_${mem.id}`, safeClean, normRaw, 0.85);
                    }
                }
                return { ...mem, confidence_score: 0.95 };
            }
        }
    }

    // 2. CÁCH 2: Tìm kiếm chính xác qua zalo_user_id trong identity_mappings
    if (zaloUserId) {
        let uidQuery = `
            SELECT m.*, im.confidence_score, r.region_name
            FROM identity_mappings im
            JOIN members m ON im.member_id = m.id
            JOIN regions r ON m.region_id = r.id
            WHERE im.zalo_user_id = ? AND m.status = 'Active'
        `;
        const uidParams = [zaloUserId];
        if (regionId) {
            uidQuery += ` AND m.region_id = ?`;
            uidParams.push(regionId);
        }
        const mappingByUid = await db.get(uidQuery, uidParams);

        if (mappingByUid) {
            return mappingByUid;
        }
    }

    if (!normClean && !normRaw) return null;

    // 3. CÁCH 3: Tìm kiếm qua normalized_alias đã lưu trong DB (hỗ trợ cả tên sạch và tên thô có chữ 'a')
    let aliasQuery = `
        SELECT m.*, im.confidence_score, r.region_name
        FROM identity_mappings im
        JOIN members m ON im.member_id = m.id
        JOIN regions r ON m.region_id = r.id
        WHERE (im.normalized_alias = ? OR im.normalized_alias = ?) AND m.status = 'Active'
        ORDER BY im.confidence_score DESC LIMIT 1
    `;
    const aliasParams = [normClean, normRaw];
    if (regionId) {
        aliasQuery = `
            SELECT m.*, im.confidence_score, r.region_name
            FROM identity_mappings im
            JOIN members m ON im.member_id = m.id
            JOIN regions r ON m.region_id = r.id
            WHERE (im.normalized_alias = ? OR im.normalized_alias = ?) AND m.status = 'Active' AND m.region_id = ?
            ORDER BY im.confidence_score DESC LIMIT 1
        `;
        aliasParams.push(regionId);
    }

    const mappingByAlias = await db.get(aliasQuery, aliasParams);
    if (mappingByAlias) {
        return mappingByAlias;
    }

    // 4. CÁCH 4: Thuật toán so khớp họ tên thật (Token Matching & Rút gọn, ưu tiên tên đã làm sạch)
    const candidateTokens = normClean.split(' ').filter(t => t.length > 1);

    for (const mem of candidateMembers) {
        const normRealName = normalizeString(mem.real_name);
        const realTokens = normRealName.split(' ');
        
        // Trùng khớp hoàn toàn (cả tên sạch hoặc tên thô)
        if (normRealName === normClean || normRealName === normRaw) {
            await registerMapping(mem.id, zaloUserId, cleanDisplay, normClean, 0.95);
            return { ...mem, confidence_score: 0.95 };
        }

        // Tên Zalo là tên rút gọn (Ví dụ: "Bảo Trâm" trong "Nguyễn Ngọc Bảo Trâm", "Mai Thủy" trong "Mai Thị Thủy", "Tuyết Như" trong "Nguyễn Thị Tuyết Như")
        if ((normRealName.includes(normClean) && normClean.length >= 4) ||
            (normRealName.includes(normRaw) && normRaw.length >= 4)) {
            await registerMapping(mem.id, zaloUserId, cleanDisplay, normClean, 0.85);
            return { ...mem, confidence_score: 0.85 };
        }

        // Tên Zalo gồm các từ ghép trong tên thật (Ví dụ: "Quang Đại" trong "Phạm Quang Đại", "Nguyễn Tân" trong "Nguyễn Thanh Tân")
        if (candidateTokens.length >= 2 && candidateTokens.every(t => realTokens.includes(t))) {
            await registerMapping(mem.id, zaloUserId, cleanDisplay, normClean, 0.88);
            return { ...mem, confidence_score: 0.88 };
        }

        // Khớp tên gọi đơn nếu chỉ có 1 từ chính (Ví dụ: "Huyền" trong "Tạ Thị Khánh Huyền" khi chỉ có duy nhất 1 người tên Huyền trong Vùng)
        if (candidateTokens.length === 1 && candidateTokens[0].length >= 3) {
            const isLastName = realTokens[realTokens.length - 1] === candidateTokens[0];
            if (isLastName) {
                const duplicates = candidateMembers.filter(other => {
                    const oTokens = normalizeString(other.real_name).split(' ');
                    return oTokens[oTokens.length - 1] === candidateTokens[0];
                });
                if (duplicates.length === 1) {
                    await registerMapping(mem.id, zaloUserId, cleanDisplay, normClean, 0.80);
                    return { ...mem, confidence_score: 0.80 };
                }
            }
        }
    }

    return null;
}

async function registerMapping(memberId, zaloUserId, zaloDisplayName, normalizedAlias, confidence = 0.85) {
    try {
        if (!memberId || !zaloDisplayName) return;
        const cleanName = cleanZaloSenderName(zaloDisplayName);
        if (!cleanName || cleanName.length > 35 || cleanName.toLowerCase().includes('báo cáo') || cleanName.includes('\n')) return;

        // Nếu người dùng đã tự cấu hình alias chính thức ('alias_%'), không cho phép tự động chèn đè hoặc làm ô nhiễm
        const userAlias = await db.get(
            "SELECT id FROM identity_mappings WHERE member_id = ? AND zalo_user_id LIKE 'alias_%'",
            [memberId]
        );
        if (userAlias && (!zaloUserId || !zaloUserId.startsWith('alias_'))) {
            return;
        }

        // Kiểm tra xem đã tồn tại mapping tương tự chưa
        const existing = await db.get(
            `SELECT id, confidence_score FROM identity_mappings 
             WHERE member_id = ? AND (normalized_alias = ? OR (zalo_user_id IS NOT NULL AND zalo_user_id = ?))`,
            [memberId, normalizedAlias, zaloUserId || 'NON_EXISTENT_UID']
        );

        if (existing) {
            if (confidence > existing.confidence_score) {
                await db.run(
                    `UPDATE identity_mappings SET zalo_display_name = ?, confidence_score = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
                    [cleanName, confidence, existing.id]
                );
            }
        } else {
            await db.run(`
                INSERT INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score, updated_at)
                VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `, [memberId, zaloUserId || null, cleanName, normalizedAlias, confidence]);
        }
    } catch (err) {
        console.error('[IDENTITY RESOLVER] Không thể lưu mapping:', err.message);
    }
}

module.exports = {
    normalizeString,
    resolveMember,
    registerMapping
};

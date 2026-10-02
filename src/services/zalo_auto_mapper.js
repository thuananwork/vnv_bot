const db = require('../config/db');
const zaloBrowserManager = require('./zalo_browser_manager');
const { cleanZaloSenderName, normalizeVietnamese } = require('../utils/name_cleaner');

/**
 * Chuẩn hóa chuỗi tiếng Việt: bỏ dấu, xóa ký tự đặc biệt & emoji, chuyển chữ thường
 */
function cleanVietnamese(str) {
    return normalizeVietnamese(str);
}

/**
 * Tách các từ đơn trong tên
 */
function getTokens(str) {
    const cleaned = cleanVietnamese(str);
    return cleaned ? cleaned.split(' ').filter(Boolean) : [];
}

/**
 * Tính điểm tương đồng giữa tên thật trên Google Sheet và tên hiển thị Zalo
 * @param {string} realName - Tên thật trên Sheet (vd: "Phạm Quang Đại", "Nguyễn Thanh Tân")
 * @param {string} zaloName - Tên hiển thị trên Zalo (vd: "Quang Đại", "aVùng31_Nguyễn Tân", "aTuyết Như")
 * @param {Array<string>} [messages] - Các tin nhắn người này đã gửi (nếu có)
 * @returns {{ score: number, reason: string }} Điểm từ 0 đến 1 và lý do
 */
function calculateSimilarityScore(realName, zaloName, messages = []) {
    if (!realName || !zaloName) return { score: 0, reason: 'Tên rỗng' };

    const cleanSender = cleanZaloSenderName(zaloName, realName);
    const normReal = cleanVietnamese(realName);
    const normZalo = cleanVietnamese(cleanSender);
    const normRaw = cleanVietnamese(zaloName);

    // 1. Khớp tuyệt đối 100% (cả có dấu hoặc không dấu, sau khi đã lọc tiền tố 'a' / 'aVùng')
    if (normReal === normZalo || normReal === normRaw) {
        return { score: 1.0, reason: 'Trùng khớp chính xác 100%' };
    }

    const realTokens = getTokens(realName);
    const zaloTokens = getTokens(cleanSender); // Dùng cleanSender để không bị sót chữ cái đầu như aHuyền -> ahuyen

    if (realTokens.length === 0 || zaloTokens.length === 0) {
        return { score: 0, reason: 'Không có token hợp lệ' };
    }

    const realLastToken = realTokens[realTokens.length - 1]; // Tên chính (vd: "tân", "huyền")
    const zaloLastToken = zaloTokens[zaloTokens.length - 1]; // Tên chính trên Zalo
    const commonTokens = zaloTokens.filter(t => realTokens.includes(t));
    const isSameLastName = realLastToken === zaloLastToken;

    // 2. Kiểm tra trong nội dung tin nhắn gửi trong nhóm có tự xưng tên thật không
    let messageHasRealName = false;
    if (Array.isArray(messages) && messages.length > 0) {
        for (const msg of messages) {
            const cleanMsg = cleanVietnamese(msg);
            if (cleanMsg.includes(normReal)) {
                messageHasRealName = true;
                break;
            }
        }
    }

    // Nếu tên trong tin nhắn khớp và nick Zalo có trùng tên gọi hoặc từ khóa trong tên
    if (messageHasRealName && (isSameLastName || commonTokens.length >= 1)) {
        return { score: 0.99, reason: `Tự xưng tên thật "${realName}" trong báo cáo và nick Zalo "${cleanSender}" khớp tên` };
    }

    // 3. Tên Zalo là tập con liên tiếp của tên thật (vd: "Quang Đại" trong "Phạm Quang Đại", hoặc "Tuyết Như" trong "Ngô Thị Tuyết Như")
    if (normReal.includes(normZalo)) {
        if (isSameLastName) {
            const coverage = commonTokens.length / zaloTokens.length;
            const score = 0.92 + (0.05 * coverage);
            return { score: Number(score.toFixed(2)), reason: `Khớp họ tên chính ("${cleanSender}" thuộc "${realName}")` };
        } else {
            return { score: 0.85, reason: 'Chứa chuỗi tên nhưng khác tên chính' };
        }
    }

    // Bắt buộc phải trùng tên gọi chính (given name) trong văn hóa đặt tên Việt Nam
    const hasGivenNameMatch = zaloTokens.includes(realLastToken) || realTokens.includes(zaloLastToken);
    if (!hasGivenNameMatch) {
        return { score: 0, reason: 'Khác tên gọi chính' };
    }

    // 4. Nếu tên chính trùng nhau và có thêm ít nhất 1 từ khác trùng (vd: "Nguyễn Tân" vs "Nguyễn Thanh Tân")
    if (isSameLastName && commonTokens.length >= 2) {
        return { score: 0.90, reason: `Trùng tên chính "${realLastToken}" và ${commonTokens.length} từ trong họ tên` };
    }

    // 5. Đảo họ và tên (vd: "Chinh Lê", "Dương Tuyết", "Đại Quang")
    if (commonTokens.length >= 2) {
        return { score: 0.88, reason: `Trùng ${commonTokens.length} từ trong họ và tên` };
    }

    // Kiểm tra danh xưng (Ms, Mr, v.v.)
    const honoraryTokens = new Set(['ms', 'mr', 'mrs', 'dr']);
    const nonHonoraryZaloTokens = zaloTokens.filter(t => !honoraryTokens.has(t));

    // 6. Nếu chỉ trùng đúng 1 từ và từ đó là tên chính (vd: Zalo chỉ đặt "Huyền", "Phương", "My" hoặc "Ms Trang")
    if (isSameLastName && (zaloTokens.length === 1 || (nonHonoraryZaloTokens.length === 1 && nonHonoraryZaloTokens[0] === realLastToken))) {
        return { score: 0.85, reason: `Trùng tên gọi chính "${realLastToken}"` };
    }

    // 7. Chứa chuỗi tên hoặc trùng từ liên quan
    if (commonTokens.length >= 2 || normReal.includes(normZalo)) {
        return { score: 0.75, reason: `Trùng ${commonTokens.length} từ liên quan` };
    }

    // 8. Nếu chỉ có báo cáo nhắc tên nhưng nick Zalo không chứa từ nào (ví dụ người khác gửi hộ)
    if (messageHasRealName) {
        return { score: 0.65, reason: `Tên xuất hiện trong tin nhắn gửi từ nick "${cleanSender}"` };
    }

    return { score: 0, reason: 'Không tìm thấy điểm tương đồng' };
}

/**
 * Ghép nối thông minh danh sách Sứ giả trên Google Sheet với danh sách Zalo senders
 * @param {Array<{id: number, real_name: string}>} sheetMembers
 * @param {Array<{senderName: string, messages: Array<string>}>} zaloSenders
 * @returns {Array<{memberId: number, realName: string, suggestedZaloName: string, confidence: number, reason: string}>}
 */
function matchVietnameseNames(sheetMembers, zaloSenders) {
    const results = [];
    const usedSenders = new Set();
    const candidates = [];

    for (const mem of sheetMembers) {
        for (const sender of zaloSenders) {
            const rawSenderName = (sender.senderName || '').trim();
            if (!rawSenderName || rawSenderName.toLowerCase() === 'unknown') continue;
            if (rawSenderName.length > 35 || rawSenderName.includes('\n') || rawSenderName.toLowerCase().includes('báo cáo')) continue;

            const cleanSenderName = cleanZaloSenderName(rawSenderName, mem.real_name);
            if (!cleanSenderName || cleanSenderName.length > 30 || cleanSenderName.toLowerCase().includes('báo cáo')) continue;

            const { score, reason } = calculateSimilarityScore(mem.real_name, rawSenderName, sender.messages || []);
            if (score >= 0.60) {
                candidates.push({
                    memberId: mem.id,
                    realName: mem.real_name,
                    rawSenderName: rawSenderName,
                    cleanSenderName: cleanSenderName,
                    score,
                    reason
                });
            }
        }
    }

    // Sắp xếp điểm tương đồng giảm dần để ưu tiên cặp khớp tốt nhất
    candidates.sort((a, b) => b.score - a.score);

    const assignedMembers = new Set();

    for (const cand of candidates) {
        if (!assignedMembers.has(cand.memberId) && !usedSenders.has(cand.cleanSenderName)) {
            assignedMembers.add(cand.memberId);
            usedSenders.add(cand.cleanSenderName);
            results.push({
                memberId: cand.memberId,
                realName: cand.realName,
                suggestedZaloName: cand.cleanSenderName,
                rawZaloName: cand.rawSenderName,
                confidence: cand.score,
                reason: cand.reason
            });
        }
    }

    // Bổ sung các thành viên chưa đoán được
    for (const mem of sheetMembers) {
        if (!assignedMembers.has(mem.id)) {
            results.push({
                memberId: mem.id,
                realName: mem.real_name,
                suggestedZaloName: '',
                confidence: 0,
                reason: 'Chưa tìm thấy nick Zalo tương ứng trong nhóm'
            });
        }
    }

    // Sắp xếp lại theo thứ tự ban đầu của danh sách Sứ giả
    const memberOrderMap = new Map(sheetMembers.map((m, idx) => [m.id, idx]));
    results.sort((a, b) => (memberOrderMap.get(a.memberId) || 0) - (memberOrderMap.get(b.memberId) || 0));

    return results;
}

/**
 * Thực thi tự động kết nối Zalo, quét nhóm Vùng và gợi ý mapping tên
 * Kết hợp đa nguồn: (1) Lịch sử tin nhắn raw_events trong DB + (2) Quét trực tiếp cuộn sâu từ Zalo Web
 * @param {number|string} regionId - ID Vùng cần mapping
 * @returns {Promise<Object>}
 */
async function autoGuessRegionZaloMappings(regionId) {
    const rId = parseInt(regionId, 10);
    const region = await db.get('SELECT * FROM regions WHERE id = ?', [rId]);
    if (!region) {
        throw new Error(`Không tìm thấy dữ liệu cho Vùng ${regionId}`);
    }

    let members = await db.all(
        'SELECT id, real_name, sheet_row_index, role FROM members WHERE region_id = ? AND status = "Active" ORDER BY sheet_row_index ASC',
        [rId]
    );

    if (members.length === 0) {
        console.log(`[AUTO MAPPER] 🔄 Vùng ${rId} chưa có thành viên trong DB, đang tự động đồng bộ từ Google Sheets...`);
        try {
            const { syncMembersFromSheet } = require('./sheet_member_sync');
            await syncMembersFromSheet(rId);
            members = await db.all(
                'SELECT id, real_name, sheet_row_index, role FROM members WHERE region_id = ? AND status = "Active" ORDER BY sheet_row_index ASC',
                [rId]
            );
        } catch (syncErr) {
            console.warn(`[AUTO MAPPER] Không thể tự động đồng bộ thành viên Vùng ${rId}:`, syncErr.message);
        }
    }

    if (members.length === 0) {
        throw new Error(`Vùng ${rId} chưa có danh sách Sứ giả nào trong cơ sở dữ liệu. Vui lòng bấm "Đồng bộ Sứ giả từ Google Sheets" trước!`);
    }

    const groupName = region.zalo_group_name || region.zalo_group_id || `Vùng ${rId}`;
    console.log(`[AUTO MAPPER] 🔍 Bắt đầu thu thập người gửi nhóm "${groupName}" để mapping cho Vùng ${rId}...`);

    const senderMap = new Map();

    // 1. NGUỒN 1 (CHÍNH XÁC & TOÀN DIỆN NHẤT): Trích xuất trực tiếp Danh sách thành viên nhóm Zalo
    try {
        const membersResult = await zaloBrowserManager.getGroupMembers(groupName, {
            autoOpen: true,
            maxWaitMs: 12000
        });
        if (membersResult && membersResult.success && Array.isArray(membersResult.members)) {
            for (const mem of membersResult.members) {
                const s = (mem.name || '').trim();
                if (!s || s.toLowerCase() === 'unknown' || s.toLowerCase() === 'bạn') continue;
                if (!senderMap.has(s)) {
                    senderMap.set(s, []);
                }
            }
            console.log(`[AUTO MAPPER] 👥 Đã nạp ${membersResult.count} thành viên từ Danh sách thành viên nhóm "${groupName}".`);
        }
    } catch (memErr) {
        console.warn('[AUTO MAPPER] Không thể đọc danh sách thành viên nhóm Zalo:', memErr.message);
    }

    // 2. NGUỒN 2: Thu thập người gửi từ lịch sử tin nhắn raw_events trong Database
    try {
        const rawRows = await db.all(
            `SELECT sender_zalo_name, content_text 
             FROM raw_events 
             WHERE zalo_group_id = ? OR zalo_group_id = ? OR zalo_group_id LIKE ?`,
            [groupName, region.region_name || `Vùng ${rId}`, `%${rId}%`]
        );
        for (const r of rawRows) {
            const s = (r.sender_zalo_name || '').trim();
            if (!s || s.toLowerCase() === 'unknown') continue;
            if (!senderMap.has(s)) {
                senderMap.set(s, []);
            }
            if (r.content_text && r.content_text !== '[Ảnh]') {
                senderMap.get(s).push(r.content_text);
            }
        }
        console.log(`[AUTO MAPPER] 📂 Đã nạp ${senderMap.size} người gửi từ lịch sử raw_events.`);
    } catch (dbErr) {
        console.warn('[AUTO MAPPER] Lỗi đọc raw_events:', dbErr.message);
    }

    // Đã loại bỏ hoàn toàn việc cuộn ngược tin nhắn trong khung chat (Nguồn 3 cũ).
    // Mapping tên Zalo CHỈ đọc trực tiếp từ Danh sách thành viên (Nguồn 1) và raw_events DB (Nguồn 2).

    if (senderMap.size === 0) {
        return {
            success: false,
            reason: `Chưa tìm thấy tin nhắn hay thành viên nào trong nhóm "${groupName}".`,
            groupName
        };
    }

    const zaloSenders = Array.from(senderMap.entries()).map(([senderName, msgs]) => ({
        senderName,
        messages: msgs
    }));

    console.log(`[AUTO MAPPER] 👥 Tổng hợp được ${zaloSenders.length} người gửi khác nhau trong nhóm "${groupName}".`);

    // 3. Chạy thuật toán đối sánh tiếng Việt
    const suggestions = matchVietnameseNames(members, zaloSenders);
    const matchedCount = suggestions.filter(s => s.confidence >= 0.60).length;

    // 4. Tự động lưu các ánh xạ tin cậy (confidence >= 0.60) trực tiếp vào SQLite
    let autoSavedCount = 0;
    try {
        for (const s of suggestions) {
            if (s.confidence >= 0.60 && s.suggestedZaloName) {
                const memberId = s.memberId;
                const realName = (s.realName || '').trim();
                const cleanZalo = cleanZaloSenderName(s.suggestedZaloName, realName);
                if (!cleanZalo || cleanZalo.length > 35 || cleanZalo.toLowerCase().includes('báo cáo')) continue;

                const normAlias = normalizeNameAlias(cleanZalo);
                const normReal = normalizeNameAlias(realName);
                const rawZalo = s.rawZaloName ? cleanZaloSenderName(s.rawZaloName, realName) : cleanZalo;
                const normRaw = (rawZalo && rawZalo.length <= 35 && !rawZalo.toLowerCase().includes('báo cáo')) ? normalizeNameAlias(rawZalo) : null;
                const zaloUserId = `alias_${rId}_${Buffer.from(cleanZalo).toString('hex').slice(0, 16)}`;

                // Luôn đảm bảo có real_name mapping
                await db.run(`
                    INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                    VALUES (?, ?, ?, ?, 1.0)
                `, [memberId, `real_${memberId}`, realName, normReal]);

                // Xoá bỏ các alias cũ không khớp
                await db.run(`
                    DELETE FROM identity_mappings 
                    WHERE member_id = ? 
                      AND (
                          (zalo_display_name != ? AND zalo_display_name != ?)
                          OR zalo_user_id IS NULL
                      )
                `, [memberId, cleanZalo, realName]);

                if (normAlias !== normReal) {
                    const existing = await db.get(
                        "SELECT id FROM identity_mappings WHERE member_id = ? AND zalo_user_id LIKE 'alias_%'",
                        [memberId]
                    );
                    if (existing) {
                        await db.run(
                            "UPDATE identity_mappings SET zalo_user_id = ?, zalo_display_name = ?, normalized_alias = ?, confidence_score = 1.0, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                            [zaloUserId, cleanZalo, normAlias, existing.id]
                        );
                    } else {
                        await db.run(`
                            INSERT INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                            VALUES (?, ?, ?, ?, 1.0)
                        `, [memberId, zaloUserId, cleanZalo, normAlias]);
                    }
                } else {
                    await db.run(
                        "DELETE FROM identity_mappings WHERE member_id = ? AND zalo_user_id LIKE 'alias_%'",
                        [memberId]
                    );
                }

                if (normRaw && normRaw !== normAlias && normRaw !== normReal) {
                    await db.run(`
                        INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                        VALUES (?, ?, ?, ?, 0.95)
                    `, [memberId, `raw_${rId}_${Buffer.from(rawZalo).toString('hex').slice(0, 16)}`, cleanZalo, normRaw]);
                }

                autoSavedCount++;
            }
        }
        console.log(`[AUTO MAPPER] 💾 Đã tự động lưu ${autoSavedCount} ánh xạ tên Zalo vào cơ sở dữ liệu SQLite cho Vùng ${rId}.`);
    } catch (saveErr) {
        console.warn(`[AUTO MAPPER] Cảnh báo lỗi lưu tự động mapping Vùng ${rId}:`, saveErr.message);
    }

    // 5. Khi mapping xong, tự động tắt trình duyệt Zalo
    try {
        await zaloBrowserManager.closeBrowser();
    } catch (closeErr) {
        console.warn('[AUTO MAPPER] Lỗi khi tắt trình duyệt Zalo:', closeErr.message);
    }

    return {
        success: true,
        regionId: rId,
        groupName,
        totalMembers: members.length,
        totalSendersFound: zaloSenders.length,
        matchedCount,
        savedCount: autoSavedCount,
        suggestions
    };
}

function normalizeNameAlias(str) {
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

module.exports = {
    cleanVietnamese,
    getTokens,
    calculateSimilarityScore,
    matchVietnameseNames,
    autoGuessRegionZaloMappings,
    normalizeNameAlias
};

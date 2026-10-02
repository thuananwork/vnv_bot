/**
 * Cluster Synthesizer Service
 * 
 * Bóc tách tin nhắn báo cáo Mẫu 1 của các Trưởng/Phó Vùng từ group chat Cụm
 * và tổng hợp thành bản Báo cáo Cụm chuẩn (Mẫu 2).
 */

const db = require('../config/db');
const { formatDateVN, getDayOfWeekVN } = require('./reports_v2');

/**
 * Phân tích 1 văn bản báo cáo Vùng (Mẫu 1) thành dữ liệu có cấu trúc
 * @param {string} rawText 
 * @returns {Object|null}
 */
function parseRegionReport(rawText) {
    if (!rawText || !rawText.includes('VÙNG')) return null;

    // 1. Nhận diện số Vùng
    const regMatch = rawText.match(/VÙNG\s*(\d+)/i);
    if (!regMatch) return null;
    const regionId = parseInt(regMatch[1], 10);

    // 2. Nhận diện ngày báo cáo
    const dateMatch = rawText.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    const reportDate = dateMatch 
        ? `${dateMatch[3]}-${String(dateMatch[2]).padStart(2, '0')}-${String(dateMatch[1]).padStart(2, '0')}`
        : null;

    // 3. Tên và chức vụ người báo cáo
    let leaderName = '';
    const leaderMatch = rawText.match(/(?:^|\n)\s*1\.\s*(.+)/);
    if (leaderMatch) {
        leaderName = leaderMatch[1].trim().replace(/\.$/, '');
    }

    let role = 'Trưởng Vùng';
    const roleMatch = rawText.match(/(?:^|\n)\s*(?:2\.\s*)?[Cc]hức\s*vụ\s*:\s*(.+)/);
    if (roleMatch) {
        role = roleMatch[1].trim().replace(/\.$/, '');
    }

    // 4. Tổng số sứ giả
    const totalMatch = rawText.match(/[Tt]ổng\s*số\s*sứ\s*giả\s*:\s*(\d+)/i);
    const total = totalMatch ? parseInt(totalMatch[1], 10) : 0;

    // 5. Hoàn thành
    const compMatch = rawText.match(/[Hh]oàn\s*thành\s*:\s*(\d+)/i);
    const completed = compMatch ? parseInt(compMatch[1], 10) : 0;

    // 6. Không hoàn thành
    const incompMatch = rawText.match(/[Kk]hông\s*hoàn\s*thành\s*:\s*(\d+)/i);
    const incomplete = incompMatch ? parseInt(incompMatch[1], 10) : Math.max(0, total - completed);

    // 7. Danh sách không phản hồi
    const noResponse = [];
    const noResponseSection = rawText.match(/\*?\s*Không phản hồi\s*:?[^\n]*\n([\s\S]*?)(?=\*|\n\s*7|\n\s*———|\n\s*——|$)/i);
    if (noResponseSection) {
        const lines = noResponseSection[1].split('\n');
        for (const l of lines) {
            const clean = l.replace(/^[-*•\s]+/, '').trim();
            if (clean && !clean.match(/^[-—–_]{2,}$/) && !clean.toLowerCase().includes('không có') && clean !== '0' && clean.length > 1) {
                clean.split(',').forEach(part => {
                    const p = part.trim();
                    if (p && !p.match(/^[-—–_]{2,}$/) && !p.toLowerCase().includes('không có') && p !== '0') {
                        noResponse.push(p);
                    }
                });
            }
        }
    }

    // 8. Danh sách xin làm muộn / bổ sung sau
    const lateRequests = [];
    const lateSection = rawText.match(/\*?\s*(?:Xin làm muộn|Bổ sung sau)[^\n]*\n([\s\S]*?)(?=\*|\n\s*7|\n\s*———|\n\s*——|$)/i);
    if (lateSection) {
        const lines = lateSection[1].split('\n');
        for (const l of lines) {
            const clean = l.replace(/^[-*•\s]+/, '').trim();
            if (clean && !clean.match(/^[-—–_]{2,}$/) && !clean.toLowerCase().includes('không có') && clean !== '0' && clean.length > 1) {
                clean.split(',').forEach(part => {
                    const p = part.trim();
                    if (p && !p.match(/^[-—–_]{2,}$/) && !p.toLowerCase().includes('không có') && p !== '0') {
                        lateRequests.push(p);
                    }
                });
            }
        }
    }

    // 9. Danh sách bổ sung nhiệm vụ ngày cũ
    const supplements = [];
    const supSection = rawText.match(/(?:7\.?\s*Bổ sung|Bổ sung)\s*:?[^\n]*\n([\s\S]*?)(?=\n\d{1,2}:\d{2}|$)/i);
    if (supSection) {
        const lines = supSection[1].split('\n');
        for (const l of lines) {
            let clean = l.replace(/^[-*•\s]+/, '').trim();
            // Lọc bỏ các dòng header hoặc dòng trống/ký tự gạch ngang
            if (!clean || clean.match(/^[-—–_]{2,}$/)) continue;
            if (clean.match(/^7\.?\s*Bổ sung/i)) continue;
            if (clean.toLowerCase().includes('không có') || clean === '0') continue;
            if (clean.length > 2) {
                supplements.push(clean);
            }
        }
    }

    return {
        regionId,
        leaderName,
        role,
        reportDate,
        total,
        completed,
        incomplete,
        noResponse,
        lateRequests,
        supplements
    };
}

/**
 * Tổng hợp báo cáo Cụm từ danh sách báo cáo các Vùng
 * @param {Object} params
 * @param {Array<Object>} params.parsedReports Danh sách kết quả từ parseRegionReport
 * @param {string} params.workDate 'YYYY-MM-DD'
 * @param {string} [params.clusterLeaderName]
 * @param {number} [params.clusterId]
 * @returns {Promise<Object>}
 */
async function synthesizeClusterReport({ parsedReports = [], workDate, clusterLeaderName = 'Nguyễn Thuận An', clusterId = 5 }) {
    const cluster = await db.get('SELECT * FROM clusters WHERE id = ?', [clusterId]) || { leader_name: clusterLeaderName };
    const leaderName = cluster.leader_name || clusterLeaderName;

    const allRegions = await db.all(
        "SELECT * FROM regions WHERE cluster_id = ? AND status = 'active' ORDER BY id ASC",
        [clusterId]
    );

    const reportMap = new Map();
    for (const pr of parsedReports) {
        if (pr && pr.regionId) {
            reportMap.set(pr.regionId, pr);
        }
    }

    let totalClusterMembers = 0;
    let totalClusterCompleted = 0;
    let totalClusterIncomplete = 0;

    const fullyCompletedRegions = [];
    const missingRegions = [];
    const incompleteBlocks = [];
    const supplementBlocks = [];

    for (const reg of allRegions) {
        const rep = reportMap.get(reg.id);

        if (!rep) {
            // Vùng chưa nộp báo cáo (chỉ ghi nhận, KHÔNG tạo nhắc nhở/cảnh báo)
            missingRegions.push(reg.id);
            const memCount = await db.get("SELECT COUNT(*) as count FROM members WHERE region_id = ? AND status = 'Active'", [reg.id]);
            const count = memCount ? memCount.count : 0;
            totalClusterMembers += count;
            continue;
        }

        totalClusterMembers += rep.total;
        totalClusterCompleted += rep.completed;
        totalClusterIncomplete += rep.incomplete;

        if (rep.incomplete === 0) {
            fullyCompletedRegions.push(reg.id);
        } else {
            const lines = [];
            lines.push(`Vùng ${reg.id}: ${rep.incomplete} sứ giả`);
            if (rep.noResponse && rep.noResponse.length > 0) {
                lines.push(`*${rep.noResponse.join(', ')}: không phản hồi`);
            }
            if (rep.lateRequests && rep.lateRequests.length > 0) {
                lines.push(`*${rep.lateRequests.join(', ')}: xin làm muộn/bổ sung sau`);
            }
            incompleteBlocks.push(lines.join('\n'));
        }

        if (rep.supplements && rep.supplements.length > 0) {
            const lines = [];
            lines.push(`Vùng ${reg.id}: ${rep.supplements.length} sứ giả`);
            rep.supplements.forEach(sup => {
                lines.push(`*${sup}`);
            });
            supplementBlocks.push(lines.join('\n'));
        }
    }

    // Xây dựng phần Ghi chú
    const notesParts = [];

    // 1. Các vùng có sứ giả chưa hoàn thành
    if (incompleteBlocks.length > 0) {
        notesParts.push(incompleteBlocks.join('\n\n'));
    }

    // 2. Nhóm các vùng hoàn thành đầy đủ
    if (fullyCompletedRegions.length > 0) {
        notesParts.push(`Vùng ${fullyCompletedRegions.join(', ')}: Sứ giả vùng hoàn thành đầy đủ`);
    }

    // 3. Các vùng chưa báo cáo (Chỉ ghi nhận trạng thái sạch sẽ, KHÔNG hiển thị cảnh báo nhắc nhở)
    for (const mid of missingRegions) {
        notesParts.push(`Vùng ${mid}: Vùng chưa báo cáo`);
    }

    const notesSection = notesParts.join('\n\n');

    // Xây dựng phần Bổ sung
    const supplementSection = supplementBlocks.length > 0
        ? `\n\nBổ sung:\n${supplementBlocks.join('\n\n')}`
        : '';

    const dayOfWeek = getDayOfWeekVN(workDate);
    const dateFormatted = formatDateVN(workDate);

    // Chuẩn hóa đúng cấu trúc Mẫu 2 của Cụm trưởng
    const content = `BÁO CÁO ${dayOfWeek} ngày ${dateFormatted}
----- HÀNG NGÀY -----
${leaderName}
Cụm ${clusterId} (Vùng 25–31)

Tổng số thành viên: ${totalClusterMembers}
Kết quả hoàn thành: ${totalClusterCompleted}
Chưa làm nhiệm vụ: ${totalClusterIncomplete} sứ giả

${notesSection}${supplementSection}

./. @Phạm Minh Tú em gửi báo cáo nha anh`;

    return {
        clusterId,
        workDate,
        totalClusterMembers,
        totalClusterCompleted,
        totalClusterIncomplete,
        fullyCompletedRegions,
        missingRegions,
        content
    };
}

module.exports = {
    parseRegionReport,
    synthesizeClusterReport
};

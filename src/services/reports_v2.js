const db = require('../config/db');
const { extractDatesFromText } = require('./message_parser');

/**
 * Format ngày hiển thị dạng dd/mm/yyyy hoặc dd/m/yyyy
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {string} 'DD/MM/YYYY'
 */
function formatDateVN(dateStr) {
    if (!dateStr) return '';
    const [y, m, d] = dateStr.split('-');
    return `${parseInt(d, 10)}/${parseInt(m, 10)}/${y}`;
}

/**
 * Lấy thứ trong tuần bằng tiếng Việt
 * @param {string} dateStr 'YYYY-MM-DD'
 * @returns {string} 'Thứ Hai', 'Thứ Ba' ... 'Chủ nhật'
 */
function getDayOfWeekVN(dateStr) {
    const d = new Date(dateStr);
    const day = d.getDay();
    const days = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy'];
    return days[day];
}

/**
 * Sinh Báo cáo cho một Vùng (Mẫu 1)
 * @param {number} regionId 
 * @param {string} workDate 'YYYY-MM-DD'
 * @returns {Promise<Object>}
 */
async function generateRegionReport(regionId, workDate) {
    const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
    if (!region) throw new Error(`Không tìm thấy Vùng ID ${regionId}`);

    // Lấy toàn bộ thành viên đang hoạt động trong Vùng
    const allMembers = await db.all(
        "SELECT * FROM members WHERE region_id = ? AND status = 'Active' ORDER BY CASE WHEN role = 'LEADER' THEN 1 WHEN role = 'DEPUTY' THEN 2 ELSE 3 END ASC, sheet_row_index ASC",
        [regionId]
    );
    const totalMembers = allMembers.length;

    // Lấy danh sách kết quả nộp bài của ngày này
    const submissions = await db.all(
        "SELECT s.*, m.real_name FROM submissions s JOIN members m ON s.member_id = m.id WHERE s.region_id = ? AND s.work_date = ?",
        [regionId, workDate]
    );

    const submissionMap = new Map();
    submissions.forEach(sub => submissionMap.set(sub.member_id, sub));

    const completedList = [];
    const noResponseList = [];
    const lateRequestList = [];
    const supplementList = [];

    function formatLateReason(name, note) {
        if (!note) return name;
        const clean = note.trim();
        if (clean.toLowerCase().startsWith(name.toLowerCase())) {
            return clean;
        }
        return `${name} ${clean}`;
    }

    function isLeaveNoteValidForDate(note, targetDate) {
        if (!note) return false;
        const lower = note.toLowerCase();
        const untilMatch = lower.match(/(?:đến|den)(?:\s+ngày)?\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/);
        if (untilMatch) {
            const d = String(untilMatch[1]).padStart(2, '0');
            const m = String(untilMatch[2]).padStart(2, '0');
            let y = untilMatch[3] ? parseInt(untilMatch[3], 10) : new Date(targetDate).getFullYear();
            if (y < 100) y += 2000;
            const untilDate = `${y}-${m}-${d}`;
            if (targetDate > untilDate) {
                if (!lower.includes('quân sự') && !lower.includes('gia đình')) {
                    return false;
                }
            }
        }
        return true;
    }

    // Lấy danh sách các bài nộp đúng hạn của ngày cũ để không tính nhầm thành nộp bù
    const pastOkSubmissions = await db.all(
        "SELECT member_id, work_date, status, notes FROM submissions WHERE region_id = ? AND work_date < ?",
        [regionId, workDate]
    );
    const onTimeKeySet = new Set();
    for (const pos of pastOkSubmissions) {
        // Nếu ngày cũ có status = 'OK' và không phải là do nộp bù từ ngày sau
        if (pos.status === 'OK' && !(pos.notes && /nộp bù ngày/i.test(pos.notes))) {
            onTimeKeySet.add(`${pos.member_id}::${pos.work_date}`);
        }
    }

    const getTrulySupplementDates = (mId, suppDates) => {
        if (!Array.isArray(suppDates)) return [];
        return suppDates.filter(d => d && d < workDate && !onTimeKeySet.has(`${mId}::${d}`));
    };

    for (const mem of allMembers) {
        const sub = submissionMap.get(mem.id);
        if (sub && (sub.status === 'OK' || sub.status === 'LATE_COMPLETED')) {
            completedList.push(mem.real_name);

            // Phân tích supplement_dates_json hoặc text notes để lấy danh sách ngày cũ đã nộp bù (d < workDate)
            let suppDates = [];
            if (sub.supplement_dates_json) {
                try { suppDates = JSON.parse(sub.supplement_dates_json); } catch (e) {}
            }
            if (!suppDates || suppDates.length === 0) {
                suppDates = extractDatesFromText(sub.notes, workDate);
            }
            const validSuppDates = getTrulySupplementDates(mem.id, suppDates);

            if (validSuppDates.length > 0) {
                const formattedDates = validSuppDates.map(d => formatDateVN(d)).join(', ');
                supplementList.push(`${mem.real_name} nộp bù nhiệm vụ ngày ${formattedDates}`);
            }
        } else if (sub && (sub.status === 'LATE_REQUEST' || sub.status === 'OFF')) {
            lateRequestList.push(formatLateReason(mem.real_name, sub.notes || mem.sheet_note));
        } else if (sub && sub.status === 'SUPPLEMENT') {
            // Sứ giả nộp bù ngày cũ nhưng chưa hoàn thành bài ngày hôm nay
            noResponseList.push(mem.real_name);
            let suppDates = [];
            if (sub.supplement_dates_json) {
                try { suppDates = JSON.parse(sub.supplement_dates_json); } catch (e) {}
            }
            if (!suppDates || suppDates.length === 0) {
                suppDates = extractDatesFromText(sub.notes, workDate);
            }
            const validSuppDates = getTrulySupplementDates(mem.id, suppDates);
            if (validSuppDates.length > 0) {
                const formattedDates = validSuppDates.map(d => formatDateVN(d)).join(', ');
                supplementList.push(`${mem.real_name} nộp bù nhiệm vụ ngày ${formattedDates}`);
            } else if (sub.notes && sub.notes.trim()) {
                supplementList.push(`${mem.real_name}: ${sub.notes}`);
            }
        } else if (mem.sheet_note && isLeaveNoteValidForDate(mem.sheet_note, workDate)) {
            // Sứ giả có ghi chú xin hoãn / quân sự / nghỉ phép từ Google Sheet và còn hiệu lực
            lateRequestList.push(formatLateReason(mem.real_name, mem.sheet_note));
        } else {
            noResponseList.push(mem.real_name);
            // Sứ giả chưa làm bài hôm nay (NO_RESPONSE) nhưng có gửi nộp bài cho ngày cũ (vd: Trần Huỳnh Kiều Duyên)
            let suppDates = [];
            if (sub && sub.supplement_dates_json) {
                try { suppDates = JSON.parse(sub.supplement_dates_json); } catch (e) {}
            }
            if ((!suppDates || suppDates.length === 0) && sub && sub.notes) {
                suppDates = extractDatesFromText(sub.notes, workDate);
            }
            const validSuppDates = getTrulySupplementDates(mem.id, suppDates);
            if (validSuppDates.length > 0) {
                const formattedDates = validSuppDates.map(d => formatDateVN(d)).join(', ');
                supplementList.push(`${mem.real_name} nộp bù nhiệm vụ ngày ${formattedDates}`);
            }
        }
    }

    // Lấy thêm các thành viên Inactive có ghi chú xin hoãn/quân sự trên Sheet
    const inactiveLeaveMembers = await db.all(
        "SELECT * FROM members WHERE region_id = ? AND status = 'Inactive' AND sheet_note IS NOT NULL AND sheet_note != '' ORDER BY sheet_row_index ASC",
        [regionId]
    );
    for (const inact of inactiveLeaveMembers) {
        const lower = inact.sheet_note.toLowerCase();
        // Bỏ qua các trường hợp thôi việc vĩnh viễn
        if (lower.includes('thôi vai trò') || lower.includes('dừng hoạt động')) continue;
        const formatted = formatLateReason(inact.real_name, inact.sheet_note);
        if (!lateRequestList.includes(formatted)) {
            lateRequestList.push(formatted);
        }
    }

    const totalCompleted = completedList.length;
    const totalIncomplete = Math.max(0, totalMembers - totalCompleted);

    // Tự động chuyển người ký báo cáo thành Phó Vùng nếu Trưởng Vùng xin hoãn/nghỉ
    let reporterName = region.leader_name;
    let reporterRole = 'Trưởng Vùng';
    const isLeaderExcused = lateRequestList.some(item => item.includes(region.leader_name));
    if (isLeaderExcused && region.deputy_name) {
        reporterName = region.deputy_name;
        reporterRole = 'Phó Vùng';
    }

    // Định dạng text theo đúng Mẫu 1
    const noResponseText = noResponseList.length > 0 
        ? noResponseList.map(name => `- ${name}`).join('\n')
        : '- Không có';

    const lateRequestText = lateRequestList.length > 0
        ? lateRequestList.map(name => `- ${name}`).join('\n')
        : '- Không có';

    const supplementText = supplementList.length > 0
        ? supplementList.map(name => `- ${name}`).join('\n')
        : '- Không có';

    const content = `Báo cáo ngày ${formatDateVN(workDate)}
------HÀNG NGÀY-------
${(region.region_name || `SỨ GIẢ VÙNG ${region.id}`).toUpperCase()}
1. ${reporterName}
2. Chức vụ: ${reporterRole}
3. Tổng số sứ giả: ${totalMembers}
4. Hoàn thành: ${totalCompleted}
5. Không hoàn thành: ${totalIncomplete}
6. Lý do:  
* Không phản hồi:
${noResponseText}
* Xin làm muộn/bổ sung: 
${lateRequestText}
7. Bổ sung: 
${supplementText}`;

    // Lưu vào bảng reports (Idempotent)
    let task = await db.get("SELECT id FROM tasks WHERE publish_date = ?", [workDate]);
    let taskId = task ? task.id : null;
    if (!taskId) {
        const defaultTask = await db.get("SELECT id FROM tasks ORDER BY id ASC LIMIT 1");
        if (defaultTask) {
            taskId = defaultTask.id;
        } else {
            const ins = await db.run(
                "INSERT INTO tasks (task_code, title, description, publish_date, status) VALUES (?, ?, ?, ?, 'active')",
                ['TSK-' + workDate.replace(/-/g, ''), 'Nhiệm vụ ' + workDate, 'Nhiệm vụ ' + workDate, workDate]
            );
            taskId = ins.id;
        }
    }

    await db.run('DELETE FROM reports WHERE region_id = ? AND work_date = ?', [regionId, workDate]);
    const insertRes = await db.run(`
        INSERT INTO reports (task_id, report_type, region_id, work_date, total_members, total_completed, total_incomplete, content)
        VALUES (?, 'region', ?, ?, ?, ?, ?, ?)
    `, [taskId, regionId, workDate, totalMembers, totalCompleted, totalIncomplete, content]);

    return {
        id: insertRes.id,
        regionId,
        workDate,
        totalMembers,
        totalCompleted,
        totalIncomplete,
        noResponseList,
        lateRequestList,
        supplementList,
        content
    };
}

/**
 * Sinh Báo cáo tổng hợp Cụm 5 (Mẫu 2)
 * @param {number} clusterId 
 * @param {string} workDate 'YYYY-MM-DD'
 * @returns {Promise<Object>}
 */
async function generateClusterReport(clusterId = 5, workDate) {
    const cluster = await db.get('SELECT * FROM clusters WHERE id = ?', [clusterId]) || { leader_name: 'Nguyễn Thuận An' };
    const regions = await db.all("SELECT * FROM regions WHERE cluster_id = ? AND status = 'active' ORDER BY id ASC", [clusterId]);

    let totalClusterMembers = 0;
    let totalClusterCompleted = 0;
    let totalClusterIncomplete = 0;

    const regionNotesBlocks = [];
    const regionSupplementsBlocks = [];

    for (const r of regions) {
        const regionReport = await generateRegionReport(r.id, workDate);
        totalClusterMembers += regionReport.totalMembers;
        totalClusterCompleted += regionReport.totalCompleted;
        totalClusterIncomplete += regionReport.totalIncomplete;

        // Xây dựng block Ghi chú cho từng vùng
        if (regionReport.totalIncomplete === 0) {
            regionNotesBlocks.push(`Vùng ${r.id}: Sứ giả vùng hoàn thành đầy đủ`);
        } else {
            const lines = [];
            lines.push(`Vùng ${r.id}: ${regionReport.totalIncomplete} sứ giả`);
            
            if (regionReport.noResponseList.length > 0) {
                lines.push(`- ${regionReport.noResponseList.join(', ')}: không phản hồi`);
            }
            if (regionReport.lateRequestList.length > 0) {
                lines.push(`- ${regionReport.lateRequestList.join(', ')}: xin làm muộn/bổ sung sau`);
            }
            regionNotesBlocks.push(lines.join('\n'));
        }

        // Xây dựng block Bổ sung cho từng vùng
        if (regionReport.supplementList.length > 0) {
            const lines = [];
            lines.push(`Vùng ${r.id}: ${regionReport.supplementList.length} sứ giả`);
            regionReport.supplementList.forEach(sup => {
                lines.push(`- ${sup}`);
            });
            regionSupplementsBlocks.push(lines.join('\n'));
        }
    }

    const notesSection = regionNotesBlocks.join('\n\n');
    const supplementSection = regionSupplementsBlocks.length > 0
        ? `Bổ sung:\n${regionSupplementsBlocks.join('\n\n')}\n\n`
        : '';

    const dayOfWeek = getDayOfWeekVN(workDate);
    const dateFormatted = formatDateVN(workDate);

    const content = `BÁO CÁO ${dayOfWeek} ngày ${dateFormatted}
----- HÀNG NGÀY -----
${cluster.leader_name}
Cụm 5 (Vùng 25–31)

Tổng số thành viên: ${totalClusterMembers} 
Kết quả hoàn thành: ${totalClusterCompleted} 
Chưa làm nhiệm vụ: ${totalClusterIncomplete} sứ giả 
*(Lưu ý: Số liệu hoàn thành của các Vùng đã được cân đối lại theo tổng số sứ giả trừ đi số lượng chưa hoàn thành)*

Ghi chú:
${notesSection}

${supplementSection}./. @Phạm Minh Tú em gửi báo cáo nha anh`;

    let task = await db.get("SELECT id FROM tasks WHERE publish_date = ?", [workDate]);
    const taskId = task ? task.id : 1;

    await db.run('DELETE FROM reports WHERE cluster_id = ? AND work_date = ?', [clusterId, workDate]);
    const insertRes = await db.run(`
        INSERT INTO reports (task_id, report_type, cluster_id, work_date, total_members, total_completed, total_incomplete, content)
        VALUES (?, 'cluster', ?, ?, ?, ?, ?, ?)
    `, [taskId, clusterId, workDate, totalClusterMembers, totalClusterCompleted, totalClusterIncomplete, content]);

    return {
        id: insertRes.id,
        clusterId,
        workDate,
        totalClusterMembers,
        totalClusterCompleted,
        totalClusterIncomplete,
        content
    };
}

module.exports = {
    generateRegionReport,
    generateClusterReport,
    formatDateVN,
    getDayOfWeekVN
};

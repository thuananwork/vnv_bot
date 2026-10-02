/**
 * Parser Engine V2: Phân tích ngữ nghĩa tin nhắn của Sứ giả & Trưởng vùng
 * Hỗ trợ nhận diện Tên Sứ giả, Ngày làm nhiệm vụ, Bổ sung ngày cũ và Lý do xin phép
 */

/**
 * Trích xuất danh sách ngày nộp bài / nộp bù từ nội dung tin nhắn
 * Ví dụ: "báo cáo nhiệm vụ 16/06/2026" hoặc "Bổ sung nhiệm vụ ngày 18/08 và 19/08"
 * @param {string} text 
 * @returns {Array<string>} Danh sách ngày dạng 'YYYY-MM-DD'
 */
/**
 * Trích xuất danh sách ngày nộp bài / nộp bù từ nội dung tin nhắn
 * Hỗ trợ ngày tương đối (hôm qua, hôm kia, hôm trước) và nhiều ngày (22/23/04/2026)
 * @param {string} text 
 * @param {string|Date} [referenceDate] 
 * @returns {Array<string>} Danh sách ngày dạng 'YYYY-MM-DD'
 */
function extractDatesFromText(text, referenceDate = null) {
    if (!text) return [];
    const dates = [];
    const ref = referenceDate ? new Date(referenceDate) : new Date();
    const currentYear = ref.getFullYear();
    const lower = text.toLowerCase();
    
    const formatDateStr = (d) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };

    // 1. Nhận diện ngày tương đối (hôm qua, hôm kia, hôm trước, hôm bữa)
    if (lower.includes('hôm qua') || lower.includes('hom qua') || lower.includes('hqua') || lower.includes('hôm trước') || lower.includes('hom truoc') || lower.includes('hôm bữa')) {
        const yesterday = new Date(ref);
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = formatDateStr(yesterday);
        if (!dates.includes(yStr)) dates.push(yStr);
    }
    if (lower.includes('hôm kia') || lower.includes('hom kia')) {
        const twoDaysAgo = new Date(ref);
        twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);
        const kStr = formatDateStr(twoDaysAgo);
        if (!dates.includes(kStr)) dates.push(kStr);
    }

    // 2. Pattern chuỗi ngày gộp: ví dụ "22/23/04/2026" hoặc "18/21/23/04/2026"
    const multiDayRegex = /\b((?:\d{1,2}\/)+\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/g;
    let multiMatch;
    while ((multiMatch = multiDayRegex.exec(text)) !== null) {
        const daysPart = multiMatch[1].split('/');
        const month = multiMatch[2].padStart(2, '0');
        let year = multiMatch[3] ? parseInt(multiMatch[3], 10) : currentYear;
        if (year < 100) year += 2000;

        for (const d of daysPart) {
            const day = d.padStart(2, '0');
            const dStr = `${year}-${month}-${day}`;
            if (!dates.includes(dStr)) dates.push(dStr);
        }
    }

    // 3. Pattern 1: dd/mm/yyyy hoặc dd/mm
    const dateRegex = /\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/g;
    let match;
    while ((match = dateRegex.exec(text)) !== null) {
        const dNum = parseInt(match[1], 10);
        const mNum = parseInt(match[2], 10);
        if (dNum < 1 || dNum > 31 || mNum < 1 || mNum > 12) continue;

        const day = String(dNum).padStart(2, '0');
        const month = String(mNum).padStart(2, '0');
        let year = match[3] ? parseInt(match[3], 10) : currentYear;
        if (year < 100) year += 2000;
        const dateStr = `${year}-${month}-${day}`;
        if (!dates.includes(dateStr)) {
            dates.push(dateStr);
        }
    }

    // 4. Pattern 1.2: "ngày dd tháng mm" hoặc "dd tháng mm"
    const monthNameRegex = /\b(?:ngày\s+)?(\d{1,2})\s+tháng\s+(\d{1,2})(?:\s+năm\s+(\d{2,4}))?\b/gi;
    let monthMatch;
    while ((monthMatch = monthNameRegex.exec(text)) !== null) {
        const day = monthMatch[1].padStart(2, '0');
        const month = monthMatch[2].padStart(2, '0');
        let year = monthMatch[3] ? parseInt(monthMatch[3], 10) : currentYear;
        if (year < 100) year += 2000;
        const dateStr = `${year}-${month}-${day}`;
        if (!dates.includes(dateStr)) {
            dates.push(dateStr);
        }
    }

    // 5. Pattern 2: "từ ngày 25/05 đến 30/05"
    const rangeRegex = /từ\s+ngày\s+(\d{1,2})[\/\-](\d{1,2})\s+đến\s+(\d{1,2})[\/\-](\d{1,2})/i;
    const rangeMatch = rangeRegex.exec(text);
    if (rangeMatch) {
        const startDay = parseInt(rangeMatch[1], 10);
        const startMonth = parseInt(rangeMatch[2], 10);
        const endDay = parseInt(rangeMatch[3], 10);
        const endMonth = parseInt(rangeMatch[4], 10);

        if (startMonth === endMonth && startDay <= endDay) {
            for (let d = startDay; d <= endDay; d++) {
                const dayStr = String(d).padStart(2, '0');
                const monthStr = String(startMonth).padStart(2, '0');
                const fullDate = `${currentYear}-${monthStr}-${dayStr}`;
                if (!dates.includes(fullDate)) {
                    dates.push(fullDate);
                }
            }
        }
    }

    // 6. Pattern 3: "ngày dd" (lấy tháng hiện tại)
    if (dates.length === 0) {
        const dayOnlyRegex = /\bngày\s+(\d{1,2})\b/gi;
        let dayMatch;
        const currentMonth = String(ref.getMonth() + 1).padStart(2, '0');
        while ((dayMatch = dayOnlyRegex.exec(text)) !== null) {
            const dayNum = parseInt(dayMatch[1], 10);
            if (dayNum >= 1 && dayNum <= 31) {
                const dayStr = String(dayNum).padStart(2, '0');
                const dateStr = `${currentYear}-${currentMonth}-${dayStr}`;
                if (!dates.includes(dateStr)) {
                    dates.push(dateStr);
                }
            }
        }
    }

    return dates;
}

/**
 * Trích xuất tên thành viên từ cú pháp báo cáo có dấu gạch ngang
 * Ví dụ: "Phản hồi hoàn thành Nhiệm vụ CN ngày 3/5/2026 - Phạm Thu Vân"
 * @param {string} text 
 * @returns {string|null}
 */
function extractMemberNameFromSubmission(text) {
    if (!text) return null;
    const parts = text.split(/\s+[-–—]\s+/);
    if (parts.length >= 2) {
        const candidate = parts[parts.length - 1].trim().replace(/\.+$/, '');
        if (candidate.length >= 2 && candidate.length <= 40 && !/\d/.test(candidate)) {
            return candidate;
        }
    }
    return null;
}

/**
 * Trích xuất lý do xin phép/xin nghỉ/hoãn
 * @param {string} text 
 * @returns {string}
 */
function extractReasonNotes(text) {
    if (!text) return '';
    const reasons = [];
    const lower = text.toLowerCase();

    if (lower.includes('ôn thi') || lower.includes('lịch thi')) reasons.push('ôn thi');
    if (lower.includes('nhập viện') || lower.includes('đi viện') || lower.includes('nằm viện')) reasons.push('nhập viện');
    if (lower.includes('quân sự') || lower.includes('học quân sự') || lower.includes('đi quân sự')) reasons.push('đi quân sự');
    if (lower.includes('thpt') || lower.includes('thptqg')) reasons.push('ôn thi THPT');
    if (lower.includes('xin off') || lower.includes('xin nghỉ')) reasons.push('xin off');
    if (lower.includes('muộn') || lower.includes('bổ sung sau') || lower.includes('hoãn')) reasons.push('xin làm muộn/bổ sung sau');

    if (reasons.length > 0) {
        return reasons.join(', ');
    }

    return text.trim();
}

/**
 * Phân tích nội dung tin nhắn và phân loại trạng thái nộp bài
 * 100% Text-based — Hoàn toàn không phụ thuộc vào ảnh
 * @param {Object} params
 * @param {string} [params.content] - Nội dung tin nhắn
 * @param {string} [params.workDate] - Ngày đang xét (mặc định hôm nay YYYY-MM-DD)
 * @returns {Object} { status: 'OK'|'LATE_REQUEST'|'SUPPLEMENT'|'OFF'|'IGNORED', notes: string, supplementDates: string[], explicitMemberName: string|null }
 */
function parseMessageSubmission({ content = '', workDate = null }) {
    const trimmed = (content || '').trim();
    const lower = trimmed.toLowerCase();
    const todayStr = workDate || new Date().toLocaleDateString('sv');
    const explicitMemberName = extractMemberNameFromSubmission(trimmed);

    // 1. Kiểm tra xin phép / xin off / xin làm muộn / hoãn / quân sự
    const lateKeywords = ['xin làm muộn', 'bổ sung sau', 'xin off', 'xin nghỉ', 'ôn thi', 'lịch thi', 'nhập viện', 'đi viện', 'quân sự', 'hoãn', 'xin phép', 'dừng hoạt động'];
    const isLateRequest = lateKeywords.some(k => lower.includes(k));
    if (isLateRequest) {
        return {
            status: 'LATE_REQUEST',
            notes: extractReasonNotes(content) || trimmed,
            supplementDates: [],
            explicitMemberName
        };
    }

    // 2. Trích xuất các ngày được nhắc tới trong tin nhắn (kèm ngày tương đối)
    const extractedDates = extractDatesFromText(content, todayStr);
    const oldDates = extractedDates.filter(d => d < todayStr);

    // Từ khóa nộp bù / làm bù / bổ sung
    const supplementKeywords = [
        'bổ sung', 'bo sung',
        'nộp bù', 'nop bu',
        'làm bù', 'lam bu',
        'gửi bù', 'gui bu',
        'bù nhiệm vụ', 'bu nhiem vu',
        'bù nv', 'bu nv',
        'bù bài', 'bu bai',
        'bù ngày', 'bu ngay',
        'gửi bù nhiệm vụ', 'gui bu nhiem vu',
        'nộp bù nhiệm vụ', 'nop bu nhiem vu',
        'gửi bù nv', 'gui bu nv',
        'nộp bù nv', 'nop bu nv',
        'nv bù', 'nv bu',
        'trả nv', 'tra nv',
        'trả bài', 'tra bai',
        'trả nợ nv', 'tra no nv',
        'làm bù ngày', 'lam bu ngay',
        'hoàn thành nhiệm vụ từ',
        'gửi nv hôm',
        'gửi nhiệm vụ hôm',
        'gửi nv hqua'
    ];
    const hasSupplementKeyword = supplementKeywords.some(k => lower.includes(k));

    // Nhận diện các cú pháp nộp bài chính thức của Sứ giả (100% bằng Text)
    const donePatterns = [
        'gửi báo cáo',
        'hoàn thành nhiệm vụ',
        'hoàn thành nv',
        'phản hồi hoàn thành',
        'báo cáo nhiệm vụ',
        'bao cao nhiem vu',
        'báo cáo nvu',
        'bao cao nvu',
        'báo cáo nv',
        'bao cao nv',
        'báo cáo bài',
        'bao cao bai',
        'báo cáo ngày',
        'bao cao ngay',
        'gửi nhiệm vụ',
        'gui nhiem vu',
        'gửi nv',
        'gui nv',
        'gửi nvu',
        'gui nvu',
        'nộp nhiệm vụ',
        'nop nhiem vu',
        'nộp nv',
        'nop nv',
        'nộp nvu',
        'nop nvu',
        'gửi bài',
        'gui bai',
        'nộp bài',
        'nop bai',
        'đã nộp',
        'da nop',
        'đã làm',
        'da lam',
        'đã xong',
        'da xong',
        'hoàn thành',
        'hoan thanh',
        'done',
        'xong',
        'oke',
        'ok'
    ];
    const isReportSubmission = donePatterns.some(p => lower.includes(p))
        || /(?:báo\s*cáo|bao\s*cao)\s*(?:nhiệm\s*vụ|nhiem\s*vu|nv|nvu|bài|bai|ngay|ngày|\d)/i.test(lower);

    // 3. Kiểm tra tin nhắn Giao nhiệm vụ của Trưởng/Phó Vùng hoặc Kế hoạch làm việc (tuyệt đối không tính là nộp bài)
    const taskDispatchPatterns = [
        /(?:m[ìi]nh|anh|ch[ịi]|bql|ad|admin)\s+g[ửu]i\s+(?:nhi[ệe]m\s+v[ụu]|nv|k[ếe]\s+ho[ạa]ch)/i,
        /g[ửu]i\s+(?:nhi[ệe]m\s+v[ụu]|nv)\s+h[ôo]m\s+nay\s*(?:nh[áa]|nh[ée]|nhe|nha|ạ|a|\.|$)/i,
        /k[ếe]\s+ho[ạa]ch\s+l[àa]m\s+vi[ệe]c/i,
        /^m[ìi]nh\s+g[ửu]i\s+(?:nhi[ệe]m\s+v[ụu]|nv)/i
    ];
    const isTaskDispatch = taskDispatchPatterns.some(p => p.test(trimmed));
    if (isTaskDispatch) {
        return {
            status: 'IGNORED',
            notes: 'Giao nhiệm vụ',
            supplementDates: [],
            explicitMemberName: null
        };
    }

    // 4. Kiểm tra tin nhắn nhắc nhở / thông báo chung (không phải nộp bài)
    const isReminder = /nh[áéèẽẻẹa]\s+(c[áa]c\s+b[ạa]n|c[ảa]\s+nh[àa]|m[ọo]i\s+ng[ườu][ờơi]|ai\s+ch[ưưa]|c[ảa]\s+team)/i.test(lower)
        || /m[ọo]i\s+ng[ườu][ờơi]\s+(nh[ớo]|v[àa]o|l[àa]m|ch[úu]\s+[ýy])/i.test(lower)
        || /nh[ắa]c\s+nh[ởo]/i.test(lower);
    if (isReminder) {
        return {
            status: 'IGNORED',
            notes: 'Nhắc nhở',
            supplementDates: [],
            explicitMemberName: null
        };
    }

    // Trường hợp 1: Có nhắc đến ngày cụ thể trong tin nhắn
    if (extractedDates.length > 0) {
        // Nếu ngày được nhắc tới CHÍNH LÀ ngày đang xét (todayStr)
        // Ví dụ: Mai Thủy ghi "Em gửi bù nhiệm vụ ngày 16/9 ạ" khi đang quét ngày 16/9
        // hoặc "Nguyễn Văn Chương hoàn thành nhiệm vụ ngày 16/09"
        if (extractedDates.includes(todayStr)) {
            if (hasSupplementKeyword || isReportSubmission) {
                const otherDates = extractedDates.filter(d => d !== todayStr);
                return {
                    status: 'OK',
                    notes: trimmed,
                    supplementDates: otherDates,
                    explicitMemberName
                };
            }
        }

        // Trường hợp có cả hôm nay và ngày cũ ("em gửi nv hôm qua với hôm nay ạ")
        const hasBothTodayAndPast = (lower.includes('hôm nay') || lower.includes('hom nay')) && oldDates.length > 0;
        if (hasBothTodayAndPast) {
            return {
                status: 'OK',
                notes: `Hoàn thành hôm nay & Bổ sung: ${oldDates.join(', ')}`,
                supplementDates: oldDates,
                explicitMemberName
            };
        }

        // Trường hợp tin nhắn chỉ nhắc đến các ngày cũ (KHÔNG bao gồm ngày todayStr đang xét)
        // Ví dụ: "nộp bù ngày 15/9" khi đang quét ngày 17/9
        if (oldDates.length > 0) {
            return {
                status: hasSupplementKeyword ? 'SUPPLEMENT' : 'PAST_SUBMISSION',
                notes: trimmed,
                targetWorkDates: oldDates,
                supplementDates: oldDates,
                explicitMemberName
            };
        }
    }

    // Trường hợp 2: Không nhắc ngày cụ thể, nhưng có từ khóa nộp bài hoặc nộp bù trong cửa sổ quét
    if (hasSupplementKeyword || isReportSubmission) {
        return {
            status: 'OK',
            notes: hasSupplementKeyword ? trimmed : '',
            supplementDates: [],
            explicitMemberName
        };
    }

    return {
        status: 'IGNORED',
        notes: '',
        supplementDates: [],
        explicitMemberName
    };
}

/**
 * Kiểm tra xem một tin nhắn có phải là tin nhắn giao Nhiệm vụ hằng ngày hay không
 * Nhận diện dựa trên FORMAT đầy đủ của nhiệm vụ:
 * - Tiêu đề: "KẾ HOẠCH LÀM VIỆC SỨ GIẢ"
 * - Mục: "HÀNG NGÀY" hoặc "Nhiệm vụ hôm nay"
 * @param {string} text 
 * @returns {boolean}
 */
function isTaskMessage(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase();
    const hasHeader = lower.includes('kế hoạch làm việc sứ giả') || lower.includes('ke hoach lam viec su gia');
    if (!hasHeader) return false;

    const hasDailyMarker = lower.includes('hàng ngày') || 
                           lower.includes('hang ngay') || 
                           lower.includes('nhiệm vụ hôm nay') || 
                           lower.includes('nhiem vu hom nay');
    return hasDailyMarker;
}

/**
 * Trích xuất ngày giao nhiệm vụ (YYYY-MM-DD) từ tin nhắn Nhiệm vụ
 * Mẫu: "Hôm nay, T3 ngày 15/09/2026" hoặc "ngày 15/9/2026"
 * @param {string} text 
 * @returns {string|null} 'YYYY-MM-DD' hoặc null
 */
function extractDateFromTaskMessage(text) {
    if (!text) return null;
    // Tìm cụm "ngày dd/mm/yyyy" hoặc "ngày dd-mm-yyyy"
    const regex = /ngày\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/i;
    const match = regex.exec(text);
    if (match) {
        const d = match[1].padStart(2, '0');
        const m = match[2].padStart(2, '0');
        let y = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
        if (y < 100) y += 2000;
        return `${y}-${m}-${d}`;
    }

    // Dự phòng tìm bất kỳ định dạng ngày nào trong bài
    const allDates = extractDatesFromText(text);
    return allDates.length > 0 ? allDates[0] : null;
}

/**
 * Kiểm tra xem tin nhắn có phải là tin nhắn Báo cáo tổng kết của Bot hay không
 * Mẫu: "Báo cáo ngày 15/9/2026\n------HÀNG NGÀY-------\nVÙNG" hoặc "BÁO CÁO TIẾN ĐỘ VÙNG"
 * @param {string} text 
 * @returns {boolean}
 */
function isBotSummaryReport(text) {
    if (!text || typeof text !== 'string') return false;
    const lower = text.toLowerCase();
    const isModel1 = (lower.includes('báo cáo ngày') || lower.includes('bao cao ngay')) &&
                     (lower.includes('hàng ngày') || lower.includes('hang ngay')) &&
                     (lower.includes('vùng') || lower.includes('vung'));
    const isModel2 = lower.includes('báo cáo tiến độ vùng') || lower.includes('bao cao tien do vung');
    return isModel1 || isModel2;
}

/**
 * Trích xuất ngày từ tin nhắn Báo cáo tổng kết
 * @param {string} text 
 * @returns {string|null} 'YYYY-MM-DD'
 */
function extractDateFromReportMessage(text) {
    if (!text) return null;
    const regex = /ngày\s+(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?/i;
    const match = regex.exec(text);
    if (match) {
        const d = match[1].padStart(2, '0');
        const m = match[2].padStart(2, '0');
        let y = match[3] ? parseInt(match[3], 10) : new Date().getFullYear();
        if (y < 100) y += 2000;
        return `${y}-${m}-${d}`;
    }
    const allDates = extractDatesFromText(text);
    return allDates.length > 0 ? allDates[0] : null;
}

module.exports = {
    parseMessageSubmission,
    extractDatesFromText,
    extractSupplementDates: extractDatesFromText,
    extractMemberNameFromSubmission,
    extractReasonNotes,
    isTaskMessage,
    extractDateFromTaskMessage,
    isBotSummaryReport,
    extractDateFromReportMessage
};


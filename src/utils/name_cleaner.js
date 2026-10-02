/**
 * name_cleaner.js - Bộ công cụ chuẩn hóa và làm sạch tên Zalo / Sứ giả
 */

/**
 * Làm sạch tên hiển thị trên Zalo:
 * - Bỏ tiền tố vùng: aVùng 31_, Vùng 31_, aV31_, V31_, Vùng31 -, v.v.
 * - Bỏ chữ 'a' ở đầu do thói quen lưu danh bạ đẩy lên top A-Z:
 *   + aTuyết Như -> Tuyết Như
 *   + aPhương Hoa -> Phương Hoa
 *   + aHuyền -> Huyền
 *   + aDuyên Nguyễn -> Duyên Nguyễn
 *   + a Tuyết Như / a_Tuyết Như -> Tuyết Như
 * - Giữ nguyên các tên gốc bắt đầu bằng chữ A tự nhiên (Anh Tuấn, An Nguyễn, Ánh Tuyết, Ân Trần, v.v.)
 * 
 * @param {string} raw - Tên thô lấy từ Zalo Web
 * @returns {string} - Tên sạch, chuẩn của Sứ giả
 */
function cleanZaloSenderName(raw, realName = null) {
    if (!raw) return '';
    let name = String(raw).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();

    // 0. Cắt bỏ các phần dính nội dung tin nhắn hoặc icon cảm xúc Zalo
    if (name.includes('\n')) name = name.split('\n')[0];
    
    // Cắt bỏ nếu dính từ khóa báo cáo, nhiệm vụ, kế hoạch (không phân biệt hoa thường)
    name = name.split(/(?:báo cáo|báo\s*cáo|gửi báo cáo|gủi báo cáo|kế hoạch|hàng ngày|nhiệm vụ|\/-|@)/i)[0].trim();

    // 1. Loại bỏ tiền tố chức vụ & vùng: vd PhóVùng 29_, TrưởngVùng 29_, PV29_, TV29_, aVùng31_, Vùng 31:, V31_, aV31_
    name = name.replace(/^(?:a[\s_\-.:]*)?(?:(?:phó|trưởng)\s*(?:v(?:ùng)?)?\s*\d*|(?:v(?:ùng)?|pv|tv)\s*\d+)[\s_\-.:]*/i, '');

    // 2. Loại bỏ chữ 'a' ở đầu nếu ngay sau nó là chữ cái in hoa tiếng Việt
    // vd: aTuyết Như -> Tuyết Như, aHuyền -> Huyền, aDuyên Nguyễn -> Duyên Nguyễn
    // (Lưu ý: Tên người thật bắt đầu bằng chữ A hoa như "Anh", "An" sẽ không bị ảnh hưởng vì là chữ hoa theo sau là chữ thường)
    name = name.replace(/^a(?=[A-ZÀ-ỴÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ])/g, '');

    // 3. Loại bỏ chữ 'a' đứng riêng trước dấu cách hoặc ký tự phân cách
    // vd: a Tuyết Như -> Tuyết Như, a_Tuyết Như -> Tuyết Như, a-Tuyết Như -> Tuyết Như
    name = name.replace(/^a[\s_\-.:]+(?=[A-Za-zÀ-ỹ])/i, '');

    // 3.1. Xử lý danh xưng Ms/Mr dính liền tên (vd: Mstrang -> Ms Trang, MrTuan -> Mr Tuan)
    name = name.replace(/^(ms|mr)([a-zà-ỹ0-9_]+)/i, (m, p1, p2) => {
        const title = p1.toLowerCase() === 'ms' ? 'Ms ' : 'Mr ';
        return title + p2.charAt(0).toUpperCase() + p2.slice(1);
    });

    name = name.trim();

    // 4. Nếu tên bị dính tên thật ở cuối do trích xuất DOM Zalo (vd: "Chinh LêLê Trường Chinh", "Phương HoaNinh Thị Phương Hoa", "MyPhan Hà My")
    if (realName) {
        const candidates = Array.isArray(realName) ? realName : [realName];
        for (const cand of candidates) {
            if (!cand || typeof cand !== 'string') continue;
            const cleanCand = cand.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
            if (cleanCand.length >= 3 && name.toLowerCase().endsWith(cleanCand.toLowerCase()) && name.length > cleanCand.length) {
                const prefix = name.slice(0, name.length - cleanCand.length).trim();
                if (prefix.length >= 2) {
                    name = prefix;
                    break;
                }
            }
        }
    }

    // 4.1. Tự động phát hiện và bóc tách nếu dính họ tên tiếng Việt viết hoa dính liền chữ thường
    // Ví dụ: "Chinh LêLê Trường Chinh" -> "Chinh Lê", "Phương HoaNinh Thị Phương Hoa" -> "Phương Hoa", "MyPhan Hà My" -> "My"
    const vnUpper = 'A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ';
    const vnLower = 'a-zàáảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ';
    const concatRegex = new RegExp('^(.+?[' + vnLower + '0-9])([' + vnUpper + '][' + vnLower + ']+(?:\\s+[' + vnUpper + '][' + vnLower + ']+){1,3})$');
    const concatMatch = name.match(concatRegex);
    if (concatMatch) {
        const prefixPart = concatMatch[1].trim();
        const suffixName = concatMatch[2].trim();
        if (prefixPart.length >= 2 && suffixName.length >= 4) {
            name = prefixPart;
        }
    }

    // 5. Xử lý tên bị lặp đôi (vd: "Nguyễn Võ Minh DuyNguyễn Võ Minh Duy" -> "Nguyễn Võ Minh Duy")
    const half = Math.floor(name.length / 2);
    if (half >= 3 && name.slice(0, half) === name.slice(half)) {
        name = name.slice(0, half).trim();
    }

    // 6. Giới hạn độ dài tối đa (tên hiển thị Zalo không bao giờ quá 35 ký tự)
    if (name.length > 35) {
        name = name.slice(0, 35).trim();
    }

    return name.trim();
}

/**
 * Chuẩn hóa chuỗi tiếng Việt: bỏ dấu, xóa ký tự đặc biệt & emoji, chuyển chữ thường
 * @param {string} str 
 * @returns {string}
 */
function normalizeVietnamese(str) {
    if (!str) return '';
    return String(str)
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/đ/g, 'd')
        .replace(/Đ/g, 'd')
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Tách các từ đơn trong tên
 * @param {string} str 
 * @returns {string[]}
 */
function getTokens(str) {
    const cleaned = normalizeVietnamese(str);
    return cleaned ? cleaned.split(' ').filter(Boolean) : [];
}

module.exports = {
    cleanZaloSenderName,
    normalizeVietnamese,
    getTokens
};

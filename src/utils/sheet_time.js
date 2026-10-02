/**
 * Tiện ích thời gian thực cho Google Sheet
 * Quy tắc đặt tên tab: T{Tháng}/{2 số cuối của Năm}
 * Ví dụ:
 *  - 2026-09-06 -> 'T9/26'
 *  - 2026-10-01 -> 'T10/26'
 *  - 2027-01-15 -> 'T1/27'
 */

function parseDateInput(dateInput) {
    if (!dateInput) return new Date();
    if (dateInput instanceof Date) return dateInput;
    if (typeof dateInput === 'string') {
        const parts = dateInput.split('-');
        if (parts.length === 3) {
            return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        }
        return new Date(dateInput);
    }
    return new Date();
}

/**
 * Lấy tên tab tháng theo thời gian thực hoặc theo ngày làm việc
 * @param {string|Date} [dateInput] Ví dụ '2026-10-01'
 * @returns {string} Ví dụ 'T10/26'
 */
function getExpectedMonthTab(dateInput) {
    const d = parseDateInput(dateInput);
    const month = d.getMonth() + 1;
    const yearShort = String(d.getFullYear()).slice(-2);
    return `T${month}/${yearShort}`;
}

/**
 * Lấy tên tab tháng trước liền kề (dùng để làm template nhân bản)
 * @param {string|Date} [dateInput]
 * @returns {string} Ví dụ '2026-10-01' -> 'T9/26'
 */
function getPreviousMonthTab(dateInput) {
    const d = parseDateInput(dateInput);
    // Lùi về tháng trước
    const prevDate = new Date(d.getFullYear(), d.getMonth() - 1, 1);
    const month = prevDate.getMonth() + 1;
    const yearShort = String(prevDate.getFullYear()).slice(-2);
    return `T${month}/${yearShort}`;
}

module.exports = {
    parseDateInput,
    getExpectedMonthTab,
    getPreviousMonthTab
};

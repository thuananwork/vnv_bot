/**
 * Chuẩn hóa địa chỉ email theo chuẩn bảo mật và nghiệp vụ của VNV-Bot
 * @param {string} email - Email thô cần chuẩn hóa
 * @returns {string} Email đã được chuẩn hóa
 */
function normalizeEmail(email) {
    if (!email) return null;

    let normalized = email
        .normalize('NFC')
        .trim()
        .toLowerCase();

    const atIndex = normalized.lastIndexOf('@');
    if (atIndex <= 0 || atIndex === normalized.length - 1) {
        throw new Error('INVALID_EMAIL');
    }

    let local = normalized.slice(0, atIndex);
    let domain = normalized.slice(atIndex + 1);

    if (domain === 'googlemail.com') {
        domain = 'gmail.com';
    }

    if (domain === 'gmail.com') {
        local = local.split('+')[0].replace(/\./g, '');
    }

    return `${local}@${domain}`;
}

function isEmailAllowed(email, allowedDomainsStr) {
    if (!email) return false;
    const parts = email.split('@');
    if (parts.length !== 2) return false;
    const domain = parts[1];

    if (!allowedDomainsStr) return false;
    const allowedDomains = allowedDomainsStr
        .split(',')
        .map(d => d.trim().toLowerCase())
        .filter(d => d !== '');

    for (const allowed of allowedDomains) {
        if (allowed === '*') {
            return true;
        }
        if (domain === allowed) {
            return true;
        }
    }
    return false;
}

module.exports = {
    normalizeEmail,
    isEmailAllowed
};

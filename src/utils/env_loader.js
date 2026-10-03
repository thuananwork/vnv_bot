const dns = require('dns');
try { dns.setDefaultResultOrder('ipv4first'); } catch (e) {}

// Ép buộc phân giải IPv4 cho toàn bộ các thư viện HTTP (node-fetch, gaxios, undici, tls)
// để tránh lỗi timeout ETIMEDOUT 20-30s trên Windows do định tuyến IPv6 của nhà mạng
if (!dns.__vnv_ipv4_patched) {
    const origLookup = dns.lookup;
    dns.lookup = function (hostname, options, callback) {
        if (typeof options === 'function') {
            callback = options;
            options = { family: 4 };
        } else if (typeof options === 'number') {
            options = { family: 4 };
        } else if (options && typeof options === 'object') {
            options = { ...options, family: 4 };
        } else {
            options = { family: 4 };
        }
        return origLookup.call(this, hostname, options, callback);
    };
    dns.__vnv_ipv4_patched = true;
}
const fs = require('fs');
const path = require('path');

function loadEnv() {
    const envPath = path.join(__dirname, '../../config/.env');
    if (fs.existsSync(envPath)) {
        const content = fs.readFileSync(envPath, 'utf8');
        const lines = content.split('\n');
        for (const line of lines) {
            const trimmed = line.trim();
            if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
                const idx = trimmed.indexOf('=');
                const key = trimmed.slice(0, idx).trim();
                const val = trimmed.slice(idx + 1).trim();
                if (process.env[key] === undefined) {
                    process.env[key] = val;
                }
            }
        }
    }
}

loadEnv();

module.exports = { loadEnv };

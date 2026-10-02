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

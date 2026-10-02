const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '../..');

/**
 * Resolves the SHA-256 checksum of the canonical OAuth migration script (v2.1).
 * Works deterministically in both source development layout and packaged desktop layout.
 */
function getMigrationChecksum() {
    // 1. Check migration script source file on filesystem
    const scriptPath = path.join(ROOT, 'scripts/migration_v2.1_oauth.js');
    if (fs.existsSync(scriptPath)) {
        const content = fs.readFileSync(scriptPath, 'utf8');
        return crypto.createHash('sha256').update(content).digest('hex');
    }

    // 2. Check release manifest (release.json) packaged with production desktop builds
    const releasePath = path.join(ROOT, 'release.json');
    if (fs.existsSync(releasePath)) {
        try {
            const releaseManifest = JSON.parse(fs.readFileSync(releasePath, 'utf8'));
            if (releaseManifest && releaseManifest.migration_checksum) {
                return releaseManifest.migration_checksum;
            }
        } catch (e) {}
    }

    // 3. Check config/migration_manifest.json
    const manifestPath = path.join(ROOT, 'config/migration_manifest.json');
    if (fs.existsSync(manifestPath)) {
        try {
            const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
            if (manifest && manifest.migration_checksum) {
                return manifest.migration_checksum;
            }
        } catch (e) {}
    }

    // Fail-fast if no checksum source is available
    throw new Error('FATAL_MIGRATION_CHECKSUM_SOURCE_MISSING');
}

module.exports = {
    getMigrationChecksum
};

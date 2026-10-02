const fs = require('fs');
const path = require('path');
const os = require('os');

function generateDeploymentManifest() {
    const manifestPath = path.join(__dirname, '../../deployment.json');
    const manifest = {
        deployment_time: new Date().toISOString(),
        hostname: os.hostname(),
        version: process.env.APP_VERSION || '2.0.0',
        git_tag: process.env.GIT_TAG || 'v2.0.0',
        schema_version: '1.0',
        node_version: process.version
    };
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
    console.log(`[MANIFEST] Đã tạo tệp cấu hình triển khai: ${manifestPath}`);
}

if (require.main === module) {
    generateDeploymentManifest();
}

module.exports = {
    generateDeploymentManifest
};

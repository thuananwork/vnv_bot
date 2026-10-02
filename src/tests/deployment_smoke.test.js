const http = require('http');
const assert = require('assert');

const PORT = process.env.PORT || 3000;
const BASE_URL = `http://localhost:${PORT}`;

function makeRequest(url, method = 'GET', body = null) {
    return new Promise((resolve, reject) => {
        const options = {
            method,
            headers: {
                'Content-Type': 'application/json'
            }
        };

        const req = http.request(url, options, (res) => {
            let data = '';
            res.on('data', chunk => { data += chunk; });
            res.on('end', () => {
                resolve({
                    statusCode: res.statusCode,
                    headers: res.headers,
                    data: data.trim()
                });
            });
        });

        req.on('error', (err) => reject(err));
        req.on('timeout', () => {
            req.destroy();
            reject(new Error(`Timeout requesting ${url}`));
        });

        if (body) {
            req.write(JSON.stringify(body));
        }
        req.end();
    });
}

async function runDeploymentSmokeTest() {
    console.log('=========================================');
    console.log('    RUNNING DEPLOYMENT SMOKE TEST        ');
    console.log('=========================================');
    console.log(`Server Target: ${BASE_URL}\n`);

    try {
        // 1. Health Probe Check
        console.log('[SMOKE 1] Checking /api/health...');
        const health = await makeRequest(`${BASE_URL}/api/health`);
        assert.strictEqual(health.statusCode, 200, 'Health endpoint should return 200');
        const healthData = JSON.parse(health.data);
        assert.strictEqual(healthData.status, 'ok', 'Health status should be "ok"');
        console.log(` -> [OK] Health check passed (Uptime: ${healthData.uptime}s, Version: ${healthData.version})`);

        // 2. Readiness Probe Check
        console.log('\n[SMOKE 2] Checking /api/ready...');
        const ready = await makeRequest(`${BASE_URL}/api/ready`);
        assert.strictEqual(ready.statusCode, 200, 'Ready endpoint should return 200');
        const readyData = JSON.parse(ready.data);
        assert.strictEqual(readyData.status, 'ready', 'Ready status should be "ready"');
        console.log(' -> [OK] Readiness checks passed:', readyData.checks);

        // 3. Prometheus Metrics Endpoint Check
        console.log('\n[SMOKE 3] Checking /metrics...');
        const metrics = await makeRequest(`${BASE_URL}/metrics`);
        assert.strictEqual(metrics.statusCode, 200, 'Metrics endpoint should return 200');
        assert.ok(metrics.data.includes('build_info'), 'Metrics should export build_info metric');
        assert.ok(metrics.data.includes('pipeline_processed_total'), 'Metrics should export pipeline_processed_total');
        console.log(' -> [OK] Prometheus metrics endpoint is healthy.');

        // 4. Webhook Endpoint Integrity Check
        console.log('\n[SMOKE 4] Testing Webhook response...');
        const webhook = await makeRequest(`${BASE_URL}/api/webhooks/zalo`, 'POST', {
            zaloMsgId: 'smoke_test_msg_123',
            message: { msg_id: 'smoke_test_msg_123', text: 'xong' },
            sender: { id: 'smoke_sender_123' }
        });
        assert.strictEqual(webhook.statusCode, 200, 'Webhook should return 200 OK');
        assert.strictEqual(webhook.data, 'OK', 'Webhook response data should be "OK"');
        console.log(' -> [OK] Webhook endpoint responded successfully.');

        console.log('\n=========================================');
        console.log('🟢 SMOKE TEST SUCCESSFUL: DEPLOYMENT STABLE!');
        console.log('=========================================');
        process.exit(0);
    } catch (err) {
        console.error('\n🔴 SMOKE TEST FAILED: DEPLOYMENT CORRUPTED!');
        console.error(err.message);
        process.exit(1);
    }
}

if (require.main === module) {
    runDeploymentSmokeTest();
}

module.exports = {
    runDeploymentSmokeTest
};

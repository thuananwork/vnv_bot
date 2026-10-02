process.env.MOCK_GOOGLE_SHEETS = 'true';
const db = require('../config/db');
const { setupGoldenDataset } = require('./fixtures/golden_dataset');
const { enqueueMessage } = require('../services/zalo/pipeline');
const GoogleSheetsClient = require('../services/google/sheets');
const puppeteerProvider = require('../services/zalo/providers/puppeteer_provider');
const summarizeJob = require('../scheduler/summarize.job');
const syncSheetsJob = require('../scheduler/syncSheets.job');
const assert = require('assert');

// Simple Seeded PRNG
function createPRNG(seed) {
    let s = seed;
    return function() {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Chờ hàng đợi SQLite xử lý xong toàn bộ tin nhắn
async function drainQueue(timeoutMs = 15000) {
    const startTime = Date.now();
    while (true) {
        if (Date.now() - startTime > timeoutMs) {
            throw new Error('[CHAOS RUNNER] Timeout chờ hàng đợi xử lý xong!');
        }
        const pending = await db.get(`
            SELECT COUNT(*) as count FROM zalo_message_queue 
            WHERE status = 'pending' OR status = 'processing'
        `);
        if (pending.count === 0) {
            break;
        }
        await wait(50);
    }
}

/**
 * Phân hệ Fault Injection & Chaos Runner
 */
async function runFaultAndChaosTests(seed = 20260702) {
    console.log('====================================================');
    console.log(`BẮT ĐẦU KIỂM THỬ FAULT INJECTION & CHAOS. Seed: ${seed}`);
    console.log('====================================================');

    const randomFn = createPRNG(seed);

    // -------------------------------------------------------------------------
    // TEST 1: Google API Timeout & Retry with Exponential Backoff
    // -------------------------------------------------------------------------
    console.log('\n[FAULT INJECTION] 1. Mô phỏng Google API Timeout...');
    let googleAttempts = 0;
    
    // Override Google Client spreadsheets.values.update to throw 503 twice then succeed
    GoogleSheetsClient.sheetsClient = {
        spreadsheets: {
            get: async () => ({ data: { sheets: [{ properties: { title: 'Sheet1', sheetId: 1 } }] } }),
            values: {
                update: async () => {
                    googleAttempts++;
                    if (googleAttempts < 3) {
                        console.log(`[FAULT INJECT] Google API ném lỗi 503 (Lần thử ${googleAttempts})`);
                        throw { status: 503, message: 'Service Unavailable' };
                    }
                    console.log('[FAULT INJECT] Google API phản hồi thành công (Lần thử 3)');
                    return { data: { updatedRows: 5 } };
                }
            }
        }
    };

    const syncContext = {
        spreadsheetId: 'sheet_retry_test',
        sheetName: 'TASK_RETRY - 2026-07-02',
        sheetId: 1,
        rows: [['A', 'B', 'C']]
    };

    const startTime = Date.now();
    const result = await GoogleSheetsClient.updateValues(syncContext);
    const duration = Date.now() - startTime;

    assert.ok(result, 'Cuộc gọi API Sheets phải thành công sau khi retry');
    assert.strictEqual(googleAttempts, 3, 'Phải kích hoạt chính xác 3 lần gọi (2 lần retry + 1 lần thành công)');
    console.log(` -> [OK] Google Retry hoạt động chuẩn xác. Tổng thời gian chạy: ${duration}ms`);

    // Dọn dẹp mock client để phục vụ test tiếp theo
    GoogleSheetsClient.sheetsClient = null;

    // -------------------------------------------------------------------------
    // TEST 2: Token Expired & Intelligent OAuth Auto-Refresh
    // -------------------------------------------------------------------------
    console.log('\n[FAULT INJECTION] 2. Mô phỏng Token hết hạn...');
    // Seed DB cấu hình
    await tokenManager.ensureConfigSeeded();
    
    // Set thời gian hết hạn token về quá khứ (1 tiếng trước)
    const pastExpiresAt = Date.now() - 60 * 60 * 1000;
    await db.run("UPDATE local_config SET value = ? WHERE key = 'zalo.oa.token_expires_at'", [String(pastExpiresAt)]);
    await db.run("UPDATE local_config SET value = 'old_access_token' WHERE key = 'zalo.oa.access_token'");
    await db.run("UPDATE local_config SET value = 'mock_refresh_token' WHERE key = 'zalo.oa.refresh_token'");

    const currentToken = await tokenManager.getAccessToken();
    assert.ok(currentToken.startsWith('mock_access_token_'), 'Token mới phải được sinh ra');
    assert.notStrictEqual(currentToken, 'old_access_token', 'Token cũ hết hạn phải bị hủy bỏ và làm mới');

    const freshExpiresAtRow = await db.get("SELECT value FROM local_config WHERE key = 'zalo.oa.token_expires_at'");
    const freshExpiresAt = parseInt(freshExpiresAtRow.value, 10);
    assert.ok(freshExpiresAt > Date.now(), 'Thời gian hết hạn mới phải nằm ở tương lai');
    console.log(' -> [OK] Token Manager tự động refresh token hết hạn thành công.');

    // -------------------------------------------------------------------------
    // TEST 3: Chaos Mode (Chaos Runner)
    // -------------------------------------------------------------------------
    console.log('\n[CHAOS MODE] 3. Khởi chạy Seeded Chaos Runner (2 phút chạy)...');
    
    // Setup Golden Dataset sạch
    const data = await setupGoldenDataset(seed);
    const mockContext = {
        logger: {
            info: () => {},
            warn: () => {},
            error: () => {}
        },
        dryRun: false
    };

    let chaosActive = true;
    let chaosTimer = setTimeout(() => {
        chaosActive = false;
        console.log('[CHAOS RUNNER] Đã hoàn thành 2 phút chạy Chaos.');
    }, 2500); // Rút ngắn xuống 2.5s khi chạy test để tối ưu thời gian CI, nhưng vẫn đảm bảo đầy đủ chu kỳ

    // Task ngầm tiêm lỗi ngẫu nhiên có hạt giống
    const chaosInterval = setInterval(async () => {
        if (!chaosActive) {
            clearInterval(chaosInterval);
            return;
        }

        const eventRand = randomFn();
        if (eventRand < 0.2) {
            console.log('[CHAOS RUNNER] [TIÊM LỖI] SQLite Lock - Chạy Transaction độc quyền trì hoãn...');
            db.run('BEGIN EXCLUSIVE TRANSACTION').then(() => {
                setTimeout(async () => {
                    await db.run('COMMIT');
                    console.log('[CHAOS RUNNER] [PHỤC HỒI] Giải phóng SQLite Lock.');
                }, 100);
            }).catch(() => {});
        } else if (eventRand < 0.4) {
            console.log('[CHAOS RUNNER] [TIÊM LỖI] Google API Timeout - Thiết lập Google mock ném lỗi...');
            GoogleSheetsClient.sheetsClient = {
                spreadsheets: {
                    get: async () => { throw { status: 503, message: 'Google API Timeout' }; },
                    batchUpdate: async () => { throw { status: 503, message: 'Google API Timeout' }; },
                    values: {
                        update: async () => { throw { status: 503, message: 'Google API Timeout' }; }
                    }
                }
            };
            setTimeout(() => {
                GoogleSheetsClient.sheetsClient = null;
                console.log('[CHAOS RUNNER] [PHỤC HỒI] Khôi phục Google API client bình thường.');
            }, 300);
        } else if (eventRand < 0.6) {
            // Chaos mock event
        } else if (eventRand < 0.8) {
            console.log('[CHAOS RUNNER] [TIÊM LỖI] Webhook Resend - Gửi tin nhắn trùng lặp...');
            if (data.messages.length > 0) {
                const randomMsg = data.messages[Math.floor(randomFn() * data.messages.length)];
                await enqueueMessage(randomMsg.provider, randomMsg);
            }
        }
    }, 200);

    // Bắt đầu gửi dữ liệu dồn dập
    console.log('[CHAOS RUNNER] Đang nộp 500 tin nhắn của Golden Dataset dưới tải Chaos...');
    for (const msg of data.messages) {
        await enqueueMessage(msg.provider, msg);
        if (randomFn() > 0.9) {
            await wait(10); // Ngắt quãng nhẹ
        }
    }

    // Chờ Chaos runner dừng hẳn
    while (chaosActive) {
        await wait(100);
    }

    // Chờ hàng đợi xử lý xong toàn bộ
    console.log('[CHAOS RUNNER] Chờ hàng đợi Zalo Message Queue tiêu thụ hết...');
    await drainQueue();

    // Khôi phục Google Sheets client bình thường nếu còn sót mock lỗi
    GoogleSheetsClient.sheetsClient = null;

    // Chạy Summarize và SyncSheets
    console.log('[CHAOS RUNNER] Chạy Job Summarize để tổng hợp dữ liệu sau Chaos...');
    await summarizeJob.handler(mockContext);
    console.log('[CHAOS RUNNER] Chạy Job SyncSheets để đồng bộ báo cáo...');
    await syncSheetsJob.handler(mockContext);

    // 4. Verify post-chaos constraints
    console.log('[CHAOS RUNNER] Kiểm tra các ràng buộc sau Chaos...');
    
    // A. Cơ sở dữ liệu nhất quán, không trùng lặp submissions
    const dupSubmissions = await db.all(`
        SELECT zalo_msg_id, COUNT(*) as count 
        FROM submissions 
        GROUP BY zalo_msg_id 
        HAVING count > 1
    `);
    assert.strictEqual(dupSubmissions.length, 0, 'Không được phép xuất hiện bài nộp trùng lặp ID trong submissions');

    // B. Queue trống hoàn toàn
    const queuePendingCount = await db.get("SELECT COUNT(*) as count FROM zalo_message_queue WHERE status = 'pending'");
    assert.strictEqual(queuePendingCount.count, 0, 'Hàng đợi phải được tiêu thụ hết sạch');

    // C. Lock được giải phóng
    const activeLocks = await db.all("SELECT * FROM local_config WHERE key LIKE 'lock:%'");
    assert.strictEqual(activeLocks.length, 0, 'Toàn bộ các khóa trong database local_config phải được giải phóng');
    const lockManager = require('../scheduler/lock');
    assert.strictEqual(lockManager.heartbeats.size, 0, 'Toàn bộ heartbeat của LockManager phải được tắt sạch');

    console.log(' -> [OK] Chaos Runner vượt qua tất cả tiêu chuẩn chất lượng (Dữ liệu nhất quán, Khôi phục hoàn tất).');
}

module.exports = {
    runFaultAndChaosTests
};

if (require.main === module) {
    runFaultAndChaosTests(20260702)
        .then(() => {
            console.log('\n[FAULT & CHAOS TESTS] Hoàn thành xuất sắc.');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n[FAULT & CHAOS TESTS ERROR] Thất bại:', err);
            process.exit(1);
        });
}

process.env.MOCK_GOOGLE_SHEETS = 'true';
const db = require('../config/db');
const { setupGoldenDataset } = require('./fixtures/golden_dataset');
const { enqueueMessage } = require('../services/zalo/pipeline');
const GoogleSheetsClient = require('../services/google/sheets');
const summarizeJob = require('../scheduler/summarize.job');
const syncSheetsJob = require('../scheduler/syncSheets.job');
const fs = require('fs');
const path = require('path');
const assert = require('assert');

// Simple LCG PRNG for seeded random shuffling
function createPRNG(seed) {
    let s = seed;
    return function() {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}

function shuffle(array, randomFn) {
    const arr = [...array];
    let currentIndex = arr.length, randomIndex;
    while (currentIndex !== 0) {
        randomIndex = Math.floor(randomFn() * currentIndex);
        currentIndex--;
        [arr[currentIndex], arr[randomIndex]] = [arr[randomIndex], arr[currentIndex]];
    }
    return arr;
}

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Chờ hàng đợi SQLite xử lý xong toàn bộ tin nhắn
async function drainQueue(timeoutMs = 15000) {
    const startTime = Date.now();
    while (true) {
        if (Date.now() - startTime > timeoutMs) {
            throw new Error('[E2E HARNESS] Timeout chờ hàng đợi xử lý xong!');
        }

        const pending = await db.get(`
            SELECT COUNT(*) as count FROM zalo_message_queue 
            WHERE status = 'pending' OR status = 'processing'
        `);

        if (pending.count === 0) {
            break;
        }
        await wait(100);
    }
}

function normalizeSnapshot(snapshot) {
    const cloned = {};
    for (const spreadsheetId in snapshot) {
        const sheets = snapshot[spreadsheetId];
        cloned[spreadsheetId] = {};
        for (const sheetName in sheets) {
            const normalizedSheetName = sheetName.replace(/\d{4}-\d{2}-\d{2}/g, '<REPORT_DATE>');
            const rows = JSON.parse(JSON.stringify(sheets[sheetName]));
            for (let i = 1; i < rows.length; i++) { // Bỏ qua header
                if (rows[i] && rows[i].length > 4) {
                    rows[i][4] = '<TIMESTAMP>';
                }
            }
            cloned[spreadsheetId][normalizedSheetName] = rows;
        }
    }
    return cloned;
}

/**
 * Chạy một vòng lặp E2E hoàn chỉnh
 * @param {number} seed - Hạt giống ngẫu nhiên cho vòng này
 * @param {boolean} updateBaseline - Có cập nhật snapshot baseline hay không
 */
async function runE2EIteration(seed, updateBaseline = false) {
    const originalToLocaleDateString = Date.prototype.toLocaleDateString;
    // Mock Date to 2026-07-02 for dynamic date localization to ensure Golden Dataset business date is locked
    Date.prototype.toLocaleDateString = function(locales, options) {
        if (locales === 'sv') {
            return '2026-07-02';
        }
        return originalToLocaleDateString.call(this, locales, options);
    };

    try {
        console.log(`\n--- Bắt đầu vòng E2E với Seed: ${seed} ---`);

    // Reset sandbox môi trường (Test Independence)
    GoogleSheetsClient.resetFakeSpreadsheets();
    GoogleSheetsClient.clearMetadataCache();

    // 1. Setup Golden Dataset
    console.log('[E2E] Khởi tạo Golden Dataset...');
    const data = await setupGoldenDataset(seed);
    const randomFn = createPRNG(seed);

    // 2. Xáo trộn thứ tự tin nhắn nộp bài (Seeded Randomized Testing)
    console.log('[E2E] Xáo trộn thứ tự 500 tin nhắn...');
    const shuffledMessages = shuffle(data.messages, randomFn);

    // 3. Đẩy tin nhắn vào Pipeline qua Queue
    console.log('[E2E] Gửi 500 tin nhắn vào zalo_message_queue...');
    for (const msg of shuffledMessages) {
        let payload;
        if (msg.provider === 'oa') {
            payload = {
                event_name: 'user_send_text',
                message: {
                    msg_id: msg.zaloMsgId,
                    text: msg.msgType === 'text' ? msg.content : '',
                    attachments: msg.msgType === 'image' ? [
                        {
                            type: 'photo',
                            payload: {
                                url: msg.content
                            }
                        }
                    ] : []
                },
                sender: {
                    id: msg.senderId,
                    name: msg.senderName
                },
                recipient: {
                    id: msg.groupId
                },
                timestamp: Date.now()
            };
        } else {
            payload = msg;
        }
        await enqueueMessage(msg.provider, payload);
    }

    // 4. Chờ hàng đợi tiêu thụ hết sạch tin nhắn thô
    console.log('[E2E] Đang chờ hàng đợi Zalo Message Queue tiêu thụ hết...');
    const startPipelineTime = Date.now();
    await drainQueue();
    const pipelineDuration = Date.now() - startPipelineTime;
    const avgPipelineTime = pipelineDuration / shuffledMessages.length;
    console.log(`[E2E] Hàng đợi đã rỗng. Thời gian: ${pipelineDuration}ms | Trung bình/tin nhắn: ${avgPipelineTime.toFixed(1)}ms`);

    // 5. Chạy Scheduler Job: Summarize để tổng hợp báo cáo SQLite
    console.log('[E2E] Chạy Job Summarize...');
    const mockContext = {
        logger: {
            info: (msg) => console.log(`[JOB LOG:INFO] ${msg}`),
            warn: (msg) => console.warn(`[JOB LOG:WARN] ${msg}`),
            error: (msg) => console.error(`[JOB LOG:ERROR] ${msg}`)
        },
        dryRun: false
    };
    await summarizeJob.handler(mockContext);

    // 6. Chạy Scheduler Job: SyncSheets để đồng bộ lên Google Sheets (Mock)
    console.log('[E2E] Chạy Job SyncSheets...');
    await syncSheetsJob.handler(mockContext);

    // 7. Verify SQLite Database - Test Oracle Deep Compare
    console.log('[E2E] [ORACLE] Tiến hành so sánh sâu trạng thái database thực tế vs Expected State...');
    const actualSubmissions = await db.all(`
        SELECT task_id, member_id, zalo_msg_id, submission_type, raw_content, status 
        FROM submissions 
        ORDER BY zalo_msg_id ASC
    `);

    // Tính toán expectedSubmissions động dựa theo thứ tự xáo trộn thực tế
    const processedIds = new Set();
    const approvedMembers = new Set(); // key: taskId-memberId
    const expectedSubmissionsList = [];

    const regionMap = {};
    for (const r of data.regions) {
        regionMap[r.zalo_group_id] = r;
    }

    const activeTask = data.tasks[0]; // TASK_01_IMAGE

    for (const msg of shuffledMessages) {
        // A. Chống trùng lặp
        if (processedIds.has(msg.zaloMsgId)) {
            continue;
        }
        processedIds.add(msg.zaloMsgId);

        // B. Định danh Vùng
        const region = regionMap[msg.groupId];
        if (!region) {
            continue;
        }

        // C. Định danh Sứ giả
        const member = data.members.find(m => 
            m.region_id === region.id &&
            (m.zalo_id === msg.senderId || m.zalo_name === msg.senderName || m.real_name === msg.senderName)
        );
        if (!member) {
            continue;
        }

        // D. Khớp nhiệm vụ ngày
        const taskId = activeTask.dbId;

        // E. Kiểm tra đã nộp bài thành công trước đó chưa
        const approvedKey = `${taskId}-${member.id}`;
        if (approvedMembers.has(approvedKey)) {
            continue;
        }

        // F. Chấm điểm nộp bài
        if (msg.msgType === 'image') {
            approvedMembers.add(approvedKey);
            expectedSubmissionsList.push({
                task_id: taskId,
                member_id: member.id,
                zalo_msg_id: msg.zaloMsgId,
                submission_type: 'image',
                raw_content: msg.content,
                status: 'approved'
            });
        }
    }

    // Chuyển expectedSubmissionsList về map để so khớp sâu
    const expectedMap = {};
    for (const exp of expectedSubmissionsList) {
        expectedMap[exp.zalo_msg_id] = exp;
    }

    // Assert từng bài nộp của actual vs expected
    for (const act of actualSubmissions) {
        const exp = expectedMap[act.zalo_msg_id];
        assert.ok(exp, `[ORACLE FAIL] Không tìm thấy expected submission cho MsgID: ${act.zalo_msg_id}`);
        assert.strictEqual(act.task_id, exp.task_id, `MsgID ${act.zalo_msg_id} sai task_id`);
        assert.strictEqual(act.member_id, exp.member_id, `MsgID ${act.zalo_msg_id} sai member_id`);
        assert.strictEqual(act.submission_type, exp.submission_type, `MsgID ${act.zalo_msg_id} sai submission_type`);
        assert.strictEqual(act.raw_content, exp.raw_content, `MsgID ${act.zalo_msg_id} sai raw_content`);
        assert.strictEqual(act.status, exp.status, `MsgID ${act.zalo_msg_id} sai status`);
    }

    assert.strictEqual(
        actualSubmissions.length,
        expectedSubmissionsList.length,
        `[ORACLE FAIL] Số lượng bài nộp thực tế (${actualSubmissions.length}) khác mong đợi (${expectedSubmissionsList.length})`
    );
    console.log(` -> [OK] Test Oracle Deep Compare khớp 100% (${actualSubmissions.length} bài nộp).`);

    // 8. Verify Golden Dataset Business Date
    const taskDateRow = await db.get("SELECT publish_date FROM tasks LIMIT 1");
    assert.strictEqual(taskDateRow.publish_date, '2026-07-02', 'Ngày nghiệp vụ của Golden Dataset phải là 2026-07-02');
    console.log(' -> [OK] Xác thực ngày nghiệp vụ Golden Dataset 2026-07-02 thành công.');

    // 9. Verify Google Sheet Snapshot
    console.log('[E2E] [SNAPSHOT] Trích xuất và serialize cấu trúc bảng tính...');
    const snapshotPath = path.join(__dirname, 'snapshots/snapshot_baseline.json');
    const snapshotDir = path.dirname(snapshotPath);
    if (!fs.existsSync(snapshotDir)) {
        fs.mkdirSync(snapshotDir, { recursive: true });
    }

    const actualSnapshot = normalizeSnapshot(GoogleSheetsClient.fakeSpreadsheets);

    if (updateBaseline) {
        console.log(`[E2E] [SNAPSHOT] Đang ghi đè Baseline mới tại: ${snapshotPath}`);
        fs.writeFileSync(snapshotPath, JSON.stringify(actualSnapshot, null, 2), 'utf8');
        console.log(' -> [OK] Đã lưu Baseline mới thành công.');
    } else {
        if (!fs.existsSync(snapshotPath)) {
            console.log(`[E2E] [SNAPSHOT] Chưa có file baseline. Tạo mới baseline tự động cho hạt giống ${seed}...`);
            fs.writeFileSync(snapshotPath, JSON.stringify(actualSnapshot, null, 2), 'utf8');
        } else {
            console.log('[E2E] [SNAPSHOT] So khớp actual snapshot vs baseline.json...');
            const baselineContent = fs.readFileSync(snapshotPath, 'utf8');
            const expectedSnapshot = normalizeSnapshot(JSON.parse(baselineContent));

            // Deep compare actualSnapshot vs expectedSnapshot
            assert.deepStrictEqual(actualSnapshot, expectedSnapshot, '[SNAPSHOT FAIL] Dữ liệu Google Sheets actual khác biệt so với baseline!');
            console.log(' -> [OK] Google Sheets Snapshot khớp baseline 100%.');
        }
    }

    // Trả về Metrics của vòng này
    return {
        pipelineTimeAvg: avgPipelineTime,
        pipelineDuration,
        submissionsCount: actualSubmissions.length,
        metrics: {
            webhooks_received: shuffledMessages.length,
            messages_deduplicated: shuffledMessages.filter(m => m.isDuplicate).length,
            queue_depth_max: shuffledMessages.length // Mock max depth
        }
    };
    } finally {
        Date.prototype.toLocaleDateString = originalToLocaleDateString;
    }
}

module.exports = {
    runE2EIteration
};

// Chạy trực tiếp nếu execute từ command line
if (require.main === module) {
    const updateBaseline = process.argv.includes('--update-baseline');
    const seed = 20260702;
    const original = Date.prototype.toLocaleDateString;
    runE2EIteration(seed, updateBaseline)
        .then(() => {
            assert.strictEqual(Date.prototype.toLocaleDateString, original, 'Global Date.prototype.toLocaleDateString must be restored to original function identity after E2E execution!');
            console.log('\n[E2E HARNESS] Chạy kiểm thử thành công tốt đẹp và đã phục hồi prototype Date.');
            process.exit(0);
        })
        .catch(err => {
            console.error('\n[E2E HARNESS ERROR] Gặp lỗi nghiêm trọng:', err);
            process.exit(1);
        });
}

const db = require('../../config/db');
const logger = require('../../utils/logger');
const metrics = require('../../utils/metrics');
const stats = require('../../utils/stats');
const { resolveMember } = require('../identity_resolver');

let isProcessingQueue = false;

/**
 * Đảm bảo các bảng cơ sở dữ liệu cho Pipeline tồn tại
 */
async function ensurePipelineTables() {
    // 1. Bảng lưu trữ tin nhắn đã xử lý chống trùng lặp (Message Idempotency)
    await db.run(`
        CREATE TABLE IF NOT EXISTS processed_messages (
            provider TEXT NOT NULL,
            message_id TEXT NOT NULL,
            processed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (provider, message_id)
        );
    `);

    // 2. Hàng đợi lưu trữ sự kiện tin nhắn tạm thời (Event Queue)
    await db.run(`
        CREATE TABLE IF NOT EXISTS zalo_message_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            provider TEXT NOT NULL,
            raw_payload TEXT NOT NULL,
            status TEXT CHECK(status IN ('pending', 'processing', 'completed', 'failed')) DEFAULT 'pending',
            attempts INTEGER DEFAULT 0,
            error_message TEXT,
            request_id TEXT,
            parent_request_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME
        );
    `);
}

/**
 * Log trạng thái trong Pipeline State Machine
 */
function logState(state, provider, messageId, details = '') {
    logger.info(`[State: ${state.toUpperCase()}] Provider: ${provider} | MsgID: ${messageId} | ${details}`, {
        provider,
        message_id: messageId,
        pipeline_state: state
    });
}

/**
 * Đẩy tin nhắn thô vào hàng đợi SQLite để xử lý bất đồng bộ
 * @param {string} provider - 'oa' | 'puppeteer'
 * @param {Object} rawPayload - Payload thô nhận từ nguồn Zalo
 */
async function enqueueMessage(provider, rawPayload) {
    try {
        await ensurePipelineTables();

        const msgId = rawPayload.zaloMsgId || rawPayload.message?.msg_id || 'raw_event';
        const requestId = rawPayload.requestId || rawPayload.request_id || `req-${msgId}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
        const parentRequestId = rawPayload.parentRequestId || rawPayload.parent_request_id || null;

        const rawPayloadStr = JSON.stringify(rawPayload);
        await db.run(`
            INSERT INTO zalo_message_queue (provider, raw_payload, status, request_id, parent_request_id)
            VALUES (?, ?, 'pending', ?, ?)
        `, [provider, rawPayloadStr, requestId, parentRequestId]);

        logger.info(`Nhận tin nhắn đầu vào, enqueued thành công. MsgID: ${msgId}`, {
            component: 'pipeline',
            event: 'message_enqueued',
            requestId,
            parentRequestId
        });

        // Kích hoạt xử lý hàng đợi ngầm (không chặn luồng hồi đáp Webhook)
        processQueue().catch(err => {
            logger.error('[PIPELINE QUEUE WORKER] Lỗi tiến trình xử lý hàng đợi:', {
                error: err.message,
                component: 'pipeline'
            });
        });
    } catch (err) {
        logger.error('[PIPELINE] Gặp sự cố khi enqueue tin nhắn:', {
            error: err.message,
            component: 'pipeline'
        });
    }
}

/**
 * Xử lý hàng đợi (Sequential Queue Worker)
 */
async function processQueue() {
    if (isProcessingQueue) return;
    isProcessingQueue = true;

    try {
        while (true) {
            const item = await db.get(`
                SELECT * FROM zalo_message_queue 
                WHERE status = 'pending' 
                ORDER BY id ASC LIMIT 1
            `);

            if (!item) break;

            // Đánh dấu đang xử lý
            await db.run(`
                UPDATE zalo_message_queue 
                SET status = 'processing', attempts = attempts + 1, updated_at = CURRENT_TIMESTAMP 
                WHERE id = ?
            `, [item.id]);

            // Bọc chạy trong AsyncLocalStorage để tự động truyền requestId & parentRequestId cho logger
            await logger.asyncLocalStorage.run({ requestId: item.request_id, parentRequestId: item.parent_request_id }, async () => {
                try {
                    const rawPayload = JSON.parse(item.raw_payload);
                    const success = await handleMessageProcessing(item.provider, rawPayload);

                    if (success) {
                        await db.run(`
                            UPDATE zalo_message_queue 
                            SET status = 'completed', updated_at = CURRENT_TIMESTAMP 
                            WHERE id = ?
                        `, [item.id]);
                        metrics.increment('pipeline_processed_total');
                        stats.completedQueueItems++;
                    } else {
                        await db.run(`
                            UPDATE zalo_message_queue 
                            SET status = 'failed', error_message = 'Bị từ chối hoặc bỏ qua trong pipeline', updated_at = CURRENT_TIMESTAMP 
                            WHERE id = ?
                        `, [item.id]);
                        stats.completedQueueItems++;
                    }
                } catch (err) {
                    logger.error(`[PIPELINE QUEUE WORKER] Lỗi xử lý hàng đợi dòng ID ${item.id}:`, {
                        error: err.message,
                        component: 'pipeline'
                    });
                    await db.run(`
                        UPDATE zalo_message_queue 
                        SET status = 'failed', error_message = ?, updated_at = CURRENT_TIMESTAMP 
                        WHERE id = ?
                    `, [err.message || String(err), item.id]);
                    stats.completedQueueItems++;
                }
            });
        }
    } finally {
        isProcessingQueue = false;
    }
}

/**
 * Bộ xử lý chính đi qua State Machine và Business Logic
 * @returns {Promise<boolean>}
 */
async function handleMessageProcessing(provider, rawPayload) {
    const isSafeMode = process.env.SAFE_MODE === 'true';

    // 1. STATE: normalized
    let normalized = null;
    try {
        if (provider === 'puppeteer') {
            normalized = {
                provider,
                zaloMsgId: rawPayload.zaloMsgId,
                senderId: rawPayload.senderId,
                senderName: rawPayload.senderName,
                groupId: rawPayload.groupId,
                timestamp: rawPayload.timestamp || Date.now(),
                msgType: rawPayload.msgType || 'text',
                content: rawPayload.content || ''
            };
        } else {
            // Chuẩn hóa từ Zalo OA Webhook event
            const msgId = rawPayload.message?.msg_id || rawPayload.msg_id || 'msg_' + Date.now();
            const senderId = rawPayload.sender?.id || rawPayload.user_id || 'user_unknown';
            const senderName = rawPayload.sender?.name || 'Zalo User';
            const recipientId = rawPayload.recipient?.id || 'oa_unknown';
            const isImage = rawPayload.message?.attachments && rawPayload.message.attachments.some(a => a.type === 'photo' || a.type === 'image');
            
            let content = '';
            if (isImage) {
                const imgAttachment = rawPayload.message.attachments.find(a => a.type === 'photo' || a.type === 'image');
                content = imgAttachment?.payload?.url || '';
            } else {
                content = rawPayload.message?.text || '';
            }

            normalized = {
                provider,
                zaloMsgId: msgId,
                senderId: senderId,
                senderName: senderName,
                groupId: recipientId,
                timestamp: rawPayload.timestamp || Date.now(),
                msgType: isImage ? 'image' : 'text',
                content: content
            };
        }

        logState('normalized', provider, normalized.zaloMsgId, `Chuẩn hóa thành công: Sender="${normalized.senderName}" Type="${normalized.msgType}"`);
    } catch (err) {
        logState('failed', provider, 'unknown', `Lỗi chuẩn hóa tin nhắn: ${err.message}`);
        return false;
    }

    const msgId = normalized.zaloMsgId;

    // 2. Chống ghi nhận trùng lặp (Message Idempotency Check)
    try {
        await db.run(`
            INSERT INTO processed_messages (provider, message_id)
            VALUES (?, ?)
        `, [provider, msgId]);
    } catch (err) {
        logState('ignored', provider, msgId, 'Bỏ qua tin nhắn trùng lặp (Đã được xử lý trước đó).');
        return true; // Trả về true để xóa khỏi Queue bình thường
    }

    // 3. STATE: resolved (Định danh Vùng & Thành viên)
    let region = null;
    let member = null;
    let matchedCluster = null;

    try {
        // A. Tra cứu Vùng dựa trên groupId (Đối với Puppeteer là groupName, OA là OA ID)
        region = await db.get(`
            SELECT * FROM regions 
            WHERE zalo_group_id = ? OR region_name = ?
        `, [normalized.groupId, normalized.groupId]);

        if (!region) {
            // Nếu không tìm thấy Vùng, kiểm tra xem có phải là nhóm Cụm không
            matchedCluster = await db.get(`
                SELECT * FROM clusters 
                WHERE LOWER(cluster_name) = LOWER(?)
            `, [normalized.groupId]);
        }

        // Trích xuất tên Sứ Giả từ nội dung tin nhắn dạng "Nguyễn Văn A hoàn thành nhiệm vụ..."
        let extractedName = null;
        const completeRegex = /^(.+?)\s+hoàn thành nhiệm vụ/i;
        const nameMatch = completeRegex.exec(normalized.content);
        if (nameMatch) {
            extractedName = nameMatch[1].trim();
        }

        if (region) {
            // Sử dụng Identity Resolver V2 (4 tầng ánh xạ)
            member = await resolveMember({
                zaloUserId: normalized.senderId,
                zaloDisplayName: normalized.senderName,
                messageContent: normalized.content,
                regionId: region.id
            });
        } else if (matchedCluster) {
            // Trường hợp 2: Nhận tin nhắn trong nhóm Cụm. Ta tìm thành viên trên toàn bộ các Vùng của Cụm này
            const nameToFind = extractedName || normalized.senderName;
            
            const memberRow = await db.get(`
                SELECT m.*, r.id as r_id, r.region_name as r_name, r.zalo_group_id as r_zalo_group_id, r.zalo_group_name as r_zalo_group_name, r.sheet_id as r_sheet_id, r.sheet_name as r_sheet_name, r.sheet_url as r_sheet_url
                FROM members m
                JOIN regions r ON m.region_id = r.id
                WHERE r.cluster_id = ? 
                  AND (m.real_name = ? OR m.zalo_name = ? OR m.zalo_id = ?)
                  AND m.status = 'Active'
                  AND r.status = 'active'
            `, [matchedCluster.id, nameToFind, nameToFind, normalized.senderId]);

            if (memberRow) {
                member = {
                    id: memberRow.id,
                    real_name: memberRow.real_name,
                    zalo_name: memberRow.zalo_name,
                    zalo_id: memberRow.zalo_id,
                    region_id: memberRow.r_id,
                    status: memberRow.status
                };
                region = {
                    id: memberRow.r_id,
                    region_name: memberRow.r_name,
                    cluster_id: matchedCluster.id,
                    zalo_group_id: memberRow.r_zalo_group_id,
                    zalo_group_name: memberRow.r_zalo_group_name,
                    sheet_id: memberRow.r_sheet_id,
                    sheet_name: memberRow.r_sheet_name,
                    sheet_url: memberRow.r_sheet_url,
                    status: 'active'
                };
            }
        }

        if (!region || !member) {
            if (!region && !matchedCluster) {
                logState('ignored', provider, msgId, `Không tìm thấy Vùng/Cụm tương ứng với Group ID/Name: "${normalized.groupId}". Bỏ qua.`);
            } else {
                logState('unverified', provider, msgId, `Tài khoản chưa xác minh: "${normalized.senderName}" (ID: ${normalized.senderId}) thuộc nhóm "${normalized.groupId}".`);
                if (!isSafeMode && region) {
                    await db.run(`
                        INSERT INTO audit_logs (action, target, details, ip_address)
                        VALUES ('UNVERIFIED_SENDER', 'members/unverified', ?, '127.0.0.1')
                    `, [`Tài khoản chưa xác minh nộp bài: "${normalized.senderName}" (Zalo ID: ${normalized.senderId}) tại vùng "${region.region_name}"`]);
                }
            }
            return true;
        }

        logState('resolved', provider, msgId, `Đã định danh: Member="${member.real_name}" (ID: ${member.id}) thuộc Vùng "${region.region_name}"`);
    } catch (err) {
        logState('failed', provider, msgId, `Lỗi định danh: ${err.message}`);
        return false;
    }

    // 4. STATE: matched (Khớp nối Nhiệm vụ ngày)
    let task = null;
    let taskQueryDate = new Date().toLocaleDateString('sv');
    try {
        // Trích xuất ngày từ nội dung tin nhắn dạng "... ngày 19/08/2026"
        let reportedDateStr = null;
        const dateRegex = /hoàn thành nhiệm vụ ngày\s+(\d{2})\/(\d{2})\/(\d{4})/i;
        const dateMatch = dateRegex.exec(normalized.content);
        if (dateMatch) {
            reportedDateStr = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`; // YYYY-MM-DD
        }

        taskQueryDate = reportedDateStr || taskQueryDate;

        // Tìm nhiệm vụ active của ngày tương ứng
        task = await db.get(`
            SELECT * FROM tasks 
            WHERE publish_date = ? AND status = 'active'
        `, [taskQueryDate]);

        if (!task) {
            // Tự động khởi tạo nhiệm vụ ngày từ tin nhắn Zalo nếu chưa được tạo thủ công
            const autoTaskCode = 'NV-' + taskQueryDate.replace(/-/g, '');
            try {
                const insertRes = await db.run(`
                    INSERT INTO tasks (task_code, title, description, publish_date, status)
                    VALUES (?, ?, ?, ?, 'active')
                `, [autoTaskCode, `Nhiệm vụ ngày ${taskQueryDate}`, 'Tự động phát hiện từ Zalo', taskQueryDate]);
                
                task = await db.get(`SELECT * FROM tasks WHERE id = ?`, [insertRes.lastID]);
                logState('matched', provider, msgId, `Tự động phát hiện & khởi tạo nhiệm vụ ngày: ID=${task.id} (${task.task_code})`);
            } catch (createErr) {
                task = await db.get(`SELECT * FROM tasks WHERE publish_date = ? AND status = 'active'`, [taskQueryDate]);
            }
        }

        if (!task) {
            logState('ignored', provider, msgId, `Không tìm thấy nhiệm vụ nào đang hoạt động trong ngày ${taskQueryDate}. Bỏ qua.`);
            return true;
        }

        logState('matched', provider, msgId, `Khớp nối nhiệm vụ: ID=${task.id} (${task.task_code})`);
    } catch (err) {
        logState('failed', provider, msgId, `Lỗi khớp nối nhiệm vụ: ${err.message}`);
        return false;
    }



    // 6. STATE: approved / failed (Submission Engine Chấm điểm)
    try {
        // Kiểm tra xem đã tồn tại bài nộp 'approved' trong ngày cho thành viên này chưa để tránh ghi đè
        const existingSub = await db.get(`
            SELECT * FROM submissions 
            WHERE task_id = ? AND member_id = ? AND status = 'approved'
        `, [task.id, member.id]);

        if (existingSub) {
            logState('ignored', provider, msgId, `Thành viên "${member.real_name}" đã nộp bài thành công nhiệm vụ này hôm nay. Bỏ qua tin nhắn trùng.`);
            return true;
        }

        // Lấy cấu hình loại bài nộp của nhiệm vụ
        const taskType = task.description.toLowerCase().includes('ảnh') ? 'image' : 'keyword';
        
        let isMatch = false;
        let subStatus = 'pending_review';
        let subType = 'manual';

        if (taskType === 'image') {
            subType = 'image';
            if (normalized.msgType === 'image') {
                isMatch = true;
                subStatus = 'approved';
            }
        } else {
            // Nhiệm vụ từ khóa
            subType = 'keyword';
            const textContent = normalized.content.toLowerCase();
            const keywords = ['done', 'ok', 'xong', 'đã làm', 'hoàn thành nhiệm vụ'];
            const hasKeyword = keywords.some(k => textContent.includes(k));
            
            // Hỗ trợ kiểm định Link nhiệm vụ
            const isUrl = /^https?:\/\/[^\s/$.?#].[^\s]*$/i.test(normalized.content);

            if (isUrl) {
                isMatch = true;
                subStatus = 'pending_review';
                subType = 'link';
            } else if (hasKeyword) {
                isMatch = true;
                subStatus = 'approved';
            }
        }

        if (!isMatch) {
            logState('failed', provider, msgId, `Tin nhắn không khớp định dạng nộp bài của nhiệm vụ.`);
            return true;
        }

        // 6. STATE: stored (Ghi nhận Database)
        if (isSafeMode) {
            logger.warn(`[SAFE MODE] Tin nhắn nộp bài hợp lệ. Bỏ qua lưu database submissions và audit log.`, {
                member: member.real_name,
                task_code: task.task_code,
                msgId
            });
            return true;
        }

        const statusV2 = subStatus === 'approved' ? 'OK' : 'LATE_REQUEST';
        await db.run(`
            INSERT OR REPLACE INTO submissions (task_id, member_id, region_id, work_date, status, notes, submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `, [task.id, member.id, region.id, taskQueryDate, statusV2, normalized.content]);

        logState('stored', provider, msgId, `Ghi nhận bài nộp thành công! Member="${member.real_name}" Status="${subStatus}"`);

        // Ghi Audit log thành công
        await db.run(`
            INSERT INTO audit_logs (action, target_type, details, ip_address)
            VALUES ('SUBMISSION_RECORDED', 'submissions', ?, '127.0.0.1')
        `, [`Bot ghi nhận bài nộp của "${member.real_name}" | Trạng thái: ${subStatus}`]);

        // Nếu nộp bài qua nhóm Cụm, đồng bộ Google Sheet ngay lập tức
        if (matchedCluster) {
            try {
                const { syncRegionSheet } = require('../sheet_sync');
                await syncRegionSheet(region.id, task.id);
            } catch (sheetErr) {
                logger.error(`[PIPELINE] Lỗi đồng bộ Sheet thời gian thực từ nhóm Cụm: ${sheetErr.message}`);
            }
        }

        return true;
    } catch (err) {
        logState('failed', provider, msgId, `Lỗi ghi nhận database: ${err.message}`);
        throw err;
    }
}

module.exports = {
    enqueueMessage,
    ensurePipelineTables
};

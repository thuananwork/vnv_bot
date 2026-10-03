const db = require('../config/db');
const { generateRegionReport, generateClusterReport } = require('./reports_v2');
const { syncRegionMatrixSheet } = require('./sheet_matrix_sync');
const { resolveMember } = require('./identity_resolver');
const { parseMessageSubmission } = require('./message_parser');

class OnDemandActionService {
    /**
     * 1. NÚT: [CHIA SẺ NHIỆM VỤ]
     * Lấy bài nhiệm vụ từ Group Cụm/BĐH và gửi về Group Vùng
     */
    async forwardTask({ regionId, workDate, taskContent, sourceGroup = 'CỤM 5' }) {
        const todayStr = workDate || new Date().toLocaleDateString('sv');
        const taskCode = 'TSK-C5-' + todayStr.replace(/-/g, '') + '-01';

        // Lưu hoặc cập nhật nhiệm vụ trong DB
        const content = taskContent || `Nhiệm vụ truyền thông ngày ${todayStr}: Sứ giả vui lòng tương tác link Facebook và nộp ảnh vào nhóm trước 22h00.`;
        
        await db.run(`
            INSERT OR REPLACE INTO tasks (task_code, title, description, publish_date, source_group, status)
            VALUES (?, ?, ?, ?, ?, 'active')
        `, [taskCode, `Nhiệm vụ ngày ${todayStr}`, content, todayStr, sourceGroup]);

        let targetRegions = [];
        if (regionId) {
            const r = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
            if (r) targetRegions.push(r);
        } else {
            targetRegions = await db.all("SELECT * FROM regions WHERE status = 'active' ORDER BY id ASC");
        }

        // Cập nhật FSM ngày
        await db.run(`
            INSERT OR REPLACE INTO daily_operations (work_date, state, task_forwarded, task_source_group, task_content, updated_at)
            VALUES (?, 'TASK_FORWARDED', 1, ?, ?, CURRENT_TIMESTAMP)
        `, [todayStr, sourceGroup, content]);

        console.log(`[ON-DEMAND] Đã chia sẻ nhiệm vụ "${taskCode}" tới ${targetRegions.length} Vùng.`);

        return {
            success: true,
            taskCode,
            publishDate: todayStr,
            forwardedRegions: targetRegions.map(r => r.region_name),
            content
        };
    }

    /**
     * 2. NÚT: [QUÉT BÀI & XUẤT BÁO CÁO VÙNG] (MẪU 1)
     * Quét tin nhắn trong ngày -> Ghi nhận "Oke" vào Sheet -> Xuất Báo cáo Vùng gửi Zalo
     */
    async scanAndReportRegion({ regionId, workDate, simulatedMessages = [], dryRun = false, skipSheet = false, showBrowser = false }) {
        const remoteLicense = require('./remote_license');
        const lic = await remoteLicense.getLicenseStatus(true);
        if (!lic.allowed) {
            return {
                success: false,
                revoked: true,
                error: lic.message || 'Phiên bản VNV-Bot này đã bị Quản trị viên tạm dừng từ xa.'
            };
        }

        const targetDate = workDate || new Date().toLocaleDateString('sv');
        const region = await db.get('SELECT * FROM regions WHERE id = ?', [regionId]);
        if (!region) throw new Error(`Không tìm thấy Vùng ID ${regionId}`);

        // Lấy hoặc tạo Task ngày
        const task = await db.get(
            "SELECT * FROM tasks WHERE publish_date = ? ORDER BY id DESC LIMIT 1",
            [targetDate]
        );
        let taskId = task ? task.id : 1;
        if (!task) {
            const taskCode = 'TSK-C5-' + targetDate.replace(/-/g, '') + '-01';
            const insTask = await db.run(`
                INSERT INTO tasks (task_code, title, description, publish_date, source_group, status)
                VALUES (?, ?, ?, ?, 'CỤM 5', 'active')
            `, [taskCode, `Nhiệm vụ ngày ${targetDate}`, 'Tự động tạo', targetDate]);
            taskId = insTask.id || 1;
        }

        // Lấy danh sách thành viên của Vùng
        let members = await db.all(
            "SELECT * FROM members WHERE region_id = ? AND status = 'Active' ORDER BY sheet_row_index ASC",
            [regionId]
        );

        if (members.length === 0) {
            try {
                const { syncMembersFromSheet } = require('./sheet_member_sync');
                console.log(`[ON-DEMAND] Vùng ${regionId} chưa có danh sách sứ giả, tự động đồng bộ từ Google Sheet...`);
                await syncMembersFromSheet(regionId);
                members = await db.all(
                    "SELECT * FROM members WHERE region_id = ? AND status = 'Active' ORDER BY sheet_row_index ASC",
                    [regionId]
                );
            } catch (syncErr) {
                console.warn(`[ON-DEMAND] Không thể tự động kéo thành viên Vùng ${regionId}:`, syncErr.message);
            }
        }

        // 1. Quét tin nhắn trực tiếp từ Zalo theo Mốc Neo (Anchor-Based Scanner)
        const { zaloAnchorScanner } = require('./zalo_anchor_scanner');
        const zaloBrowserManager = require('./zalo_browser_manager');
        const { extractDatesFromText } = require('./message_parser');
        const todayStr = new Date().toLocaleDateString('sv');
        let zaloScrapedInfo = { connected: false, count: 0 };
        let scrapeRes = null;

        if (!simulatedMessages || simulatedMessages.length === 0) {
            try {
                const groupTarget = region.zalo_group_name || region.region_name || '';
                console.log(`[ON-DEMAND] 🚀 Gọi Anchor Scanner để quét bài cho ${groupTarget}, ngày ${targetDate}...`);
                scrapeRes = await zaloAnchorScanner.scanWithAnchors(groupTarget, targetDate, {
                    autoOpen: true,
                    showBrowser: showBrowser === true
                });

                if (scrapeRes && scrapeRes.cancelled) {
                    return {
                        success: false,
                        cancelled: true,
                        error: 'Đã dừng quét bài theo yêu cầu của bạn.',
                        zaloScrapedInfo: { connected: true, cancelled: true, count: 0 },
                        regionId: region.id,
                        regionName: region.region_name,
                        workDate: targetDate
                    };
                }

                if (scrapeRes && scrapeRes.connected) {
                    zaloScrapedInfo = { 
                        connected: true, 
                        count: scrapeRes.messagesScraped || 0,
                        groupName: scrapeRes.groupName || groupTarget,
                        taskFound: scrapeRes.taskFound
                    };

                    if (scrapeRes.scrapedEvents && scrapeRes.scrapedEvents.length > 0) {
                        const crypto = require('crypto');
                        for (const m of scrapeRes.scrapedEvents) {
                            const msgId = m.zalo_msg_id || ('ZMSG_' + Date.now() + '_' + crypto.randomBytes(4).toString('hex'));
                            const senderId = m.sender_zalo_id || m.sender_zalo_name || 'unknown';
                            const timestampMs = m.timestamp_ms || Date.now();
                            const createdAtStr = `${targetDate} 12:00:00`;

                            await db.run(`
                                INSERT OR IGNORE INTO raw_events (
                                    zalo_msg_id, zalo_group_id, sender_zalo_id, sender_zalo_name, msg_type, content_text, timestamp_ms, created_at
                                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            `, [
                                msgId,
                                region.zalo_group_name,
                                senderId,
                                m.sender_zalo_name,
                                m.msg_type || 'text',
                                m.content_text,
                                timestampMs,
                                createdAtStr
                            ]);
                        }
                    }

                    if (scrapeRes.taskFound === false && (!simulatedMessages || simulatedMessages.length === 0)) {
                        return {
                            success: false,
                            error: scrapeRes.reason || `Chưa tìm thấy tin nhắn nhiệm vụ ngày ${targetDate} trong nhóm "${groupTarget}". Vui lòng gửi nhiệm vụ vào nhóm Zalo trước khi quét báo cáo!`,
                            zaloScrapedInfo,
                            regionId: region.id,
                            regionName: region.region_name,
                            workDate: targetDate
                        };
                    }
                } else {
                    zaloScrapedInfo = {
                        connected: false,
                        count: 0,
                        needsLogin: scrapeRes?.needsLogin === true,
                        reason: scrapeRes?.reason || 'Chưa thể kết nối Zalo'
                    };
                }
            } catch (zErr) {
                console.warn('[ON-DEMAND] Lỗi Anchor Scanner:', zErr.message);
                const isCancelled = zaloAnchorScanner.isCancelled || 
                    (zErr.message && (
                        zErr.message.includes('Target closed') || 
                        zErr.message.includes('Session closed') ||
                        zErr.message.includes('Protocol error')
                    ));
                if (isCancelled) {
                    return {
                        success: false,
                        cancelled: true,
                        error: 'Đã dừng quét bài theo yêu cầu của bạn.',
                        zaloScrapedInfo: { connected: true, cancelled: true, count: 0 },
                        regionId: region.id,
                        regionName: region.region_name,
                        workDate: targetDate
                    };
                }
                zaloScrapedInfo = { connected: false, count: 0, reason: zErr.message };
            }
        }

        // Kiểm tra hủy một lần nữa trước khi bước vào xử lý DB và ghi Sheet
        if (zaloAnchorScanner.isCancelled || (scrapeRes && scrapeRes.cancelled)) {
            return {
                success: false,
                cancelled: true,
                error: 'Đã dừng quét bài theo yêu cầu của bạn.',
                zaloScrapedInfo: { connected: true, cancelled: true, count: 0 },
                regionId: region.id,
                regionName: region.region_name,
                workDate: targetDate
            };
        }

        // 2. Thu thập tin nhắn từ raw_events hoặc mảng tin nhắn truyền vào
        let events = await db.all(`
            SELECT * FROM raw_events 
            WHERE zalo_group_id = ? AND DATE(created_at) = ?
        `, [region.zalo_group_name, targetDate]);

        // Ưu tiên sử dụng trực tiếp các sự kiện vừa quét từ Anchor Scanner
        if (scrapeRes && scrapeRes.scrapedEvents && scrapeRes.scrapedEvents.length > 0) {
            events = scrapeRes.scrapedEvents;
        } else if (scrapeRes && scrapeRes.messages && scrapeRes.messages.length > 0) {
            const relevantScraped = scrapeRes.messages.filter(m => {
                if (m.messageDate && m.messageDate === targetDate) return true;
                const textDates = extractDatesFromText(m.text, targetDate);
                if (textDates.includes(targetDate)) return true;
                if (!m.messageDate && targetDate === todayStr && !m.isBeforeTarget) return true;
                return false;
            });

            if (relevantScraped.length > 0) {
                const scrapedAsEvents = relevantScraped.map(m => ({
                    sender_zalo_name: m.sender,
                    content_text: m.text,
                    msg_type: m.hasImage ? 'image' : 'text',
                    timestamp_ms: m.timestamp
                }));

                if (events.length === 0) {
                    events = scrapedAsEvents;
                } else {
                    const existingKeys = new Set(events.map(e => `${e.sender_zalo_name}::${e.content_text}`));
                    for (const s of scrapedAsEvents) {
                        const k = `${s.sender_zalo_name}::${s.content_text}`;
                        if (!existingKeys.has(k)) {
                            events.push(s);
                            existingKeys.add(k);
                        }
                    }
                }
            }
        }

        if (simulatedMessages && simulatedMessages.length > 0) {
            events = simulatedMessages;
        }

        // Bổ sung các tin nhắn nộp bù từ raw_events của các ngày lân cận (nếu có)
        // QUY TẮC: Tuyệt đối không lấy tin nhắn từ các ngày TƯƠNG LAI (> nextDay)
        if (!simulatedMessages || simulatedMessages.length === 0) {
            try {
                const [y, m, d] = targetDate.split('-');
                const dInt = parseInt(d, 10);
                const mInt = parseInt(m, 10);
                const dPad = String(dInt).padStart(2, '0');
                const mPad = String(mInt).padStart(2, '0');
                const datePatterns = [`%${dInt}/${mInt}%`, `%${dPad}/${mPad}%`, `%${dPad}-${mPad}%`];
                
                // Giới hạn tối đa là ngày kế tiếp (targetDate + 1)
                const nextDateObj = new Date(`${targetDate}T00:00:00Z`);
                nextDateObj.setDate(nextDateObj.getDate() + 1);
                const nextDateStr = nextDateObj.toISOString().split('T')[0];

                const crossDayRawEvents = await db.all(`
                    SELECT * FROM raw_events 
                    WHERE zalo_group_id = ? 
                      AND DATE(created_at) <= ?
                      AND (${datePatterns.map(() => 'content_text LIKE ?').join(' OR ')})
                    ORDER BY created_at ASC
                `, [region.zalo_group_name, nextDateStr, ...datePatterns]);

                const existingKeys = new Set(events.map(e => `${e.sender_zalo_name}::${e.content_text}`));
                for (const pe of crossDayRawEvents) {
                    const k = `${pe.sender_zalo_name}::${pe.content_text}`;
                    if (!existingKeys.has(k)) {
                        events.push(pe);
                        existingKeys.add(k);
                    }
                }
            } catch (e) {}
        }

        // Nếu quét bị hủy hoặc Zalo không thể kết nối
        if (zaloAnchorScanner.isCancelled) {
            return {
                success: false,
                cancelled: true,
                error: 'Đã dừng quét bài theo yêu cầu của bạn.',
                zaloScrapedInfo: { connected: true, cancelled: true, count: 0 },
                regionId: region.id,
                regionName: region.region_name,
                workDate: targetDate
            };
        }

        if (!zaloScrapedInfo.connected && (!simulatedMessages || simulatedMessages.length === 0)) {
            return {
                success: false,
                requiresZaloLogin: zaloScrapedInfo.needsLogin === true,
                error: zaloScrapedInfo.reason || `Chưa thể kết nối Zalo để quét bài cho ${region.region_name}. Vui lòng đăng nhập Zalo hoặc kiểm tra cửa sổ Zalo trên màn hình.`,
                zaloScrapedInfo,
                regionId: region.id,
                regionName: region.region_name,
                workDate: targetDate
            };
        }

        // 2. Map tin nhắn tới từng thành viên (Logic: Thấy Sứ giả có gửi tin nhắn/ảnh -> HOÀN THÀNH)
        const memberSubmissionMap = new Map();



        for (const evt of events) {
            const contentText = evt.content_text || evt.content || '';
            const mem = await resolveMember({
                zaloUserId: evt.sender_zalo_id || evt.senderId,
                zaloDisplayName: evt.sender_zalo_name || evt.senderName || evt.sender,
                messageContent: contentText,
                regionId: region.id
            });

            if (mem) {
                const parsed = parseMessageSubmission({
                    msgType: evt.msg_type || evt.msgType || 'text',
                    content: contentText,
                    workDate: targetDate
                });

                const existing = memberSubmissionMap.get(mem.id);
                const mergedSupplementDates = [
                    ...(existing?.supplementDates || []),
                    ...(parsed.supplementDates || [])
                ];

                let finalStatus = existing ? existing.status : 'NO_RESPONSE';
                let finalNotes = existing?.notes || '';
                let hasExplicitTodayOk = existing?.hasExplicitTodayOk || false;
                let hasPastSubmissionOnly = existing?.hasPastSubmissionOnly || false;

                if (parsed.status === 'OK') {
                    finalStatus = 'OK';
                    hasExplicitTodayOk = true;
                    hasPastSubmissionOnly = false;
                    finalNotes = parsed.notes || finalNotes;
                } else if (parsed.status === 'SUPPLEMENT') {
                    // Sứ giả nói rõ là nộp bổ sung cho ngày cũ (vd: 14/09)
                    // Chỉ chuyển thành OK nếu có tin nhắn nói rõ đã làm cả ngày hôm nay
                    if (!hasExplicitTodayOk) {
                        finalStatus = 'SUPPLEMENT';
                    }
                    finalNotes = parsed.notes || finalNotes;
                } else if (parsed.status === 'LATE_REQUEST') {
                    if (!hasExplicitTodayOk && finalStatus !== 'SUPPLEMENT') {
                        finalStatus = 'LATE_REQUEST';
                        finalNotes = parsed.notes || finalNotes;
                    }
                } else if (parsed.status === 'OFF') {
                    if (!hasExplicitTodayOk && finalStatus !== 'SUPPLEMENT') {
                        finalStatus = 'OFF';
                        finalNotes = parsed.notes || finalNotes;
                    }
                } else if (parsed.status === 'PAST_SUBMISSION') {
                    // Tin nhắn dành cho ngày cũ cụ thể (không phải nộp bổ sung cho hôm nay)
                    // Cập nhật ngày cũ trong database nhưng KHÔNG ghi nhận cho ngày hôm nay
                    if (Array.isArray(parsed.targetWorkDates) && parsed.targetWorkDates.length > 0) {
                        for (const pDate of parsed.targetWorkDates) {
                            try {
                                const oldTask = await db.get("SELECT id FROM tasks WHERE publish_date = ? LIMIT 1", [pDate]);
                                const oldTaskId = oldTask ? oldTask.id : taskId;
                                await db.run(`
                                    INSERT INTO submissions (task_id, member_id, region_id, work_date, status, notes)
                                    VALUES (?, ?, ?, ?, 'SUPPLEMENT', ?)
                                    ON CONFLICT(work_date, member_id) DO UPDATE SET 
                                        status = CASE WHEN submissions.status = 'OK' THEN 'OK' ELSE 'SUPPLEMENT' END,
                                        notes = CASE WHEN submissions.status = 'OK' THEN submissions.notes ELSE excluded.notes END
                                `, [oldTaskId, mem.id, region.id, pDate, parsed.notes]);
                            } catch (pErr) {}
                        }
                    }
                    if (!hasExplicitTodayOk) {
                        hasPastSubmissionOnly = true;
                        finalStatus = 'NO_RESPONSE';
                    }
                } else if (parsed.status === 'IGNORED') {
                    // QUY TẮC CỐT LÕI: Chỉ ghi nhận thành công / hoàn thành qua TIN NHẮN văn bản
                    // TUYỆT ĐỐI KHÔNG dùng ảnh để tính hoàn thành (tránh lỗi false-positive)
                }

                memberSubmissionMap.set(mem.id, {
                    memberId: mem.id,
                    status: finalStatus,
                    notes: finalNotes,
                    hasExplicitTodayOk,
                    hasPastSubmissionOnly,
                    supplementDates: [...new Set(mergedSupplementDates)]
                });
            }
        }

        // 3. Ghi nhận kết quả vào bảng submissions
        for (const mem of members) {
            const sub = memberSubmissionMap.get(mem.id);
            if (sub) {
                await db.run(`
                    INSERT OR REPLACE INTO submissions (task_id, member_id, region_id, work_date, status, notes, supplement_dates_json)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                `, [taskId, mem.id, region.id, targetDate, sub.status, sub.notes, JSON.stringify(sub.supplementDates)]);

                // Nếu có ngày nộp bổ sung cho ngày cũ, cập nhật trạng thái OK cho ngày cũ tương ứng
                if (Array.isArray(sub.supplementDates) && sub.supplementDates.length > 0) {
                    for (const sDate of sub.supplementDates) {
                        try {
                            const oldTask = await db.get("SELECT id FROM tasks WHERE publish_date = ? LIMIT 1", [sDate]);
                            const oldTaskId = oldTask ? oldTask.id : taskId;
                            await db.run(`
                                INSERT INTO submissions (task_id, member_id, region_id, work_date, status, notes)
                                VALUES (?, ?, ?, ?, 'SUPPLEMENT', ?)
                                ON CONFLICT(work_date, member_id) DO UPDATE SET 
                                    status = CASE WHEN submissions.status = 'OK' THEN 'OK' ELSE 'SUPPLEMENT' END,
                                    notes = CASE WHEN submissions.status = 'OK' THEN submissions.notes ELSE excluded.notes END
                            `, [oldTaskId, mem.id, region.id, sDate, `Nộp bù ngày ${targetDate}: ${sub.notes || ''}`]);
                        } catch (sErr) {
                            console.warn(`[ON-DEMAND] Lỗi ghi nhận nộp bù ngày ${sDate}:`, sErr.message);
                        }
                    }
                }
            } else {
                await db.run(`
                    INSERT OR REPLACE INTO submissions (task_id, member_id, region_id, work_date, status, notes)
                    VALUES (?, ?, ?, ?, 'NO_RESPONSE', '')
                `, [taskId, mem.id, region.id, targetDate]);
            }
        }

        // Kiểm tra nếu người dùng đã bấm dừng trong lúc xử lý
        if (zaloAnchorScanner.isCancelled) {
            return {
                success: false,
                cancelled: true,
                error: 'Đã dừng quét bài theo yêu cầu của bạn.',
                zaloScrapedInfo: { connected: true, cancelled: true, count: 0 },
                regionId: region.id,
                regionName: region.region_name,
                workDate: targetDate
            };
        }

        // 4. Đồng bộ Google Sheet ma trận (Cột D..AH, Hàng 4-5, 8-24)
        let sheetSyncResult = { success: false, skipped: true, message: 'Bỏ qua ghi Sheet' };
        if (!skipSheet) {
            try {
                sheetSyncResult = await syncRegionMatrixSheet(region.id, targetDate, { dryRun, skipSheet });

                // Đồng bộ bổ sung cho các ngày cũ trên Google Sheet nếu có bài nộp bù (chỉ thực hiện khi ngày chính đã ghi thành công)
                if (sheetSyncResult.success) {
                    const suppDatesMap = new Map();
                    for (const sub of memberSubmissionMap.values()) {
                        if (Array.isArray(sub.supplementDates)) {
                            sub.supplementDates.forEach(d => {
                                if (d && d < targetDate) {
                                    if (!suppDatesMap.has(d)) suppDatesMap.set(d, new Set());
                                    suppDatesMap.get(d).add(sub.memberId);
                                }
                            });
                        }
                    }
                    // Sắp xếp các ngày nộp bù giảm dần (ưu tiên các ngày gần nhất: hôm qua, hôm kia...)
                    const sortedSuppDates = Array.from(suppDatesMap.keys())
                        .sort((a, b) => b.localeCompare(a))
                        .slice(0, 3); // Đồng bộ tối đa 3 ngày nộp bù gần nhất lên Sheet để an toàn tuyệt đối hạn ngạch Google API

                    for (const sDate of sortedSuppDates) {
                        const memberIdSet = suppDatesMap.get(sDate);
                        try {
                            console.log(`[ON-DEMAND] 🔄 Tự động đồng bộ bài nộp bù ngày ${sDate} cho ${memberIdSet.size} sứ giả lên Google Sheet...`);
                            await new Promise(r => setTimeout(r, 800)); // Nghỉ 800ms chống vượt hạn ngạch Google Write Quota
                            await syncRegionMatrixSheet(region.id, sDate, { 
                                dryRun, 
                                skipSheet,
                                onlyMemberIds: Array.from(memberIdSet)
                            });
                        } catch (suppErr) {
                            console.warn(`[ON-DEMAND] Không thể đồng bộ ngày bổ sung ${sDate}:`, suppErr.message);
                        }
                    }
                }
            } catch (sheetErr) {
                console.warn(`[ON-DEMAND] ⚠️ Không thể đồng bộ Google Sheet (quyền truy cập hoặc lỗi mạng): ${sheetErr.message}. Tiếp tục xuất báo cáo văn bản.`);
                sheetSyncResult = { 
                    success: false, 
                    skipped: true, 
                    message: `Chưa thể ghi Sheet (${sheetErr.message}). Báo cáo văn bản Zalo vẫn được tạo thành công.` 
                };
            }
        }

        const isSheetSynced = sheetSyncResult.success && !sheetSyncResult.skipped && !sheetSyncResult.tabMissing;
        if (isSheetSynced) {
            await db.run(
                "UPDATE submissions SET sheet_synced = 1 WHERE region_id = ? AND work_date = ?",
                [region.id, targetDate]
            );
        } else {
            await db.run(
                "UPDATE submissions SET sheet_synced = 0 WHERE region_id = ? AND work_date = ?",
                [region.id, targetDate]
            );
        }

        // 5. Sinh Báo cáo Vùng (Mẫu 1)
        const reportResult = await generateRegionReport(region.id, targetDate);

        // 6. Tự động soạn thảo Báo cáo vào ô chat Zalo ở dạng bản nháp chờ (CHƯA BẤM ENTER GỬI)
        let zaloDraftResult = null;
        if (zaloScrapedInfo.connected) {
            try {
                const grpTarget = region.zalo_group_name || region.region_name;
                zaloDraftResult = await zaloBrowserManager.draftMessageToChat(
                    grpTarget,
                    reportResult.content,
                    null, // Đã bỏ chụp ảnh sau khi soạn thảo báo cáo theo yêu cầu
                    { showBrowser: showBrowser === true }
                );
                console.log(`[ON-DEMAND] 📝 Đã tự động soạn thảo Báo cáo Vùng ${region.id} vào ô chat Zalo (Bản nháp chờ người dùng duyệt gửi).`);
            } catch (dErr) {
                console.warn('[ON-DEMAND] Không thể tự động soạn thảo vào Zalo:', dErr.message);
            }
        }

        return {
            success: true,
            regionId: region.id,
            regionName: region.region_name,
            workDate: targetDate,
            totalMembers: reportResult.totalMembers,
            completed: reportResult.totalCompleted,
            incomplete: reportResult.totalIncomplete,
            sheetSynced: isSheetSynced,
            tabMissing: sheetSyncResult.tabMissing === true,
            expectedTab: sheetSyncResult.expectedTab || null,
            currentTabs: sheetSyncResult.currentTabs || [],
            latestTab: sheetSyncResult.latestTab || null,
            sheetMessage: sheetSyncResult.message || (isSheetSynced ? 'Đã cập nhật Google Sheet' : 'Chưa ghi vào Google Sheet'),
            sheetRange: sheetSyncResult.range || null,
            reportContent: reportResult.content,
            zaloScrapedInfo,
            zaloDraftResult
        };
    }

    /**
     * 3. NÚT DÀNH CHO TRƯỞNG CỤM: [TỔNG HỢP & GỬI BÁO CÁO CỤM 5] (MẪU 2)
     */
    async aggregateAndDispatchCluster({ clusterId = 5, workDate, dryRun = false }) {
        const remoteLicense = require('./remote_license');
        const lic = await remoteLicense.getLicenseStatus(true);
        if (!lic.allowed) {
            return {
                success: false,
                revoked: true,
                error: lic.message || 'Phiên bản VNV-Bot này đã bị Quản trị viên tạm dừng từ xa.'
            };
        }

        const targetDate = workDate || new Date().toLocaleDateString('sv');
        
        // Sinh Báo cáo Cụm tổng hợp từ 7 Vùng
        const clusterReport = await generateClusterReport(clusterId, targetDate);

        // Đánh dấu hoàn tất trong FSM
        await db.run(`
            INSERT OR REPLACE INTO daily_operations (work_date, state, cluster_report_status, updated_at)
            VALUES (?, 'REPORTS_DISPATCHED', 'SENT', CURRENT_TIMESTAMP)
        `, [targetDate]);

        console.log(`[ON-DEMAND] Đã xuất bản Báo cáo Cụm 5 ngày ${targetDate} tag @Phạm Minh Tú.`);

        return {
            success: true,
            clusterId,
            workDate: targetDate,
            totalMembers: clusterReport.totalClusterMembers,
            totalCompleted: clusterReport.totalClusterCompleted,
            totalIncomplete: clusterReport.totalClusterIncomplete,
            reportContent: clusterReport.content,
            dispatchedTo: 'BĐH SỨ GIẢ TOÀN QUỐC - VNV',
            taggedUser: '@Phạm Minh Tú'
        };
    }
}

module.exports = new OnDemandActionService();

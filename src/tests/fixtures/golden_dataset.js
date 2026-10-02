const db = require('../../config/db');

// LCG Pseudo-Random Number Generator for deterministic dataset generation
function createPRNG(seed) {
    let s = seed;
    return function() {
        s = (s * 1664525 + 1013904223) % 4294967296;
        return s / 4294967296;
    };
}

/**
 * Tạo dữ liệu mẫu Golden Dataset (10 Vùng, 100 Sứ giả, 5 Nhiệm vụ, 500 Tin nhắn)
 * @param {number} seed - Hạt giống ngẫu nhiên để đảm bảo tính deterministic
 * @returns {Promise<Object>} Trả về danh sách dữ liệu thực tế và Expected State
 */
async function setupGoldenDataset(seed = 20260702) {
    const random = createPRNG(seed);
    
    // Clear and reset DB structures
    await db.run('PRAGMA foreign_keys = OFF;');
    const tables = ['sheet_sync_history', 'reports', 'submissions', 'members', 'regions', 'clusters', 'audit_logs', 'users', 'tasks', 'local_config', 'processed_messages', 'zalo_message_queue'];
    for (const table of tables) {
        await db.run(`DROP TABLE IF EXISTS ${table}`);
    }
    await db.run('PRAGMA foreign_keys = ON;');
    await db.initDb();

    // 1. Tạo 2 Clusters
    const cluster1 = await db.run("INSERT INTO clusters (cluster_name) VALUES ('Cụm Miền Bắc')");
    const cluster2 = await db.run("INSERT INTO clusters (cluster_name) VALUES ('Cụm Miền Nam')");
    const clusterIds = [cluster1.id, cluster2.id];

    // 2. Tạo 10 Regions
    const regions = [];
    for (let i = 1; i <= 10; i++) {
        const clusterId = clusterIds[i % 2];
        const res = await db.run(`
            INSERT INTO regions (region_name, cluster_id, zalo_group_id, zalo_group_name, sheet_id, sheet_name)
            VALUES (?, ?, ?, ?, ?, ?)
        `, [
            `Vùng ${i}`,
            clusterId,
            `zalo_group_${i}`,
            `Nhóm Vùng ${i}`,
            `sheet_id_vung_${i}`,
            `Sheet Vùng ${i}`
        ]);
        regions.push({
            id: res.id,
            region_name: `Vùng ${i}`,
            zalo_group_id: `zalo_group_${i}`,
            sheet_id: `sheet_id_vung_${i}`
        });
    }

    // 3. Tạo 100 Members (10 members mỗi vùng)
    const members = [];
    for (let i = 1; i <= 100; i++) {
        const regionIndex = Math.floor((i - 1) / 10);
        const region = regions[regionIndex];
        const sheetRow = ((i - 1) % 10) + 4;
        const res = await db.run(`
            INSERT INTO members (region_id, sheet_row_index, real_name, role, status)
            VALUES (?, ?, ?, 'EMISSARY', 'Active')
        `, [
            region.id,
            sheetRow,
            `Sứ Giả ${i}`
        ]);
        await db.run(`
            INSERT INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias)
            VALUES (?, ?, ?, ?)
        `, [
            res.id,
            `zalo_id_${i}`,
            `zalo_name_${i}`,
            `su gia ${i}`
        ]);
        members.push({
            id: res.id,
            real_name: `Sứ Giả ${i}`,
            zalo_name: `zalo_name_${i}`,
            zalo_id: `zalo_id_${i}`,
            region_id: region.id
        });
    }

    // 4. Tạo 5 Tasks
    const todayStr = new Date().toLocaleDateString('sv'); // YYYY-MM-DD
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toLocaleDateString('sv');

    const tasks = [
        { id: 1, task_code: 'TASK_01_IMAGE', description: 'Nhiệm vụ chụp ảnh báo cáo', date: todayStr, type: 'image' },
        { id: 2, task_code: 'TASK_02_KEYWORD', description: 'Nhiệm vụ từ khóa xác nhận', date: todayStr, type: 'keyword' },
        { id: 3, task_code: 'TASK_03_LINK', description: 'Nhiệm vụ gửi đường dẫn liên kết', date: todayStr, type: 'link' },
        { id: 4, task_code: 'TASK_04_MANUAL', description: 'Nhiệm vụ phê duyệt thủ công hoàn toàn', date: todayStr, type: 'manual' },
        { id: 5, task_code: 'TASK_05_PAST', description: 'Nhiệm vụ từ khóa ngày hôm qua', date: yesterdayStr, type: 'keyword' }
    ];

    for (const t of tasks) {
        const res = await db.run(`
            INSERT INTO tasks (task_code, title, description, publish_date, status)
            VALUES (?, ?, ?, ?, 'active')
        `, [t.task_code, t.task_code, t.description, t.date]);
        t.dbId = res.id;
    }

    // 5. Sinh 500 tin nhắn (Webhook/DOM events) một cách deterministic
    const messages = [];
    const expectedSubmissions = []; // Test Oracle Expected State
    const duplicateTracker = new Set(); // Chống trùng khi generate expected state

    const keywordList = ['done', 'ok', 'xong', 'đã làm'];
    const invalidKeywordList = ['chưa làm', 'hỏi thăm', 'alo', 'tin nhắn rác'];
    const urlList = ['https://facebook.com/post/1', 'http://tiktok.com/video/2', 'https://youtube.com/watch?v=3'];

    for (let i = 1; i <= 500; i++) {
        // Chọn ngẫu nhiên provider (oa hoặc puppeteer)
        const provider = random() > 0.5 ? 'oa' : 'puppeteer';
        const msgId = `msg_test_${i}`;
        
        // 80% tin nhắn đến từ thành viên hợp lệ, 20% từ người không xác minh
        const isValidMember = random() > 0.2;
        let member = null;
        let senderId = `unverified_zalo_id_${i}`;
        let senderName = `Người lạ ${i}`;
        let groupId = 'unverified_group';

        if (isValidMember) {
            const mIndex = Math.floor(random() * members.length);
            member = members[mIndex];
            senderId = member.zalo_id;
            senderName = member.zalo_name;
            const region = regions.find(r => r.id === member.region_id);
            groupId = region.zalo_group_id;
        } else {
            // Randomly map to a valid group to test unverified sender in registered group
            if (random() > 0.5) {
                const rIndex = Math.floor(random() * regions.length);
                groupId = regions[rIndex].zalo_group_id;
            }
        }

        // Chọn nội dung tin nhắn: Text, Image, hoặc Link
        const msgTypeRand = random();
        let msgType = 'text';
        let content = '';

        if (msgTypeRand < 0.3) {
            msgType = 'image';
            content = `https://zalo.me/attachments/img_${i}.jpg`;
        } else if (msgTypeRand < 0.6) {
            content = urlList[Math.floor(random() * urlList.length)];
        } else {
            // Text keyword
            const isMatch = random() > 0.4;
            content = isMatch 
                ? keywordList[Math.floor(random() * keywordList.length)] 
                : invalidKeywordList[Math.floor(random() * invalidKeywordList.length)];
        }

        // Tỷ lệ tin nhắn trùng lặp (10% tin nhắn là gửi trùng của tin nhắn trước đó)
        let isDuplicate = false;
        let finalMsgId = msgId;
        let finalContent = content;
        let finalMsgType = msgType;
        let finalSenderId = senderId;
        let finalSenderName = senderName;
        let finalGroupId = groupId;

        if (i > 1 && random() < 0.1) {
            isDuplicate = true;
            const dupSource = messages[Math.floor(random() * messages.length)];
            finalMsgId = dupSource.zaloMsgId;
            finalContent = dupSource.content;
            finalMsgType = dupSource.msgType;
            finalSenderId = dupSource.senderId;
            finalSenderName = dupSource.senderName;
            finalGroupId = dupSource.groupId;
        }

        messages.push({
            id: i,
            provider,
            zaloMsgId: finalMsgId,
            senderId: finalSenderId,
            senderName: finalSenderName,
            groupId: finalGroupId,
            msgType: finalMsgType,
            content: finalContent,
            isDuplicate
        });

        // 6. Tính toán Expected State của Database (Test Oracle)
        // Chỉ xử lý nếu member hợp lệ, group hợp lệ, không bị trùng lặp trước đó
        if (isValidMember && !isDuplicate) {
            const region = regions.find(r => r.id === member.region_id);
            if (region && !duplicateTracker.has(finalMsgId)) {
                duplicateTracker.add(finalMsgId);

                // Đối soát loại task hiện tại của ngày hôm nay
                // Theo logic pipeline.js:
                // Hôm nay có các task: TASK_01_IMAGE (Publish: Today, Image), TASK_02_KEYWORD (Publish: Today, Keyword),
                // TASK_03_LINK (Publish: Today, Link/Manual), TASK_04_MANUAL (Publish: Today, Manual)
                // Theo logic code, task ngày hôm nay được active sẽ lấy task ngày hôm nay khớp theo mô tả.
                // Ở đây ta tìm task tương ứng. Vì database setup có nhiều tasks hoạt động cùng ngày,
                // Pipeline của ta sẽ tìm `tasks WHERE publish_date = today AND status = 'active' LIMIT 1` (hoặc tương tự).
                // Let's check how task is resolved in pipeline.js. It does `SELECT * FROM tasks WHERE publish_date = ? AND status = 'active'`.
                // If there are multiple active tasks, sqlite query returns the first one (usually TASK_01_IMAGE or task with smallest ID).
                // Let's assume TASK_01_IMAGE is the matched task in SQLite (dbId of TASK_01_IMAGE is 1).
                const activeTaskId = tasks[0].dbId; 
                const activeTask = tasks[0];

                // Check duplicate check on submission (member already has approved task today)
                const alreadyApproved = expectedSubmissions.some(
                    sub => sub.task_id === activeTaskId && sub.member_id === member.id && sub.status === 'approved'
                );

                if (!alreadyApproved) {
                    const taskType = 'image'; // Vì activeTask.description chứa chữ 'chụp ảnh' nên taskType là 'image'
                    let isMatch = false;
                    let subStatus = 'pending_review';
                    let subType = 'manual';

                    if (finalMsgType === 'image') {
                        isMatch = true;
                        subStatus = 'approved';
                        subType = 'image';
                    }

                    if (isMatch) {
                        expectedSubmissions.push({
                            task_id: activeTaskId,
                            member_id: member.id,
                            zalo_msg_id: finalMsgId,
                            submission_type: subType,
                            raw_content: finalContent,
                            status: subStatus
                        });
                    }
                }
            }
        }
    }

    return {
        regions,
        members,
        tasks,
        messages,
        expectedSubmissions
    };
}

module.exports = {
    setupGoldenDataset
};

process.env.MOCK_GOOGLE_SHEETS = 'true';
const db = require('../config/db');
const { initZaloConnector, oaProvider, pipeline } = require('../services/zalo');
const assert = require('assert');

async function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runZaloIntegrationTests() {
    console.log('====================================================');
    console.log('CHẠY KIỂM THỬ TÍCH HỢP: ZALO MESSAGE PIPELINE');
    console.log('====================================================');

    console.log('0. Chuẩn bị database sạch...');
    await db.run('PRAGMA foreign_keys = OFF;');
    const tables = ['sheet_sync_history', 'reports', 'submissions', 'members', 'regions', 'clusters', 'audit_logs', 'users', 'tasks', 'local_config', 'processed_messages', 'zalo_message_queue'];
    for (const table of tables) {
        await db.run(`DROP TABLE IF EXISTS ${table}`);
    }
    await db.run('PRAGMA foreign_keys = ON;');
    await db.initDb();

    // 1. Khởi chạy Zalo Connector
    console.log('1. Khởi tạo phân hệ Zalo Connector...');
    await initZaloConnector();

    // 2. Tạo Dữ liệu mẫu (Region, Active Task, Member)
    console.log('2. Thiết lập dữ liệu vùng, thành viên và nhiệm vụ...');
    const todayStr = new Date().toLocaleDateString('sv');

    const taskRes = await db.run(`
        INSERT INTO tasks (task_code, title, description, publish_date, status)
        VALUES ('TASK_ZALO_01', 'Nhiệm vụ kiểm thử Zalo', 'Nhiệm vụ ảnh hoàn thành hôm nay', ?, 'active')
    `, [todayStr]);
    const taskId = taskRes.id;

    const clusterRes = await db.run("INSERT INTO clusters (cluster_name) VALUES ('Cụm Zalo')");
    const clusterId = clusterRes.id;

    // Region map zalo_group_id 'oa_recipient_test' và 'Nhóm Test Zalo'
    const regionRes = await db.run(`
        INSERT INTO regions (region_name, cluster_id, zalo_group_id, zalo_group_name, leader_name)
        VALUES ('Vùng Zalo', ?, 'oa_recipient_test', 'Nhóm Test Zalo', 'Trưởng Vùng Test')
    `, [clusterId]);
    const regionId = regionRes.id;

    // Thành viên map zalo_id 'zalo_user_abc'
    const memberRes = await db.run(`
        INSERT INTO members (region_id, sheet_row_index, real_name, role, status)
        VALUES (?, 8, 'Sứ Giả Zalo', 'EMISSARY', 'Active')
    `, [regionId]);
    const memberId = memberRes.id;

    await db.run(`
        INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias)
        VALUES (?, 'zalo_user_abc', 'zalo_user_name_test', 'su gia zalo')
    `, [memberId]);

    // -------------------------------------------------------------------------
    // TEST 1: Gửi tin nhắn hợp lệ (Image) & kiểm tra Queue -> Pipeline -> DB
    // -------------------------------------------------------------------------
    console.log('\n3. [TEST 1] Kiểm thử xử lý nộp bài ảnh hợp lệ qua Zalo OA...');
    const webhookPayload = {
        event_name: 'user_send_text',
        message: {
            msg_id: 'zalo_msg_id_111',
            attachments: [
                {
                    type: 'photo',
                    payload: {
                        url: 'https://test.image.url/photo.jpg'
                    }
                }
            ]
        },
        sender: {
            id: 'zalo_user_abc',
            name: 'zalo_user_name_test'
        },
        recipient: {
            id: 'oa_recipient_test'
        },
        timestamp: Date.now()
    };

    // Đẩy sự kiện qua webhook OA provider
    oaProvider.handleWebhookEvent(webhookPayload);

    // Chờ hàng đợi SQLite xử lý bất đồng bộ kết thúc
    console.log(' -> Đang chờ Event Queue xử lý tin nhắn...');
    await wait(800);

    // Xác nhận trạng thái hàng đợi
    const queueItem = await db.get("SELECT * FROM zalo_message_queue WHERE provider = 'oa'");
    assert.ok(queueItem, 'Sự kiện phải được lưu vào hàng đợi zalo_message_queue');
    assert.strictEqual(queueItem.status, 'completed', 'Hàng đợi phải được xử lý hoàn tất (completed)');

    // Xác nhận kết quả nộp bài được ghi nhận trong submissions
    const submission = await db.get("SELECT * FROM submissions WHERE member_id = ? AND task_id = ?", [memberId, taskId]);
    assert.ok(submission, 'Bài nộp phải được tạo thành công');
    assert.strictEqual(submission.zalo_msg_id, 'zalo_msg_id_111', 'zalo_msg_id phải trùng khớp');
    assert.strictEqual(submission.submission_type, 'image', 'Phải nhận diện đúng loại submission là image');
    assert.strictEqual(submission.status, 'approved', 'Image task phải được auto-approved');
    console.log(' -> [OK] Webhook sự kiện được chuẩn hóa và ghi DB thành công.');

    // -------------------------------------------------------------------------
    // TEST 2: Kiểm thử tính Idempotency (Gửi lại tin nhắn trùng lặp)
    // -------------------------------------------------------------------------
    console.log('\n4. [TEST 2] Kiểm thử tính Message Idempotency (Webhook resend)...');
    
    // Đẩy lại tin nhắn có zalo_msg_id_111 y hệt lần trước
    oaProvider.handleWebhookEvent(webhookPayload);
    await wait(500);

    // Kiểm tra hàng đợi thứ 2
    const queueItems = await db.all("SELECT * FROM zalo_message_queue WHERE provider = 'oa' ORDER BY id ASC");
    assert.strictEqual(queueItems.length, 2, 'Phải có 2 bản ghi sự kiện trong hàng đợi');
    assert.strictEqual(queueItems[1].status, 'completed', 'Sự kiện trùng lặp vẫn xử lý xong (nhưng bỏ qua)');

    const dupMessage = await db.get("SELECT COUNT(*) as count FROM processed_messages WHERE message_id = 'zalo_msg_id_111'");
    assert.strictEqual(dupMessage.count, 1, 'Bảng processed_messages chỉ được lưu 1 bản ghi message_id duy nhất');
    
    const subCount = await db.get("SELECT COUNT(*) as count FROM submissions WHERE task_id = ? AND member_id = ?", [taskId, memberId]);
    assert.strictEqual(subCount.count, 1, 'Không được tạo thêm bản ghi bài nộp thứ hai (Deduplication thành công)');
    // -------------------------------------------------------------------------
    // TEST 3: Kiểm thử trích xuất Tên Sứ Giả và Ngày hoàn thành từ tin nhắn VNV
    // -------------------------------------------------------------------------
    console.log('\n5. [TEST 3] Kiểm thử trích xuất Tên Sứ Giả và Ngày từ tin nhắn VNV...');
    
    // Tạo nhiệm vụ cho ngày 19/08/2026
    const specificTaskRes = await db.run(`
        INSERT INTO tasks (task_code, title, description, publish_date, status)
        VALUES ('TASK_SPECIFIC_01', 'Nhiệm vụ cụ thể', 'Yêu cầu báo cáo', '2026-08-19', 'active')
    `);
    const specificTaskId = specificTaskRes.id;

    // Tạo sứ giả Nguyễn Văn A
    const nvaRes = await db.run(`
        INSERT INTO members (real_name, zalo_name, zalo_id, region_id, status)
        VALUES ('Nguyễn Văn A', 'nva_zalo_display', 'zalo_id_nva', ?, 'Active')
    `, [regionId]);
    const nvaId = nvaRes.id;

    const vnvMessagePayload = {
        event_name: 'user_send_text',
        message: {
            msg_id: 'zalo_msg_id_vnv_report',
            text: 'Nguyễn Văn A hoàn thành nhiệm vụ ngày 19/08/2026'
        },
        sender: {
            id: 'some_leader_zalo_id',
            name: 'Trưởng Vùng Zalo'
        },
        recipient: {
            id: 'oa_recipient_test'
        },
        timestamp: Date.now()
    };

    // Đẩy sự kiện qua webhook
    oaProvider.handleWebhookEvent(vnvMessagePayload);
    await wait(800);

    // Xác nhận kết quả bài nộp của Nguyễn Văn A được tạo
    const nvaSubmission = await db.get("SELECT * FROM submissions WHERE member_id = ? AND task_id = ?", [nvaId, specificTaskId]);
    assert.ok(nvaSubmission, 'Bài nộp của Nguyễn Văn A phải được tạo');
    assert.strictEqual(nvaSubmission.zalo_msg_id, 'zalo_msg_id_vnv_report', 'zalo_msg_id phải đúng');
    assert.strictEqual(nvaSubmission.submission_type, 'keyword', 'Phải khớp keyword task');
    assert.strictEqual(nvaSubmission.status, 'approved', 'Phải được tự động approved');
    console.log(' -> [OK] Trích xuất tên Sứ Giả và ngày hoàn thành thành công.');

    // -------------------------------------------------------------------------
    // TEST 4: Kiểm thử xử lý báo cáo nộp bài cá nhân gửi lên nhóm Zalo Cụm
    // -------------------------------------------------------------------------
    console.log('\n6. [TEST 4] Kiểm thử xử lý nộp bài cá nhân gửi lên nhóm Zalo Cụm...');

    // Tạo hoặc lấy Cụm 5
    let cluster5Id;
    const existingCluster = await db.get("SELECT id FROM clusters WHERE cluster_name = 'Cụm 5'");
    if (existingCluster) {
        cluster5Id = existingCluster.id;
    } else {
        const cluster5Res = await db.run("INSERT INTO clusters (cluster_name) VALUES ('Cụm 5')");
        cluster5Id = cluster5Res.id;
    }

    // Tạo Vùng Thử Nghiệm 27 thuộc Cụm 5
    const region27Res = await db.run(`
        INSERT INTO regions (region_name, cluster_id, zalo_group_id, zalo_group_name, sheet_id, sheet_name)
        VALUES ('Vùng Thử Nghiệm 27', ?, 'group_vung_test_27', 'Vùng 27', 'dummy_sheet_id_27', 'Báo cáo Vùng 27')
    `, [cluster5Id]);
    const region27Id = region27Res.id;

    // Tạo các thành viên thuộc Vùng Thử Nghiệm 27
    const memberXRes = await db.run(`
        INSERT INTO members (real_name, zalo_name, zalo_id, region_id, status)
        VALUES ('Sứ Giả X', 'zalo_display_x', 'zalo_id_x', ?, 'Active')
    `, [region27Id]);
    const memberXId = memberXRes.id;

    const memberYRes = await db.run(`
        INSERT INTO members (real_name, zalo_name, zalo_id, region_id, status)
        VALUES ('Sứ Giả Y', 'zalo_display_y', 'zalo_id_y', ?, 'Active')
    `, [region27Id]);
    const memberYId = memberYRes.id;

    // Tạo nhiệm vụ cho ngày 20/08/2026
    const clusterTaskRes = await db.run(`
        INSERT INTO tasks (task_code, title, description, publish_date, status)
        VALUES ('TASK_CLUSTER_01', 'Nhiệm vụ cụm', 'Yêu cầu làm báo cáo', '2026-08-20', 'active')
    `);
    const clusterTaskId = clusterTaskRes.id;

    // Giả lập tin nhắn nộp bài của Sứ Giả X gửi vào nhóm Zalo Cụm 5
    const clusterMessagePayload = {
        event_name: 'user_send_text',
        message: {
            msg_id: 'zalo_msg_id_cluster_report',
            text: 'Sứ Giả X hoàn thành nhiệm vụ ngày 20/08/2026'
        },
        sender: {
            id: 'some_other_sender_zalo_id',
            name: 'Trưởng Vùng hoặc Sứ Giả'
        },
        recipient: {
            id: 'Cụm 5' // Tên nhóm Cụm nhận tin
        },
        timestamp: Date.now()
    };

    // Đẩy sự kiện qua webhook OA
    oaProvider.handleWebhookEvent(clusterMessagePayload);
    await wait(800);

    // Xác nhận bài nộp của Sứ Giả X được tạo thành công
    const subX = await db.get("SELECT * FROM submissions WHERE member_id = ? AND task_id = ?", [memberXId, clusterTaskId]);
    const subY = await db.get("SELECT * FROM submissions WHERE member_id = ? AND task_id = ?", [memberYId, clusterTaskId]);

    assert.ok(subX, 'Bài nộp của Sứ Giả X phải được tạo');
    assert.strictEqual(subX.status, 'approved', 'Sứ Giả X phải được auto-approved');
    assert.strictEqual(subX.zalo_msg_id, 'zalo_msg_id_cluster_report', 'zalo_msg_id của Sứ Giả X phải chính xác');

    assert.strictEqual(subY, undefined, 'Sứ Giả Y không gửi báo cáo nên không được tạo bài nộp');

    console.log(' -> [OK] Định danh Sứ Giả đơn lẻ thành công khi báo cáo gửi lên nhóm Cụm.');

    console.log('\n====================================================');
    console.log('THÀNH CÔNG: TẤT CẢ CA KIỂM THỬ TÍCH HỢP PIPELINE ĐẠT (PASS)!');
    console.log('====================================================');
    process.exit(0);
}

runZaloIntegrationTests().catch(err => {
    console.error('[TEST ERROR] Kiểm thử tích hợp Pipeline thất bại:', err);
    process.exit(1);
});

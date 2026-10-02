const db = require('../config/db');
const lockManager = require('../scheduler/lock');
const assert = require('assert');

async function runStressTests() {
    console.log('====================================================');
    console.log('CHẠY KIỂM THỬ TẢI & XUNG ĐỘT KHÓA (STRESS/CONCURRENCY TESTS)');
    console.log('====================================================');

    // 0. Khởi tạo DB Schema sạch
    console.log('0. Chuẩn bị database...');
    await db.initDb();
    await db.run("DELETE FROM local_config WHERE key LIKE 'lock:%'");

    // 1. TEST A: 100 Tiến trình tranh chấp CÙNG 1 KHÓA
    console.log('1. Chạy tải tranh chấp 100 yêu cầu acquireLock cùng 1 khóa...');
    
    const lockKey = 'lock:active:stress_same_key';
    const ttlMs = 1800000;
    
    // Tạo 100 owner khác nhau giả lập các instance
    const promises = Array.from({ length: 100 }).map(async (_, idx) => {
        // Mock tạm ownerId của LockManager để giả lập nhiều instance PM2 khác nhau
        const customOwner = `stress-worker-${idx}-${process.pid}`;
        
        // Tạo một instance LockManager giả lập
        const mockLockManager = Object.create(lockManager);
        mockLockManager.ownerId = customOwner;
        
        try {
            const success = await mockLockManager.acquireLock(lockKey, ttlMs);
            return { owner: customOwner, success };
        } catch (err) {
            return { owner: customOwner, success: false, error: err };
        }
    });

    const results = await Promise.all(promises);
    
    // Thống kê kết quả
    const successes = results.filter(r => r.success);
    const failures = results.filter(r => !r.success);

    console.log(` -> Kết quả tranh chấp: Thành công = ${successes.length}, Thất bại = ${failures.length}`);
    assert.strictEqual(successes.length, 1, 'Chỉ duy nhất 1 tiến trình được phép chiếm khóa thành công trong 100 yêu cầu song song');
    assert.strictEqual(failures.length, 99, '99 tiến trình còn lại bắt buộc phải thất bại (không bị lỗi sập/lock DB)');

    // Dọn dẹp khóa
    const winner = successes[0];
    const mockWinnerLockManager = Object.create(lockManager);
    mockWinnerLockManager.ownerId = winner.owner;
    await mockWinnerLockManager.releaseLock(lockKey);


    // 2. TEST B: 100 Yêu cầu acquireLock SONG SONG vào 100 KHÓA KHÁC NHAU
    console.log('2. Chạy tải ghi song song 100 khóa khác nhau (Kiểm thử SQLite WAL concurrency)...');
    
    const uniquePromises = Array.from({ length: 100 }).map(async (_, idx) => {
        const uniqueKey = `lock:active:stress_diff_key_${idx}`;
        const customOwner = `stress-worker-${idx}-${process.pid}`;
        
        const mockLockManager = Object.create(lockManager);
        mockLockManager.ownerId = customOwner;

        try {
            const success = await mockLockManager.acquireLock(uniqueKey, ttlMs);
            return { key: uniqueKey, owner: customOwner, success };
        } catch (err) {
            return { key: uniqueKey, owner: customOwner, success: false, error: err };
        }
    });

    const uniqueResults = await Promise.all(uniquePromises);
    const uniqueSuccesses = uniqueResults.filter(r => r.success);
    const uniqueFailures = uniqueResults.filter(r => !r.success);

    console.log(` -> Kết quả ghi song song: Thành công = ${uniqueSuccesses.length}, Thất bại = ${uniqueFailures.length}`);
    assert.strictEqual(uniqueSuccesses.length, 100, 'Tất cả 100 khóa riêng biệt phải được tạo thành công song song dưới chế độ WAL');
    assert.strictEqual(uniqueFailures.length, 0, 'Không có khóa nào bị lỗi ghi chép database');

    // 3. TEST C: 100 Yêu cầu giải phóng khóa (releaseLock) song song
    console.log('3. Giải phóng song song 100 khóa đã tạo...');
    const releasePromises = uniqueSuccesses.map(async (row) => {
        const mockLockManager = Object.create(lockManager);
        mockLockManager.ownerId = row.owner;
        await mockLockManager.releaseLock(row.key);
        return true;
    });

    await Promise.all(releasePromises);
    
    // Kiểm tra xem DB đã sạch hoàn toàn khóa chưa
    const remainingLocks = await db.all("SELECT key FROM local_config WHERE key LIKE 'lock:active:stress_diff_key_%'");
    assert.strictEqual(remainingLocks.length, 0, 'Tất cả các khóa song song phải được dọn dẹp sạch sẽ khỏi database');

    console.log('====================================================');
    console.log('THÀNH CÔNG: TẤT CẢ KIỂM THỬ TẢI & TRANH CHẤP LOCK ĐỀU ĐẠT (PASS)!');
    console.log('====================================================');
    process.exit(0);
}

runStressTests().catch(err => {
    console.error('[STRESS TEST ERROR] Kiểm thử tải/xung đột thất bại:', err);
    process.exit(1);
});

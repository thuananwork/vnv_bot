const assert = require('assert');
const {
    cleanVietnamese,
    getTokens,
    calculateSimilarityScore,
    matchVietnameseNames
} = require('../services/zalo_auto_mapper');

async function runTests() {
    console.log('===============================================================');
    console.log('🧪 BẮT ĐẦU KIỂM THỬ: TỰ ĐỘNG ĐOÁN MAPPING TÊN ZALO SỨ GIẢ');
    console.log('===============================================================\n');

    // 1. Kiểm tra chuẩn hóa tiếng Việt và tách token
    console.log('1. Kiểm thử chuẩn hóa tiếng Việt & lọc emoji...');
    assert.strictEqual(cleanVietnamese('Phạm Quang Đại ❤️'), 'pham quang dai');
    assert.strictEqual(cleanVietnamese('✨ Nguyễn Thị Thanh Trà ✨'), 'nguyen thi thanh tra');
    assert.strictEqual(cleanVietnamese('Đặng Vũ Thu Hằng'), 'dang vu thu hang');
    console.log('  ✅ [PASS] Chuẩn hóa tên tiếng Việt chuẩn xác');

    // 2. Kiểm thử độ tương đồng giữa Tên Sheet và Tên Zalo
    console.log('\n2. Kiểm thử tính điểm tương đồng (Similarity Scoring)...');

    // Case 2.1: Trùng 100%
    const scoreExact = calculateSimilarityScore('Phạm Quang Đại', 'Phạm Quang Đại');
    assert.strictEqual(scoreExact.score, 1.0, 'Trùng 100% phải đạt điểm 1.0');

    // Case 2.2: Rút gọn họ, chỉ dùng Tên đệm + Tên chính (Quang Đại vs Phạm Quang Đại)
    const scoreSubset = calculateSimilarityScore('Phạm Quang Đại', 'Quang Đại');
    assert(scoreSubset.score >= 0.95, 'Quang Đại vs Phạm Quang Đại phải đạt >= 0.95');

    // Case 2.3: Rút gọn họ (Thanh Trà vs Nguyễn Thị Thanh Trà)
    const scoreTra = calculateSimilarityScore('Nguyễn Thị Thanh Trà', 'Thanh Trà 🌸');
    assert(scoreTra.score >= 0.95, 'Thanh Trà vs Nguyễn Thị Thanh Trà phải đạt >= 0.95');

    // Case 2.4: Xuất hiện tên thật trong nội dung tin nhắn báo cáo
    const scoreMsg = calculateSimilarityScore('Mai Thị Thủy', 'Thủy Miu', ['Em Mai Thị Thủy gửi báo cáo ca sáng ạ']);
    assert.strictEqual(scoreMsg.score, 0.99, 'Tên xuất hiện trong tin nhắn phải đạt 0.99');

    // Case 2.5: Không liên quan
    const scoreNone = calculateSimilarityScore('Phạm Quang Đại', 'Lê Kim Chi');
    assert.strictEqual(scoreNone.score, 0, 'Hai tên không liên quan phải đạt 0');
    console.log('  ✅ [PASS] Thuật toán chấm điểm tương đồng hoạt động chuẩn xác');

    // 3. Kiểm thử ghép nối danh sách Sứ giả Vùng thực tế
    console.log('\n3. Kiểm thử khớp danh sách Sứ giả Vùng 27 với các nick Zalo...');
    const sheetMembers = [
        { id: 2701, real_name: 'Phạm Quang Đại' },
        { id: 2702, real_name: 'Nguyễn Thị Thanh Trà' },
        { id: 2703, real_name: 'Nguyễn Thị Phương Trinh' },
        { id: 2704, real_name: 'Thàn Thị Quỳnh Nhi' },
        { id: 2705, real_name: 'Nguyễn Thị Mỹ Duyên' },
        { id: 2706, real_name: 'Phạm Ngọc Phương Chi' },
        { id: 2707, real_name: 'Mai Thị Thủy' },
        { id: 2708, real_name: 'Nguyễn Lê Tuyết Trinh' },
        { id: 2709, real_name: 'Nguyễn Văn Chương' }
    ];

    const zaloSenders = [
        { senderName: 'Quang Đại', messages: ['Báo cáo ca sáng'] },
        { senderName: 'Thanh Trà ❤️', messages: ['Dạ em gửi'] },
        { senderName: 'Phương Trinh', messages: ['Đã xong ca'] },
        { senderName: 'Quỳnh Nhi', messages: ['Em nộp bài'] },
        { senderName: 'Mỹ Duyên', messages: ['Hoàn thành'] },
        { senderName: 'Phương Chi', messages: ['Link bài viết...'] },
        { senderName: 'Thủy Mai', messages: ['Em Mai Thị Thủy gửi link'] },
        { senderName: 'Tuyết Trinh', messages: ['Đã nộp bài'] },
        { senderName: 'Văn Chương', messages: ['Xong'] },
        { senderName: 'Người Lạ Zalo', messages: ['Hello'] }
    ];

    const matches = matchVietnameseNames(sheetMembers, zaloSenders);

    assert.strictEqual(matches.length, sheetMembers.length, 'Số lượng kết quả phải bằng số Sứ giả');

    const daiMatch = matches.find(m => m.realName === 'Phạm Quang Đại');
    assert(daiMatch && daiMatch.suggestedZaloName === 'Quang Đại', 'Phạm Quang Đại phải khớp với Quang Đại');

    const traMatch = matches.find(m => m.realName === 'Nguyễn Thị Thanh Trà');
    assert(traMatch && traMatch.suggestedZaloName === 'Thanh Trà ❤️', 'Nguyễn Thị Thanh Trà phải khớp với Thanh Trà ❤️');

    const thuyMatch = matches.find(m => m.realName === 'Mai Thị Thủy');
    assert(thuyMatch && thuyMatch.suggestedZaloName === 'Thủy Mai', 'Mai Thị Thủy phải khớp với Thủy Mai qua nội dung tin nhắn');

    // Phân biệt chính xác giữa 2 bạn cùng tên Trinh: Phương Trinh và Tuyết Trinh
    const ptrinhMatch = matches.find(m => m.realName === 'Nguyễn Thị Phương Trinh');
    const ttrinhMatch = matches.find(m => m.realName === 'Nguyễn Lê Tuyết Trinh');
    assert.strictEqual(ptrinhMatch.suggestedZaloName, 'Phương Trinh', 'Phương Trinh phải khớp đúng Phương Trinh');
    assert.strictEqual(ttrinhMatch.suggestedZaloName, 'Tuyết Trinh', 'Tuyết Trinh phải khớp đúng Tuyết Trinh');

    console.log('  ✅ [PASS] Phân biệt chính xác các Sứ giả trùng tên đệm hoặc trùng tên chính');
    console.log(`  ✅ [PASS] Khớp thành công 9/9 Sứ giả thử nghiệm:`);
    matches.forEach(m => {
        console.log(`     • ${m.realName} -> "${m.suggestedZaloName}" (${Math.round(m.confidence * 100)}%) [${m.reason}]`);
    });

    console.log('\n===============================================================');
    console.log('🎉 TẤT CẢ KIỂM THỬ TỰ ĐỘNG ĐOÁN MAPPING ZALO ĐẠT 100% PASS!');
    console.log('===============================================================');
    process.exit(0);
}

runTests().catch(err => {
    console.error('❌ LỖI KIỂM THỬ:', err);
    process.exit(1);
});

const rootRep = require('../services/reports_v2');
const distRep = require('../../dist/VNV-Bot-v2.0.0/src/services/reports_v2');

async function runParityComparison() {
    console.log('========================================================================');
    console.log('🔍 ĐỐI SOÁT TÍNH ĐỒNG NHẤT (PARITY TEST): SOURCE CODE VS DIST PACKAGE');
    console.log('   Ngày đối soát: 20/09/2026 | Đối tượng: 7 Vùng Cụm 5 & Báo cáo Cụm');
    console.log('========================================================================\n');

    const date = '2026-09-20';
    let allMatched = true;

    for (let rId = 25; rId <= 31; rId++) {
        const repRoot = await rootRep.generateRegionReport(rId, date);
        const repDist = await distRep.generateRegionReport(rId, date);

        const match = repRoot.content.trim() === repDist.content.trim();
        console.log(`  Vùng ${rId}: ${match ? '✅ KHỚP 100%' : '❌ KHÁC BIỆT'}`);
        if (!match) {
            allMatched = false;
            console.log('--- ROOT CONTENT ---:\n', repRoot.content);
            console.log('--- DIST CONTENT ---:\n', repDist.content);
        }
    }

    const clusterRoot = await rootRep.generateClusterReport(5, date);
    const clusterDist = await distRep.generateClusterReport(5, date);
    const clusterMatch = clusterRoot.content.trim() === clusterDist.content.trim();
    console.log(`  Báo cáo Cụm 5: ${clusterMatch ? '✅ KHỚP 100%' : '❌ KHÁC BIỆT'}`);
    if (!clusterMatch) {
        allMatched = false;
        console.log('--- ROOT CLUSTER ---:\n', clusterRoot.content);
        console.log('--- DIST CLUSTER ---:\n', clusterDist.content);
    }

    console.log('\n========================================================================');
    if (allMatched) {
        console.log('🎉 KẾT QUẢ ĐỐI SOÁT: 100% TRÙNG KHỚP TUYỆT ĐỐI (PARITY PASS)');
    } else {
        console.log('❌ KẾT QUẢ ĐỐI SOÁT: PHÁT HIỆN LỆCH NỘI DUNG GIỮA SOURCE VÀ DIST');
        process.exit(1);
    }
    console.log('========================================================================\n');
}

runParityComparison().catch(err => {
    console.error('Lỗi khi đối soát:', err);
    process.exit(1);
});

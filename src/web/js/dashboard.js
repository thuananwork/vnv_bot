// ==========================================
// VNV-BOT V2: DASHBOARD OVERVIEW & STATS
// ==========================================

let dashboardScanning = false;

function getDashboardWorkDate() {
    if (typeof window.getSelectedDate === 'function') {
        return window.getSelectedDate('dash-work-date', 'dash-work-date-custom');
    }
    const dateInput = document.getElementById('dash-work-date');
    return dateInput?.value || new Date().toLocaleDateString('sv');
}

async function loadDashboard() {
    const workDate = getDashboardWorkDate();

    try {
        const res = await fetch('/api/dashboard/overview?date=' + workDate);
        const data = await res.json();

        if (data.success) {
            renderDashboardStats(data.totals);
            renderDashboardRegions(data.regions);
        }
    } catch (err) {
        console.error('Lỗi tải dữ liệu Dashboard:', err);
    }
}

function renderDashboardStats(totals) {
    if (!totals) return;
    const setVal = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.innerText = val !== undefined ? val : '0';
    };

    setVal('stat-total-members', totals.totalMembers);
    setVal('stat-completed', totals.completed);
    setVal('stat-completed-change', totals.rate + '% hôm nay');
    setVal('stat-incomplete', totals.incomplete);
    setVal('stat-rate', totals.rate + '%');
}

function renderDashboardRegions(regions) {
    const tbody = document.getElementById('table-dashboard-regions-body');
    if (!tbody) return;

    if (!regions || regions.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 24px;">Không có dữ liệu Vùng</td></tr>';
        return;
    }

    tbody.innerHTML = regions.map(r => {
        const isDone = r.rate === 100 && r.total > 0;
        const badgeHtml = isDone
            ? '<span class="badge badge-ok"><i class="fa-solid fa-check"></i> Hoàn thành (100%)</span>'
            : `<span class="badge badge-warning">${r.incomplete} chưa làm</span>`;

        return `
            <tr>
                <td><strong>${r.name}</strong></td>
                <td><strong>${r.completed}</strong> / ${r.total}</td>
                <td style="min-width: 180px;">
                    <div class="progress-bar-wrapper">
                        <div class="progress-bar">
                            <div class="progress-fill ${isDone ? 'done' : ''}" style="width: ${r.rate}%;"></div>
                        </div>
                        <span class="progress-label">${r.rate}%</span>
                    </div>
                </td>
                <td>${badgeHtml}</td>
            </tr>
        `;
    }).join('');
}

async function handleDashboardScan() {
    if (dashboardScanning) return;
    const btn = document.getElementById('btn-dash-scan-zalo');
    const user = window.currentUser;
    const isCluster = user?.role === 'cluster_leader' || user?.role === 'admin';
    const workDate = getDashboardWorkDate();

    const regionId = user?.managed_region_id || 27;

    dashboardScanning = true;
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang quét Zalo...';
    }

    try {
        if (isCluster) {
            // Quét Cụm
            const res = await fetch('/api/v2/cluster/run-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workDate, dryRun: false })
            });
            const data = await res.json();
            if (data.success) {
                showToast('🚀 Đã quét và xuất báo cáo toàn Cụm 5 thành công!');
            } else {
                showToast('❌ Lỗi quét: ' + data.error);
            }
        } else {
            // Quét Vùng của User
            const res = await fetch(`/api/v2/regions/${regionId}/run-report`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ workDate, dryRun: false })
            });
            const data = await res.json();
            if (data.success) {
                showToast(`🚀 Đã quét Vùng ${regionId} thành công (${data.data.completed}/${data.data.totalMembers})!`);
            } else {
                showToast('❌ Lỗi quét: ' + data.error);
            }
        }

        const lastScanEl = document.getElementById('dash-last-scan-time');
        if (lastScanEl) {
            lastScanEl.innerText = 'Lần quét gần nhất: ' + new Date().toLocaleTimeString('vi-VN');
        }

        await loadDashboard();
    } catch (err) {
        showToast('❌ Lỗi khi quét: ' + err.message);
    } finally {
        dashboardScanning = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Quét Zalo ngay';
        }
    }
}

function initDashboard() {
    const btnScan = document.getElementById('btn-dash-scan-zalo');
    if (btnScan) {
        btnScan.addEventListener('click', handleDashboardScan);
    }

    if (typeof window.setupRecentDaysDateSelector === 'function') {
        window.setupRecentDaysDateSelector('dash-work-date', 'dash-work-date-custom', (dateVal) => {
            loadDashboard();
        });
    }

    loadDashboard();
}

window.initDashboard = initDashboard;
window.loadDashboard = loadDashboard;
window.handleDashboardScan = handleDashboardScan;

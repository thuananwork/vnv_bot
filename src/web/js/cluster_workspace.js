// ==========================================
// VNV-BOT V2: CLUSTER WORKSPACE (BẢNG ĐIỀU HÀNH CỤM 5)
// ==========================================

function getClusterWorkDate() {
    if (typeof window.getSelectedDate === 'function') {
        return window.getSelectedDate('cw-work-date', 'cw-work-date-custom');
    }
    const cwDateEl = document.getElementById('cw-work-date');
    return cwDateEl?.value || new Date().toLocaleDateString('sv');
}

async function loadClusterReportPreview() {
    const date = getClusterWorkDate();
    const previewEl = document.getElementById('cw-report-preview-text');

    if (!previewEl) return;

    try {
        const res = await fetch(`/api/v2/preview/report?type=cluster&workDate=${date}`);
        const data = await res.json();
        if (data.success && data.content) {
            previewEl.value = data.content;
        } else {
            previewEl.value = 'Chưa có báo cáo cho ngày ' + date + '.\nBấm nút [Tổng Hợp & Bắn Báo Cáo Cụm 5] ở thanh công cụ phía trên để xuất báo cáo.';
        }
    } catch (err) {
        console.error('Lỗi nạp xem trước báo cáo cụm:', err);
    }
}

async function loadClusterRegionsProgress() {
    const date = getClusterWorkDate();
    const pillsStrip = document.getElementById('cw-region-pills-strip');
    const tbody = document.getElementById('cw-regions-table-body');
    const totalStatEl = document.getElementById('cw-total-cluster-stat');

    try {
        const res = await fetch(`/api/dashboard/overview?date=${date}`);
        const data = await res.json();

        if (data.success && Array.isArray(data.regions)) {
            // Lọc chính xác 7 Vùng của Cụm 5 (Vùng 25 -> 31)
            const cluster5Regions = data.regions.filter(r => (r.id >= 25 && r.id <= 31) || (r.name && /Vùng\s*(2[5-9]|3[0-1])/i.test(r.name)));
            const clusterTotals = cluster5Regions.reduce((acc, r) => {
                acc.totalMembers += (r.total || 0);
                acc.completed += (r.completed || 0);
                return acc;
            }, { totalMembers: 0, completed: 0 });
            clusterTotals.rate = clusterTotals.totalMembers > 0 ? Math.round((clusterTotals.completed / clusterTotals.totalMembers) * 100) : 0;

            // 1. Cập nhật Badge Tổng số
            if (totalStatEl) {
                totalStatEl.innerHTML = `<i class="fa-solid fa-chart-pie"></i> ${clusterTotals.completed}/${clusterTotals.totalMembers} (${clusterTotals.rate}%)`;
                totalStatEl.className = clusterTotals.rate === 100 ? 'badge badge-ok' : (clusterTotals.rate > 0 ? 'badge badge-late' : 'badge badge-none');
            }

            // 2. Render 7 Thẻ Pills Cụm (Vùng 25 -> 31)
            if (pillsStrip) {
                pillsStrip.innerHTML = cluster5Regions.map(r => {
                    const isDone = r.total > 0 && r.completed >= r.total;
                    const isPartial = r.completed > 0 && r.completed < r.total;
                    const badgeClass = isDone ? 'badge-ok' : (isPartial ? 'badge-late' : 'badge-none');
                    const fillClass = isDone ? 'background: #10b981;' : (isPartial ? 'background: #f59e0b;' : 'background: #cbd5e1;');
                    
                    return `
                        <div class="cluster-pill" title="Xem chi tiết ${r.name}" onclick="switchToRegionWorkspace('${r.id}')">
                            <div class="cluster-pill-header">
                                <span class="cluster-pill-title">${escapeHtml(r.name)}</span>
                                <span class="cluster-pill-badge badge ${badgeClass}">${r.rate}%</span>
                            </div>
                            <div class="cluster-pill-progress">
                                <div class="cluster-pill-fill" style="width: ${r.rate}%; ${fillClass}"></div>
                            </div>
                            <div class="cluster-pill-meta">
                                <span>${r.completed}/${r.total} làm</span>
                                <span>${r.incomplete > 0 ? `${r.incomplete} chưa` : 'Đủ'}</span>
                            </div>
                        </div>
                    `;
                }).join('');
            }

            // 3. Render Bảng Tiến Độ 7 Vùng Cụm 5
            if (tbody) {
                if (cluster5Regions.length === 0) {
                    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; padding: 20px; color: var(--text-muted);">Không có dữ liệu vùng</td></tr>';
                    return;
                }

                tbody.innerHTML = cluster5Regions.map(r => {
                    const isDone = r.total > 0 && r.completed >= r.total;
                    const isPartial = r.completed > 0 && r.completed < r.total;
                    const badgeClass = isDone ? 'badge-ok' : (isPartial ? 'badge-late' : 'badge-none');
                    const badgeText = isDone ? 'Đạt 100%' : (isPartial ? 'Đang làm' : 'Chưa nộp');

                    return `
                        <tr>
                            <td>
                                <strong><a href="#" onclick="switchToRegionWorkspace('${r.id}'); return false;" style="color: var(--color-primary); text-decoration: none;">${escapeHtml(r.name)}</a></strong>
                            </td>
                            <td>
                                ${r.leader_name ? `
                                    <strong style="font-size: 12px;"><i class="fa-solid fa-crown" style="color: #d97706; font-size: 10px; margin-right: 3px;"></i>${escapeHtml(r.leader_name)}</strong>
                                    ${r.deputy_name ? `<br><small style="color: var(--text-muted); font-size: 11px;"><i class="fa-solid fa-medal" style="color: #4f46e5; font-size: 9px; margin-right: 3px;"></i>Phó: ${escapeHtml(r.deputy_name)}</small>` : ''}
                                ` : `<span style="font-size: 11.5px; color: var(--text-secondary);">Trưởng Vùng ${r.id}</span>`}
                            </td>
                            <td>
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <div style="flex: 1; height: 6px; background: rgba(0,0,0,0.06); border-radius: 9999px; overflow: hidden; min-width: 60px;">
                                        <div style="height: 100%; width: ${r.rate}%; background: ${isDone ? '#10b981' : (isPartial ? '#f59e0b' : '#cbd5e1')}; border-radius: 9999px;"></div>
                                    </div>
                                    <span style="font-size: 12px; font-weight: 600;">${r.completed}/${r.total}</span>
                                </div>
                            </td>
                            <td>
                                <span class="badge ${badgeClass}">${badgeText} (${r.rate}%)</span>
                            </td>
                        </tr>
                    `;
                }).join('');
            }
        }
    } catch (err) {
        console.error('Lỗi tải tiến độ 7 vùng:', err);
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red; padding: 20px;">Lỗi tải dữ liệu: ${err.message}</td></tr>`;
        }
    }
}

function switchToRegionWorkspace(regionId) {
    const regSelect = document.getElementById('rw-region-select');
    if (regSelect) {
        regSelect.value = String(regionId);
    }
    const navItem = document.querySelector('[data-target="panel-region-workspace"]');
    if (navItem) {
        navItem.click();
    }
    if (typeof loadRegionWorkspaceData === 'function') {
        loadRegionWorkspaceData();
    }
}

async function runClusterReport() {
    const workDate = getClusterWorkDate();
    const btn = document.getElementById('btn-cw-run-cluster-report');

    const confirmed = await showConfirmModal(
        `Bắt đầu tổng hợp Báo cáo toàn bộ Cụm 5 cho ngày ${workDate} và gửi lên Ban Điều Hành (Tag @Phạm Minh Tú)?`,
        {
            title: 'Xác Nhận Báo Cáo Cụm 5',
            icon: '<i class="fa-solid fa-paper-plane" style="color: #6366f1;"></i>',
            confirmText: 'Bắt đầu tổng hợp',
            cancelText: 'Hủy'
        }
    );
    if (!confirmed) return;

    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tổng hợp...';
        }
        const res = await fetch('/api/v2/cluster/run-report', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workDate, dryRun: false })
        });
        const data = await res.json();
        if (data.success) {
            const summaryText = `✅ Tổng hợp thành công Báo cáo Cụm 5!\n\n• Tổng thành viên: ${data.data.totalMembers}\n• Hoàn thành: ${data.data.totalCompleted}\n• Chưa làm: ${data.data.totalIncomplete}\n• Đã tag @Phạm Minh Tú`;
            showAlertModal(summaryText, 'success', 'Báo Cáo Cụm 5 Hoàn Tất');
            showToast(`✅ Đã tổng hợp Cụm 5: ${data.data.totalCompleted}/${data.data.totalMembers} sứ giả`);
            if (data.data.reportContent) {
                document.getElementById('cw-report-preview-text').value = data.data.reportContent;
            }
            await loadClusterRegionsProgress();
        } else {
            showAlertModal('Lỗi: ' + data.error, 'error');
        }
    } catch (err) {
        showAlertModal('Lỗi kết nối: ' + err.message, 'error');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Tổng Hợp & Bắn Báo Cáo Cụm 5';
        }
    }
}

async function loadClusterSheetLink() {
    const linkBtn = document.getElementById('link-cw-open-sheet');
    if (!linkBtn) return;
    try {
        const res = await fetch('/api/clusters/5');
        const cluster = await res.json();
        const url = cluster.sheet_url || (cluster.sheet_id ? `https://docs.google.com/spreadsheets/d/${cluster.sheet_id}/edit` : null);
        if (url) {
            linkBtn.href = url;
            linkBtn.style.display = 'inline-flex';
            linkBtn.title = `Mở Google Sheet Cụm 5 (${cluster.sheet_name || 'T9/26'})`;
        } else {
            linkBtn.style.display = 'none';
        }
    } catch (e) {
        linkBtn.style.display = 'none';
    }
}

function initClusterWorkspace() {
    if (typeof window.setupRecentDaysDateSelector === 'function') {
        window.setupRecentDaysDateSelector('cw-work-date', 'cw-work-date-custom', (dateVal) => {
            loadClusterReportPreview();
            loadClusterRegionsProgress();
        });
    }

    const btnRunClusterReport = document.getElementById('btn-cw-run-cluster-report');
    if (btnRunClusterReport) {
        btnRunClusterReport.addEventListener('click', runClusterReport);
    }

    const btnAutoMapAll = document.getElementById('btn-cw-auto-map-all');
    if (btnAutoMapAll) {
        btnAutoMapAll.addEventListener('click', handleAutoGuessAllClusterMappings);
    }

    const btnCopyCluster = document.getElementById('btn-cw-copy-report');
    if (btnCopyCluster) {
        btnCopyCluster.addEventListener('click', () => {
            const text = document.getElementById('cw-report-preview-text').value;
            if (text) {
                navigator.clipboard.writeText(text);
                if (typeof window.showToast === 'function') {
                    window.showToast('📋 Đã sao chép nội dung Báo cáo Cụm 5 vào bộ nhớ tạm!');
                } else {
                    alert('Đã sao chép nội dung Báo cáo Cụm vào bộ nhớ tạm!');
                }
            }
        });
    }

    loadClusterReportPreview();
    loadClusterRegionsProgress();
    loadClusterSheetLink();
}

async function handleAutoGuessAllClusterMappings() {
    const btn = document.getElementById('btn-cw-auto-map-all');
    const originalHtml = btn ? btn.innerHTML : '';

    const ok = await showConfirmModal(
        'Bot sẽ tự động mở lần lượt các nhóm Zalo của 7 Vùng Cụm 5 (từ Vùng 25 đến 31), trích xuất danh sách thành viên nhóm và tự động mapping nick Zalo cho từng Sứ giả trên Google Sheet.\n\nSau khi hoàn tất, hệ thống sẽ tự động lưu vào cơ sở dữ liệu, thu nhỏ Zalo và mở lại màn hình giao diện Bot này. Bắt đầu ngay?',
        {
            title: '✨ Mapping Tên Zalo Cả Cụm 5',
            icon: '<i class="fa-solid fa-wand-magic-sparkles" style="color: #8b5cf6;"></i>',
            confirmText: 'Bắt đầu mapping 7 Vùng'
        }
    );
    if (!ok) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang mapping Cụm 5...';
    }

    try {
        if (typeof window.showToast === 'function') {
            window.showToast('🤖 Bot đang quét lần lượt các nhóm Zalo của Cụm 5...');
        }

        const res = await fetch('/api/v2/cluster/auto-guess-mappings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        const data = await res.json();

        // Đưa tab giao diện Bot lên tiêu điểm
        try { window.focus(); } catch (fErr) {}

        if (data.success) {
            const msg = `🎉 Đã quét và mapping xong cả 7 Vùng Cụm 5!\n\n✔ Tổng số Sứ giả đã khớp: ${data.totalMatched || 0}\n✔ Tự động lưu thành công: ${data.totalSaved || 0}`;
            
            if (typeof window.showToast === 'function') {
                window.showToast(`🎉 Mapping Cụm 5 thành công: Đã khớp ${data.totalMatched || 0} Sứ giả!`);
            }

            await showConfirmModal(
                msg,
                {
                    title: '✅ Hoàn Tất Mapping Cụm 5',
                    icon: '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i>',
                    confirmText: 'Tuyệt vời',
                    cancelText: ''
                }
            );
        } else {
            alert('Thông báo từ Bot: ' + (data.error || 'Lỗi khi quét mapping Cụm.'));
        }
    } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

window.initClusterWorkspace = initClusterWorkspace;
window.loadClusterSheetLink = loadClusterSheetLink;
window.loadClusterReportPreview = loadClusterReportPreview;
window.loadClusterRegionsProgress = loadClusterRegionsProgress;
window.runClusterReport = runClusterReport;
window.switchToRegionWorkspace = switchToRegionWorkspace;
window.handleAutoGuessAllClusterMappings = handleAutoGuessAllClusterMappings;

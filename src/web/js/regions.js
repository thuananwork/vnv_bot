// ==========================================
// VNV-BOT V2: REGIONS MANAGEMENT (CRUD)
// ==========================================

async function loadRegions() {
    const tbody = document.getElementById('table-regions-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Đang tải...</td></tr>';
    
    try {
        const res = await fetch('/api/regions');
        const list = await res.json();
        tbody.innerHTML = '';
        
        list.forEach(r => {
            const tabDisplay = r.current_month_tab || r.sheet_name || 'Link Sheet';
            const sheetUrl = r.sheet_url || (r.sheet_id ? `https://docs.google.com/spreadsheets/d/${r.sheet_id}/edit` : '#');
            const sheetInfo = r.sheet_id 
                ? `<a href="${escapeHtml(sheetUrl)}" target="_blank" style="color:var(--color-blue); text-decoration:none; display:inline-flex; align-items:center; gap:6px; font-weight:600;"><i class="fa-solid fa-file-excel" style="color:#10b981;"></i> ${escapeHtml(tabDisplay)}</a>`
                : '<em class="text-muted">Chưa liên kết</em>';
                
            let leaderDisplay = r.manager_name ? escapeHtml(r.manager_name) : '<em class="text-muted">Chưa gán</em>';
            if (r.leader_name) {
                leaderDisplay = `<strong><i class="fa-solid fa-crown" style="color:#d97706; font-size:10px; margin-right:3px;"></i>${escapeHtml(r.leader_name)}</strong>`;
                if (r.deputy_name) {
                    leaderDisplay += `<br><small style="color:var(--text-muted); font-size:11px;"><i class="fa-solid fa-medal" style="color:#4f46e5; font-size:9px; margin-right:3px;"></i>Phó: ${escapeHtml(r.deputy_name)}</small>`;
                }
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHtml(r.region_name)}</strong></td>
                <td>${r.cluster_name ? escapeHtml(r.cluster_name) : '<em class="text-muted">Chưa thuộc cụm</em>'}</td>
                <td>${leaderDisplay}</td>
                <td>
                    <small>ID: ${escapeHtml(r.zalo_group_id)}</small><br>
                    <strong>${escapeHtml(r.zalo_group_name)}</strong>
                </td>
                <td>${sheetInfo}</td>
                <td><span class="status-badge ${escapeHtml(r.status)}">${escapeHtml(r.status)}</span></td>
                <td>
                    <div class="table-actions">
                        <button class="btn btn-secondary-outline btn-sm" onclick="editRegion(${JSON.stringify(r).replace(/"/g, '&quot;')})"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
                        <button class="btn btn-danger-outline btn-sm" onclick="deleteRegion(${r.id})"><i class="fa-solid fa-trash"></i> Xóa</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        populateRegionDropdowns();
        loadAdminSheetLinksTable();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--color-rose);">Lỗi tải danh sách Vùng.</td></tr>';
    }
}

async function populateClusterManagersDropdown() {
    try {
        const res = await fetch('/api/users');
        const users = await res.json();
        const select = document.getElementById('select-cluster-manager');
        if (!select) return;
        select.innerHTML = '<option value="">-- Chưa gán --</option>';
        
        users.filter(u => u.role === 'cluster_leader' && u.is_active === 1).forEach(u => {
            select.innerHTML += `<option value="${u.id}">${escapeHtml(u.full_name)} (${escapeHtml(u.username)})</option>`;
        });
    } catch (err) {}
}

async function populateRegionDropdowns() {
    try {
        const resClusters = await fetch('/api/clusters');
        const clusters = await resClusters.json();
        const selectCluster = document.getElementById('select-region-cluster');
        if (selectCluster) {
            selectCluster.innerHTML = '<option value="">-- Chọn Cụm --</option>';
            clusters.forEach(c => {
                selectCluster.innerHTML += `<option value="${c.id}">${escapeHtml(c.cluster_name)}</option>`;
            });
        }

        const resUsers = await fetch('/api/users');
        const users = await resUsers.json();
        const selectManager = document.getElementById('select-region-manager');
        if (selectManager) {
            selectManager.innerHTML = '<option value="">-- Chưa gán --</option>';
            users.filter(u => u.role === 'region_leader' && u.is_active === 1).forEach(u => {
                selectManager.innerHTML += `<option value="${u.id}">${escapeHtml(u.full_name)} (${escapeHtml(u.username)})</option>`;
            });
        }
    } catch (err) {}
}

function showRegionModal() {
    document.getElementById('modal-region-title').innerText = 'Thêm Vùng Mới';
    document.getElementById('edit-region-id').value = '';
    document.getElementById('form-region').reset();
    document.getElementById('modal-region').classList.add('active');
}

function editRegion(region) {
    document.getElementById('modal-region-title').innerText = 'Cập Nhật Vùng';
    document.getElementById('edit-region-id').value = region.id;
    document.getElementById('input-region-name').value = region.region_name;
    document.getElementById('select-region-cluster').value = region.cluster_id || '';
    document.getElementById('select-region-manager').value = region.manager_id || '';
    document.getElementById('input-zalo-id').value = region.zalo_group_id;
    document.getElementById('input-zalo-name').value = region.zalo_group_name;
    document.getElementById('select-region-status').value = region.status;
    document.getElementById('input-sheet-id').value = region.sheet_id || '';
    document.getElementById('input-sheet-url').value = region.sheet_url || '';
    document.getElementById('input-sheet-name').value = region.sheet_name || '';
    document.getElementById('modal-region').classList.add('active');
}

async function deleteRegion(id) {
    const ok = await showConfirmModal('Bạn có chắc chắn muốn xóa vùng này không?');
    if (ok) {
        const res = await fetch(`/api/regions/${id}`, { method: 'DELETE' });
        if (res.ok) loadRegions();
    }
}

function extractSpreadsheetId(val) {
    if (!val) return '';
    const match = val.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : val.trim();
}

function initRegionForms() {
    const formRegion = document.getElementById('form-region');
    const inputSheetUrl = document.getElementById('input-sheet-url');
    const inputSheetId = document.getElementById('input-sheet-id');

    if (inputSheetUrl && inputSheetId) {
        inputSheetUrl.addEventListener('input', (e) => {
            const extracted = extractSpreadsheetId(e.target.value);
            if (extracted && !inputSheetId.value) {
                inputSheetId.value = extracted;
            }
        });
    }

    if (formRegion) {
        formRegion.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('edit-region-id').value;
            const rawSheetId = document.getElementById('input-sheet-id').value.trim();
            const rawSheetUrl = document.getElementById('input-sheet-url').value.trim();
            const cleanSheetId = extractSpreadsheetId(rawSheetId || rawSheetUrl);

            const payload = {
                region_name: document.getElementById('input-region-name').value,
                cluster_id: document.getElementById('select-region-cluster').value || null,
                manager_id: document.getElementById('select-region-manager').value || null,
                zalo_group_id: document.getElementById('input-zalo-id').value,
                zalo_group_name: document.getElementById('input-zalo-name').value,
                status: document.getElementById('select-region-status').value,
                sheet_id: cleanSheetId || null,
                sheet_url: rawSheetUrl || null,
                sheet_name: document.getElementById('input-sheet-name').value || null
            };

            const url = id ? `/api/regions/${id}` : '/api/regions';
            const method = id ? 'PUT' : 'POST';

            try {
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    closeModal('modal-region');
                    loadRegions();
                } else {
                    const data = await res.json();
                    alert('Lỗi: ' + data.error);
                }
            } catch (err) {
                alert('Lỗi kết nối.');
            }
        });
    }

    // Xử lý lưu modal cập nhật Sheet Link (Admin)
    const btnSaveSheetLink = document.getElementById('btn-save-sheet-link');
    if (btnSaveSheetLink) {
        btnSaveSheetLink.addEventListener('click', async () => {
            const type = document.getElementById('edit-sheet-target-type').value;
            const id = document.getElementById('edit-sheet-target-id').value;
            const sheetUrl = document.getElementById('edit-sheet-url').value.trim();
            const sheetName = document.getElementById('edit-sheet-name').value.trim();

            if (!sheetUrl) {
                if (typeof showAlertModal === 'function') {
                    showAlertModal('Vui lòng nhập đường dẫn Google Sheet.', 'warning', 'Thiếu Thông Tin');
                } else {
                    alert('Vui lòng nhập đường dẫn Google Sheet.');
                }
                return;
            }

            try {
                btnSaveSheetLink.disabled = true;
                btnSaveSheetLink.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

                const endpoint = type === 'cluster' 
                    ? `/api/clusters/${id}/sheet-link` 
                    : `/api/regions/${id}/sheet-link`;

                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sheet_url: sheetUrl, sheet_name: sheetName })
                });
                const data = await res.json();

                if (data.success) {
                    closeModal('modal-sheet-link');
                    loadAdminSheetLinksTable();
                    loadRegions();
                    if (typeof showToast === 'function') {
                        showToast(`✅ Đã cập nhật liên kết Google Sheet thành công!`);
                    } else if (typeof showAlertModal === 'function') {
                        showAlertModal('Đã cập nhật liên kết Google Sheet và áp dụng toàn hệ thống!', 'success', 'Cập Nhật Thành Công');
                    }
                } else {
                    if (typeof showAlertModal === 'function') {
                        showAlertModal('Lỗi cập nhật: ' + (data.error || 'Thất bại'), 'error');
                    } else {
                        alert('Lỗi cập nhật: ' + (data.error || 'Thất bại'));
                    }
                }
            } catch (err) {
                if (typeof showAlertModal === 'function') {
                    showAlertModal('Lỗi kết nối: ' + err.message, 'error');
                } else {
                    alert('Lỗi kết nối: ' + err.message);
                }
            } finally {
                btnSaveSheetLink.disabled = false;
                btnSaveSheetLink.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu liên kết Sheet';
            }
        });
    }
}

// Bảng Quản Lý Liên Kết Google Sheet (Cụm 5 & 7 Vùng)
async function loadAdminSheetLinksTable() {
    const tbody = document.getElementById('table-admin-sheets-body');
    if (!tbody) return;

    try {
        const [resClusters, resRegions] = await Promise.all([
            fetch('/api/clusters').then(r => r.json()),
            fetch('/api/regions').then(r => r.json())
        ]);

        let html = '';

        // 1. Hàng cho Cụm 5
        const cluster5 = Array.isArray(resClusters) ? resClusters.find(c => c.id === 5) || resClusters[0] : null;
        if (cluster5) {
            const cUrl = cluster5.sheet_url || (cluster5.sheet_id ? `https://docs.google.com/spreadsheets/d/${cluster5.sheet_id}/edit` : null);
            const cTab = cluster5.sheet_name || 'T9/26';
            const sheetDisplay = cUrl 
                ? `<a href="${escapeHtml(cUrl)}" target="_blank" style="color: var(--color-purple); text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;"><i class="fa-solid fa-file-excel" style="color: #10b981;"></i> ${escapeHtml(cUrl.length > 55 ? cUrl.slice(0, 52) + '...' : cUrl)}</a>`
                : '<em class="text-muted">Chưa liên kết Google Sheet</em>';

            const openBtn = cUrl 
                ? `<a href="${escapeHtml(cUrl)}" target="_blank" class="btn btn-secondary-outline btn-sm" style="text-decoration: none;" title="Mở Sheet"><i class="fa-solid fa-arrow-up-right-from-square"></i> Mở</a>`
                : '';

            html += `
                <tr style="background: rgba(99, 102, 241, 0.04);">
                    <td>
                        <strong style="color: var(--color-purple); display: inline-flex; align-items: center; gap: 6px;">
                            <i class="fa-solid fa-layer-group"></i> ${escapeHtml(cluster5.cluster_name || 'Cụm 5')}
                        </strong>
                    </td>
                    <td>${sheetDisplay}</td>
                    <td><span class="badge badge-late">${escapeHtml(cTab)}</span></td>
                    <td style="text-align: center;">
                        <div class="table-actions" style="justify-content: center; gap: 6px;">
                            <button type="button" class="btn btn-primary btn-sm" onclick="openEditSheetLinkModal('cluster', ${cluster5.id}, '${escapeHtml(cUrl || '')}', '${escapeHtml(cTab)}', '${escapeHtml(cluster5.cluster_name || 'Cụm 5')}')">
                                <i class="fa-solid fa-pen-to-square"></i> Sửa Sheet
                            </button>
                            ${openBtn}
                        </div>
                    </td>
                </tr>
            `;
        }

        // 2. Hàng cho 7 Vùng (Vùng 25 -> 31)
        if (Array.isArray(resRegions)) {
            const sortedRegions = [...resRegions].sort((a, b) => a.id - b.id);
            sortedRegions.forEach(r => {
                const rUrl = r.sheet_url || (r.sheet_id ? `https://docs.google.com/spreadsheets/d/${r.sheet_id}/edit` : null);
                const rTab = r.sheet_name || r.current_month_tab || 'T9/26';
                const sheetDisplay = rUrl 
                    ? `<a href="${escapeHtml(rUrl)}" target="_blank" style="color: var(--color-primary); text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 6px;"><i class="fa-solid fa-file-excel" style="color: #10b981;"></i> ${escapeHtml(rUrl.length > 55 ? rUrl.slice(0, 52) + '...' : rUrl)}</a>`
                    : '<em class="text-muted">Chưa liên kết Google Sheet</em>';

                const openBtn = rUrl 
                    ? `<a href="${escapeHtml(rUrl)}" target="_blank" class="btn btn-secondary-outline btn-sm" style="text-decoration: none;" title="Mở Sheet"><i class="fa-solid fa-arrow-up-right-from-square"></i> Mở</a>`
                    : '';

                html += `
                    <tr>
                        <td>
                            <strong style="display: inline-flex; align-items: center; gap: 6px;">
                                <i class="fa-solid fa-map-pin" style="color: var(--color-primary);"></i> ${escapeHtml(r.region_name)}
                            </strong>
                        </td>
                        <td>${sheetDisplay}</td>
                        <td><span class="badge badge-info">${escapeHtml(rTab)}</span></td>
                        <td style="text-align: center;">
                            <div class="table-actions" style="justify-content: center; gap: 6px;">
                                <button type="button" class="btn btn-secondary-outline btn-sm" onclick="openEditSheetLinkModal('region', ${r.id}, '${escapeHtml(rUrl || '')}', '${escapeHtml(rTab)}', '${escapeHtml(r.region_name)}')">
                                    <i class="fa-solid fa-pen-to-square"></i> Sửa Sheet
                                </button>
                                ${openBtn}
                            </div>
                        </td>
                    </tr>
                `;
            });
        }

        tbody.innerHTML = html || '<tr><td colspan="4" style="text-align: center;">Không có dữ liệu</td></tr>';
    } catch (err) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: red;">Lỗi tải Google Sheets: ${err.message}</td></tr>`;
    }
}

// Mở modal sửa Sheet Link
function openEditSheetLinkModal(type, id, currentUrl, currentTab, label) {
    document.getElementById('edit-sheet-target-type').value = type;
    document.getElementById('edit-sheet-target-id').value = id;
    document.getElementById('edit-sheet-target-label').innerText = `Cập nhật Google Sheet: ${label}`;
    document.getElementById('edit-sheet-url').value = currentUrl || '';
    document.getElementById('edit-sheet-name').value = currentTab || 'T9/26';

    if (typeof openModal === 'function') {
        openModal('modal-sheet-link');
    } else {
        document.getElementById('modal-sheet-link')?.classList.add('active');
    }
}

// Mở modal đổi Tab tháng đồng loạt
function openBulkMonthTabModal() {
    const input = document.getElementById('input-bulk-month-tab');
    if (input) {
        const now = new Date();
        let m = now.getMonth() + 1;
        let y = now.getFullYear();
        if (now.getDate() >= 25) {
            m += 1;
            if (m > 12) {
                m = 1;
                y += 1;
            }
        }
        const yShort = String(y).slice(-2);
        input.value = `T${m}/${yShort}`;
    }

    const checkClusters = document.getElementById('check-bulk-apply-clusters');
    if (checkClusters) checkClusters.checked = true;

    const checkAutoDup = document.getElementById('check-bulk-auto-duplicate');
    if (checkAutoDup) checkAutoDup.checked = false;

    if (typeof openModal === 'function') {
        openModal('modal-bulk-month-tab');
    } else {
        const el = document.getElementById('modal-bulk-month-tab');
        if (el) {
            el.classList.add('active');
            el.style.display = 'flex';
        }
    }
}

// Gửi yêu cầu đổi Tab tháng đồng loạt
async function submitBulkMonthTab() {
    const input = document.getElementById('input-bulk-month-tab');
    const newTab = input ? input.value.trim() : '';

    if (!newTab) {
        alert('Vui lòng nhập tên Tab tháng mới (Ví dụ: T10/26)!');
        input?.focus();
        return;
    }

    const applyClusters = document.getElementById('check-bulk-apply-clusters')?.checked ?? true;
    const autoDuplicate = document.getElementById('check-bulk-auto-duplicate')?.checked ?? false;

    const btn = document.getElementById('btn-confirm-bulk-month-tab');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang cập nhật...';
    }

    try {
        const res = await fetch('/api/regions/bulk-month-tab', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                new_sheet_name: newTab,
                apply_clusters: applyClusters,
                auto_duplicate: autoDuplicate
            })
        });

        const data = await res.json();
        if (!res.ok || !data.success) {
            throw new Error(data.error || 'Có lỗi xảy ra khi đổi Tab tháng.');
        }

        let message = `✅ ${data.message}`;
        if (autoDuplicate && Array.isArray(data.data?.duplicate_results) && data.data.duplicate_results.length > 0) {
            const successes = data.data.duplicate_results.filter(r => r.success).length;
            const fails = data.data.duplicate_results.filter(r => !r.success).length;
            message += `\n(Nhân bản Sheet: Thành công ${successes}, Thất bại ${fails})`;
        }

        alert(message);

        if (typeof closeModal === 'function') {
            closeModal('modal-bulk-month-tab');
        } else {
            const el = document.getElementById('modal-bulk-month-tab');
            if (el) {
                el.classList.remove('active');
                el.style.display = 'none';
            }
        }

        if (typeof loadAdminSheetLinksTable === 'function') {
            await loadAdminSheetLinksTable();
        }
    } catch (err) {
        alert('❌ Lỗi: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

window.loadRegions = loadRegions;
window.loadAdminSheetLinksTable = loadAdminSheetLinksTable;
window.openEditSheetLinkModal = openEditSheetLinkModal;
window.openBulkMonthTabModal = openBulkMonthTabModal;
window.submitBulkMonthTab = submitBulkMonthTab;
window.showRegionModal = showRegionModal;
window.editRegion = editRegion;
window.deleteRegion = deleteRegion;
window.populateRegionDropdowns = populateRegionDropdowns;
window.populateClusterManagersDropdown = populateClusterManagersDropdown;
window.initRegionForms = initRegionForms;

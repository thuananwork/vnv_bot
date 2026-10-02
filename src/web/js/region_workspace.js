// ==========================================
// VNV-BOT V2: REGION WORKSPACE (BẢNG ĐIỀU HÀNH VÙNG)
// ==========================================

let rawMembersList = [];
let currentMemberFilter = 'all';

function getRegionWorkDate() {
    if (typeof window.getSelectedDate === 'function') {
        return window.getSelectedDate('rw-work-date', 'rw-work-date-custom');
    }
    const rwDateEl = document.getElementById('rw-work-date');
    return rwDateEl?.value || new Date().toLocaleDateString('sv');
}

function getStatusColors() {
    const defaultColors = {
        ok: '#10b981',
        late: '#f59e0b',
        no_response: '#6b7280',
        military: '#8b5cf6',
        exam: '#ec4899',
        off: '#ef4444'
    };
    try {
        const saved = JSON.parse(localStorage.getItem('vnv_status_colors') || '{}');
        return { ...defaultColors, ...saved };
    } catch(e) {
        return defaultColors;
    }
}

/**
 * Làm sạch tên Zalo: bỏ các tiền tố như aVùng31_, aTuyết Như -> Tuyết Như, tách tên dính
 */
function cleanZaloSenderName(raw, realName = null) {
    if (!raw) return '';
    let name = String(raw).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
    if (name.includes('\n')) name = name.split('\n')[0];
    name = name.split(/(?:báo cáo|báo\s*cáo|gửi báo cáo|gủi báo cáo|kế hoạch|hàng ngày|nhiệm vụ|\/-|@)/i)[0].trim();
    name = name.replace(/^(?:a[\s_\-.:]*)?(?:v(?:ùng)?\s*\d+)[\s_\-.:]*/i, '');
    name = name.replace(/^a(?=[A-ZÀ-ỴÁÀẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ])/g, '');
    name = name.replace(/^a[\s_\-.:]+(?=[A-Za-zÀ-ỹ])/i, '');
    name = name.replace(/^(ms|mr)([a-zà-ỹ0-9_]+)/i, (m, p1, p2) => {
        const title = p1.toLowerCase() === 'ms' ? 'Ms ' : 'Mr ';
        return title + p2.charAt(0).toUpperCase() + p2.slice(1);
    });

    if (realName && typeof realName === 'string') {
        const cleanReal = realName.replace(/\u00a0/g, ' ').trim();
        if (cleanReal.length >= 3 && name.toLowerCase().endsWith(cleanReal.toLowerCase()) && name.length > cleanReal.length) {
            const prefix = name.slice(0, name.length - cleanReal.length).trim();
            if (prefix.length >= 2) name = prefix;
        }
    }

    const vnUpper = 'A-ZÀÁẢÃẠĂẮẰẲẴẶÂẤẦẨẪẬÉÈẺẼẸÊẾỀỂỄỆÍÌỈĨỊÓÒỎÕỌÔỐỒỔỖỘƠỚỜỞỠỢÚÙỦŨỤƯỨỪỬỮỰÝỲỶỸỴĐ';
    const vnLower = 'a-zàáảãạăắằẳẵặâấầẩẫậéèẻẽẹêếềểễệíìỉĩịóòỏõọôốồổỗộơớờởỡợúùủũụưứừửữựýỳỷỹỵđ';
    const concatRegex = new RegExp('^(.+?[' + vnLower + '0-9])([' + vnUpper + '][' + vnLower + ']+(?:\\s+[' + vnUpper + '][' + vnLower + ']+){1,3})$');
    const concatMatch = name.match(concatRegex);
    if (concatMatch && concatMatch[1].trim().length >= 2 && concatMatch[2].trim().length >= 4) {
        name = concatMatch[1].trim();
    }

    return name.trim();
}

function initStatusColorPickers() {
    const colors = getStatusColors();
    const map = [
        { key: 'ok', id: 'ok' },
        { key: 'late', id: 'late' },
        { key: 'no_response', id: 'no-response' },
        { key: 'military', id: 'military' },
        { key: 'exam', id: 'exam' },
        { key: 'off', id: 'off' }
    ];

    map.forEach(item => {
        const picker = document.getElementById('picker-color-' + item.id);
        const dot = document.getElementById('dot-color-' + item.id);
        if (picker) {
            picker.value = colors[item.key];
            if (dot) dot.style.background = colors[item.key];
            picker.addEventListener('input', (e) => {
                const newColor = e.target.value;
                if (dot) dot.style.background = newColor;
                const cur = getStatusColors();
                cur[item.key] = newColor;
                localStorage.setItem('vnv_status_colors', JSON.stringify(cur));
                renderFilteredMembers();
            });
        }
    });
}

function getActiveRegionId() {
    const user = window.currentUser;
    if (user && user.role === 'region_leader' && user.managed_region_id) {
        return String(user.managed_region_id);
    }
    const selectEl = document.getElementById('rw-region-select');
    if (selectEl && selectEl.value) {
        return String(selectEl.value);
    }
    return localStorage.getItem('vnv_selected_region') || '25';
}
window.getActiveRegionId = getActiveRegionId;

async function loadRegionWorkspaceData() {
    const selectEl = document.getElementById('rw-region-select');
    const user = window.currentUser;
    const regionId = getActiveRegionId();

    if (selectEl) {
        selectEl.value = regionId;
        if (user && user.role === 'region_leader') {
            selectEl.style.display = 'none';
        } else {
            selectEl.style.display = '';
            selectEl.disabled = false;
            selectEl.title = 'Chọn Vùng để quản trị';
        }
    }

    // Cập nhật tiêu đề trang: VÙNG [XX]
    const pageTitle = document.getElementById('rw-page-title');
    if (pageTitle) {
        pageTitle.innerHTML = `<i class="fa-solid fa-map-location-dot" style="color: var(--color-primary);"></i> VÙNG ${regionId}`;
    }
    try {
        const res = await fetch('/api/v2/regions');
        const data = await res.json();
        if (data.success && Array.isArray(data.data)) {
            const region = data.data.find(r => String(r.id) === String(regionId));
            if (region) {
                window.currentRegionData = region;
                if (pageTitle) {
                    pageTitle.innerHTML = `<i class="fa-solid fa-map-location-dot" style="color: var(--color-primary);"></i> VÙNG ${regionId}`;
                }
                // Cập nhật ngay link Mở Google Sheet cho tất cả các nút Mở Sheet (không chờ tải tabs)
                const url = region.sheet_url || (region.sheet_id ? `https://docs.google.com/spreadsheets/d/${region.sheet_id}/edit` : null);
                const openSheetButtons = document.querySelectorAll('#link-rw-open-sheet, #link-rw-open-sheet-header, .rw-open-sheet-btn, #rw-modal-sheet-link');
                openSheetButtons.forEach(btn => {
                    if (url) {
                        btn.href = url;
                        btn.style.display = 'inline-flex';
                    }
                });

                const workDate = getRegionWorkDate();
                const autoTab = getDynamicMonthTab(workDate);
                const targetTab = region.sheet_name || region.current_month_tab || autoTab || 'T10/26';
                await loadRegionSheetTabs(regionId, targetTab);
            }
        }
        await loadRegionMembers();
        await loadRegionReportPreview();
        await checkPendingSheetSync();
    } catch (err) {
        console.error('Lỗi tải dữ liệu vùng:', err);
    }
}

async function loadRegionMembers() {
    const regionId = getActiveRegionId();
    const date = getRegionWorkDate();
    const tbody = document.getElementById('rw-members-table-body');
    const summary = document.getElementById('rw-members-summary');

    if (!tbody) return;

    let retryCount = 0;
    while (retryCount < 2) {
        try {
            const res = await fetch(`/api/v2/regions/${regionId}/members?date=${date}`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();

            if (data.success && Array.isArray(data.data)) {
                if (data.settings) {
                    window.vnvSettings = { ...(window.vnvSettings || {}), ...data.settings };
                }
                if (Array.isArray(data.custom_statuses)) {
                    window.vnvCustomStatuses = data.custom_statuses;
                    renderRegionPaletteChips(window.vnvCustomStatuses);
                }
                rawMembersList = data.data;
                rawMembersList.sort((a, b) => {
                    const getRoleOrder = r => r === 'LEADER' ? 1 : (r === 'DEPUTY' ? 2 : 3);
                    const roleDiff = getRoleOrder(a.role) - getRoleOrder(b.role);
                    if (roleDiff !== 0) return roleDiff;
                    return (a.sheet_row_index || 0) - (b.sheet_row_index || 0);
                });
                const completedCount = rawMembersList.filter(m => m.submission_status === 'OK').length;
                const totalCount = rawMembersList.length;
                const incompleteCount = totalCount - completedCount;
                if (summary) summary.innerHTML = `<i class="fa-solid fa-users"></i> ${totalCount} Sứ giả`;
                const compChip = document.getElementById('rw-stat-completed-chip');
                if (compChip) compChip.innerHTML = `<i class="fa-solid fa-check"></i> Hoàn thành: ${completedCount}`;
                const incompChip = document.getElementById('rw-stat-incomplete-chip');
                if (incompChip) incompChip.innerHTML = `<i class="fa-solid fa-clock"></i> Chưa nộp: ${incompleteCount}`;
                renderFilteredMembers();
                return; // Done
            }
        } catch (err) {
            retryCount++;
            if (retryCount < 2) {
                await new Promise(r => setTimeout(r, 1000));
            } else {
                tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: #ef4444; padding: 24px; font-size: 13px;">
                    <div style="font-weight: 600; margin-bottom: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> Không thể kết nối tới máy chủ Bot</div>
                    <div style="color: #6b7280; margin-bottom: 12px;">Nguyên nhân: Cửa sổ console đen (VNV-Bot.exe) có thể đã bị đóng hoặc ứng dụng đang khởi động lại.</div>
                    <button class="btn btn-sm btn-outline-primary" onclick="loadRegionMembers()" style="cursor: pointer; padding: 4px 12px; border-radius: 6px;">
                        <i class="fa-solid fa-rotate-right"></i> Thử tải lại
                    </button>
                </td></tr>`;
            }
        }
    }
}

function isLightColor(hex) {
    if (!hex) return false;
    const c = hex.replace('#', '');
    const num = parseInt(c.length === 3 ? c.split('').map(x => x + x).join('') : c, 16);
    if (isNaN(num)) return false;
    const r = (num >> 16) & 255;
    const g = (num >> 8) & 255;
    const b = num & 255;
    return ((r * 299) + (g * 587) + (b * 114)) / 1000 >= 160;
}

function renderRegionPaletteChips(statuses) {
    const container = document.getElementById('rw-palette-chips-container');
    if (!container) return;

    if (!Array.isArray(statuses) || statuses.length === 0) {
        container.innerHTML = '<span style="font-size: 11px; color: var(--text-muted); font-style: italic;">Chưa có trạng thái màu</span>';
        return;
    }

    container.innerHTML = statuses.map(s => {
        const color = (s.color_hex || '#10B981').toUpperCase();
        return `
            <label class="micro-color-chip" id="chip-status-${s.id}" title="Nhấp để đổi màu: ${escapeHtml(s.status_name)} (${color})" style="cursor: pointer; display: inline-flex; align-items: center; gap: 4px;">
                <span class="color-dot" id="dot-status-${s.id}" style="background-color: ${color}; width: 8px; height: 8px; border-radius: 50%; display: inline-block;"></span>
                <span>${escapeHtml(s.status_name)}</span>
            </label>
        `;
    }).join('');

    statuses.forEach(s => {
        const chip = document.getElementById(`chip-status-${s.id}`);
        if (chip) {
            chip.addEventListener('click', (e) => {
                e.stopPropagation();
                if (typeof openPalettePicker === 'function') {
                    openPalettePicker(s.color_hex, chip, async (newColor) => {
                        try {
                            const res = await fetch(`/api/system/custom-status/${s.id}`, {
                                method: 'PUT',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ color_hex: newColor })
                            });
                            const data = await res.json();
                            if (data.success) {
                                s.color_hex = newColor;
                                const dot = document.getElementById(`dot-status-${s.id}`);
                                if (dot) dot.style.backgroundColor = newColor;
                                renderFilteredMembers();
                                if (typeof showToast === 'function') {
                                    showToast(`🎨 Đã đổi màu "${s.status_name}" thành ${newColor.toUpperCase()}`);
                                }
                            }
                        } catch (err) {
                            console.warn('Lỗi đổi màu chip:', err);
                        }
                    });
                }
            });
        }
    });
}
window.renderRegionPaletteChips = renderRegionPaletteChips;

function canCurrentUserChangeRole() {
    const user = window.currentUser;
    if (!user) return false;
    // Tài khoản Vùng (region_leader) tuyệt đối KHÔNG có quyền đổi vai trò
    if (user.role === 'region_leader') return false;
    // Admin có toàn quyền
    if (user.role === 'admin') return true;
    // Trưởng Cụm (cluster_leader): chỉ được đổi nếu vùng thuộc Cụm quản lý
    if (user.role === 'cluster_leader') {
        const region = window.currentRegionData;
        const userClusterId = user.managed_cluster_id;
        if (userClusterId && region && region.cluster_id && String(userClusterId) !== String(region.cluster_id)) {
            return false;
        }
        return true;
    }
    return false;
}

function renderFilteredMembers() {
    const tbody = document.getElementById('rw-members-table-body');
    if (!tbody) return;

    const colors = getStatusColors();
    const completedText = (window.vnvSettings && window.vnvSettings.completed_text) || 'Ok';
    const filtered = rawMembersList.filter(m => {
        const isDone = m.submission_status === 'OK';
        if (currentMemberFilter === 'done' && !isDone) return false;
        if (currentMemberFilter === 'not' && isDone) return false;
        return true;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align: center; padding: 24px; color: var(--text-muted);">Không tìm thấy kết quả phù hợp</td></tr>';
        return;
    }

    tbody.innerHTML = filtered.map((m, idx) => {
        let statusBadge = '<span class="badge badge-none">Chưa nộp</span>';
        const notesLower = (m.submission_notes || '').toLowerCase();

        if (m.submission_status === 'OK') {
            const okStatus = (window.vnvCustomStatuses || []).find(s => 
                s.status_name.toLowerCase().includes('hoàn thành') || 
                s.status_name.toLowerCase().includes('ok')
            );
            const okText = okStatus?.text_value || completedText;
            const okColor = okStatus?.color_hex;
            const style = okColor ? `style="background-color: ${okColor}; color: ${isLightColor(okColor) ? '#000' : '#fff'};"` : '';
            statusBadge = `<span class="badge badge-ok" ${style}>${escapeHtml(okText)}</span>`;
        } else {
            let matchedStatus = null;
            if (notesLower && Array.isArray(window.vnvCustomStatuses)) {
                for (const cs of window.vnvCustomStatuses) {
                    const csName = cs.status_name.toLowerCase().trim();
                    if (csName.includes('hoàn thành') || csName.includes('ok')) continue;
                    if (notesLower.includes(csName) || csName.includes(notesLower)) {
                        matchedStatus = cs;
                        break;
                    }
                }
            }

            if (matchedStatus) {
                const color = matchedStatus.color_hex;
                const style = color ? `style="background-color: ${color}; color: ${isLightColor(color) ? '#000' : '#fff'};"` : '';
                statusBadge = `<span class="badge" ${style}>${escapeHtml(matchedStatus.status_name)}</span>`;
            } else if (notesLower.includes('quân sự')) {
                statusBadge = '<span class="badge badge-military">Đi quân sự</span>';
            } else if (notesLower.includes('thi') || notesLower.includes('viện')) {
                statusBadge = '<span class="badge badge-exam">Ôn thi/Đi viện</span>';
            } else if (m.submission_status === 'LATE_REQUEST') {
                statusBadge = '<span class="badge badge-late">Làm muộn/Bổ sung</span>';
            } else if (m.submission_status === 'OFF') {
                statusBadge = '<span class="badge badge-off">Xin nghỉ</span>';
            }
        }

        let roleOptions = '';
        if (canCurrentUserChangeRole()) {
            roleOptions = `
                <select class="rw-role-select role-${m.role || 'EMISSARY'}" 
                        onchange="handleQuickChangeMemberRole(${m.id}, this.value, '${escapeHtml(m.real_name)}')"
                        title="Bấm để chọn chức vụ Trưởng Vùng / Phó Vùng / Sứ giả">
                    <option value="EMISSARY" ${m.role !== 'LEADER' && m.role !== 'DEPUTY' ? 'selected' : ''}>Sứ giả</option>
                    <option value="DEPUTY" ${m.role === 'DEPUTY' ? 'selected' : ''}>🏅 Phó Vùng</option>
                    <option value="LEADER" ${m.role === 'LEADER' ? 'selected' : ''}>👑 Trưởng Vùng</option>
                </select>
            `;
        } else {
            if (m.role === 'LEADER') {
                roleOptions = '<span class="badge badge-role-leader" style="font-weight:600; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid fa-crown" style="color:#f59e0b;"></i> Trưởng Vùng</span>';
            } else if (m.role === 'DEPUTY') {
                roleOptions = '<span class="badge badge-role-deputy" style="font-weight:600; font-size:11.5px; display:inline-flex; align-items:center; gap:4px;"><i class="fa-solid fa-medal" style="color:#6366f1;"></i> Phó Vùng</span>';
            } else {
                roleOptions = '<span style="color: var(--text-secondary); font-size: 12px;">Sứ giả</span>';
            }
        }

        const rawVal = m.mapped_zalo_name || m.zalo_display_name || '';
        const cleanVal = cleanZaloSenderName(rawVal, m.real_name);
        const zaloValue = cleanVal || m.real_name;

        return `
            <tr>
                <td><strong>${idx + 1}</strong> <span style="color: var(--text-muted); font-size: 11px;">(R${m.sheet_row_index})</span></td>
                <td>
                    <strong>${escapeHtml(m.real_name)}</strong>
                    <div style="margin-top: 4px;">
                        <input type="text" class="form-control rw-zalo-mapping-input" 
                               data-real-name="${escapeHtml(m.real_name)}" 
                               value="${escapeHtml(zaloValue)}" 
                               placeholder="Tên Zalo..." 
                               title="Sửa tên Zalo để bot nhận diện chính xác"
                               style="font-size: 12px; height: 28px; padding: 2px 8px; width: 100%; border: 1px solid var(--panel-border);">
                    </div>
                </td>
                <td>${roleOptions}</td>
                <td>${statusBadge}</td>
                <td><small style="color: var(--text-secondary);">${escapeHtml(m.submission_notes || '')}</small></td>
            </tr>
        `;
    }).join('');
}

async function handleQuickChangeMemberRole(memberId, newRole, realName) {
    if (!canCurrentUserChangeRole()) {
        const msg = '❌ Tài khoản Trưởng/Phó Vùng không có quyền điều chỉnh chức vụ. Quyền này chỉ thuộc về Quản lý Cụm trực tiếp hoặc Admin.';
        if (typeof showToast === 'function') {
            showToast(msg);
        } else {
            alert(msg);
        }
        return;
    }
    try {
        const res = await fetch(`/api/members/${memberId}/assign-role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });
        const data = await res.json();
        if (data.success) {
            const roleLabels = { 'LEADER': 'Trưởng Vùng 👑', 'DEPUTY': 'Phó Vùng 🏅', 'EMISSARY': 'Sứ giả' };
            if (typeof showToast === 'function') {
                showToast(`✅ Đã chọn ${realName} làm ${roleLabels[newRole] || newRole}!`);
            }
            const regionId = getActiveRegionId();
            const workDate = getRegionWorkDate();
            await loadRegionWorkspaceData(regionId, workDate);
        } else {
            if (typeof showToast === 'function') {
                showToast(`❌ Lỗi: ${data.error || 'Không thể đổi vai trò'}`);
            }
            const regionId = getActiveRegionId();
            const workDate = getRegionWorkDate();
            await loadRegionWorkspaceData(regionId, workDate);
        }
    } catch (err) {
        if (typeof showToast === 'function') {
            showToast(`❌ Lỗi kết nối: ${err.message}`);
        }
    }
}
window.handleQuickChangeMemberRole = handleQuickChangeMemberRole;

async function saveRegionNameMappings() {
    const regionId = getActiveRegionId();
    const inputs = document.querySelectorAll('.rw-zalo-mapping-input');
    const mappings = {};

    inputs.forEach(inp => {
        const realName = inp.getAttribute('data-real-name');
        const val = inp.value.trim();
        if (realName && val) {
            mappings[realName] = val;
        }
    });

    const btn = document.getElementById('btn-rw-save-mappings');
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
        }

        const res = await fetch(`/api/v2/regions/${regionId}/name-mappings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mappings })
        });
        const data = await res.json();

        if (data.success) {
            if (typeof window.showToast === 'function') {
                window.showToast('💾 ' + data.message);
            } else {
                alert(data.message);
            }
            await loadRegionMembers();
        } else {
            alert('Lỗi khi lưu mapping: ' + data.error);
        }
    } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu';
        }
    }
}

async function handleAutoGuessZaloMappings() {
    const regionId = getActiveRegionId();
    const btn = document.getElementById('btn-rw-auto-guess-zalo');
    const originalHtml = btn ? btn.innerHTML : '';

    const ok = await showConfirmModal(
        'Bot sẽ tự động kết nối nhóm Zalo của Vùng, quét danh sách người gửi/tin nhắn gần đây và tự động mapping nick Zalo tương ứng cho từng Sứ giả trên Google Sheet.\n\nSau khi Bot mapping xong, bạn có thể kiểm tra lại và bấm [Lưu] để xác nhận. Bắt đầu ngay?',
        {
            title: '✨ Mapping Tên Zalo',
            icon: '<i class="fa-solid fa-wand-magic-sparkles" style="color: #6366f1;"></i>',
            confirmText: 'Bắt đầu mapping Zalo'
        }
    );
    if (!ok) return;

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang mapping tên Zalo...';
    }

    try {
        if (typeof window.showToast === 'function') {
            window.showToast('🤖 Bot đang quét nhóm Zalo và mapping tên Sứ giả...');
        }

        const res = await fetch(`/api/v2/regions/${regionId}/auto-guess-mappings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        let data;
        const resText = await res.text();
        try {
            data = JSON.parse(resText);
        } catch (e) {
            if (res.status === 404) {
                throw new Error('Tính năng chưa được nạp trên máy chủ. Vui lòng khởi động lại Bot (đóng cửa sổ lệnh và mở lại VNV-Bot.bat).');
            }
            throw new Error(`Máy chủ phản hồi lỗi (${res.status}): ${resText.substring(0, 100)}`);
        }

        if (data.success && Array.isArray(data.suggestions)) {
            let filledCount = 0;
            const suggestions = data.suggestions;

            suggestions.forEach(s => {
                if (!s.suggestedZaloName || s.confidence < 0.60) return;

                // Tìm ô input tương ứng với Sứ giả
                const input = document.querySelector(`.rw-zalo-mapping-input[data-real-name="${s.realName}"]`);
                if (input) {
                    const cleanName = cleanZaloSenderName(s.suggestedZaloName);
                    input.value = cleanName;
                    input.style.borderColor = '#8b5cf6';
                    input.style.background = '#f5f3ff';
                    input.style.fontWeight = '600';
                    // Gắn nhãn hoặc hiển thị gợi ý bên dưới nếu chưa có
                    const parentTd = input.closest('td') || input.parentNode;
                    let hint = parentTd.querySelector('.auto-guess-hint');
                    if (!hint) {
                        hint = document.createElement('div');
                        hint.className = 'auto-guess-hint';
                        hint.style.fontSize = '11px';
                        hint.style.color = '#7c3aed';
                        hint.style.marginTop = '2px';
                        parentTd.appendChild(hint);
                    }
                    hint.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Mapping: <strong>${escapeHtml(cleanName)}</strong> <span style="opacity:0.8;">(${Math.round(s.confidence * 100)}%)</span>`;
                    filledCount++;
                }
            });

            const msg = `🎉 Bot đã mapping xong ${filledCount}/${data.totalMembers} Sứ giả từ ${data.totalSendersFound} người gửi Zalo!\n👉 Vui lòng kiểm tra lại các ô màu tím và bấm nút [Lưu] để xác nhận.`;
            if (typeof window.showToast === 'function') {
                window.showToast(msg);
            } else {
                alert(msg);
            }
        } else {
            if (data.error === 'SESSION_UNAUTHENTICATED' || res.status === 401) {
                alert('⚠️ Phiên đăng nhập đã hết hạn (do máy chủ vừa khởi động lại để cập nhật tính năng mới).\n\nVui lòng đăng nhập lại để tiếp tục thao tác!');
                window.location.hash = '#login';
                window.location.reload();
                return;
            }
            const errReason = data.reason || data.error || 'Không thể quét danh sách Zalo.';
            if (data.needsLogin) {
                alert('⚠️ Cửa sổ Zalo đã được mở trên màn hình nhưng chưa đăng nhập. Vui lòng quét mã QR trên Zalo rồi bấm thử lại!');
            } else {
                alert('Thông báo từ Bot: ' + errReason);
            }
        }
    } catch (err) {
        alert('Lỗi kết nối khi mapping Zalo: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}


function openExcelImportModal() {
    const modal = document.getElementById('modal-excel-import');
    const txt = document.getElementById('rw-excel-import-text');
    if (txt) txt.value = '';
    if (modal) modal.classList.add('active');
}

function closeExcelImportModal() {
    const modal = document.getElementById('modal-excel-import');
    if (modal) modal.classList.remove('active');
}

async function handleConfirmExcelImport() {
    const text = document.getElementById('rw-excel-import-text')?.value || '';
    if (!text.trim()) {
        alert('Vui lòng dán dữ liệu từ Excel vào ô trước khi xác nhận!');
        return;
    }

    const regionId = getActiveRegionId();
    const lines = text.split('\n');
    const mappings = {};

    for (const line of lines) {
        if (!line.trim()) continue;
        const parts = line.split('\t');
        const sheetName = parts[0]?.trim();
        const zaloName = parts[1]?.trim() || sheetName;
        if (sheetName) {
            mappings[sheetName] = zaloName;
        }
    }

    const count = Object.keys(mappings).length;
    if (count === 0) {
        alert('Không nhận diện được dòng dữ liệu nào!');
        return;
    }

    try {
        const res = await fetch(`/api/v2/regions/${regionId}/name-mappings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ mappings })
        });
        const data = await res.json();

        if (data.success) {
            if (typeof window.showToast === 'function') {
                window.showToast(`📋 Đã nhập thành công ${data.updatedCount || count} dòng từ Excel!`);
            } else {
                alert(`Đã nhập thành công ${data.updatedCount || count} dòng từ Excel!`);
            }
            closeExcelImportModal();
            await loadRegionMembers();
        } else {
            alert('Lỗi nhập Excel: ' + data.error);
        }
    } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
    }
}

async function loadRegionReportPreview() {
    const regionId = getActiveRegionId();
    const date = getRegionWorkDate();
    const previewEl = document.getElementById('rw-report-preview-text');

    if (!previewEl) return;

    try {
        const res = await fetch(`/api/v2/preview/report?type=region&regionId=${regionId}&workDate=${date}`);
        const data = await res.json();
        if (data.success && data.content) {
            previewEl.value = data.content;
        }
    } catch (err) {}
}

// ==========================================
// QUẢN LÝ TAB TRANG TÍNH (SHEET CON)
// ==========================================
let cachedRegionSheetTabs = [];

function updateToolbarSheetTabDisplay(activeTab) {
    const input = document.getElementById('rw-sheet-tab');
    if (input) input.value = activeTab;
    const display = document.getElementById('rw-sheet-tab-display');
    if (display) display.innerText = activeTab;
}

async function loadRegionSheetTabs(regionId, currentSavedTab) {
    const workDate = getRegionWorkDate();
    const autoTab = getDynamicMonthTab(workDate);
    const activeTab = currentSavedTab || autoTab || 'T10/26';
    updateToolbarSheetTabDisplay(activeTab);

    try {
        const res = await fetch(`/api/v2/regions/${regionId}/sheet-tabs`);
        if (!res.ok) return;
        const data = await res.json();
        const sheetTabs = (data.success && Array.isArray(data.tabs) && data.tabs.length > 0)
            ? data.tabs
            : [];

        cachedRegionSheetTabs = sheetTabs;

        const openSheetModalLink = document.getElementById('rw-modal-sheet-link');
        const sheetUrl = data.sheetUrl || (data.data && data.data.sheetUrl) || (window.currentRegionData && (window.currentRegionData.sheet_url || (window.currentRegionData.sheet_id ? `https://docs.google.com/spreadsheets/d/${window.currentRegionData.sheet_id}/edit` : null)));
        if (openSheetModalLink && sheetUrl) {
            openSheetModalLink.href = sheetUrl;
        }
    } catch (e) {
        console.warn('Không thể tải danh sách tab sheet:', e);
    }
}

// Mở Hộp Thoại Hệ Thống để Chọn Tab Sheet Con
async function openSelectSheetTabModal() {
    const regionId = getActiveRegionId();
    const region = window.currentRegionData;
    const currentTab = region?.sheet_name || document.getElementById('rw-sheet-tab')?.value || 'T10/26';

    const regNameEl = document.getElementById('modal-tab-region-name');
    const badgeEl = document.getElementById('modal-tab-current-badge');
    const selectEl = document.getElementById('select-modal-sheet-tab');

    if (regNameEl) regNameEl.innerText = region?.region_name || ('VÙNG ' + regionId);
    if (badgeEl) badgeEl.innerText = `Tab hiện tại: ${currentTab}`;

    if (selectEl) {
        selectEl.innerHTML = '<option value="">Đang tải danh sách Tab từ Google Sheet...</option>';
    }

    openModal('modal-select-sheet-tab');
    await reloadModalSheetTabs(currentTab);
}

// Tải / Làm mới danh sách Tab Sheet con từ Google Sheet
async function reloadModalSheetTabs(forceSelectedTab = null) {
    const regionId = getActiveRegionId();
    const selectEl = document.getElementById('select-modal-sheet-tab');
    const refreshIcon = document.getElementById('icon-refresh-tabs');
    const currentTab = forceSelectedTab || window.currentRegionData?.sheet_name || document.getElementById('rw-sheet-tab')?.value || 'T10/26';

    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    try {
        const res = await fetch(`/api/v2/regions/${regionId}/sheet-tabs`);
        const data = await res.json();
        const tabs = (data.success && Array.isArray(data.tabs) && data.tabs.length > 0)
            ? data.tabs
            : [];

        cachedRegionSheetTabs = tabs;

        // Phân loại: Các Tab Tháng vs Các Tab Khác
        const monthTabs = tabs.filter(t => t.match(/^T\d+\/\d+$/i));
        const otherTabs = tabs.filter(t => !t.match(/^T\d+\/\d+$/i));

        // Đảm bảo tab hiện tại có trong danh sách
        if (currentTab && !tabs.includes(currentTab)) {
            if (currentTab.match(/^T\d+\/\d+$/i)) {
                monthTabs.unshift(currentTab);
            } else {
                otherTabs.unshift(currentTab);
            }
        }

        let html = '';
        if (monthTabs.length > 0) {
            html += `<optgroup label="── Các Tab Tháng Làm Việc (Khuyên dùng) ──">`;
            monthTabs.forEach(t => {
                html += `<option value="${escapeHtml(t)}" ${t === currentTab ? 'selected' : ''}>${escapeHtml(t)}${t === currentTab ? ' (Đang dùng)' : ''}</option>`;
            });
            html += `</optgroup>`;
        }

        if (otherTabs.length > 0) {
            html += `<optgroup label="── Tất cả các Sheet con khác trong Trang Tính ──">`;
            otherTabs.forEach(t => {
                html += `<option value="${escapeHtml(t)}" ${t === currentTab ? 'selected' : ''}>${escapeHtml(t)}${t === currentTab ? ' (Đang dùng)' : ''}</option>`;
            });
            html += `</optgroup>`;
        }

        if (!html) {
            html = `<option value="${escapeHtml(currentTab)}" selected>${escapeHtml(currentTab)}</option>`;
        }

        if (selectEl) {
            selectEl.innerHTML = html;
            selectEl.value = currentTab;
        }

        const sheetUrl = data.sheetUrl || (data.data && data.data.sheetUrl) || (window.currentRegionData && (window.currentRegionData.sheet_url || (window.currentRegionData.sheet_id ? `https://docs.google.com/spreadsheets/d/${window.currentRegionData.sheet_id}/edit` : null)));
        const modalLink = document.getElementById('rw-modal-sheet-link');
        if (modalLink && sheetUrl) {
            modalLink.href = sheetUrl;
        }
    } catch (err) {
        console.error('Lỗi nạp tab sheet con:', err);
        if (selectEl) {
            selectEl.innerHTML = `
                <option value="${escapeHtml(currentTab)}" selected>${escapeHtml(currentTab)} (Hiện tại)</option>
                <option value="T11/26">T11/26</option>
                <option value="T10/26">T10/26</option>
                <option value="T9/26">T9/26</option>
            `;
            selectEl.value = currentTab;
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
    }
}

// Xác nhận đổi Tab Sheet con từ Modal
async function confirmSelectSheetTab() {
    const selectEl = document.getElementById('select-modal-sheet-tab');
    const newTab = selectEl ? selectEl.value : '';
    if (!newTab) {
        alert('Vui lòng chọn một Tab Trang tính!');
        return;
    }

    const regionId = getActiveRegionId();
    const btn = document.getElementById('btn-confirm-select-tab');
    const originalText = btn ? btn.innerHTML : '';
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
    }

    try {
        const res = await fetch(`/api/v2/regions/${regionId}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheet_name: newTab })
        });
        const data = await res.json();
        if (data.success) {
            if (window.currentRegionData) {
                window.currentRegionData.sheet_name = newTab;
            }
            updateToolbarSheetTabDisplay(newTab);

            closeModal('modal-select-sheet-tab');
            if (typeof window.showToast === 'function') {
                window.showToast(`✅ Đã chuyển sang Tab Sheet: "${newTab}"`, 'success');
            } else {
                alert(`Đã chuyển thành công sang Tab Sheet con: "${newTab}"!`);
            }
        } else {
            alert('Lỗi khi lưu tab: ' + (data.error || 'Thất bại'));
        }
    } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalText;
        }
    }
}

// Lưu khi đổi trực tiếp từ select trên Toolbar
async function saveRegionSettings() {
    const regionId = getActiveRegionId();
    const sheetTabEl = document.getElementById('rw-sheet-tab');
    const sheet_name = sheetTabEl?.value || 'T10/26';

    try {
        const res = await fetch(`/api/v2/regions/${regionId}/settings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sheet_name })
        });
        const data = await res.json();
        if (data.success) {
            if (window.currentRegionData) {
                window.currentRegionData.sheet_name = sheet_name;
            }
            if (typeof window.showToast === 'function') {
                window.showToast(`✅ Đã chuyển sang Tab Sheet: "${sheet_name}"`, 'success');
            } else {
                alert(`Đã lưu thành công cấu hình Tab Sheet "${sheet_name}" cho Vùng ${regionId}!`);
            }
        } else {
            alert('Lỗi khi lưu cấu hình: ' + (data.error || 'Không thể lưu.'));
        }
    } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
    }
}

function getDynamicMonthTab(dateVal) {
    if (!dateVal) return 'T' + (new Date().getMonth() + 1) + '/' + String(new Date().getFullYear()).slice(-2);
    const parts = dateVal.split('-');
    if (parts.length === 3) {
        return `T${parseInt(parts[1], 10)}/${parts[0].slice(-2)}`;
    }
    const d = new Date(dateVal);
    return `T${d.getMonth() + 1}/${String(d.getFullYear()).slice(-2)}`;
}

let currentPendingReport = null;

async function checkPendingSheetSync() {
    const regionId = getActiveRegionId();
    const workDate = getRegionWorkDate();
    const alertEl = document.getElementById('rw-sheet-sync-alert');
    if (!alertEl) return;

    try {
        const res = await fetch(`/api/v2/regions/${regionId}/members?date=${workDate}`);
        const data = await res.json();
        if (data.success && Array.isArray(data.data) && data.data.length > 0) {
            const hasSubmissions = data.data.some(m => m.submission_status && m.submission_status !== 'NO_RESPONSE');
            const hasUnsynced = data.data.some(m => m.sheet_synced === 0 && m.submission_status && m.submission_status !== 'NO_RESPONSE');
            if (hasSubmissions && hasUnsynced) {
                alertEl.style.display = 'flex';
                const expTab = getDynamicMonthTab(workDate);
                document.getElementById('rw-sheet-sync-alert-title').innerText = `Dữ liệu ngày ${workDate} chưa được ghi vào Google Sheet`;
                document.getElementById('rw-sheet-sync-alert-desc').innerText = `Báo cáo đã lưu trên bot nhưng Google Sheet chưa có tab ${expTab} hoặc chưa đồng bộ. Bấm nút bên phải để ghi bù khi tab đã tạo.`;
                return;
            }
        }
        alertEl.style.display = 'none';
    } catch (e) {
        alertEl.style.display = 'none';
    }
}

let isRegionReportRunning = false;

async function stopRegionReport() {
    const regionId = getActiveRegionId();
    const btn = document.getElementById('btn-rw-run-report');
    if (btn) {
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang dừng quét...';
    }
    showToast('⏹️ Đang gửi yêu cầu dừng quét bài...');
    try {
        await fetch(`/api/v2/regions/${regionId}/stop-scan`, { method: 'POST' });
    } catch (e) {
        console.warn('Lỗi khi gửi lệnh dừng quét:', e);
    }
}

async function runRegionReport() {
    const regionId = getActiveRegionId();
    const workDate = getRegionWorkDate();
    const btn = document.getElementById('btn-rw-run-report');
    const showBrowser = document.getElementById('rw-toggle-show-browser')?.checked ?? false;

    // 0. Nếu đang chạy quét bài -> Nhấp nút lần nữa sẽ DỪNG NGAY LẬP TỨC!
    if (isRegionReportRunning) {
        await stopRegionReport();
        return;
    }

    // 1. Hiển thị modal xác nhận NGAY LẬP TỨC (0ms - không chờ mạng)
    const browserDesc = showBrowser
        ? '🖥️ Trình duyệt Zalo sẽ mở trên màn hình để bạn theo dõi trực quan.'
        : '⚡ Trình duyệt Zalo sẽ chạy ngầm không che màn hình của bạn.';

    const confirmed = await showConfirmModal(
        `Bắt đầu quét bài nộp ngày ${workDate} cho Vùng ${regionId}, cập nhật Google Sheet và xuất báo cáo?\n\n(${browserDesc})`,
        {
            title: 'Xác Nhận Quét & Báo Cáo',
            icon: '<i class="fa-solid fa-rocket" style="color: #6366f1;"></i>',
            confirmText: 'Bắt đầu quét',
            cancelText: 'Hủy'
        }
    );
    if (!confirmed) return;

    // 2. Sau khi xác nhận, bắt đầu kiểm tra trạng thái Tab Google Sheet
    const originalHtml = btn ? btn.innerHTML : '';
    try {
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang kiểm tra tab Google Sheet...';
        }
        const checkRes = await fetch(`/api/v2/regions/${regionId}/check-sheet-tab?workDate=${workDate}`);
        const check = await checkRes.json();

        if (check.success && check.hasSheet && !check.exists) {
            // Tab tháng mới chưa tồn tại trên Google Sheet -> BẬT MODAL CẢNH BÁO TỰ CODE!
            currentPendingReport = { regionId, workDate };
            const regNameEl = document.getElementById('tab-warn-region-name');
            const workDateEl = document.getElementById('tab-warn-work-date');
            const expTabEl = document.getElementById('tab-warn-expected-tab');
            const codeTabEl = document.getElementById('tab-warn-code-tab');
            const existTabsEl = document.getElementById('tab-warn-existing-tabs');

            if (regNameEl) regNameEl.innerText = check.regionName || ('Vùng ' + regionId);
            if (workDateEl) workDateEl.innerText = workDate;
            if (expTabEl) expTabEl.innerText = check.expectedTab;
            if (codeTabEl) codeTabEl.innerText = check.expectedTab;
            if (existTabsEl) existTabsEl.innerText = (check.currentTabs && check.currentTabs.length > 0)
                ? check.currentTabs.join(', ')
                : 'Chưa có tab nào';

            openModal('modal-sheet-tab-warning');
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = originalHtml || '<i class="fa-solid fa-bolt"></i> Quét Bài & Báo Cáo';
            }
            return;
        }
    } catch (err) {
        console.warn('Lỗi kiểm tra tab Google Sheet:', err.message);
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml || '<i class="fa-solid fa-bolt"></i> Quét Bài & Báo Cáo';
        }
    }

    // 3. Tiến hành quét và báo cáo
    await executeRunRegionReport({ regionId, workDate, skipSheet: false, showBrowser });
}

async function executeRunRegionReport({ regionId, workDate, skipSheet = false, showBrowser = false }) {
    const btn = document.getElementById('btn-rw-run-report');
    const originalHtml = '<i class="fa-solid fa-bolt"></i> Quét Bài & Báo Cáo';
    isRegionReportRunning = true;

    try {
        if (btn) {
            btn.disabled = false; // Luôn để enabled để người dùng bấm dừng được!
            btn.classList.add('btn-danger');
            btn.style.backgroundColor = '#dc2626';
            btn.style.borderColor = '#dc2626';
            btn.style.color = '#ffffff';
            btn.innerHTML = '<i class="fa-solid fa-hand"></i> Dừng quét (Bấm để dừng)';
            btn.title = 'Nhấp vào đây để dừng ngay quá trình quét bài';
        }

        const res = await fetch(`/api/v2/regions/${regionId}/run-report`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ workDate, dryRun: false, skipSheet, showBrowser })
        });
        const data = await res.json();

        // 1. Nếu người dùng đã bấm dừng
        if (data.cancelled || data.data?.cancelled) {
            showAlertModal('Quá trình quét bài đã được dừng theo yêu cầu của bạn.', 'info', 'Đã Dừng Quét');
            showToast('⏹️ Đã dừng quét bài');
            return;
        }

        // 2. Nếu quét thành công
        if (data.success && data.data && data.data.completed !== undefined) {
            const d = data.data;
            let statusText = `🎉 ĐÃ HOÀN TẤT QUÉT BÀI & BÁO CÁO VÙNG ${regionId}!\n\n`;
            statusText += `• Hoàn thành: ${d.completed}/${d.totalMembers} sứ giả\n`;
            if (d.sheetSynced) {
                statusText += `• Google Sheet: Đã cập nhật thành công (${d.sheetRange || 'Đã ghi'})\n`;
            } else {
                statusText += `• Google Sheet: ${d.sheetMessage || 'Chưa ghi (Đã lưu an toàn trong bot)'}\n`;
            }
            if (d.zaloScrapedInfo && d.zaloScrapedInfo.connected) {
                const grp = d.zaloScrapedInfo.groupName || ('Vùng ' + regionId);
                if (d.zaloScrapedInfo.taskFound) {
                    statusText += `• Mốc Nhiệm Vụ: Đã định vị chính xác nhiệm vụ ngày ${workDate} trên Zalo.\n`;
                }
                statusText += `• Báo cáo sứ giả: Đã quét ${d.zaloScrapedInfo.count} tin nhắn từ nhóm "${grp}".\n`;
            } else {
                statusText += `• Zalo: ${d.zaloScrapedInfo?.reason || 'Chưa thể kết nối Zalo'}\n`;
            }
            if (d.zaloDraftResult && d.zaloDraftResult.success) {
                statusText += `• Khung chat Zalo: Đã điền sẵn báo cáo nháp vào ô tin nhắn (Chờ duyệt, chưa bấm gửi).\n`;
            }

            showAlertModal(statusText, d.sheetSynced ? 'success' : 'warning', '✅ ĐÃ HOÀN TẤT QUÉT BÀI & BÁO CÁO');
            showToast(d.sheetSynced ? '✅ Báo cáo & Ghi Sheet thành công!' : '⚠️ Đã tạo Báo cáo (Chưa ghi Sheet)');

            await loadRegionMembers();
            if (d.reportContent) {
                document.getElementById('rw-report-preview-text').value = d.reportContent;
            }
            await checkPendingSheetSync();
        } else {
            showAlertModal(data.error || data.data?.error || 'Có lỗi xảy ra khi quét bài từ Zalo.', 'warning', 'Chưa Thể Quét Bài Từ Zalo');
        }
    } catch (err) {
        showAlertModal('Lỗi kết nối: ' + err.message, 'error');
    } finally {
        isRegionReportRunning = false;
        if (btn) {
            btn.disabled = false;
            btn.classList.remove('btn-danger');
            btn.style.backgroundColor = '';
            btn.style.borderColor = '';
            btn.style.color = '';
            btn.innerHTML = originalHtml;
            btn.title = 'Bấm để quét bài tin nhắn, ghi Sheet và xuất Báo Cáo Vùng';
        }
    }
}

async function triggerOpenZaloLogin() {
    const btn = document.getElementById('btn-open-zalo-login');
    try {
        if (btn) btn.disabled = true;
        const res = await fetch('/api/v2/zalo/open-login', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            alert('Đã mở cửa sổ Zalo Web trên máy tính của bạn.\nVui lòng dùng app Zalo trên điện thoại quét mã QR để đăng nhập!');
        } else {
            alert('Lỗi khi mở Zalo: ' + (data.error || data.message));
        }
    } catch (err) {
        alert('Lỗi kết nối tới server: ' + err.message);
    } finally {
        if (btn) btn.disabled = false;
    }
}

let isSyncingMembers = false;

async function handleSyncMembersFromSheet() {
    if (isSyncingMembers) {
        console.warn('Đang đồng bộ sheet, vui lòng chờ...');
        return;
    }
    isSyncingMembers = true;

    const regionId = getActiveRegionId();
    const btn = document.getElementById('btn-rw-sync-sheet-top') || document.getElementById('btn-rw-sync-sheet');
    const originalHtml = btn ? btn.innerHTML : '';
    
    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ...';
    }

    try {
        const res = await fetch(`/api/v2/regions/${regionId}/sync-sheet-members`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (data.success) {
            const addedCount = data.added?.length || 0;
            const updatedCount = data.updated?.length || 0;
            const deactivatedCount = data.deactivated?.length || 0;
            let msg = `🔄 Đồng bộ thành công: Thêm mới ${addedCount} sứ giả, cập nhật ${updatedCount} sứ giả!`;
            if (deactivatedCount > 0) {
                msg += ` (Ngừng HĐ: ${deactivatedCount})`;
            }

            if (typeof window.showToast === 'function') {
                window.showToast(msg);
            } else {
                alert(msg);
            }
            await loadRegionMembers();
            await loadRegionSheetTabs(regionId, document.getElementById('rw-sheet-tab')?.value);
            if (typeof window.loadMembers === 'function') {
                await window.loadMembers();
            }
        } else {
            if (data.error === 'SESSION_UNAUTHENTICATED' || res.status === 401) {
                alert('⚠️ Phiên đăng nhập đã hết hạn do máy chủ vừa khởi động lại.\n\nVui lòng tải lại trang (F5) để đăng nhập lại!');
                window.location.reload();
                return;
            }
            alert('Lỗi đồng bộ từ Google Sheet: ' + (data.error || 'Thất bại'));
        }
    } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
    } finally {
        isSyncingMembers = false;
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = originalHtml;
        }
    }
}

function initRegionWorkspace() {
    initStatusColorPickers();

    if (typeof window.setupRecentDaysDateSelector === 'function') {
        window.setupRecentDaysDateSelector('rw-work-date', 'rw-work-date-custom', (dateVal) => {
            if (dateVal) {
                const parts = dateVal.split('-');
                if (parts.length === 3) {
                    const month = parseInt(parts[1], 10);
                    const year2 = parts[0].slice(-2);
                    const autoTab = `T${month}/${year2}`;
                    const sheetTabEl = document.getElementById('rw-sheet-tab');
                    if (!window.currentRegionData?.sheet_name && sheetTabEl) {
                        sheetTabEl.value = autoTab;
                    }
                }
            }
            loadRegionMembers();
            loadRegionReportPreview();
        });
    }

    const rwRegionSelect = document.getElementById('rw-region-select');
    if (rwRegionSelect) {
        rwRegionSelect.addEventListener('change', () => {
            localStorage.setItem('vnv_selected_region', rwRegionSelect.value);
            loadRegionWorkspaceData();
        });
    }

    const rwSheetTab = document.getElementById('rw-sheet-tab');
    if (rwSheetTab) {
        rwSheetTab.addEventListener('change', async () => {
            await saveRegionSettings();
        });
    }

    const btnOpenZalo = document.getElementById('btn-open-zalo-login');
    if (btnOpenZalo) {
        btnOpenZalo.addEventListener('click', triggerOpenZaloLogin);
    }

    const btnSaveSettings = document.getElementById('btn-rw-save-settings');
    if (btnSaveSettings) {
        btnSaveSettings.addEventListener('click', saveRegionSettings);
    }

    const toggleShowBrowser = document.getElementById('rw-toggle-show-browser');
    if (toggleShowBrowser) {
        const savedShowBrowser = localStorage.getItem('vnv_rw_show_browser');
        if (savedShowBrowser !== null) {
            toggleShowBrowser.checked = savedShowBrowser === 'true';
        } else {
            toggleShowBrowser.checked = false; // Mặc định là TẮT (chạy ngầm không hiển thị Zalo)
        }
        toggleShowBrowser.addEventListener('change', (e) => {
            localStorage.setItem('vnv_rw_show_browser', e.target.checked);
        });
    }

    const btnCopyRegion = document.getElementById('btn-rw-copy-report');
    if (btnCopyRegion) {
        btnCopyRegion.addEventListener('click', () => {
            const text = document.getElementById('rw-report-preview-text').value;
            if (text) {
                navigator.clipboard.writeText(text);
                if (typeof window.showToast === 'function') {
                    window.showToast('📋 Đã sao chép nội dung Báo cáo Vùng!');
                } else {
                    alert('Đã sao chép nội dung Báo cáo Vùng vào bộ nhớ tạm!');
                }
            }
        });
    }


    // Nút Tự động đoán Zalo Mapping
    const btnAutoGuessZalo = document.getElementById('btn-rw-auto-guess-zalo');
    if (btnAutoGuessZalo) {
        btnAutoGuessZalo.addEventListener('click', handleAutoGuessZaloMappings);
    }


    // Nút lưu mapping & nút mở modal Excel
    const btnSaveMappings = document.getElementById('btn-rw-save-mappings');
    if (btnSaveMappings) {
        btnSaveMappings.addEventListener('click', saveRegionNameMappings);
    }

    const btnOpenExcel = document.getElementById('btn-rw-open-excel-modal');
    if (btnOpenExcel) {
        btnOpenExcel.addEventListener('click', openExcelImportModal);
    }

    const btnConfirmExcel = document.getElementById('btn-confirm-excel-import');
    if (btnConfirmExcel) {
        btnConfirmExcel.addEventListener('click', handleConfirmExcelImport);
    }

    // Filter pills
    document.querySelectorAll('.rw-filter-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.querySelectorAll('.rw-filter-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            currentMemberFilter = pill.getAttribute('data-filter') || 'all';
            renderFilteredMembers();
        });
    });

    // Nút Modal: Tiếp tục tổng hợp (Chưa ghi Sheet)
    const btnWarnContinue = document.getElementById('btn-tab-warn-continue');
    if (btnWarnContinue) {
        btnWarnContinue.addEventListener('click', async () => {
            closeModal('modal-sheet-tab-warning');
            if (currentPendingReport) {
                await executeRunRegionReport({
                    regionId: currentPendingReport.regionId,
                    workDate: currentPendingReport.workDate,
                    skipSheet: true
                });
            }
        });
    }

    // Nút Modal: Tự động tạo Tab mới trên Google Sheet & Ghi ngay
    const btnWarnAutoCreate = document.getElementById('btn-tab-warn-autocreate');
    if (btnWarnAutoCreate) {
        btnWarnAutoCreate.addEventListener('click', async () => {
            if (!currentPendingReport) return;
            const originalHtml = btnWarnAutoCreate.innerHTML;
            btnWarnAutoCreate.disabled = true;
            btnWarnAutoCreate.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang tạo Tab trên Google Sheet...';

            try {
                const res = await fetch(`/api/v2/regions/${currentPendingReport.regionId}/create-sheet-tab`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workDate: currentPendingReport.workDate })
                });
                const data = await res.json();
                if (data.success) {
                    if (typeof window.showToast === 'function') {
                        window.showToast(`✨ ${data.message}`);
                    }
                    closeModal('modal-sheet-tab-warning');
                    // Tiến hành tổng hợp và ghi vào tab mới tạo
                    await executeRunRegionReport({
                        regionId: currentPendingReport.regionId,
                        workDate: currentPendingReport.workDate,
                        skipSheet: false
                    });
                } else {
                    alert('Lỗi khi tạo tab mới: ' + data.error);
                }
            } catch (err) {
                alert('Lỗi kết nối: ' + err.message);
            } finally {
                btnWarnAutoCreate.disabled = false;
                btnWarnAutoCreate.innerHTML = originalHtml;
            }
        });
    }

    // Nút Banner: Ghi bù lên Google Sheet
    const btnRetrySync = document.getElementById('btn-rw-retry-sheet-sync');
    if (btnRetrySync) {
        btnRetrySync.addEventListener('click', async () => {
            const regionId = getActiveRegionId();
            const workDate = getRegionWorkDate();
            const originalHtml = btnRetrySync.innerHTML;
            btnRetrySync.disabled = true;
            btnRetrySync.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang ghi bù...';

            try {
                const res = await fetch(`/api/v2/regions/${regionId}/sync-pending-sheet`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ workDate })
                });
                const data = await res.json();
                if (data.success) {
                    if (typeof window.showToast === 'function') {
                        window.showToast(`✅ ${data.message}`);
                    } else {
                        alert(data.message);
                    }
                    await checkPendingSheetSync();
                    await loadRegionMembers();
                } else {
                    alert('Lỗi ghi bù: ' + data.error);
                }
            } catch (err) {
                alert('Lỗi kết nối: ' + err.message);
            } finally {
                btnRetrySync.disabled = false;
                btnRetrySync.innerHTML = originalHtml;
            }
        });
    }

    // Nút Sao Chép Báo Cáo Vùng Mẫu 1
    const btnCopyReport = document.getElementById('btn-rw-copy-report');
    if (btnCopyReport) {
        btnCopyReport.addEventListener('click', () => {
            const previewEl = document.getElementById('rw-report-preview-text');
            const text = previewEl ? previewEl.value : '';
            if (!text || !text.trim()) {
                alert('Chưa có nội dung báo cáo để sao chép!');
                return;
            }
            navigator.clipboard.writeText(text).then(() => {
                if (typeof window.showToast === 'function') {
                    window.showToast('📋 Đã sao chép nội dung Báo cáo Vùng vào bộ nhớ tạm!');
                } else {
                    alert('📋 Đã sao chép nội dung Báo cáo Vùng vào bộ nhớ tạm!');
                }
            }).catch(() => {
                previewEl.select();
                document.execCommand('copy');
                alert('📋 Đã sao chép nội dung Báo cáo Vùng!');
            });
        });
    }

    loadRegionWorkspaceData();
}

window.initRegionWorkspace = initRegionWorkspace;
window.loadRegionWorkspaceData = loadRegionWorkspaceData;
window.loadRegionMembers = loadRegionMembers;
window.renderFilteredMembers = renderFilteredMembers;
window.saveRegionNameMappings = saveRegionNameMappings;
window.openExcelImportModal = openExcelImportModal;
window.closeExcelImportModal = closeExcelImportModal;
window.handleConfirmExcelImport = handleConfirmExcelImport;
window.handleSyncMembersFromSheet = handleSyncMembersFromSheet;
window.loadRegionReportPreview = loadRegionReportPreview;
window.saveRegionSettings = saveRegionSettings;
window.runRegionReport = runRegionReport;
window.triggerOpenZaloLogin = triggerOpenZaloLogin;
window.openSelectSheetTabModal = openSelectSheetTabModal;
window.reloadModalSheetTabs = reloadModalSheetTabs;
window.confirmSelectSheetTab = confirmSelectSheetTab;

function handleOpenRegionSheet(e) {
    const region = window.currentRegionData;
    const url = region && (region.sheet_url || (region.sheet_id ? `https://docs.google.com/spreadsheets/d/${region.sheet_id}/edit` : null));
    if (url) {
        window.open(url, '_blank');
        if (e) e.preventDefault();
    } else {
        const regionId = getActiveRegionId();
        if (typeof window.showToast === 'function') {
            window.showToast(`Chưa có liên kết Google Sheet cho Vùng ${regionId}!`, 'warning');
        } else {
            alert(`Chưa có liên kết Google Sheet cho Vùng ${regionId}!`);
        }
        if (e) e.preventDefault();
    }
}
window.handleOpenRegionSheet = handleOpenRegionSheet;

// ==========================================
// VNV-BOT V2: SETTINGS & GOOGLE SHEETS COLOR PALETTE
// ==========================================

const GOOGLE_PALETTE = [
    ['#000000', '#434343', '#666666', '#999999', '#b7b7b7', '#cccccc', '#d9d9d9', '#efefef', '#f3f3f3', '#ffffff'],
    ['#980000', '#ff0000', '#ff9900', '#ffff00', '#00ff00', '#00ffff', '#4a86e8', '#0000ff', '#9900ff', '#ff00ff'],
    ['#e6b8af', '#f4cccc', '#fce5cd', '#fff2cc', '#d9ead3', '#d0e0e3', '#c9daf8', '#cfe2f3', '#d9d2e9', '#ead1dc'],
    ['#dd7e6b', '#ea9999', '#f9cb9c', '#ffe599', '#b6d7a8', '#a2c4c9', '#a4c2f4', '#9fc5e8', '#b4a7d6', '#d5a6bd'],
    ['#cc4125', '#e06666', '#f6b26b', '#ffd966', '#93c47d', '#76a5af', '#6d9eeb', '#6fa8dc', '#8e7cc3', '#c27ba0'],
    ['#a61c00', '#cc0000', '#e69138', '#f1c232', '#6aa84f', '#45818e', '#3c78d8', '#3d85c6', '#674ea7', '#a64d79'],
    ['#85200c', '#990000', '#b45f06', '#bf9000', '#38761d', '#134f5c', '#1155cc', '#0b5394', '#351c75', '#741b47'],
    ['#5b0f00', '#660000', '#783f04', '#7f6000', '#274e13', '#0c343d', '#1c4587', '#073763', '#20124d', '#4c1130'],
];

const DEFAULT_SETTINGS_CLIENT = {
    completed_text: 'Ok',
    incomplete_text: '',
    late_text: 'Xin làm muộn',
    enable_sheet_colors: false,
    highlight_late: false,
    color_completed: '#ffffff',
    color_no_response: '#ff0000',
    color_late: '#4a86e8',
};

let currentSettings = { ...DEFAULT_SETTINGS_CLIENT };
let currentCustomStatuses = [];
let activeColorPickerKey = null;
let currentNewStatusColor = '#38761D';

async function loadSettings() {
    try {
        const res = await fetch('/api/system/settings');
        const data = await res.json();
        if (data.success && data.settings) {
            currentSettings = { ...DEFAULT_SETTINGS_CLIENT, ...data.settings };
            if (data.settings.incomplete_text !== undefined) currentSettings.incomplete_text = data.settings.incomplete_text;
            if (data.settings.late_text !== undefined) currentSettings.late_text = data.settings.late_text;
            if (data.settings.completed_text !== undefined) currentSettings.completed_text = data.settings.completed_text;
        }
        if (data.success && Array.isArray(data.custom_statuses)) {
            currentCustomStatuses = data.custom_statuses;
        }
    } catch (err) {
        console.warn('Lỗi tải cài đặt:', err);
    }
    renderSettingsForm();
    renderCustomStatuses();
    renderAccountInfo();
}

async function renderAccountInfo() {
    let user = window.currentUser;
    if (!user) {
        try {
            const meRes = await fetch('/api/auth/me');
            const meData = await meRes.json();
            if (meData && meData.user) {
                user = meData.user;
                window.currentUser = user;
            }
        } catch (e) {}
    }

    const emailEl = document.getElementById('setting-user-email');
    const roleEl = document.getElementById('setting-user-role');
    const regionsEl = document.getElementById('setting-user-regions');
    const sheetEl = document.getElementById('setting-user-sheet');

    if (emailEl) emailEl.innerText = user?.email || user?.username || '—';
    if (roleEl) {
        const roleNames = {
            admin: 'Quản Trị Viên (Admin)',
            cluster_leader: 'Trưởng Cụm 5 (Admin)',
            region_leader: 'Trưởng / Phó Vùng'
        };
        roleEl.innerText = roleNames[user?.role] || user?.role || '—';
    }

    // Hiển thị Vùng quản lý
    if (regionsEl) {
        if (user?.role === 'cluster_leader') {
            regionsEl.innerText = 'Cụm 5 (Vùng 25 - 31)';
        } else if (user?.role === 'admin') {
            regionsEl.innerText = 'Toàn bộ hệ thống (Cụm 5 & 7 Vùng)';
        } else if (user?.managed_region_name) {
            regionsEl.innerText = user.managed_region_name;
        } else if (user?.managed_region_id) {
            regionsEl.innerText = `Vùng ${user.managed_region_id}`;
        } else {
            const match = (user?.username || '').match(/\d+/);
            regionsEl.innerText = match ? `Vùng ${match[0]}` : '—';
        }
    }

    // Hiển thị Google Sheet
    if (sheetEl) {
        const targetRegionId = user?.managed_region_id || ((user?.username || '').match(/\d+/) ? (user.username.match(/\d+/))[0] : null);

        if (user?.role === 'region_leader' && targetRegionId) {
            sheetEl.innerHTML = '<span style="color: var(--text-muted);"><i class="fa-solid fa-spinner fa-spin"></i> Đang tải liên kết...</span>';

            const renderRegionSheet = (regionData) => {
                if (!regionData) {
                    sheetEl.innerText = '—';
                    return;
                }
                const url = regionData.sheet_url || (regionData.sheet_id ? `https://docs.google.com/spreadsheets/d/${regionData.sheet_id}/edit` : null);
                if (url) {
                    const tabName = (regionData.sheet_name && !regionData.sheet_name.match(/^T\d+\/\d+$/i)) ? regionData.sheet_name : (regionData.current_month_tab || 'T9/26');
                    sheetEl.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" style="color: #10b981; text-decoration: underline; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;" title="Mở Google Sheet trên tab mới"><i class="fa-solid fa-file-excel"></i> Mở Google Sheet (${escapeHtml(tabName)}) <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 11px;"></i></a>`;
                } else {
                    sheetEl.innerHTML = '<span style="color: var(--text-muted); font-style: italic;">Chưa liên kết Google Sheet (Chờ Admin cấu hình)</span>';
                }
            };

            try {
                // Thử endpoint v2 trước
                const res = await fetch(`/api/v2/regions/${targetRegionId}`);
                if (res.ok) {
                    const data = await res.json();
                    const region = data.data || data;
                    renderRegionSheet(region);
                } else {
                    // Fallback sang /api/regions/:id
                    const res2 = await fetch(`/api/regions/${targetRegionId}`);
                    if (res2.ok) {
                        const data2 = await res2.json();
                        renderRegionSheet(data2.data || data2);
                    } else {
                        sheetEl.innerText = 'Chưa liên kết Google Sheet';
                    }
                }
            } catch (err) {
                // Thử fallback nếu lỗi mạng / cú pháp
                try {
                    const res2 = await fetch(`/api/regions/${targetRegionId}`);
                    if (res2.ok) {
                        const data2 = await res2.json();
                        renderRegionSheet(data2.data || data2);
                    } else {
                        sheetEl.innerText = 'Chưa liên kết Google Sheet';
                    }
                } catch (e2) {
                    sheetEl.innerText = '—';
                }
            }
        } else if (user?.role === 'cluster_leader') {
            fetch('/api/clusters/5').then(r => r.json()).then(cluster => {
                const url = cluster.sheet_url || (cluster.sheet_id ? `https://docs.google.com/spreadsheets/d/${cluster.sheet_id}/edit` : null);
                if (url) {
                    sheetEl.innerHTML = `<a href="${escapeHtml(url)}" target="_blank" style="color: var(--color-purple); text-decoration: underline; font-weight: 700; display: inline-flex; align-items: center; gap: 6px;"><i class="fa-solid fa-file-excel"></i> Mở Google Sheet Cụm 5 <i class="fa-solid fa-arrow-up-right-from-square" style="font-size: 11px;"></i></a>`;
                } else {
                    sheetEl.innerText = 'Toàn bộ 7 Sheets Vùng';
                }
            }).catch(() => {
                sheetEl.innerText = 'Toàn bộ 7 Sheets Vùng';
            });
        } else if (user?.role === 'admin') {
            sheetEl.innerHTML = '<span style="color: var(--text-secondary);">Quản lý liên kết tại <a href="#panel-regions" style="color: var(--color-primary); font-weight: 600; text-decoration: underline;">Quản Lý Vùng</a></span>';
        } else {
            sheetEl.innerText = '—';
        }
    }
}

function updateSheetColorToggleUI(isEnabled) {
    const badge = document.getElementById('sheet-color-status-badge');
    const label = document.getElementById('toggle-color-label');
    if (badge) {
        if (isEnabled) {
            badge.className = 'badge badge-success';
            badge.style.background = '#10b981';
            badge.style.color = '#ffffff';
            badge.innerHTML = '<i class="fa-solid fa-check"></i> Đang BẬT: Bot sẽ tô màu ô';
        } else {
            badge.className = 'badge badge-secondary';
            badge.style.background = 'rgba(107, 114, 128, 0.2)';
            badge.style.color = 'var(--text-secondary)';
            badge.innerHTML = '<i class="fa-solid fa-ban"></i> Đang TẮT (Chỉ điền chữ)';
        }
    }
    if (label) {
        label.textContent = isEnabled ? 'Bật tô màu ô' : 'Chỉ điền chữ (Tắt màu)';
    }
}

function renderSettingsForm() {
    // Text values đều nằm trong custom status cards (không còn input riêng)
    // Đồng bộ text_value từ currentSettings vào custom statuses tương ứng
    if (Array.isArray(currentCustomStatuses)) {
        currentCustomStatuses.forEach(cs => {
            const nameLower = (cs.status_name || '').toLowerCase();
            if (nameLower.includes('hoàn thành') && currentSettings.completed_text !== undefined) {
                cs.text_value = currentSettings.completed_text;
            } else if ((nameLower.includes('chưa nộp') || nameLower.includes('không phản hồi')) && currentSettings.incomplete_text !== undefined) {
                cs.text_value = currentSettings.incomplete_text;
            } else if (nameLower.includes('làm muộn') && currentSettings.late_text !== undefined) {
                cs.text_value = currentSettings.late_text;
            }
        });
    }

    const isColorsEnabled = currentSettings.enable_sheet_colors === true || currentSettings.enable_sheet_colors === 'true';
    const colorToggle = document.getElementById('cfg-enable-sheet-colors');
    if (colorToggle) {
        colorToggle.checked = isColorsEnabled;
    }
    updateSheetColorToggleUI(isColorsEnabled);
}

function detectClientBehaviorType(statusName) {
    if (!statusName) return 'CUSTOM';
    const lower = statusName.toLowerCase().trim();

    // 1. Làm trễ / Nộp bù (trễ, muộn, bù, bổ sung, late, delay)
    if (/(?:trễ|muộn|bù|bổ\s*sung|late|delay|tre|muon|bu|bo\s*sung)/i.test(lower)) {
        return 'LATE_COMPLETED';
    }

    // 2. Hoàn thành đúng hạn (hoàn thành, đúng hạn, xong, ok, on time, đã hoàn thành, oke, x)
    if (/(?:hoàn\s*thành|đã\s*hoàn\s*thành|đúng\s*hạn|on\s*time|da\s*hoan\s*thanh|hoan\s*thanh|dung\s*han|\bxong\b|\bok\b|\boke\b|\bx\b)/i.test(lower)) {
        return 'ON_TIME';
    }

    // 3. Chưa làm / Không phản hồi (chưa, không, vắng, thiếu)
    if (/(?:chưa|không|vắng|thiếu|chua|khong|vang|thieu|no\s*response)/i.test(lower)) {
        return 'INCOMPLETE';
    }

    // 4. Xin hoãn / Xin phép (phép, hoãn, nghỉ, quân sự, ôn thi, viện)
    if (/(?:phép|hoãn|nghỉ|quân\s*sự|ôn\s*thi|viện|phep|hoan|nghi|quan\s*su|on\s*thi|vien)/i.test(lower)) {
        return 'ON_LEAVE';
    }

    return 'CUSTOM';
}

function renderCustomStatuses() {
    const container = document.getElementById('custom-statuses-container');
    if (!container) return;

    if (!Array.isArray(currentCustomStatuses) || currentCustomStatuses.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1 / -1; padding: 28px 16px; text-align: center; color: var(--text-muted); background: rgba(0,0,0,0.02); border-radius: 8px; border: 1px dashed var(--panel-border);">
                <i class="fa-solid fa-palette" style="font-size: 26px; margin-bottom: 8px; display: block; opacity: 0.5;"></i>
                Chưa có trạng thái nào. Nhấn <strong>"Thêm trạng thái mới"</strong> ở trên để tạo trạng thái cho Google Sheet.
            </div>
        `;
        return;
    }

    container.innerHTML = currentCustomStatuses.map(s => {
        const color = (s.color_hex || '#FFFFFF').toUpperCase();
        const bType = s.behavior_type || detectClientBehaviorType(s.status_name);

        return `
            <div class="color-item-card" id="custom-status-card-${s.id}" style="padding: 12px 14px;">
                <div class="color-item-header" style="display: flex; justify-content: space-between; align-items: center; gap: 6px; margin-bottom: 8px;">
                    <div style="display: flex; align-items: center; gap: 5px; flex: 1; min-width: 0;">
                        <input type="text" 
                               class="form-control form-control-sm" 
                               id="status-name-input-${s.id}" 
                               value="${escapeHtml(s.status_name)}" 
                               oninput="handleCustomStatusNameInput(${s.id}, this.value)"
                               onchange="updateCustomStatusName(${s.id}, this.value)" 
                               onkeydown="if(event.key==='Enter'){this.blur();}" 
                               title="Nhấp vào để sửa tên trạng thái (tự động lưu)" 
                               placeholder="Tên trạng thái..."
                               style="font-size: 13px; font-weight: 700; padding: 3px 7px; border-radius: 4px; border: 1px solid var(--panel-border); background: var(--bg-dark); color: var(--text-primary); width: 100%;"
                        />
                    </div>
                    <button type="button" class="btn btn-sm btn-danger-outline" onclick="deleteCustomStatus(${s.id})" title="Xóa trạng thái này" style="padding: 3px 8px; font-size: 11.5px; display: inline-flex; align-items: center; gap: 3px; flex-shrink: 0;">
                        <i class="fa-solid fa-trash-can"></i> Xóa
                    </button>
                </div>

                <!-- Phân loại Hành vi của Bot (Dropdown) -->
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; margin-bottom: 8px; font-size: 11.5px; color: var(--text-secondary);">
                    <span style="white-space: nowrap; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;">
                        <i class="fa-solid fa-robot" style="font-size: 10px; color: var(--color-primary);"></i> Áp dụng cho:
                    </span>
                    <select class="form-select form-select-sm" 
                            id="status-behavior-select-${s.id}" 
                            onchange="updateCustomStatusBehavior(${s.id}, this.value)"
                            title="Chọn hành vi nghiệp vụ của bot khi quét bài cho trạng thái này"
                            style="font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--panel-border); background: var(--bg-dark); color: var(--text-primary); max-width: 175px;">
                        <option value="ON_TIME" ${bType === 'ON_TIME' ? 'selected' : ''}>🟢 Hoàn thành đúng hạn</option>
                        <option value="LATE_COMPLETED" ${bType === 'LATE_COMPLETED' ? 'selected' : ''}>🟠 Làm trễ / Nộp bù</option>
                        <option value="INCOMPLETE" ${bType === 'INCOMPLETE' ? 'selected' : ''}>🔴 Chưa làm / Không phản hồi</option>
                        <option value="ON_LEAVE" ${bType === 'ON_LEAVE' ? 'selected' : ''}>🟣 Xin hoãn / Xin phép</option>
                        <option value="CUSTOM" ${bType === 'CUSTOM' ? 'selected' : ''}>⚪ Tùy chỉnh khác</option>
                    </select>
                </div>

                <!-- Màu sắc ô Google Sheets -->
                <div class="color-item-body" style="display: flex; align-items: center; gap: 8px; margin-bottom: 8px;">
                    <div class="color-swatch-box" id="swatch-custom-${s.id}" style="background-color: ${color}; width: 26px; height: 26px; border-radius: 4px;"></div>
                    <span class="color-hex" id="hex-custom-${s.id}" style="font-size: 12px;">${color}</span>
                    <button type="button" class="btn btn-sm btn-secondary-outline" style="margin-left: auto; padding: 2px 7px; font-size: 11px;" onclick="changeCustomStatusColor(${s.id}, this)">
                        <i class="fa-solid fa-palette"></i> Đổi màu
                    </button>
                </div>

                <!-- Ký hiệu văn bản ghi vào ô Sheet -->
                <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px; padding-top: 6px; border-top: 1px dashed var(--panel-border); font-size: 11.5px; color: var(--text-secondary);">
                    <span style="white-space: nowrap; font-size: 11px; display: inline-flex; align-items: center; gap: 4px;"><i class="fa-solid fa-file-lines" style="font-size: 10px;"></i> Ký hiệu Sheet:</span>
                    <input type="text" 
                           class="form-control form-control-sm"
                           id="status-text-input-${s.id}"
                           value="${escapeHtml(s.text_value !== undefined ? s.text_value : s.status_name)}" 
                           onchange="updateCustomStatusTextValue(${s.id}, this.value)"
                           oninput="handleCustomStatusInputLive(${s.id}, this.value)"
                           onkeydown="if(event.key==='Enter'){this.blur();}" 
                           title="Văn bản bot sẽ ghi vào ô Google Sheet cho trạng thái này (tự động lưu)" 
                           placeholder="${escapeHtml(s.status_name)}"
                           style="font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; border: 1px solid var(--panel-border); background: var(--bg-dark); color: var(--text-primary); max-width: 140px; text-align: right;"
                    />
                </div>
            </div>
        `;
    }).join('');
}

// Mở Bảng Màu Google Sheets 80 ô với định vị thông minh (tự động lật lên hoặc xuống)
function openPalettePicker(keyOrColor, buttonEl, onSelectCallback) {
    closePalettePicker();
    activeColorPickerKey = keyOrColor;

    const popup = document.createElement('div');
    popup.id = 'google-palette-popup';
    popup.className = 'google-color-popup';

    const rect = buttonEl.getBoundingClientRect();
    const popupWidth = 265;
    const popupHeight = 280;

    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;

    // Tự động lật lên trên nếu khoảng trống bên dưới không đủ và phía trên rộng hơn
    let top;
    if (spaceBelow < popupHeight + 10 && spaceAbove > spaceBelow) {
        top = Math.max(10, rect.top - popupHeight - 6);
    } else {
        top = Math.min(window.innerHeight - popupHeight - 10, rect.bottom + 6);
    }

    // Giữ an toàn trong màn hình theo chiều ngang
    let left = rect.left;
    if (left + popupWidth > window.innerWidth - 10) {
        left = window.innerWidth - popupWidth - 10;
    }
    if (left < 10) {
        left = 10;
    }

    popup.style.position = 'fixed';
    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
    popup.style.zIndex = '999999';

    const initialColor = (typeof onSelectCallback === 'function' ? keyOrColor : currentSettings[keyOrColor]) || '';

    let html = `
        <div class="palette-header">
            <span>🎨 Bảng màu Google Sheets</span>
            <span style="font-family: monospace; font-size: 11px; color: #666;">${escapeHtml(initialColor)}</span>
        </div>
        <div class="palette-grid">
    `;

    GOOGLE_PALETTE.forEach(row => {
        row.forEach(color => {
            const isSelected = initialColor.toLowerCase() === color.toLowerCase();
            html += `<button type="button" class="palette-swatch ${isSelected ? 'selected' : ''}" style="background-color: ${color};" data-color="${color}" title="${color}"></button>`;
        });
    });

    html += `
        </div>
        <div class="palette-footer">
            <button type="button" class="btn btn-sm btn-secondary-outline" id="btn-palette-cancel">Đóng</button>
        </div>
    `;

    popup.innerHTML = html;
    document.body.appendChild(popup);

    popup.querySelectorAll('.palette-swatch').forEach(sw => {
        sw.addEventListener('click', () => {
            const chosenColor = sw.getAttribute('data-color');
            if (typeof onSelectCallback === 'function') {
                onSelectCallback(chosenColor);
            } else {
                selectColor(keyOrColor, chosenColor);
            }
            closePalettePicker();
        });
    });

    document.getElementById('btn-palette-cancel')?.addEventListener('click', closePalettePicker);

    setTimeout(() => {
        document.addEventListener('click', handleOutsideClick);
    }, 50);
}

function closePalettePicker() {
    const existing = document.getElementById('google-palette-popup');
    if (existing) {
        existing.remove();
    }
    activeColorPickerKey = null;
    document.removeEventListener('click', handleOutsideClick);
}

function handleOutsideClick(e) {
    const popup = document.getElementById('google-palette-popup');
    if (popup && !popup.contains(e.target)) {
        closePalettePicker();
    }
}

function selectColor(key, color) {
    currentSettings[key] = color;
    const swatch = document.getElementById('swatch-' + key);
    const hexText = document.getElementById('hex-' + key);
    if (swatch) swatch.style.backgroundColor = color;
    if (hexText) hexText.innerText = color.toUpperCase();
}

function resetColorToDefault(key) {
    const defaultVal = DEFAULT_SETTINGS_CLIENT[key];
    selectColor(key, defaultVal);
}

async function saveSettingsToServer() {
    // Đọc text values từ custom statuses thay vì input fields cũ
    if (Array.isArray(currentCustomStatuses)) {
        for (const cs of currentCustomStatuses) {
            const nameLower = (cs.status_name || '').toLowerCase();
            if (nameLower.includes('hoàn thành')) {
                currentSettings.completed_text = cs.text_value || '';
            } else if (nameLower.includes('chưa nộp') || nameLower.includes('không phản hồi')) {
                currentSettings.incomplete_text = cs.text_value || '';
            } else if (nameLower.includes('làm muộn')) {
                currentSettings.late_text = cs.text_value || '';
            }
        }
    }
    const colorToggle = document.getElementById('cfg-enable-sheet-colors') || document.getElementById('cfg-highlight-late');
    const isColorEnabled = colorToggle ? colorToggle.checked : false;
    currentSettings.enable_sheet_colors = isColorEnabled;
    currentSettings.highlight_late = isColorEnabled;

    const btnSave = document.getElementById('btn-save-settings');
    try {
        if (btnSave) {
            btnSave.disabled = true;
            btnSave.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';
        }

        const res = await fetch('/api/system/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(currentSettings)
        });
        const data = await res.json();

        if (data.success) {
            showToast('✅ Đã lưu cài đặt trạng thái thành công!');
        } else {
            showToast('❌ Lỗi lưu cài đặt: ' + (data.error || data.message));
        }
    } catch (err) {
        showToast('❌ Lỗi kết nối: ' + err.message);
    } finally {
        if (btnSave) {
            btnSave.disabled = false;
            btnSave.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Lưu cài đặt';
        }
    }
}

async function resetAllSettings() {
    const confirmed = await showConfirmModal(
        'Bạn có chắc chắn muốn khôi phục toàn bộ cài đặt về mặc định của hệ thống?',
        {
            title: 'Khôi Phục Cài Đặt Mặc Định',
            isDanger: true,
            confirmText: 'Khôi phục ngay',
            cancelText: 'Hủy'
        }
    );
    if (!confirmed) return;

    try {
        const res = await fetch('/api/system/settings/reset', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            if (data.settings) {
                currentSettings = { ...DEFAULT_SETTINGS_CLIENT, ...data.settings };
            }
            await loadSettings();
            showToast('🔄 Đã khôi phục cài đặt mặc định!');
        }
    } catch (err) {
        showToast('❌ Lỗi khôi phục: ' + err.message);
    }
}

// Thao tác đổi màu cho trạng thái tùy chỉnh
function changeCustomStatusColor(statusId, buttonEl) {
    const status = currentCustomStatuses.find(s => s.id === statusId);
    const currentColor = status ? status.color_hex : '#38761D';

    openPalettePicker(currentColor, buttonEl, async (newColor) => {
        try {
            const res = await fetch(`/api/system/custom-status/${statusId}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ color_hex: newColor })
            });
            const data = await res.json();
            if (data.success) {
                if (status) status.color_hex = newColor;
                window.vnvCustomStatuses = currentCustomStatuses;
                if (typeof window.renderRegionPaletteChips === 'function') {
                    window.renderRegionPaletteChips(currentCustomStatuses);
                }
                const swatch = document.getElementById(`swatch-custom-${statusId}`);
                const hexText = document.getElementById(`hex-custom-${statusId}`);
                if (swatch) swatch.style.backgroundColor = newColor;
                if (hexText) hexText.innerText = newColor.toUpperCase();
                showToast(`✅ Đã đổi màu trạng thái thành ${newColor.toUpperCase()}`);
            } else {
                showToast('❌ Lỗi đổi màu: ' + (data.error || 'Thất bại'));
            }
        } catch (err) {
            showToast('❌ Lỗi kết nối: ' + err.message);
        }
    });
}

// Xóa trạng thái tùy chỉnh
async function deleteCustomStatus(statusId) {
    const status = currentCustomStatuses.find(s => s.id === statusId);
    const name = status ? status.status_name : 'trạng thái này';

    const confirmed = await showConfirmModal(
        `Bạn có chắc chắn muốn xóa trạng thái "${name}" không?`,
        {
            title: 'Xóa Trạng Thái Màu',
            isDanger: true,
            confirmText: 'Xóa ngay',
            cancelText: 'Hủy'
        }
    );
    if (!confirmed) return;

    try {
        const res = await fetch(`/api/system/custom-status/${statusId}`, {
            method: 'DELETE'
        });
        const data = await res.json();
        if (data.success) {
            currentCustomStatuses = currentCustomStatuses.filter(s => s.id !== statusId);
            window.vnvCustomStatuses = currentCustomStatuses;
            renderCustomStatuses();
            if (typeof window.renderRegionPaletteChips === 'function') {
                window.renderRegionPaletteChips(currentCustomStatuses);
            }
            showToast(`🗑️ Đã xóa trạng thái "${name}"!`);
        } else {
            showToast('❌ Lỗi xóa trạng thái: ' + (data.error || 'Thất bại'));
        }
    } catch (err) {
        showToast('❌ Lỗi kết nối: ' + err.message);
    }
}

// Cập nhật tên trạng thái trực tiếp
async function updateCustomStatusName(statusId, newName) {
    const trimmed = (newName || '').trim();
    if (!trimmed) {
        showToast('⚠️ Tên trạng thái không được để trống');
        renderCustomStatuses();
        return;
    }

    try {
        const res = await fetch(`/api/system/custom-status/${statusId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status_name: trimmed })
        });
        const data = await res.json();
        if (data.success) {
            const target = currentCustomStatuses.find(s => s.id === statusId);
            if (target) {
                target.status_name = trimmed;
            }
            window.vnvCustomStatuses = currentCustomStatuses;
            if (typeof window.renderRegionPaletteChips === 'function') {
                window.renderRegionPaletteChips(currentCustomStatuses);
            }
            showToast(`✏️ Đã đổi tên thành: "${trimmed}"`);
        } else {
            showToast('❌ Lỗi cập nhật tên: ' + (data.error || 'Thất bại'));
            renderCustomStatuses();
        }
    } catch (err) {
        showToast('❌ Lỗi kết nối: ' + err.message);
        renderCustomStatuses();
    }
}

// Cập nhật ký hiệu văn bản ghi vào Google Sheet trực tiếp thời gian thực
function handleCustomStatusInputLive(statusId, newText) {
    const target = currentCustomStatuses.find(s => s.id === statusId);
    if (!target) return;
    target.text_value = newText;
    // Đồng bộ vào currentSettings nếu là trạng thái hệ thống
    const nameLower = (target.status_name || '').toLowerCase();
    if (nameLower.includes('hoàn thành')) {
        currentSettings.completed_text = newText;
    } else if (nameLower.includes('chưa nộp') || nameLower.includes('không phản hồi')) {
        currentSettings.incomplete_text = newText;
    } else if (nameLower.includes('làm muộn')) {
        currentSettings.late_text = newText;
    }
}

// Cập nhật ký hiệu văn bản ghi vào Google Sheet
async function updateCustomStatusTextValue(statusId, newText) {
    const trimmed = (newText || '').trim();
    handleCustomStatusInputLive(statusId, trimmed);

    try {
        const res = await fetch(`/api/system/custom-status/${statusId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text_value: trimmed })
        });
        const data = await res.json();
        if (data.success) {
            const target = currentCustomStatuses.find(s => s.id === statusId);
            if (target) {
                target.text_value = trimmed;
            }
            window.vnvCustomStatuses = currentCustomStatuses;
            if (typeof window.renderRegionPaletteChips === 'function') {
                window.renderRegionPaletteChips(currentCustomStatuses);
            }
            showToast(trimmed ? `📝 Đã lưu ký hiệu ghi Sheet: "${trimmed}"` : `📝 Đã để trống ký hiệu (không ghi chữ vào ô Sheet)`);
        } else {
            showToast('❌ Lỗi cập nhật ký hiệu: ' + (data.error || 'Thất bại'));
            renderCustomStatuses();
        }
    } catch (err) {
        showToast('❌ Lỗi kết nối: ' + err.message);
        renderCustomStatuses();
    }
}
async function updateCustomStatusBehavior(statusId, newBehavior, isSilent = false) {
    const target = currentCustomStatuses.find(s => s.id === statusId);
    if (target) {
        target.behavior_type = newBehavior;
    }

    try {
        const res = await fetch(`/api/system/custom-status/${statusId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ behavior_type: newBehavior })
        });
        const data = await res.json();
        if (data.success) {
            window.vnvCustomStatuses = currentCustomStatuses;
            if (!isSilent) {
                const behaviorNames = {
                    'ON_TIME': 'Hoàn thành đúng hạn',
                    'LATE_COMPLETED': 'Làm trễ / Nộp bù',
                    'INCOMPLETE': 'Chưa làm / Không phản hồi',
                    'ON_LEAVE': 'Xin hoãn / Xin phép',
                    'CUSTOM': 'Tùy chỉnh khác'
                };
                showToast(`🤖 Đã gán hành vi: ${behaviorNames[newBehavior] || newBehavior}`);
            }
        }
    } catch (err) {
        console.warn('Lỗi cập nhật hành vi:', err);
    }
}

function handleCustomStatusNameInput(statusId, newName) {
    const bType = detectClientBehaviorType(newName);
    const selectEl = document.getElementById(`status-behavior-select-${statusId}`);
    if (selectEl && bType !== 'CUSTOM' && selectEl.value !== bType) {
        selectEl.value = bType;
        updateCustomStatusBehavior(statusId, bType, true);
    }
}

window.handleCustomStatusNameInput = handleCustomStatusNameInput;
window.updateCustomStatusBehavior = updateCustomStatusBehavior;
window.handleCustomStatusInputLive = handleCustomStatusInputLive;
window.updateCustomStatusName = updateCustomStatusName;
window.updateCustomStatusTextValue = updateCustomStatusTextValue;

function showToast(message) {
    if (typeof window.showToastNotification === 'function') {
        window.showToastNotification(message);
        return;
    }
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = 'vnv-toast';
    toast.innerText = message;
    if (container) {
        container.appendChild(toast);
    } else {
        document.body.appendChild(toast);
    }
    setTimeout(() => {
        toast.classList.add('hide');
        setTimeout(() => toast.remove(), 400);
    }, 2500);
}

function initSettings() {
    const btnSave = document.getElementById('btn-save-settings');
    if (btnSave) btnSave.addEventListener('click', saveSettingsToServer);

    const btnReset = document.getElementById('btn-reset-settings');
    if (btnReset) btnReset.addEventListener('click', resetAllSettings);

    // Bật/tắt tô màu ô Google Sheets trực tiếp (Trưởng/Phó Vùng)
    const colorToggle = document.getElementById('cfg-enable-sheet-colors');
    if (colorToggle) {
        colorToggle.addEventListener('change', function() {
            const isChecked = this.checked;
            currentSettings.enable_sheet_colors = isChecked;
            currentSettings.highlight_late = isChecked;
            updateSheetColorToggleUI(isChecked);
            saveSettingsToServer();
        });
    }

    // (Phần đồng bộ input cố định đã được gỡ bỏ - tất cả text nằm trong custom status cards)

    // Xử lý nút mở modal thêm trạng thái tùy chỉnh
    const btnAddCustom = document.getElementById('btn-add-custom-status');
    if (btnAddCustom) {
        btnAddCustom.addEventListener('click', () => {
            const nameInput = document.getElementById('custom-status-name');
            const textInput = document.getElementById('custom-status-text');
            const behaviorSelect = document.getElementById('custom-status-behavior');
            const swatch = document.getElementById('custom-status-swatch');
            const hex = document.getElementById('custom-status-hex');

            if (nameInput) nameInput.value = '';
            if (textInput) textInput.value = '';
            if (behaviorSelect) behaviorSelect.value = 'ON_TIME';
            currentNewStatusColor = '#38761D';
            if (swatch) swatch.style.backgroundColor = currentNewStatusColor;
            if (hex) hex.innerText = currentNewStatusColor;

            if (typeof openModal === 'function') {
                openModal('modal-custom-status');
            } else {
                document.getElementById('modal-custom-status')?.classList.add('active');
            }
        });
    }

    const modalNameInput = document.getElementById('custom-status-name');
    if (modalNameInput) {
        modalNameInput.addEventListener('input', function() {
            const detected = detectClientBehaviorType(this.value);
            const behaviorSelect = document.getElementById('custom-status-behavior');
            if (behaviorSelect && detected !== 'CUSTOM') {
                behaviorSelect.value = detected;
            }
        });
    }

    // Nút chọn màu trong modal
    const btnPickerModal = document.getElementById('btn-picker-custom-status');
    if (btnPickerModal) {
        btnPickerModal.addEventListener('click', (e) => {
            e.stopPropagation();
            openPalettePicker(currentNewStatusColor, btnPickerModal, (pickedColor) => {
                currentNewStatusColor = pickedColor.toUpperCase();
                const swatch = document.getElementById('custom-status-swatch');
                const hex = document.getElementById('custom-status-hex');
                if (swatch) swatch.style.backgroundColor = currentNewStatusColor;
                if (hex) hex.innerText = currentNewStatusColor;
            });
        });
    }

    // Nút xác nhận lưu trong modal
    const btnConfirmSaveCustom = document.getElementById('btn-confirm-save-custom-status');
    if (btnConfirmSaveCustom) {
        btnConfirmSaveCustom.addEventListener('click', async () => {
            const name = document.getElementById('custom-status-name')?.value?.trim();
            const textVal = document.getElementById('custom-status-text')?.value?.trim();
            const behaviorType = document.getElementById('custom-status-behavior')?.value || 'CUSTOM';

            if (!name) {
                if (typeof showAlertModal === 'function') {
                    showAlertModal('Vui lòng nhập tên trạng thái.', 'warning', 'Thiếu Thông Tin');
                } else {
                    alert('Vui lòng nhập tên trạng thái.');
                }
                return;
            }

            try {
                btnConfirmSaveCustom.disabled = true;
                btnConfirmSaveCustom.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang lưu...';

                const res = await fetch('/api/system/custom-status', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        status_name: name,
                        color_hex: currentNewStatusColor,
                        text_value: textVal || name,
                        behavior_type: behaviorType
                    })
                });
                const data = await res.json();

                if (data.success && data.status) {
                    currentCustomStatuses.push(data.status);
                    window.vnvCustomStatuses = currentCustomStatuses;
                    renderCustomStatuses();
                    if (typeof window.renderRegionPaletteChips === 'function') {
                        window.renderRegionPaletteChips(currentCustomStatuses);
                    }
                    closeModal('modal-custom-status');
                    showToast(`✅ Đã thêm trạng thái màu "${name}" thành công!`);
                } else {
                    if (typeof showAlertModal === 'function') {
                        showAlertModal('Lỗi thêm trạng thái: ' + (data.error || 'Thất bại'), 'error');
                    } else {
                        alert('Lỗi thêm trạng thái: ' + (data.error || 'Thất bại'));
                    }
                }
            } catch (err) {
                if (typeof showAlertModal === 'function') {
                    showAlertModal('Lỗi kết nối: ' + err.message, 'error');
                } else {
                    alert('Lỗi kết nối: ' + err.message);
                }
            } finally {
                btnConfirmSaveCustom.disabled = false;
                btnConfirmSaveCustom.innerHTML = '<i class="fa-solid fa-check"></i> Lưu trạng thái';
            }
        });
    }

    loadSettings();
}

window.initSettings = initSettings;
window.loadSettings = loadSettings;
window.renderAccountInfo = renderAccountInfo;
window.saveSettingsToServer = saveSettingsToServer;
window.resetAllSettings = resetAllSettings;
window.openPalettePicker = openPalettePicker;
window.resetColorToDefault = resetColorToDefault;
window.openPalettePicker = openPalettePicker;
window.changeCustomStatusColor = changeCustomStatusColor;
window.deleteCustomStatus = deleteCustomStatus;
window.showToast = showToast;

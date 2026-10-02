// ==========================================
// VNV-BOT V2: UTILITY FUNCTIONS & DIALOGS
// ==========================================

// Hàm chống tấn công XSS bằng cách mã hóa các ký tự đặc biệt
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
window.escapeHtml = escapeHtml;

function getRoleLabel(role) {
    const user = window.currentUser;
    if (role === 'admin') return 'Quản Trị Viên (Admin)';
    if (role === 'cluster_leader') return 'Trưởng Cụm 5';
    if (role === 'region_leader') {
        const isDeputy = user && (user.username?.startsWith('phovung') || user.is_deputy);
        const prefix = isDeputy ? 'Phó' : 'Trưởng';
        if (user && user.managed_region_name) return `${prefix} ${user.managed_region_name}`;
        if (user && user.managed_region_id) return `${prefix} Vùng ${user.managed_region_id}`;
        return `${prefix} Vùng`;
    }
    return 'Người Dùng';
}
window.getRoleLabel = getRoleLabel;

function openModal(modalId) {
    const el = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (el) {
        el.style.display = 'flex';
        el.classList.add('active');
    }
}
window.openModal = openModal;

function closeModal(modalId) {
    const el = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (el) {
        el.classList.remove('active');
        el.style.display = 'none';
    }
}
window.closeModal = closeModal;

// Đóng modal khi bấm vào vùng ngoài backdrop (.modal-overlay)
document.addEventListener('click', (e) => {
    if (e.target && e.target.classList && e.target.classList.contains('modal-overlay')) {
        closeModal(e.target);
    }
});

// Dialog modal helpers
const nativeAlert = window.alert;
const nativeConfirm = window.confirm;

function showInviteModal(text) {
    const textPreview = document.getElementById('invite-text-preview');
    const statusBanner = document.getElementById('invite-status-banner');
    
    if (textPreview) {
        textPreview.value = text;
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => {
            if (statusBanner) {
                statusBanner.className = 'invite-alert-success';
                statusBanner.innerHTML = `<i class="fa-solid fa-circle-check" style="font-size: 1.2rem;"></i> <span>Đã copy lời mời vào Clipboard!</span>`;
            }
        }).catch(err => {
            console.error('Không thể copy:', err);
            if (statusBanner) {
                statusBanner.className = 'invite-alert-warning';
                statusBanner.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size: 1.2rem;"></i> <span>Không thể tự động copy. Vui lòng copy thủ công lời mời bên dưới:</span>`;
            }
        });
    } else if (statusBanner) {
        statusBanner.className = 'invite-alert-warning';
        statusBanner.innerHTML = `<i class="fa-solid fa-triangle-exclamation" style="font-size: 1.2rem;"></i> <span>Không thể tự động copy. Vui lòng copy thủ công lời mời bên dưới:</span>`;
    }

    openModal('modal-invite');
}
window.showInviteModal = showInviteModal;

function copyInviteTextAgain() {
    const textPreview = document.getElementById('invite-text-preview');
    const copyBtn = document.getElementById('btn-copy-again');
    if (!textPreview) return;
    
    textPreview.select();
    textPreview.setSelectionRange(0, 99999);
    
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(textPreview.value).then(() => {
            if (copyBtn) {
                const originalText = copyBtn.innerHTML;
                copyBtn.innerHTML = '<i class="fa-solid fa-check"></i> Đã sao chép!';
                setTimeout(() => {
                    copyBtn.innerHTML = originalText;
                }, 2000);
            }
        }).catch(err => {
            console.error('Lỗi sao chép:', err);
        });
    }
}
window.copyInviteTextAgain = copyInviteTextAgain;

function copyUserInvitation(fullname, role, email) {
    const roleLabel = getRoleLabel(role);
    const origin = window.location.origin;
    const text = `Chào Anh/Chị ${fullname},\nAnh/Chị đã được phân quyền quản lý với vai trò ${roleLabel} trên hệ thống VNV-Bot.\nVui lòng sử dụng địa chỉ email ${email} để đăng nhập thông qua nút "Đăng nhập với Google" tại liên kết: ${origin}.\nXin cảm ơn!`;
    
    showInviteModal(text);
}
window.copyUserInvitation = copyUserInvitation;

function showConfirmModal(message, options = {}) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-confirm');
        const msgEl = document.getElementById('confirm-modal-message');
        const titleEl = document.getElementById('confirm-modal-title');
        const iconEl = document.getElementById('confirm-modal-icon');
        const btnConfirm = document.getElementById('confirm-modal-btn-confirm');
        const btnCancel = document.getElementById('confirm-modal-btn-cancel');

        if (!modal || !msgEl) {
            resolve(nativeConfirm ? nativeConfirm(message) : true);
            return;
        }

        msgEl.innerText = message;
        titleEl.innerText = options.title || 'Xác Nhận Thao Tác';
        
        if (options.icon) {
            iconEl.innerHTML = options.icon;
        } else if (options.isDanger === true) {
            iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i>';
        } else {
            iconEl.innerHTML = '<i class="fa-solid fa-circle-question" style="color: #6366f1;"></i>';
        }

        if (options.confirmClass) {
            btnConfirm.className = options.confirmClass;
        } else if (options.isDanger === true) {
            btnConfirm.className = 'btn btn-danger';
        } else {
            btnConfirm.className = 'btn btn-primary';
        }

        btnConfirm.innerText = options.confirmText || 'Đồng ý';
        btnCancel.innerText = options.cancelText || 'Hủy';

        const handleConfirm = () => {
            cleanup();
            closeModal('modal-confirm');
            resolve(true);
        };

        const handleCancel = () => {
            cleanup();
            closeModal('modal-confirm');
            resolve(false);
        };

        const cleanup = () => {
            btnConfirm.removeEventListener('click', handleConfirm);
            btnCancel.removeEventListener('click', handleCancel);
        };

        btnConfirm.addEventListener('click', handleConfirm);
        btnCancel.addEventListener('click', handleCancel);

        openModal(modal);
    });
}
window.showConfirmModal = showConfirmModal;

function showAlertModal(message, type = 'info', title = null) {
    return new Promise((resolve) => {
        const modal = document.getElementById('modal-alert');
        const msgEl = document.getElementById('alert-modal-message');
        const titleEl = document.getElementById('alert-modal-title');
        const iconEl = document.getElementById('alert-modal-icon');
        const btnOk = document.getElementById('alert-modal-btn-ok');

        if (!modal || !msgEl) {
            if (nativeAlert) nativeAlert(message);
            resolve();
            return;
        }

        msgEl.innerText = message;

        if (type === 'error') {
            titleEl.innerText = title || 'Thông Báo Lỗi';
            iconEl.innerHTML = '<i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i>';
        } else if (type === 'success') {
            titleEl.innerText = title || 'Thành Công';
            iconEl.innerHTML = '<i class="fa-solid fa-circle-check" style="color: #10b981;"></i>';
        } else if (type === 'warning') {
            titleEl.innerText = title || 'Cảnh Báo';
            iconEl.innerHTML = '<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i>';
        } else {
            titleEl.innerText = title || 'Thông Báo';
            iconEl.innerHTML = '<i class="fa-solid fa-circle-info" style="color: #6366f1;"></i>';
        }

        const handleOk = () => {
            btnOk.removeEventListener('click', handleOk);
            closeModal('modal-alert');
            resolve();
        };

        btnOk.addEventListener('click', handleOk);
        openModal(modal);
    });
}
window.showAlertModal = showAlertModal;

// Toast notification banner nổi ở góc màn hình
function showToast(message, type = 'info', durationMs = 4000) {
    const container = document.getElementById('toast-container');
    if (!container) {
        console.log('[TOAST]', message);
        return;
    }

    const toast = document.createElement('div');
    toast.className = 'glass-card toast-item';
    toast.style.cssText = `
        pointer-events: auto;
        padding: 12px 18px;
        border-radius: 10px;
        box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        display: flex;
        align-items: center;
        gap: 12px;
        min-width: 280px;
        max-width: 420px;
        font-size: 13.5px;
        font-weight: 500;
        backdrop-filter: blur(16px);
        animation: toastIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
        transition: all 0.3s ease;
        border: 1px solid rgba(255, 255, 255, 0.15);
    `;

    let iconHtml = '<i class="fa-solid fa-circle-info" style="color: #6366f1; font-size: 17px;"></i>';
    if (type === 'success' || message.includes('✅') || message.includes('thành công') || message.includes('Thành công')) {
        iconHtml = '<i class="fa-solid fa-circle-check" style="color: #10b981; font-size: 17px;"></i>';
        toast.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    } else if (type === 'error' || message.includes('❌') || message.includes('Lỗi') || message.includes('thất bại')) {
        iconHtml = '<i class="fa-solid fa-circle-xmark" style="color: #ef4444; font-size: 17px;"></i>';
        toast.style.borderColor = 'rgba(239, 68, 68, 0.4)';
    } else if (type === 'warning' || message.includes('⚠️') || message.includes('Cảnh báo')) {
        iconHtml = '<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b; font-size: 17px;"></i>';
        toast.style.borderColor = 'rgba(245, 158, 11, 0.4)';
    }

    toast.innerHTML = `
        <div style="flex-shrink: 0;">${iconHtml}</div>
        <div style="flex: 1; word-break: break-word; color: var(--text-primary);">${escapeHtml(message)}</div>
    `;

    container.appendChild(toast);

    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(10px)';
        setTimeout(() => toast.remove(), 300);
    }, durationMs);
}
window.showToast = showToast;

// Ghi đè toàn bộ window.alert để chuyển sang hộp thoại HTML hiện đại (không bao giờ dùng popup của trình duyệt)
window.alert = function(msg) {
    if (!msg) return;
    const str = String(msg);
    if (str.startsWith('Lỗi:') || str.includes('thất bại') || str.includes('Lỗi kết nối') || str.includes('❌')) {
        showAlertModal(str, 'error');
    } else if (str.includes('thành công') || str.includes('Thành công') || str.includes('✅') || str.includes('Đã sao chép')) {
        showAlertModal(str, 'success');
    } else if (str.includes('Cảnh báo') || str.includes('⚠️')) {
        showAlertModal(str, 'warning');
    } else {
        showAlertModal(str, 'info');
    }
};

/**
 * Thiết lập bộ chọn ngày: Hiển thị 7 ngày gần nhất (1 tuần) kèm tùy chọn lịch tùy ý
 * @param {string} selectId - ID thẻ select (vd: 'rw-work-date')
 * @param {string} customInputId - ID thẻ input date dự phòng (vd: 'rw-work-date-custom')
 * @param {Function} onChange - Callback khi ngày thay đổi: fn(selectedDateYmd)
 */
function setupRecentDaysDateSelector(selectId, customInputId, onChange) {
    const selectEl = document.getElementById(selectId);
    const customInputEl = document.getElementById(customInputId);
    if (!selectEl) return;

    const today = new Date();
    const dayNames = ['Chủ Nhật', 'Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7'];
    
    selectEl.innerHTML = '';
    const todayYmd = today.toLocaleDateString('sv');
    
    for (let i = 0; i < 7; i++) {
        const d = new Date(today);
        d.setDate(d.getDate() - i);
        const ymd = d.toLocaleDateString('sv');
        const dayOfWeek = dayNames[d.getDay()];
        const dd = String(d.getDate()).padStart(2, '0');
        const mm = String(d.getMonth() + 1).padStart(2, '0');
        
        let label = '';
        if (i === 0) {
            label = `Hôm nay (${dd}/${mm} - ${dayOfWeek})`;
        } else if (i === 1) {
            label = `Hôm qua (${dd}/${mm} - ${dayOfWeek})`;
        } else {
            label = `${dd}/${mm} (${dayOfWeek})`;
        }

        const opt = document.createElement('option');
        opt.value = ymd;
        opt.textContent = label;
        if (i === 0) opt.selected = true;
        selectEl.appendChild(opt);
    }

    // Đảm bảo ẩn ô input tự chọn nếu còn tồn tại
    if (customInputEl) {
        customInputEl.style.display = 'none';
    }

    selectEl.addEventListener('change', () => {
        if (typeof onChange === 'function') {
            onChange(selectEl.value);
        }
    });
}
window.setupRecentDaysDateSelector = setupRecentDaysDateSelector;

/**
 * Lấy ngày đã chọn từ bộ chọn ngày 7 ngày gần nhất
 */
function getSelectedDate(selectId, customInputId) {
    const selectEl = document.getElementById(selectId);
    return selectEl?.value || new Date().toLocaleDateString('sv');
}
window.getSelectedDate = getSelectedDate;

// ==========================================
// REMOTE LOCKDOWN & KILLSWITCH LISTENER
// ==========================================
function showRemoteLockdownModal(message) {
    let overlay = document.getElementById('remote-lockdown-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'remote-lockdown-overlay';
        overlay.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(15, 23, 42, 0.95);
            backdrop-filter: blur(10px);
            z-index: 9999999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            box-sizing: border-box;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        `;
        document.body.appendChild(overlay);
    }

    const safeMsg = escapeHtml(message || 'Phiên bản này đã bị tạm dừng bởi Admin. Vui lòng liên hệ Admin!');
    overlay.innerHTML = `
        <div style="background: #1e293b; border: 1px solid #ef4444; border-radius: 16px; max-width: 520px; width: 100%; padding: 36px 28px; text-align: center; box-shadow: 0 25px 50px -12px rgba(0,0,0,0.5);">
            <div style="width: 72px; height: 72px; border-radius: 50%; background: rgba(239, 68, 68, 0.15); color: #ef4444; display: flex; align-items: center; justify-content: center; font-size: 36px; margin: 0 auto 20px;">
                <i class="fa-solid fa-ban"></i>
            </div>
            <h2 style="color: #f87171; font-size: 22px; font-weight: 700; margin: 0 0 12px;">HỆ THỐNG ĐÃ TẠM DỪNG</h2>
            <div style="background: rgba(0, 0, 0, 0.3); border-left: 4px solid #ef4444; padding: 14px; border-radius: 6px; text-align: left; color: #e2e8f0; font-size: 14px; line-height: 1.6; margin: 16px 0 24px;">
                <strong>Thông báo từ Quản trị viên:</strong><br>
                ${safeMsg}
            </div>
            <p style="color: #94a3b8; font-size: 13px; margin: 0;">Vui lòng liên hệ Admin để được cấp quyền mở lại hệ thống.</p>
        </div>
    `;
    overlay.style.display = 'flex';
}
window.showRemoteLockdownModal = showRemoteLockdownModal;

// Intercept window.fetch to trigger lockdown when revoked
const _systemOriginalFetch = window.fetch;
window.fetch = async function(...args) {
    const res = await _systemOriginalFetch.apply(this, args);
    if (res.status === 403) {
        try {
            const clone = res.clone();
            const data = await clone.json();
            if (data && data.revoked) {
                showRemoteLockdownModal(data.error);
            }
        } catch (e) {}
    }
    return res;
};

// Check license status on page load
document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/system/license-status')
        .then(r => r.json())
        .then(data => {
            if (data && data.allowed === false) {
                showRemoteLockdownModal(data.message);
            }
        })
        .catch(() => {});
});



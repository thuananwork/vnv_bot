// ==========================================
// VNV-BOT V2: AUTHENTICATION & SESSION
// ==========================================

let currentUser = null;

async function checkSession() {
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.user) {
            currentUser = data.user;
            window.currentUser = currentUser;
            showApp();
        } else {
            showLogin();
        }
    } catch (err) {
        showLogin();
    }
}

function showLogin() {
    document.body.classList.add('login-mode');
    document.getElementById('login-container').classList.add('active');
    document.getElementById('app-container').classList.add('hide');
    if (window.location.hash !== '#login') {
        history.replaceState(null, '', '#login');
    }
    checkUrlError();
}

function checkUrlError() {
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');
    if (error) {
        const errorEl = document.getElementById('login-error');
        if (errorEl) {
            let message = 'Có lỗi xảy ra trong quá trình đăng nhập.';
            switch(error) {
                case 'access_denied':
                    message = 'Quyền truy cập bị từ chối hoặc bạn đã hủy đăng nhập Google.';
                    break;
                case 'invalid_state':
                    message = 'Phiên đăng nhập không hợp lệ (mismatch CSRF state). Vui lòng thử lại.';
                    break;
                case 'invalid_grant':
                    message = 'Mã xác thực Google OAuth không hợp lệ hoặc đã hết hạn.';
                    break;
                case 'network_error':
                    message = 'Lỗi kết nối đến dịch vụ Google Auth. Vui lòng thử lại sau.';
                    break;
                case 'user_disabled':
                    message = 'Tài khoản của bạn đã bị khóa hoặc vô hiệu hóa.';
                    break;
                case 'google_id_mismatch':
                    message = 'Lỗi bảo mật: Tài khoản của bạn đã liên kết với Google ID khác.';
                    break;
                case 'auth_method_mismatch':
                    message = 'Tài khoản này chỉ được phép đăng nhập nội bộ bằng mật khẩu.';
                    break;
                case 'email_not_in_whitelist':
                    message = 'Địa chỉ email này chưa được đăng ký trong hệ thống.';
                    break;
                case 'email_domain_not_allowed':
                    message = 'Tên miền email của bạn không nằm trong danh sách được cho phép.';
                    break;
                case 'unknown_error':
                    message = 'Đã xảy ra lỗi không xác định. Vui lòng thử lại.';
                    break;
            }
            errorEl.innerText = message;
            errorEl.classList.remove('hide');
            
            const cleanUrl = window.location.protocol + "//" + window.location.host + window.location.pathname;
            window.history.replaceState({ path: cleanUrl }, '', cleanUrl);
        }
    }
}

function showApp() {
    document.body.classList.remove('login-mode');
    document.getElementById('login-container').classList.remove('active');
    document.getElementById('app-container').classList.remove('hide');
    
    document.getElementById('profile-fullname').innerText = currentUser.full_name;
    document.getElementById('profile-role').innerText = getRoleLabel(currentUser.role);
    
    // Phân quyền menu (RBAC)
    const isRegion = currentUser.role === 'region_leader';
    const isCluster = currentUser.role === 'cluster_leader';
    const isAdmin = currentUser.role === 'admin';

    // Cài Đặt & Bảng Màu: CHỈ dành riêng cho Trưởng Vùng
    document.querySelectorAll('.region-only').forEach(el => {
        if (isRegion) el.classList.remove('hide');
        else el.classList.add('hide');
    });

    // Công cụ cho Trưởng Cụm & Admin: Tổng quan, Cụm 5, Cấu hình Vùng, Quản lý tài khoản, Nhật ký
    document.querySelectorAll('.cluster-admin').forEach(el => {
        if (isCluster || isAdmin) el.classList.remove('hide');
        else el.classList.add('hide');
    });

    // Riêng cho Cụm
    document.querySelectorAll('.cluster-only').forEach(el => {
        if (isCluster || isAdmin) el.classList.remove('hide');
        else el.classList.add('hide');
    });

    // Riêng cho Admin
    document.querySelectorAll('.admin-only').forEach(el => {
        if (isAdmin) el.classList.remove('hide');
        else el.classList.add('hide');
    });

    // Dropdown chọn Vùng: Ẩn đi khi là Trưởng Vùng (vì chỉ quản trị đúng 1 Vùng cố định)
    const rwRegionSelect = document.getElementById('rw-region-select');
    if (rwRegionSelect) {
        rwRegionSelect.style.display = isRegion ? 'none' : '';
    }

    // Render thanh chuyển vai trò theo phân cấp
    renderRoleSwitcher();

    if (typeof window.renderAccountInfo === 'function') {
        window.renderAccountInfo();
    }

    // Tự động chuyển URL hash thoát khỏi #login sang trang làm việc chính
    const defaultHash = (currentUser && currentUser.role === 'region_leader') ? '#region-workspace' : '#dashboard';
    if (!window.location.hash || window.location.hash === '#login' || window.location.hash === '#') {
        history.replaceState(null, '', defaultHash);
    }

    navigateFromHash();
}

function renderRoleSwitcher() {
    const container = document.getElementById('role-switcher-container');
    const content = document.getElementById('role-switcher-content');
    if (!container || !content) return;

    const user = window.currentUser;
    if (!user) {
        container.style.display = 'none';
        return;
    }

    const originalRole = user.original_role;

    // 1. TÀI KHOẢN VÙNG: Tuyệt đối không được chuyển vai trò -> Ẩn hoàn toàn!
    if (user.role === 'region_leader' && !originalRole) {
        container.style.display = 'none';
        content.innerHTML = '';
        return;
    }

    container.style.display = 'block';

    // 2. ĐANG Ở VAI TRÒ CHUYỂN TẠM (từ Admin hoặc Cụm 5 sang)
    if (originalRole) {
        if (originalRole === 'admin') {
            content.innerHTML = `
                <div style="font-size: 11px; font-weight: 600; color: #f59e0b; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                    <span><i class="fa-solid fa-eye"></i> Đang xem: ${escapeHtml(user.managed_region_name || ('Vùng ' + (user.managed_region_id || '')))}</span>
                </div>
                <a href="/api/auth/quick-switch?user=admin" class="btn btn-sm btn-primary" style="font-size: 11px; width: 100%; justify-content: center; text-decoration: none; padding: 5px 8px; display: flex; align-items: center; gap: 6px; font-weight: 600;">
                    <i class="fa-solid fa-shield-halved"></i> Trở về Admin
                </a>
            `;
            return;
        }
        if (originalRole === 'cluster_leader') {
            content.innerHTML = `
                <div style="font-size: 11px; font-weight: 600; color: #6366f1; margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                    <span><i class="fa-solid fa-eye"></i> Đang xem: ${escapeHtml(user.managed_region_name || ('Vùng ' + (user.managed_region_id || '')))}</span>
                </div>
                <a href="/api/auth/quick-switch?user=cum5" class="btn btn-sm btn-primary" style="font-size: 11px; width: 100%; justify-content: center; text-decoration: none; padding: 5px 8px; display: flex; align-items: center; gap: 6px; font-weight: 600;">
                    <i class="fa-solid fa-layer-group"></i> Trở về Cụm 5
                </a>
            `;
            return;
        }
    }

    // 3. ADMIN: Quyền cao nhất, được đổi sang Cụm 5 và cả 7 Vùng
    if (user.role === 'admin') {
        content.innerHTML = `
            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                <span><i class="fa-solid fa-repeat"></i> Chuyển quyền (Admin):</span>
            </div>
            <div style="margin-bottom: 6px;">
                <a href="/api/auth/quick-switch?user=cum5" class="btn btn-sm btn-secondary-outline" style="font-size: 11px; padding: 3px 6px; width: 100%; text-align: center; text-decoration: none; display: flex; align-items: center; justify-content: center; gap: 4px;">
                    <i class="fa-solid fa-layer-group"></i> Xem vai trò Cụm 5
                </a>
            </div>
            <select class="form-control input-compact" style="font-size: 11px; height: 28px; padding: 2px 6px; width: 100%; font-weight: 600;" onchange="if(this.value) window.location.href='/api/auth/quick-switch?user='+this.value;">
                <option value="" disabled selected>-- Chọn Vùng 25-31 --</option>
                <optgroup label="👑 Trưởng Vùng">
                    <option value="truongvung25">Trưởng Vùng 25 (Bảo Trâm)</option>
                    <option value="truongvung26">Trưởng Vùng 26 (Hoàng Vũ)</option>
                    <option value="truongvung27">Trưởng Vùng 27 (Quang Đại)</option>
                    <option value="truongvung28">Trưởng Vùng 28 (Nhật My)</option>
                    <option value="truongvung29">Trưởng Vùng 29 (Thanh Hiền)</option>
                    <option value="truongvung30">Trưởng Vùng 30 (Thanh Phương)</option>
                    <option value="truongvung31">Trưởng Vùng 31 (Thanh Tân)</option>
                </optgroup>
                <optgroup label="⭐ Phó Vùng">
                    <option value="phovung25">Phó Vùng 25 (Yến Nhi)</option>
                    <option value="phovung26">Phó Vùng 26 (Hồng Lý)</option>
                    <option value="phovung27">Phó Vùng 27 (Thanh Trà)</option>
                    <option value="phovung28">Phó Vùng 28 (Nhật My)</option>
                    <option value="phovung29">Phó Vùng 29 (Kim Chi)</option>
                    <option value="phovung30">Phó Vùng 30 (Thanh Trúc)</option>
                    <option value="phovung31">Phó Vùng 31 (Minh Trang)</option>
                </optgroup>
            </select>
        `;
        return;
    }

    // 4. TRƯỞNG CỤM: Chỉ được chuyển sang 7 Vùng trực thuộc, KHÔNG ĐƯỢC sang Admin
    if (user.role === 'cluster_leader') {
        content.innerHTML = `
            <div style="font-size: 11px; font-weight: 600; color: var(--text-muted); margin-bottom: 6px; display: flex; align-items: center; justify-content: space-between;">
                <span><i class="fa-solid fa-map-location-dot"></i> Xem theo Vùng:</span>
            </div>
            <select class="form-control input-compact" style="font-size: 11px; height: 28px; padding: 2px 6px; width: 100%; font-weight: 600;" onchange="if(this.value) window.location.href='/api/auth/quick-switch?user='+this.value;">
                <option value="" disabled selected>-- Chọn Vùng trực thuộc --</option>
                <optgroup label="👑 Trưởng Vùng">
                    <option value="truongvung25">Trưởng Vùng 25 (Bảo Trâm)</option>
                    <option value="truongvung26">Trưởng Vùng 26 (Hoàng Vũ)</option>
                    <option value="truongvung27">Trưởng Vùng 27 (Quang Đại)</option>
                    <option value="truongvung28">Trưởng Vùng 28 (Nhật My)</option>
                    <option value="truongvung29">Trưởng Vùng 29 (Thanh Hiền)</option>
                    <option value="truongvung30">Trưởng Vùng 30 (Thanh Phương)</option>
                    <option value="truongvung31">Trưởng Vùng 31 (Thanh Tân)</option>
                </optgroup>
                <optgroup label="⭐ Phó Vùng">
                    <option value="phovung25">Phó Vùng 25 (Yến Nhi)</option>
                    <option value="phovung26">Phó Vùng 26 (Hồng Lý)</option>
                    <option value="phovung27">Phó Vùng 27 (Thanh Trà)</option>
                    <option value="phovung28">Phó Vùng 28 (Nhật My)</option>
                    <option value="phovung29">Phó Vùng 29 (Kim Chi)</option>
                    <option value="phovung30">Phó Vùng 30 (Thanh Trúc)</option>
                    <option value="phovung31">Phó Vùng 31 (Minh Trang)</option>
                </optgroup>
            </select>
        `;
        return;
    }
}

function initAuthEvents() {
    // Nút ẩn/hiện mật khẩu
    const btnTogglePassword = document.getElementById('btn-toggle-password');
    if (btnTogglePassword) {
        btnTogglePassword.addEventListener('click', () => {
            const passwordInput = document.getElementById('password');
            const icon = btnTogglePassword.querySelector('i');
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                passwordInput.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    }

    // Xử lý Form Đăng Nhập
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            const errorEl = document.getElementById('login-error');

            errorEl.classList.add('hide');

            try {
                const res = await fetch('/api/auth/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ username, password })
                });
                const data = await res.json();

                if (res.ok) {
                    currentUser = data.user;
                    window.currentUser = currentUser;
                    showApp();
                } else {
                    errorEl.innerText = data.error || 'Đăng nhập thất bại.';
                    errorEl.classList.remove('hide');
                }
            } catch (err) {
                errorEl.innerText = 'Không thể kết nối tới server backend.';
                errorEl.classList.remove('hide');
            }
        });
    }

    // Đăng xuất
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', async () => {
            try {
                await fetch('/api/auth/logout', { method: 'POST' });
            } catch (err) {}
            currentUser = null;
            window.currentUser = null;
            showLogin();
        });
    }
}

window.currentUser = currentUser;
window.checkSession = checkSession;
window.showLogin = showLogin;
window.showApp = showApp;
window.initAuthEvents = initAuthEvents;

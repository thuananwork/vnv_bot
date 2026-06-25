// Global State
let currentUser = null;

// Hàm chống tấn công XSS bằng cách mã hóa các thẻ HTML
function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Khởi chạy ứng dụng
document.addEventListener('DOMContentLoaded', () => {
    checkSession();
    initNavigation();
    initForms();
});

// ==========================================
// 1. XÁC THỰC & ĐĂNG NHẬP (AUTH FLOW)
// ==========================================

async function checkSession() {
    try {
        const res = await fetch('/api/auth/me');
        const data = await res.json();
        if (data.user) {
            currentUser = data.user;
            showApp();
        } else {
            showLogin();
        }
    } catch (err) {
        showLogin();
    }
}

function showLogin() {
    document.getElementById('login-container').classList.add('active');
    document.getElementById('app-container').classList.add('hide');
}

function showApp() {
    document.getElementById('login-container').classList.remove('active');
    document.getElementById('app-container').classList.remove('hide');
    
    // Nạp thông tin tài khoản hiển thị ở sidebar
    document.getElementById('profile-fullname').innerText = currentUser.full_name;
    document.getElementById('profile-role').innerText = getRoleLabel(currentUser.role);
    
    // Điều chỉnh hiển thị thanh menu theo quyền hạn (RBAC)
    if (currentUser.role === 'admin') {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('hide'));
    } else {
        document.querySelectorAll('.admin-only').forEach(el => el.classList.add('hide'));
    }

    // Mặc định nạp trang Dashboard
    switchPanel('panel-dashboard');
}

function getRoleLabel(role) {
    if (role === 'admin') return 'System Admin';
    if (role === 'cluster_leader') return 'Trưởng Cụm';
    if (role === 'region_leader') return 'Trưởng Vùng';
    return 'User';
}

// Xử lý Form Đăng Nhập
document.getElementById('login-form').addEventListener('submit', async (e) => {
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

// Đăng xuất
document.getElementById('btn-logout').addEventListener('click', async () => {
    try {
        await fetch('/api/auth/logout', { method: 'POST' });
    } catch (err) {}
    currentUser = null;
    showLogin();
});

// ==========================================
// 2. CHUYỂN ĐỔI GIAO DIỆN (NAVIGATION)
// ==========================================

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            
            // Xóa class active ở menu cũ
            document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
            
            // Active menu mới
            item.classList.add('active');
            
            const targetPanel = item.getAttribute('data-target');
            switchPanel(targetPanel);
        });
    });
}

function switchPanel(panelId) {
    // Ẩn tất cả các panel
    document.querySelectorAll('.content-panel').forEach(panel => {
        panel.classList.remove('active');
    });

    // Hiển thị panel được chọn
    const activePanel = document.getElementById(panelId);
    if (activePanel) {
        activePanel.classList.add('active');
        
        // Gọi hàm nạp dữ liệu đặc thù cho từng Panel
        if (panelId === 'panel-dashboard') loadDashboard();
        else if (panelId === 'panel-submissions') loadSubmissions();
        else if (panelId === 'panel-reports') loadReports();
        else if (panelId === 'panel-clusters') loadClusters();
        else if (panelId === 'panel-regions') loadRegions();
        else if (panelId === 'panel-users') loadUsers();
        else if (panelId === 'panel-audit') loadAuditLogs();
    }
}

// ==========================================
// 3. TẢI DỮ LIỆU TỪ BACKEND APIs
// ==========================================

// Dashboard Tổng quan
async function loadDashboard() {
    try {
        const res = await fetch('/api/dashboard/summary');
        const data = await res.json();
        
        document.getElementById('stat-clusters').innerText = data.clusters;
        document.getElementById('stat-regions').innerText = data.regions;
        document.getElementById('stat-members').innerText = data.members;
        document.getElementById('stat-submissions').innerText = data.submissions;
        document.getElementById('stat-tasks').innerText = data.tasks;
    } catch (err) {
        console.error('Không thể tải số liệu thống kê Dashboard:', err);
    }
}

// Kết quả nộp bài
async function loadSubmissions() {
    const tbody = document.getElementById('table-submissions-body');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Đang tải dữ liệu...</td></tr>';
    
    try {
        const res = await fetch('/api/submissions');
        const list = await res.json();
        tbody.innerHTML = '';
        
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Chưa có bài nộp nào được ghi nhận.</td></tr>';
            return;
        }

        list.forEach(sub => {
            const time = new Date(sub.submitted_at).toLocaleString();
            const statusBadge = `<span class="status-badge ${escapeHtml(sub.status)}">${escapeHtml(getStatusLabel(sub.status))}</span>`;
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${time}</td>
                <td><strong>${escapeHtml(sub.real_name || 'N/A')}</strong></td>
                <td>${escapeHtml(sub.zalo_name || 'N/A')}</td>
                <td>${escapeHtml(sub.region_name || 'N/A')}</td>
                <td><code>${escapeHtml(sub.task_code)}</code></td>
                <td><span class="badge" style="background:rgba(255,255,255,0.08);">${escapeHtml(sub.submission_type)}</span></td>
                <td>${sub.raw_content ? escapeHtml(sub.raw_content.substring(0, 50)) + '...' : '-'}</td>
                <td>${statusBadge}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--color-rose);">Thất bại khi nạp danh sách nộp bài.</td></tr>';
    }
}

function getStatusLabel(status) {
    if (status === 'approved') return 'Hoàn thành';
    if (status === 'pending_review') return 'Chờ duyệt';
    if (status === 'rejected') return 'Từ chối';
    return status;
}

// Báo cáo ngày & xuất Google Sheet
async function loadReports() {
    const tbody = document.getElementById('table-reports-body');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Đang tải dữ liệu...</td></tr>';
    
    try {
        const res = await fetch('/api/reports');
        const list = await res.json();
        tbody.innerHTML = '';
        
        if (list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Chưa có báo cáo ngày nào được sinh ra.</td></tr>';
            return;
        }

        list.forEach(rep => {
            const time = new Date(rep.created_at).toLocaleDateString();
            const syncStatus = rep.sent_at 
                ? `<span class="status-badge approved"><i class="fa-solid fa-cloud-arrow-up"></i> Đã đồng bộ (${new Date(rep.sent_at).toLocaleTimeString()})</span>`
                : `<span class="status-badge pending"><i class="fa-solid fa-cloud-arrow-down"></i> Chưa đồng bộ</span>`;
            
            const scope = rep.region_name 
                ? `Vùng: ${escapeHtml(rep.region_name)}` 
                : `Cụm: ${escapeHtml(rep.cluster_name)}`;
            
            // Chỉ hiển thị nút Đồng bộ Sheet cho báo cáo cấp Vùng (Region)
            const syncBtn = rep.region_name
                ? `<button class="btn btn-primary btn-sm" onclick="syncToGoogleSheet(${rep.id})"><i class="fa-solid fa-sync"></i> Đồng bộ Sheet</button>`
                : `<span class="text-muted">Không hỗ trợ</span>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${time}</td>
                <td><code>${escapeHtml(rep.task_code)}</code></td>
                <td><strong>${scope}</strong></td>
                <td>${rep.total_members}</td>
                <td style="color:var(--color-green); font-weight:bold;">${rep.total_completed}</td>
                <td style="color:var(--color-rose); font-weight:bold;">${rep.total_failed}</td>
                <td>${syncStatus}</td>
                <td>${syncBtn}</td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--color-rose);">Thất bại khi tải báo cáo.</td></tr>';
    }
}

// Hàm gửi request đồng bộ Google Sheet cục bộ của từng vùng
async function syncToGoogleSheet(reportId) {
    try {
        const res = await fetch(`/api/reports/${reportId}/sync-sheet`, { method: 'POST' });
        const data = await res.json();
        if (res.ok) {
            alert(data.message);
            loadReports();
        } else {
            alert('Lỗi: ' + data.error);
        }
    } catch (err) {
        alert('Lỗi kết nối khi đồng bộ.');
    }
}

// Quản lý Cụm (Admin)
async function loadClusters() {
    const tbody = document.getElementById('table-clusters-body');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;">Đang tải...</td></tr>';
    
    try {
        const res = await fetch('/api/clusters');
        const list = await res.json();
        tbody.innerHTML = '';
        
        list.forEach(c => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${c.id}</td>
                <td><strong>${escapeHtml(c.cluster_name)}</strong></td>
                <td>${c.manager_name ? escapeHtml(c.manager_name) : '<em class="text-muted">Chưa gán</em>'}</td>
                <td>${new Date(c.created_at).toLocaleDateString()}</td>
                <td>
                    <div class="table-actions">
                        <button class="btn btn-secondary-outline btn-sm" onclick="editCluster(${JSON.stringify(c).replace(/"/g, '&quot;')})"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
                        <button class="btn btn-danger-outline btn-sm" onclick="deleteCluster(${c.id})"><i class="fa-solid fa-trash"></i> Xóa</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });

        // Nạp trước danh sách Managers phục vụ form
        populateClusterManagersDropdown();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--color-rose);">Lỗi tải danh sách Cụm.</td></tr>';
    }
}

// Quản lý Vùng (Admin)
async function loadRegions() {
    const tbody = document.getElementById('table-regions-body');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Đang tải...</td></tr>';
    
    try {
        const res = await fetch('/api/regions');
        const list = await res.json();
        tbody.innerHTML = '';
        
        list.forEach(r => {
            const sheetInfo = r.sheet_id 
                ? `<a href="${escapeHtml(r.sheet_url)}" target="_blank" style="color:var(--color-blue); text-decoration:none;"><i class="fa-solid fa-file-excel"></i> ${escapeHtml(r.sheet_name || 'Link Sheet')}</a>`
                : '<em class="text-muted">Chưa liên kết</em>';
                
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHtml(r.region_name)}</strong></td>
                <td>${r.cluster_name ? escapeHtml(r.cluster_name) : '<em class="text-muted">Chưa thuộc cụm</em>'}</td>
                <td>${r.manager_name ? escapeHtml(r.manager_name) : '<em class="text-muted">Chưa gán</em>'}</td>
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

        // Nạp trước danh sách Managers và Clusters phục vụ form
        populateRegionDropdowns();
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--color-rose);">Lỗi tải danh sách Vùng.</td></tr>';
    }
}

// Quản lý tài khoản (Admin)
async function loadUsers() {
    const tbody = document.getElementById('table-users-body');
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;">Đang tải...</td></tr>';
    
    try {
        const res = await fetch('/api/users');
        const list = await res.json();
        tbody.innerHTML = '';
        
        list.forEach(u => {
            const statusBadge = u.is_active === 1
                ? '<span class="status-badge approved">Hoạt động</span>'
                : '<span class="status-badge rejected">Bị khóa</span>';
                
            const lastLogin = u.last_login ? new Date(u.last_login).toLocaleString() : 'Chưa từng đăng nhập';

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHtml(u.username)}</strong></td>
                <td>${escapeHtml(u.full_name)}</td>
                <td>${u.zalo_id ? escapeHtml(u.zalo_id) : '-'}</td>
                <td><span class="badge" style="background:rgba(255,255,255,0.08);">${escapeHtml(getRoleLabel(u.role))}</span></td>
                <td>${statusBadge}</td>
                <td><small>${escapeHtml(lastLogin)}</small></td>
                <td>
                    <div class="table-actions">
                        <button class="btn btn-secondary-outline btn-sm" onclick="editUser(${JSON.stringify(u).replace(/"/g, '&quot;')})"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
                        <button class="btn btn-danger-outline btn-sm" onclick="deleteUser(${u.id})"><i class="fa-solid fa-trash"></i> Xóa</button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; color:var(--color-rose);">Lỗi tải danh sách người dùng.</td></tr>';
    }
}

// Nhật ký hệ thống Audit Logs (Admin)
async function loadAuditLogs() {
    const tbody = document.getElementById('table-audit-body');
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Đang tải...</td></tr>';
    
    try {
        const res = await fetch('/api/audit-logs');
        const list = await res.json();
        tbody.innerHTML = '';
        
        list.forEach(l => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><small>${new Date(l.created_at).toLocaleString()}</small></td>
                <td><strong>${escapeHtml(l.full_name)} (${escapeHtml(l.username)})</strong></td>
                <td><span class="badge" style="background:rgba(138,43,226,0.15); color:hsl(272,95%,75%);">${escapeHtml(l.action)}</span></td>
                <td><code>${escapeHtml(l.target)}</code></td>
                <td><small>${escapeHtml(l.details)}</small></td>
                <td><small>${l.ip_address ? escapeHtml(l.ip_address) : '-'}</small></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--color-rose);">Lỗi nạp nhật ký audit.</td></tr>';
    }
}

// ==========================================
// 4. DROPDOWN POPULATION HELPERs
// ==========================================

async function populateClusterManagersDropdown() {
    try {
        const res = await fetch('/api/users');
        const users = await res.json();
        const select = document.getElementById('select-cluster-manager');
        select.innerHTML = '<option value="">-- Chưa gán --</option>';
        
        users.filter(u => u.role === 'cluster_leader' && u.is_active === 1).forEach(u => {
            select.innerHTML += `<option value="${u.id}">${escapeHtml(u.full_name)} (${escapeHtml(u.username)})</option>`;
        });
    } catch (err) {}
}

async function populateRegionDropdowns() {
    try {
        // Nạp danh sách cụm
        const resClusters = await fetch('/api/clusters');
        const clusters = await resClusters.json();
        const selectCluster = document.getElementById('select-region-cluster');
        selectCluster.innerHTML = '<option value="">-- Chọn Cụm --</option>';
        clusters.forEach(c => {
            selectCluster.innerHTML += `<option value="${c.id}">${escapeHtml(c.cluster_name)}</option>`;
        });

        // Nạp danh sách trưởng vùng
        const resUsers = await fetch('/api/users');
        const users = await resUsers.json();
        const selectManager = document.getElementById('select-region-manager');
        selectManager.innerHTML = '<option value="">-- Chưa gán --</option>';
        users.filter(u => u.role === 'region_leader' && u.is_active === 1).forEach(u => {
            selectManager.innerHTML += `<option value="${u.id}">${escapeHtml(u.full_name)} (${escapeHtml(u.username)})</option>`;
        });
    } catch (err) {}
}

// ==========================================
// 5. MODAL CONTROL & FORM HANDLERS (CRUD)
// ==========================================

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function initForms() {
    // FORM USER SUBMIT
    document.getElementById('form-user').addEventListener('submit', async (e) => {
        e.preventDefault();
        const userId = document.getElementById('edit-user-id').value;
        const payload = {
            username: document.getElementById('input-username').value,
            full_name: document.getElementById('input-fullname').value,
            zalo_id: document.getElementById('input-user-zaloid').value,
            role: document.getElementById('select-role').value,
            is_active: parseInt(document.getElementById('select-is-active').value)
        };

        const password = document.getElementById('input-password').value;
        if (password && password.trim() !== '') {
            payload.password = password;
        } else if (!userId) {
            // Khi thêm mới bắt buộc phải có mật khẩu
            payload.password = document.getElementById('input-password').value = '123456'; // Default password
        }

        const url = userId ? `/api/users/${userId}` : '/api/users';
        const method = userId ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                closeModal('modal-user');
                loadUsers();
            } else {
                const data = await res.json();
                alert('Lỗi: ' + data.error);
            }
        } catch (err) {
            alert('Lỗi kết nối server.');
        }
    });

    // FORM CLUSTER SUBMIT
    document.getElementById('form-cluster').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-cluster-id').value;
        const payload = {
            cluster_name: document.getElementById('input-cluster-name').value,
            manager_id: document.getElementById('select-cluster-manager').value || null
        };

        const url = id ? `/api/clusters/${id}` : '/api/clusters';
        const method = id ? 'PUT' : 'POST';

        try {
            const res = await fetch(url, {
                method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (res.ok) {
                closeModal('modal-cluster');
                loadClusters();
            } else {
                const data = await res.json();
                alert('Lỗi: ' + data.error);
            }
        } catch (err) {
            alert('Lỗi kết nối.');
        }
    });

    // FORM REGION SUBMIT
    document.getElementById('form-region').addEventListener('submit', async (e) => {
        e.preventDefault();
        const id = document.getElementById('edit-region-id').value;
        const payload = {
            region_name: document.getElementById('input-region-name').value,
            cluster_id: document.getElementById('select-region-cluster').value || null,
            manager_id: document.getElementById('select-region-manager').value || null,
            zalo_group_id: document.getElementById('input-zalo-id').value,
            zalo_group_name: document.getElementById('input-zalo-name').value,
            status: document.getElementById('select-region-status').value,
            sheet_id: document.getElementById('input-sheet-id').value || null,
            sheet_url: document.getElementById('input-sheet-url').value || null,
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

// --- CALL MODALS & FILL FORMs ---

window.showUserModal = function() {
    document.getElementById('modal-user-title').innerText = 'Thêm Tài Khoản Mới';
    document.getElementById('edit-user-id').value = '';
    document.getElementById('form-user').reset();
    document.getElementById('input-username').disabled = false;
    document.getElementById('group-is-active').classList.add('hide');
    document.getElementById('modal-user').classList.add('active');
};

window.editUser = function(user) {
    document.getElementById('modal-user-title').innerText = 'Cập Nhật Tài Khoản';
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('input-username').value = user.username;
    document.getElementById('input-username').disabled = true; // Không cho đổi username
    document.getElementById('input-password').value = '';
    document.getElementById('input-fullname').value = user.full_name;
    document.getElementById('input-user-zaloid').value = user.zalo_id || '';
    document.getElementById('select-role').value = user.role;
    document.getElementById('select-is-active').value = user.is_active;
    document.getElementById('group-is-active').classList.remove('hide');
    document.getElementById('modal-user').classList.add('active');
};

window.deleteUser = async function(id) {
    if (confirm('Bạn có chắc chắn muốn xóa tài khoản này không?')) {
        const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
        if (res.ok) loadUsers();
    }
};

window.showClusterModal = function() {
    document.getElementById('modal-cluster-title').innerText = 'Thêm Cụm Mới';
    document.getElementById('edit-cluster-id').value = '';
    document.getElementById('form-cluster').reset();
    document.getElementById('modal-cluster').classList.add('active');
};

window.editCluster = function(cluster) {
    document.getElementById('modal-cluster-title').innerText = 'Cập Nhật Cụm';
    document.getElementById('edit-cluster-id').value = cluster.id;
    document.getElementById('input-cluster-name').value = cluster.cluster_name;
    document.getElementById('select-cluster-manager').value = cluster.manager_id || '';
    document.getElementById('modal-cluster').classList.add('active');
};

window.deleteCluster = async function(id) {
    if (confirm('Xóa cụm sẽ ngắt liên kết của các vùng trực thuộc. Bạn vẫn muốn xóa?')) {
        const res = await fetch(`/api/clusters/${id}`, { method: 'DELETE' });
        if (res.ok) loadClusters();
    }
};

window.showRegionModal = function() {
    document.getElementById('modal-region-title').innerText = 'Thêm Vùng Mới';
    document.getElementById('edit-region-id').value = '';
    document.getElementById('form-region').reset();
    document.getElementById('modal-region').classList.add('active');
};

window.editRegion = function(region) {
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
};

window.deleteRegion = async function(id) {
    if (confirm('Bạn có chắc chắn muốn xóa vùng này không?')) {
        const res = await fetch(`/api/regions/${id}`, { method: 'DELETE' });
        if (res.ok) loadRegions();
    }
};

window.closeModal = closeModal;

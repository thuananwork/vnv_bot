// ==========================================
// VNV-BOT V2: USERS MANAGEMENT (CRUD)
// ==========================================

async function loadUsers() {
    const tbody = document.getElementById('table-users-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="10" style="text-align:center;">Đang tải...</td></tr>';
    
    try {
        const res = await fetch('/api/users');
        const list = await res.json();
        tbody.innerHTML = '';
        
        list.forEach(u => {
            const statusBadge = u.approval_status === 'approved'
                ? '<span class="status-badge approved">Hoạt động</span>'
                : '<span class="status-badge rejected">Bị khóa</span>';
                
            const authMethodBadge = u.auth_method === 'google'
                ? '<span class="badge" style="background:#eff6ff; color:#2563eb; border:1px solid #bfdbfe;"><i class="fa-brands fa-google"></i> Google</span>'
                : '<span class="badge" style="background:#f1f5f9; color:#475569; border:1px solid #e2e8f0;"><i class="fa-solid fa-key"></i> Local</span>';

            const firstLogin = u.first_login_at ? new Date(u.first_login_at).toLocaleString() : '<span style="color:var(--text-muted);">Chưa từng</span>';
            const lastLogin = u.last_login ? new Date(u.last_login).toLocaleString() : '<span style="color:var(--text-muted);">Chưa từng</span>';

            let extraActions = '';
            if (u.auth_method === 'google') {
                extraActions += `
                    <button class="btn btn-secondary-outline btn-sm" title="Copy lời mời đăng nhập" onclick="copyUserInvitation('${escapeHtml(u.full_name)}', '${escapeHtml(u.role)}', '${escapeHtml(u.email || '')}')">
                        <i class="fa-solid fa-share-nodes"></i> Mời
                    </button>
                `;
            }
            
            extraActions += `
                <button class="btn btn-warning-outline btn-sm" title="Cưỡng bức đăng xuất khỏi mọi thiết bị" onclick="revokeUserSessions(${u.id})">
                    <i class="fa-solid fa-circle-xmark"></i> Revoke
                </button>
            `;

            const roleBadgeClass = u.role === 'admin' ? 'badge-role-deputy' : (u.role === 'cluster_leader' ? 'badge-late' : 'badge-role-leader');

            const toggleLockBtn = (u.approval_status === 'approved' && u.is_active !== 0)
                ? `<button class="btn btn-danger-outline btn-sm" onclick="deleteUser(${u.id})"><i class="fa-solid fa-ban"></i> Khóa</button>`
                : `<button class="btn btn-success-outline btn-sm" style="color:#10b981; border-color:#10b981;" onclick="enableUser(${u.id})"><i class="fa-solid fa-unlock"></i> Mở khóa</button>`;

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>
                    <strong>${escapeHtml(u.username)}</strong>
                    ${u.email ? `<br><small style="color:var(--text-muted);">${escapeHtml(u.email)}</small>` : ''}
                </td>
                <td>${escapeHtml(u.full_name)}</td>
                <td>${u.zalo_id ? escapeHtml(u.zalo_id) : '-'}</td>
                <td><span class="badge ${roleBadgeClass}">${escapeHtml(getRoleLabel(u.role))}</span></td>
                <td>${authMethodBadge}</td>
                <td>${statusBadge}</td>
                <td><small style="color:var(--text-muted);">${firstLogin}</small></td>
                <td><small style="color:var(--text-muted);">${lastLogin}</small></td>
                <td><span class="badge" style="background:#f1f5f9; color:#475569; border:1px solid #e2e8f0;">${u.login_count || 0}</span></td>
                <td>
                    <div class="table-actions" style="gap:5px;">
                        <button class="btn btn-secondary-outline btn-sm" onclick="editUser(${JSON.stringify(u).replace(/"/g, '&quot;')})"><i class="fa-solid fa-pen-to-square"></i> Sửa</button>
                        ${toggleLockBtn}
                        <button class="btn btn-danger-outline btn-sm" style="color:#ef4444; border-color:#fca5a5;" title="Xóa vĩnh viễn tài khoản này" onclick="permanentDeleteUser(${u.id}, '${escapeHtml(u.username)}')"><i class="fa-solid fa-trash-can"></i> Xóa</button>
                        ${extraActions}
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="10" style="text-align:center; color:var(--color-rose);">Lỗi tải danh sách người dùng.</td></tr>';
    }
}

function toggleUserFields() {
    const groupUsername = document.getElementById('group-user-username');
    const groupPassword = document.getElementById('group-user-password');
    const groupEmail = document.getElementById('group-user-email');
    
    if (groupUsername) groupUsername.classList.remove('hide');
    if (groupPassword) groupPassword.classList.remove('hide');
    if (groupEmail) groupEmail.classList.remove('hide');
}

function showUserModal() {
    document.getElementById('modal-user-title').innerText = 'Thêm Tài Khoản Mới';
    document.getElementById('edit-user-id').value = '';
    document.getElementById('form-user').reset();
    document.getElementById('input-username').disabled = false;
    document.getElementById('input-email').disabled = false;
    document.getElementById('group-is-active').classList.add('hide');
    document.getElementById('modal-user').classList.add('active');
    toggleUserFields();
}

function editUser(user) {
    document.getElementById('modal-user-title').innerText = 'Cập Nhật Tài Khoản';
    document.getElementById('edit-user-id').value = user.id;
    document.getElementById('input-username').value = user.username || '';
    document.getElementById('input-username').disabled = false;
    document.getElementById('input-email').value = user.email || '';
    document.getElementById('input-email').disabled = false;
    document.getElementById('input-password').value = '';
    document.getElementById('input-fullname').value = user.full_name;
    document.getElementById('input-user-zaloid').value = user.zalo_id || '';
    document.getElementById('select-role').value = user.role;
    document.getElementById('select-is-active').value = user.is_active;
    document.getElementById('group-is-active').classList.remove('hide');
    document.getElementById('modal-user').classList.add('active');
    toggleUserFields();
}

async function deleteUser(id) {
    const ok = await showConfirmModal('Bạn có chắc chắn muốn khóa tài khoản này không?');
    if (ok) {
        try {
            const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
            if (res.ok) {
                loadUsers();
            } else {
                const data = await res.json();
                if (data.error === 'SELF_DISABLE_PROTECTED') {
                    showAlertModal('Bạn không thể tự vô hiệu hóa tài khoản của mình.', 'warning');
                } else if (data.error === 'LAST_ADMIN_PROTECTED') {
                    showAlertModal('Không thể vô hiệu hóa Admin cuối cùng trong hệ thống.', 'warning');
                } else {
                    showAlertModal('Lỗi: ' + data.error, 'error');
                }
            }
        } catch (err) {
            showAlertModal('Lỗi kết nối.', 'error');
        }
    }
}

async function enableUser(id) {
    const ok = await showConfirmModal('Bạn có muốn kích hoạt lại (mở khóa) tài khoản này không?');
    if (ok) {
        try {
            const res = await fetch(`/api/users/${id}/enable`, { method: 'POST' });
            if (res.ok) {
                if (typeof showToast === 'function') {
                    showToast('✅ Đã mở khóa tài khoản thành công!');
                } else if (typeof showAlertModal === 'function') {
                    showAlertModal('Đã mở khóa tài khoản thành công.', 'success');
                }
                loadUsers();
            } else {
                const data = await res.json();
                showAlertModal('Lỗi: ' + (data.error || 'Không thể mở khóa tài khoản.'), 'error');
            }
        } catch (err) {
            showAlertModal('Lỗi kết nối.', 'error');
        }
    }
}

async function revokeUserSessions(id) {
    const ok = await showConfirmModal('Bạn có chắc chắn muốn cưỡng bức đăng xuất tài khoản này trên mọi thiết bị không?');
    if (ok) {
        try {
            const res = await fetch(`/api/users/${id}/revoke-sessions`, { method: 'POST' });
            if (res.ok) {
                showAlertModal('Đã cưỡng bức đăng xuất thành công.', 'success');
                loadUsers();
            } else {
                const data = await res.json();
                showAlertModal('Lỗi: ' + data.error, 'error');
            }
        } catch (err) {
            showAlertModal('Lỗi kết nối.', 'error');
        }
    }
}

async function permanentDeleteUser(id, username) {
    const ok = await showConfirmModal(
        `Bạn có chắc chắn muốn XÓA VĨNH VIỄN tài khoản "${username}" không?\n\n⚠️ Lưu ý: Thao tác này sẽ xóa hoàn toàn tài khoản khỏi cơ sở dữ liệu và không thể khôi phục!`,
        { title: 'Xác Nhận Xóa Vĩnh Viễn', isDanger: true }
    );
    if (!ok) return;

    try {
        const res = await fetch(`/api/users/${id}/permanent`, { method: 'DELETE' });
        const data = await res.json();
        if (res.ok) {
            if (typeof showToast === 'function') {
                showToast(`✅ ${data.message || 'Đã xóa tài khoản vĩnh viễn!'}`);
            } else if (typeof showAlertModal === 'function') {
                showAlertModal(data.message || 'Đã xóa tài khoản vĩnh viễn.', 'success');
            }
            loadUsers();
        } else {
            if (data.error === 'SELF_DELETE_PROTECTED') {
                showAlertModal('Bạn không thể tự xóa tài khoản của chính mình.', 'warning');
            } else if (data.error === 'LAST_ADMIN_PROTECTED') {
                showAlertModal('Không thể xóa tài khoản Admin cuối cùng trong hệ thống.', 'warning');
            } else {
                showAlertModal('Lỗi: ' + (data.error || 'Không thể xóa tài khoản.'), 'error');
            }
        }
    } catch (err) {
        showAlertModal('Lỗi kết nối máy chủ.', 'error');
    }
}

function initUserForms() {
    const roleSelect = document.getElementById('select-role');
    if (roleSelect) {
        roleSelect.addEventListener('change', toggleUserFields);
    }

    const formUser = document.getElementById('form-user');
    if (formUser) {
        formUser.addEventListener('submit', async (e) => {
            e.preventDefault();
            const userId = document.getElementById('edit-user-id').value;
            const role = document.getElementById('select-role').value;
            const payload = {
                full_name: document.getElementById('input-fullname').value,
                zalo_id: document.getElementById('input-user-zaloid').value,
                role: role
            };

            const usernameVal = document.getElementById('input-username').value;
            const passwordVal = document.getElementById('input-password').value;
            const emailVal = document.getElementById('input-email').value;

            if (usernameVal && usernameVal.trim()) {
                payload.username = usernameVal.trim();
            }
            if (passwordVal && passwordVal.trim()) {
                payload.password = passwordVal.trim();
            }
            if (emailVal && emailVal.trim()) {
                payload.email = emailVal.trim();
            }

            if (!userId && !payload.username && !payload.email) {
                alert('Vui lòng nhập Tên đăng nhập + Mật khẩu hoặc Email Google.');
                return;
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
                    const resData = await res.json();
                    closeModal('modal-user');
                    loadUsers();
                    if (!userId && (resData.email || payload.email)) {
                        copyUserInvitation(
                            resData.full_name || payload.full_name,
                            resData.role || payload.role,
                            resData.email || payload.email
                        );
                    }
                } else {
                    const data = await res.json();
                    alert('Lỗi: ' + data.error);
                }
            } catch (err) {
                alert('Lỗi kết nối server.');
            }
        });
    }
}

window.loadUsers = loadUsers;
window.showUserModal = showUserModal;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.enableUser = enableUser;
window.revokeUserSessions = revokeUserSessions;
window.permanentDeleteUser = permanentDeleteUser;
window.toggleUserFields = toggleUserFields;
window.initUserForms = initUserForms;

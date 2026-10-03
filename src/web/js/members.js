// ==========================================
// VNV-BOT V2: MEMBERS MANAGEMENT (SỨ GIẢ)
// ==========================================

async function loadMembers() {
    const tbody = document.getElementById('table-members-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Đang tải danh sách Sứ giả...</td></tr>';

    try {
        const res = await fetch('/api/members');
        const list = await res.json();
        tbody.innerHTML = '';

        if (res.status === 401 || (list && list.error === 'SESSION_UNAUTHENTICATED')) {
            tbody.innerHTML = `<tr><td colspan="8" style="text-align:center; padding: 24px; color: #ef4444;">
                <div style="font-weight: 600; margin-bottom: 6px;"><i class="fa-solid fa-triangle-exclamation"></i> Phiên đăng nhập đã hết hạn</div>
                <div style="color: #6b7280; margin-bottom: 12px;">Máy chủ vừa được cập nhật mã nguồn mới. Vui lòng đăng nhập lại để tiếp tục.</div>
                <button class="btn btn-sm btn-outline-primary" onclick="window.location.hash='#login'; window.location.reload();" style="cursor: pointer; padding: 4px 14px; border-radius: 6px;">
                    <i class="fa-solid fa-right-to-bracket"></i> Đăng nhập lại
                </button>
            </td></tr>`;
            return;
        }

        if (!Array.isArray(list) || list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;">Chưa có Sứ giả nào trong danh sách.</td></tr>';
            return;
        }

        list.sort((a, b) => {
            const rDiff = (a.region_id || 0) - (b.region_id || 0);
            if (rDiff !== 0) return rDiff;
            const getRoleOrder = r => r === 'LEADER' ? 1 : (r === 'DEPUTY' ? 2 : 3);
            const roleDiff = getRoleOrder(a.role) - getRoleOrder(b.role);
            if (roleDiff !== 0) return roleDiff;
            return (a.sheet_row_index || 0) - (b.sheet_row_index || 0);
        });

        const user = window.currentUser;
        const isAdmin = user && user.role === 'admin';
        const isCluster = user && user.role === 'cluster_leader';

        list.forEach(m => {
            const statusBadge = m.status === 'Active' 
                ? '<span class="status-badge approved">Active</span>' 
                : '<span class="status-badge rejected">Inactive</span>';

            let roleBadge = '<span class="badge badge-role-member">Sứ giả</span>';
            if (m.role === 'LEADER') {
                roleBadge = '<span class="badge badge-role-leader" style="font-weight:600;"><i class="fa-solid fa-crown" style="margin-right:4px;"></i>Trưởng Vùng</span>';
            } else if (m.role === 'DEPUTY') {
                roleBadge = '<span class="badge badge-role-deputy" style="font-weight:600;"><i class="fa-solid fa-medal" style="margin-right:4px;"></i>Phó Vùng</span>';
            }

            // Chỉ hiển thị nút đổi chức vụ nếu là Admin hoặc là Trưởng Cụm quản lý Cụm của Sứ giả này
            const canAssign = isAdmin || (isCluster && (!user.managed_cluster_id || !m.cluster_id || String(user.managed_cluster_id) === String(m.cluster_id)));

            let roleActionBtns = '';
            if (canAssign) {
                if (m.role === 'LEADER') {
                    roleActionBtns = `
                        <button type="button" class="btn btn-warning-outline btn-sm" onclick="handleAssignRole(${m.id}, 'EMISSARY', '${escapeHtml(m.real_name)}')" title="Tắt chức vụ, chuyển về Sứ giả bình thường">
                            <i class="fa-solid fa-user-xmark"></i> Hủy Trưởng
                        </button>
                    `;
                } else if (m.role === 'DEPUTY') {
                    roleActionBtns = `
                        <button type="button" class="btn btn-warning-outline btn-sm" onclick="handleAssignRole(${m.id}, 'EMISSARY', '${escapeHtml(m.real_name)}')" title="Tắt chức vụ, chuyển về Sứ giả bình thường">
                            <i class="fa-solid fa-user-xmark"></i> Hủy Phó
                        </button>
                    `;
                } else {
                    // Đang là Sứ giả bình thường
                    roleActionBtns = `
                        <button type="button" class="btn btn-secondary-outline btn-sm" onclick="handleAssignRole(${m.id}, 'LEADER', '${escapeHtml(m.real_name)}')" title="Bổ nhiệm làm Trưởng Vùng">
                            <i class="fa-solid fa-crown" style="color:#d97706;"></i> Trưởng
                        </button>
                        <button type="button" class="btn btn-secondary-outline btn-sm" onclick="handleAssignRole(${m.id}, 'DEPUTY', '${escapeHtml(m.real_name)}')" title="Bổ nhiệm làm Phó Vùng">
                            <i class="fa-solid fa-medal" style="color:#4f46e5;"></i> Phó
                        </button>
                    `;
                }
            }

            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td><strong>${escapeHtml(m.real_name)}</strong></td>
                <td>${escapeHtml(m.zalo_name)}</td>
                <td>${m.zalo_id ? escapeHtml(m.zalo_id) : '-'}</td>
                <td>${escapeHtml(m.region_name || 'Chưa gán')}</td>
                <td>${escapeHtml(m.cluster_name || '-')}</td>
                <td>${roleBadge}</td>
                <td>${statusBadge}</td>
                <td>
                    <div style="display:flex; gap:4px; align-items:center; flex-wrap:wrap;">
                        ${roleActionBtns}
                        <button type="button" class="btn btn-secondary-outline btn-sm" onclick="editMember(${JSON.stringify(m).replace(/"/g, '&quot;')})" title="Sửa thông tin"><i class="fa-solid fa-pen-to-square"></i></button>
                        <button type="button" class="btn btn-danger-outline btn-sm" onclick="deleteMember(${m.id})" title="Xóa"><i class="fa-solid fa-trash"></i></button>
                    </div>
                </td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:var(--color-rose);">Thất bại khi nạp danh sách Sứ giả.</td></tr>';
    }
}

async function handleAssignRole(memberId, targetRole, memberName) {
    const user = window.currentUser;
    if (!user || user.role === 'region_leader') {
        alert('Tài khoản Trưởng/Phó Vùng không có quyền điều chỉnh chức vụ. Chỉ Quản lý Cụm trực tiếp hoặc Admin mới được phép thao tác.');
        return;
    }

    let confirmMsg = '';
    let title = '';
    let icon = '';
    let isDanger = false;
    let confirmText = 'Xác nhận';

    if (targetRole === 'LEADER') {
        title = '⭐ Bổ Nhiệm Trưởng Vùng';
        icon = '<i class="fa-solid fa-crown" style="color: #f59e0b;"></i>';
        confirmMsg = `Bạn có chắc chắn muốn bổ nhiệm "${memberName}" làm Trưởng Vùng không?\n(Trưởng Vùng hiện tại của vùng này sẽ tự động chuyển về làm Sứ giả)`;
        confirmText = 'Bổ nhiệm Trưởng Vùng';
    } else if (targetRole === 'DEPUTY') {
        title = '🎖️ Bổ Nhiệm Phó Vùng';
        icon = '<i class="fa-solid fa-medal" style="color: #6366f1;"></i>';
        confirmMsg = `Bạn có chắc chắn muốn bổ nhiệm "${memberName}" làm Phó Vùng không?\n(Phó Vùng hiện tại của vùng này sẽ tự động chuyển về làm Sứ giả)`;
        confirmText = 'Bổ nhiệm Phó Vùng';
    } else {
        title = '⚠️ Tắt Chức Vụ / Hủy Bổ Nhiệm';
        icon = '<i class="fa-solid fa-user-xmark" style="color: #ef4444;"></i>';
        isDanger = true;
        confirmMsg = `Bạn có chắc chắn muốn TẮT CHỨC VỤ của "${memberName}" và chuyển về làm Sứ giả bình thường không?`;
        confirmText = 'Xác nhận tắt chức vụ';
    }

    const ok = await showConfirmModal(confirmMsg, { title, icon, isDanger, confirmText });
    if (!ok) return;

    try {
        const res = await fetch(`/api/members/${memberId}/assign-role`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: targetRole })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            if (typeof window.showToast === 'function') {
                window.showToast('✅ ' + data.message);
            } else {
                alert(data.message);
            }
            await loadMembers();
        } else {
            alert('Lỗi: ' + (data.error || 'Không thể thực hiện thao tác'));
        }
    } catch (err) {
        alert('Lỗi kết nối: ' + err.message);
    }
}

async function showMemberModal() {
    const modal = document.getElementById('modal-member');
    if (modal) modal.classList.add('active');
    document.getElementById('modal-member-title').innerText = 'Thêm Sứ Giả Mới';
    document.getElementById('edit-member-id').value = '';
    document.getElementById('form-member').reset();
    const selectRole = document.getElementById('select-member-role');
    if (selectRole) {
        selectRole.value = 'EMISSARY';
        const user = window.currentUser;
        const canEditRole = user && (user.role === 'admin' || user.role === 'cluster_leader');
        selectRole.disabled = !canEditRole;
        selectRole.title = canEditRole ? '' : 'Chỉ Quản lý Cụm hoặc Admin mới có quyền gán chức vụ Trưởng/Phó Vùng.';
    }
    
    const selRegion = document.getElementById('select-member-region');
    if (selRegion) {
        selRegion.innerHTML = '<option value="">-- Chọn Vùng --</option>';
        try {
            const res = await fetch('/api/regions');
            const regions = await res.json();
            if (Array.isArray(regions)) {
                regions.forEach(r => {
                    selRegion.innerHTML += `<option value="${r.id}">${escapeHtml(r.region_name)} (${escapeHtml(r.cluster_name || 'Chưa thuộc cụm')})</option>`;
                });
            }
            if (window.currentUser && window.currentUser.role === 'region_leader' && window.currentUser.managed_region_id) {
                selRegion.value = String(window.currentUser.managed_region_id);
            }
        } catch (err) {}
    }
}

async function editMember(member) {
    await showMemberModal();
    document.getElementById('modal-member-title').innerText = 'Cập Nhật Sứ Giả';
    document.getElementById('edit-member-id').value = member.id;
    document.getElementById('input-member-fullname').value = member.real_name;
    document.getElementById('input-member-zaloname').value = member.zalo_name;
    document.getElementById('input-member-zaloid').value = member.zalo_id || '';
    document.getElementById('select-member-region').value = member.region_id || '';
    const selectRole = document.getElementById('select-member-role');
    if (selectRole) {
        selectRole.value = member.role || 'EMISSARY';
        const user = window.currentUser;
        const canEditRole = user && (
            user.role === 'admin' || 
            (user.role === 'cluster_leader' && (!user.managed_cluster_id || !member.cluster_id || String(user.managed_cluster_id) === String(member.cluster_id)))
        );
        selectRole.disabled = !canEditRole;
        selectRole.title = canEditRole ? '' : 'Chỉ Quản lý Cụm hoặc Admin mới có quyền thay đổi chức vụ Trưởng/Phó Vùng.';
    }
    document.getElementById('select-member-status').value = member.status || 'Active';
}

async function deleteMember(id) {
    const ok = await showConfirmModal('Bạn có chắc chắn muốn xóa Sứ giả này khỏi danh sách?');
    if (ok) {
        const res = await fetch(`/api/members/${id}`, { method: 'DELETE' });
        if (res.ok) loadMembers();
    }
}

function initMemberForms() {
    const formMember = document.getElementById('form-member');
    if (formMember) {
        formMember.addEventListener('submit', async (e) => {
            e.preventDefault();
            const memberId = document.getElementById('edit-member-id').value;
            const selectRole = document.getElementById('select-member-role');
            const payload = {
                real_name: document.getElementById('input-member-fullname').value,
                zalo_name: document.getElementById('input-member-zaloname').value,
                zalo_id: document.getElementById('input-member-zaloid').value,
                region_id: document.getElementById('select-member-region').value,
                role: selectRole ? selectRole.value : 'EMISSARY',
                status: document.getElementById('select-member-status').value
            };
            const method = memberId ? 'PUT' : 'POST';
            const url = memberId ? `/api/members/${memberId}` : '/api/members';

            try {
                const res = await fetch(url, {
                    method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                if (res.ok) {
                    closeModal('modal-member');
                    loadMembers();
                } else {
                    const data = await res.json();
                    alert('Lỗi: ' + (data.error || 'Thao tác thất bại'));
                }
            } catch (err) {
                alert('Lỗi kết nối.');
            }
        });
    }
}


async function handleSyncAllMembersFromSheet() {
    const btn = document.getElementById('btn-members-sync-sheet');
    const originalHtml = btn ? btn.innerHTML : '';

    if (btn) {
        btn.disabled = true;
        btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Đang đồng bộ...';
    }

    try {
        const user = window.currentUser;
        let url = '/api/v2/cluster/sync-all-sheet-members';
        if (user && user.role === 'region_leader' && user.managed_region_id) {
            url = `/api/v2/regions/${user.managed_region_id}/sync-sheet-members`;
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        const data = await res.json();

        if (res.status === 401 || (data && data.error === 'SESSION_UNAUTHENTICATED')) {
            alert('⚠️ Phiên đăng nhập đã hết hạn (do máy chủ vừa khởi động lại để cập nhật tính năng mới).\n\nVui lòng đăng nhập lại để tiếp tục thao tác!');
            window.location.hash = '#login';
            window.location.reload();
            return;
        }

        if (data.success) {
            let msg = data.message;
            if (typeof window.showToast === 'function') {
                window.showToast('🔄 ' + msg);
            } else {
                alert(msg);
            }
            await loadMembers();
        } else {
            alert('Lỗi đồng bộ: ' + (data.error || 'Thất bại'));
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

window.loadMembers = loadMembers;
window.showMemberModal = showMemberModal;
window.editMember = editMember;
window.deleteMember = deleteMember;
window.initMemberForms = initMemberForms;
window.handleSyncAllMembersFromSheet = handleSyncAllMembersFromSheet;
window.handleAssignRole = handleAssignRole;


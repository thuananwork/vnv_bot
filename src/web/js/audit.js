// ==========================================
// VNV-BOT V2: AUDIT LOGS & SYSTEM UTILS
// ==========================================

async function loadAuditLogs() {
    const tbody = document.getElementById('table-audit-body');
    if (!tbody) return;
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Đang tải...</td></tr>';
    
    try {
        const res = await fetch('/api/audit-logs');
        const list = await res.json();
        tbody.innerHTML = '';
        
        if (!Array.isArray(list) || list.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Chưa có nhật ký nào.</td></tr>';
            return;
        }

        list.forEach(l => {
            const tr = document.createElement('tr');
            const targetDisplay = l.target_type ? (l.target_type + (l.target_id ? ':' + l.target_id : '')) : (l.target || '-');
            tr.innerHTML = `
                <td><small style="color:var(--text-muted);">${new Date(l.created_at).toLocaleString()}</small></td>
                <td><strong>${escapeHtml(l.full_name || l.username || 'System')}</strong></td>
                <td><span class="badge" style="background:#f5f3ff; color:#5b21b6; border:1px solid #ddd6fe; font-weight:600;">${escapeHtml(l.action)}</span></td>
                <td><code>${escapeHtml(targetDisplay)}</code></td>
                <td><small style="color:var(--text-secondary);">${escapeHtml(l.details || '-')}</small></td>
                <td><small style="color:var(--text-muted);">${l.ip_address ? escapeHtml(l.ip_address) : '-'}</small></td>
            `;
            tbody.appendChild(tr);
        });
    } catch (err) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color:var(--color-rose);">Lỗi nạp nhật ký audit.</td></tr>';
    }
}

function triggerDbBackup() {
    window.location.href = '/api/system/backup';
}

window.loadAuditLogs = loadAuditLogs;
window.triggerDbBackup = triggerDbBackup;

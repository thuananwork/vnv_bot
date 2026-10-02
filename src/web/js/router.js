// ==========================================
// VNV-BOT V2: CLIENT ROUTER & NAVIGATION
// ==========================================

function initNavigation() {
    document.querySelectorAll('.nav-item').forEach(item => {
        item.addEventListener('click', (e) => {
            e.preventDefault();
            const targetPanel = item.getAttribute('data-target');
            switchPanel(targetPanel, true);
        });
    });

    window.addEventListener('popstate', () => {
        navigateFromHash();
    });

    window.addEventListener('hashchange', () => {
        navigateFromHash();
    });
}

function getPanelFromHash() {
    const hash = window.location.hash.replace('#', '').trim();
    const user = window.currentUser;

    // Nếu hash là login hoặc rỗng, trả về panel mặc định theo vai trò
    if (!hash || hash === 'login') {
        return (user && user.role === 'region_leader') ? 'panel-region-workspace' : 'panel-dashboard';
    }

    // Nếu là Trưởng Vùng: được xem Điều Hành Vùng, Quản lý Sứ giả, Cài Đặt & Bảng Màu, Hướng Dẫn Sử Dụng
    if (user && user.role === 'region_leader') {
        const allowed = ['region-workspace', 'members', 'settings', 'help'];
        if (!allowed.includes(hash)) {
            return 'panel-region-workspace';
        }
    }

    const panelId = 'panel-' + hash;
    if (document.getElementById(panelId)) {
        return panelId;
    }
    return (user && user.role === 'region_leader') ? 'panel-region-workspace' : 'panel-dashboard';
}

function navigateFromHash() {
    const user = window.currentUser;
    if (!user) return;

    const targetPanel = getPanelFromHash();
    const targetSlug = targetPanel.replace('panel-', '');
    const currentHash = window.location.hash.replace('#', '').trim();

    // Nếu URL đang là login hoặc rỗng hoặc hash không hợp lệ, thay thế URL ngay lập tức
    if (!currentHash || currentHash === 'login' || ('panel-' + currentHash) !== targetPanel) {
        history.replaceState(null, '', '#' + targetSlug);
    }

    switchPanel(targetPanel, false);
}

function switchPanel(panelId, updateHash = true) {
    document.querySelectorAll('.content-panel').forEach(panel => {
        panel.classList.remove('active');
    });

    document.querySelectorAll('.nav-item').forEach(item => {
        if (item.getAttribute('data-target') === panelId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    const activePanel = document.getElementById(panelId);
    if (activePanel) {
        activePanel.classList.add('active');
        
        if (updateHash) {
            const hashSlug = panelId.replace('panel-', '');
            if (window.location.hash !== '#' + hashSlug) {
                history.pushState(null, '', '#' + hashSlug);
            }
        }
        
        if (panelId === 'panel-dashboard' && typeof window.loadDashboard === 'function') {
            window.loadDashboard();
        } else if (panelId === 'panel-settings' && typeof window.loadSettings === 'function') {
            window.loadSettings();
        } else if (panelId === 'panel-region-workspace' && typeof window.loadRegionWorkspaceData === 'function') {
            window.loadRegionWorkspaceData();
        } else if (panelId === 'panel-cluster-workspace') {
            if (typeof window.loadClusterReportPreview === 'function') window.loadClusterReportPreview();
            if (typeof window.loadClusterRegionsProgress === 'function') window.loadClusterRegionsProgress();
        } else if (panelId === 'panel-members' && typeof window.loadMembers === 'function') {
            window.loadMembers();
        } else if (panelId === 'panel-regions' && typeof window.loadRegions === 'function') {
            window.loadRegions();
        } else if (panelId === 'panel-users' && typeof window.loadUsers === 'function') {
            window.loadUsers();
        } else if (panelId === 'panel-audit' && typeof window.loadAuditLogs === 'function') {
            window.loadAuditLogs();
        }
    }
}

window.initNavigation = initNavigation;
window.getPanelFromHash = getPanelFromHash;
window.navigateFromHash = navigateFromHash;
window.switchPanel = switchPanel;

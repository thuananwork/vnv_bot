// ==========================================
// VNV-BOT V2: APPLICATION BOOTSTRAP ENTRY
// ==========================================

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Khởi tạo giao diện sáng / tối
    if (typeof initTheme === 'function') {
        initTheme();
    }

    // 2. Khởi tạo sự kiện xác thực & kiểm tra phiên đăng nhập
    if (typeof initAuthEvents === 'function') {
        initAuthEvents();
    }
    if (typeof checkSession === 'function') {
        await checkSession();
    }

    // 3. Khởi tạo điều hướng SPA Navigation & Router
    if (typeof initNavigation === 'function') {
        initNavigation();
    }

    // 4. Khởi tạo sự kiện các Form CRUD
    if (typeof initUserForms === 'function') {
        initUserForms();
    }
    if (typeof initRegionForms === 'function') {
        initRegionForms();
    }
    if (typeof initMemberForms === 'function') {
        initMemberForms();
    }

    // 5. Khởi tạo Bảng Điều Hành Vùng & Cụm 5
    if (typeof initRegionWorkspace === 'function') {
        initRegionWorkspace();
    }
    if (typeof initClusterWorkspace === 'function') {
        initClusterWorkspace();
    }

    // 6. Khởi tạo Dashboard & Cài đặt
    if (typeof initDashboard === 'function') {
        initDashboard();
    }
    if (typeof initSettings === 'function') {
        initSettings();
    }
});

// Điều hướng chuyển bài viết trong Cẩm nang Hướng Dẫn Sử Dụng
window.switchGuideArticle = function(articleId) {
    document.querySelectorAll('.guide-menu-item').forEach(item => {
        if (item.getAttribute('data-article') === articleId) {
            item.classList.add('active');
        } else {
            item.classList.remove('active');
        }
    });

    document.querySelectorAll('.guide-article').forEach(art => {
        if (art.id === articleId) {
            art.classList.add('active');
        } else {
            art.classList.remove('active');
        }
    });
};


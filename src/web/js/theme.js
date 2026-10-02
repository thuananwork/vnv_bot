// ==========================================
// VNV-BOT V2: THEME SYSTEM (LIGHT/DARK MODE)
// ==========================================

function initTheme() {
    const savedTheme = localStorage.getItem('theme') || 'light';
    setTheme(savedTheme);

    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    const btnLoginThemeToggle = document.getElementById('btn-login-theme-toggle');

    if (btnThemeToggle) {
        btnThemeToggle.addEventListener('click', toggleTheme);
    }
    if (btnLoginThemeToggle) {
        btnLoginThemeToggle.addEventListener('click', toggleTheme);
    }
}

function setTheme(theme) {
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        localStorage.setItem('theme', 'dark');
        updateThemeButtons('dark');
    } else {
        document.documentElement.removeAttribute('data-theme');
        localStorage.setItem('theme', 'light');
        updateThemeButtons('light');
    }
}

function toggleTheme() {
    const currentTheme = localStorage.getItem('theme') || 'light';
    const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
    setTheme(newTheme);
}

function updateThemeButtons(theme) {
    const btnThemeToggle = document.getElementById('btn-theme-toggle');
    const btnLoginThemeToggle = document.getElementById('btn-login-theme-toggle');

    if (btnThemeToggle) {
        if (theme === 'dark') {
            btnThemeToggle.innerHTML = '<i class="fa-solid fa-sun"></i> Giao diện sáng';
        } else {
            btnThemeToggle.innerHTML = '<i class="fa-solid fa-moon"></i> Giao diện tối';
        }
    }

    if (btnLoginThemeToggle) {
        if (theme === 'dark') {
            btnLoginThemeToggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
        } else {
            btnLoginThemeToggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
        }
    }
}

window.initTheme = initTheme;
window.setTheme = setTheme;
window.toggleTheme = toggleTheme;

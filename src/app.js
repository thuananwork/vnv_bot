const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const bcrypt = require('bcryptjs');
const path = require('path');
const db = require('./config/db');
const auth = require('./middlewares/auth');
const audit = require('./services/audit');
const { syncRegionSheet } = require('./services/sheet_sync');

const app = express();

// Middleware cấu hình Express
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Cấu hình Session cục bộ
app.use(session({
    secret: 'vnv-bot-secret-key-2026',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000, // 24 giờ
        httpOnly: true,
        sameSite: 'strict',
        secure: false // Sẽ được cập nhật động bằng middleware dưới nếu chạy HTTPS
    }
}));

// Bổ sung bảo mật cho cookie session khi chạy HTTPS
app.use((req, res, next) => {
    if (req.secure || req.headers['x-forwarded-proto'] === 'https') {
        if (req.session && req.session.cookie) {
            req.session.cookie.secure = true;
        }
    }
    next();
});

// Serve thư mục giao diện Web tĩnh
app.use(express.static(path.join(__dirname, 'web')));

// ==========================================
// 1. API XÁC THỰC (AUTHENTICATION)
// ==========================================

// Đăng nhập
app.post('/api/auth/login', async (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) {
        return res.status(400).json({ error: 'Vui lòng cung cấp username và password.' });
    }

    try {
        const user = await db.get('SELECT * FROM users WHERE username = ?', [username]);
        if (!user) {
            return res.status(401).json({ error: 'Tên đăng nhập không chính xác.' });
        }
        if (user.is_active !== 1) {
            return res.status(403).json({ error: 'Tài khoản đã bị khóa.' });
        }

        const isMatch = bcrypt.compareSync(password, user.password_hash);
        if (!isMatch) {
            return res.status(401).json({ error: 'Mật khẩu không chính xác.' });
        }

        // Tái tạo Session ID chống tấn công Session Fixation
        req.session.regenerate(async (err) => {
            if (err) {
                return res.status(500).json({ error: 'Không thể khởi tạo phiên làm việc mới.' });
            }

            // Lưu thông tin người dùng vào Session mới
            req.session.user = {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                role: user.role
            };

            try {
                // Cập nhật last_login
                await db.run('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id]);
                
                // Ghi audit log đăng nhập thành công
                await audit.logAction(user.id, 'LOGIN', `user:${user.id}`, 'Đăng nhập thành công', req);

                // Lưu session trước khi phản hồi về client
                req.session.save((saveErr) => {
                    if (saveErr) {
                        return res.status(500).json({ error: 'Không thể lưu phiên làm việc.' });
                    }
                    res.json({ message: 'Đăng nhập thành công.', user: req.session.user });
                });
            } catch (dbErr) {
                res.status(500).json({ error: 'Lỗi cơ sở dữ liệu khi đăng nhập.' });
            }
        });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi máy chủ khi đăng nhập.' });
    }
});

// Đăng xuất
app.post('/api/auth/logout', auth.requireAuth, async (req, res) => {
    const user = req.session.user;
    req.session.destroy(async (err) => {
        if (err) {
            return res.status(500).json({ error: 'Không thể đăng xuất.' });
        }
        res.clearCookie('connect.sid');
        res.json({ message: 'Đăng xuất thành công.' });
    });
});

// Thông tin user hiện tại
app.get('/api/auth/me', (req, res) => {
    if (req.session && req.session.user) {
        res.json({ user: req.session.user });
    } else {
        res.json({ user: null });
    }
});

// ==========================================
// 2. API THỐNG KÊ DASHBOARD (SUMMARY)
// ==========================================

app.get('/api/dashboard/summary', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, all: isAll } = req.userScope;
    try {
        let stats = {
            clusters: 0,
            regions: 0,
            members: 0,
            submissions: 0,
            tasks: 0
        };

        if (isAll) {
            // ADMIN
            const clusterCnt = await db.get('SELECT COUNT(*) as count FROM clusters');
            const regionCnt = await db.get('SELECT COUNT(*) as count FROM regions');
            const memberCnt = await db.get('SELECT COUNT(*) as count FROM members');
            const submissionCnt = await db.get('SELECT COUNT(*) as count FROM submissions');
            const taskCnt = await db.get('SELECT COUNT(*) as count FROM tasks');
            
            stats.clusters = clusterCnt.count;
            stats.regions = regionCnt.count;
            stats.members = memberCnt.count;
            stats.submissions = submissionCnt.count;
            stats.tasks = taskCnt.count;
        } else if (role === 'cluster_leader') {
            // TRƯỞNG CỤM
            const cluster = await db.get('SELECT id FROM clusters WHERE manager_id = ?', [managerId]);
            if (cluster) {
                const regionCnt = await db.get('SELECT COUNT(*) as count FROM regions WHERE cluster_id = ?', [cluster.id]);
                const memberCnt = await db.get('SELECT COUNT(*) as count FROM members WHERE region_id IN (SELECT id FROM regions WHERE cluster_id = ?)', [cluster.id]);
                const submissionCnt = await db.get('SELECT COUNT(*) as count FROM submissions WHERE member_id IN (SELECT id FROM members WHERE region_id IN (SELECT id FROM regions WHERE cluster_id = ?))', [cluster.id]);
                const taskCnt = await db.get('SELECT COUNT(DISTINCT task_id) as count FROM submissions WHERE member_id IN (SELECT id FROM members WHERE region_id IN (SELECT id FROM regions WHERE cluster_id = ?))', [cluster.id]);

                stats.clusters = 1;
                stats.regions = regionCnt.count;
                stats.members = memberCnt.count;
                stats.submissions = submissionCnt.count;
                stats.tasks = taskCnt.count;
            }
        } else if (role === 'region_leader') {
            // TRƯỞNG VÙNG
            const region = await db.get('SELECT id FROM regions WHERE manager_id = ?', [managerId]);
            if (region) {
                const memberCnt = await db.get('SELECT COUNT(*) as count FROM members WHERE region_id = ?', [region.id]);
                const submissionCnt = await db.get('SELECT COUNT(*) as count FROM submissions WHERE member_id IN (SELECT id FROM members WHERE region_id = ?)', [region.id]);
                const taskCnt = await db.get('SELECT COUNT(DISTINCT task_id) as count FROM submissions WHERE member_id IN (SELECT id FROM members WHERE region_id = ?)', [region.id]);

                stats.clusters = 0;
                stats.regions = 1;
                stats.members = memberCnt.count;
                stats.submissions = submissionCnt.count;
                stats.tasks = taskCnt.count;
            }
        }
        res.json(stats);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi truy vấn dữ liệu thống kê.' });
    }
});

// ==========================================
// 3. API CRUD QUẢN TRỊ (ADMIN ONLY)
// ==========================================

// --- USERS CRUD ---
app.get('/api/users', auth.requireAuth, auth.isAdmin, async (req, res) => {
    try {
        const usersList = await db.all('SELECT id, username, full_name, zalo_id, role, is_active, last_login, created_at FROM users');
        res.json(usersList);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách user.' });
    }
});

app.post('/api/users', auth.requireAuth, auth.isAdmin, async (req, res) => {
    const { username, password, full_name, zalo_id, role } = req.body;
    if (!username || !password || !full_name || !role) {
        return res.status(400).json({ error: 'Thiếu thông tin người dùng bắt buộc.' });
    }

    try {
        const hash = bcrypt.hashSync(password, 10);
        const result = await db.run(
            `INSERT INTO users (username, password_hash, full_name, zalo_id, role) 
             VALUES (?, ?, ?, ?, ?)`,
            [username, hash, full_name, zalo_id || null, role]
        );
        await audit.logAction(req.session.user.id, 'CREATE_USER', `user:${result.id}`, { username, full_name, role }, req);
        res.status(201).json({ message: 'Tạo người dùng thành công.', id: result.id });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Username đã tồn tại.' });
        }
        res.status(500).json({ error: 'Lỗi khi tạo user.' });
    }
});

app.put('/api/users/:id', auth.requireAuth, auth.isAdmin, async (req, res) => {
    const userId = req.params.id;
    const { full_name, zalo_id, role, is_active, password } = req.body;

    try {
        const user = await db.get('SELECT * FROM users WHERE id = ?', [userId]);
        if (!user) {
            return res.status(404).json({ error: 'Không tìm thấy người dùng.' });
        }

        let query = 'UPDATE users SET full_name = ?, zalo_id = ?, role = ?, is_active = ?, updated_at = CURRENT_TIMESTAMP';
        let params = [full_name, zalo_id || null, role, is_active === undefined ? user.is_active : is_active];

        if (password && password.trim() !== '') {
            const hash = bcrypt.hashSync(password, 10);
            query += ', password_hash = ?';
            params.push(hash);
        }

        query += ' WHERE id = ?';
        params.push(userId);

        await db.run(query, params);
        await audit.logAction(req.session.user.id, 'UPDATE_USER', `user:${userId}`, { full_name, role, is_active }, req);
        res.json({ message: 'Cập nhật người dùng thành công.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi cập nhật user.' });
    }
});

app.delete('/api/users/:id', auth.requireAuth, auth.isAdmin, async (req, res) => {
    const userId = req.params.id;
    if (parseInt(userId) === req.session.user.id) {
        return res.status(400).json({ error: 'Bạn không thể tự xóa tài khoản của mình.' });
    }

    try {
        await db.run('DELETE FROM users WHERE id = ?', [userId]);
        await audit.logAction(req.session.user.id, 'DELETE_USER', `user:${userId}`, `Đã xóa user ID ${userId}`, req);
        res.json({ message: 'Xóa người dùng thành công.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi xóa user.' });
    }
});

// --- CLUSTERS CRUD ---
app.get('/api/clusters', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, all: isAll } = req.userScope;
    try {
        let query = `
            SELECT c.*, u.full_name as manager_name 
            FROM clusters c 
            LEFT JOIN users u ON c.manager_id = u.id
        `;
        let params = [];

        if (!isAll) {
            if (role === 'cluster_leader') {
                query += ' WHERE c.manager_id = ?';
                params.push(managerId);
            } else if (role === 'region_leader') {
                query += ' WHERE c.id IN (SELECT cluster_id FROM regions WHERE manager_id = ?)';
                params.push(managerId);
            }
        }

        const clusters = await db.all(query, params);
        res.json(clusters);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách cụm.' });
    }
});

app.post('/api/clusters', auth.requireAuth, auth.isAdmin, async (req, res) => {
    const { cluster_name, manager_id } = req.body;
    if (!cluster_name) {
        return res.status(400).json({ error: 'Tên cụm không được bỏ trống.' });
    }

    try {
        if (manager_id) {
            const mgrUser = await db.get('SELECT role FROM users WHERE id = ?', [manager_id]);
            if (!mgrUser) {
                return res.status(400).json({ error: 'Người quản lý được gán không tồn tại.' });
            }
            if (mgrUser.role !== 'cluster_leader') {
                return res.status(400).json({ error: 'Chỉ có tài khoản vai trò Trưởng Cụm mới được gán quản lý Cụm.' });
            }
        }

        const result = await db.run(
            'INSERT INTO clusters (cluster_name, manager_id) VALUES (?, ?)',
            [cluster_name, manager_id || null]
        );
        await audit.logAction(req.session.user.id, 'CREATE_CLUSTER', `cluster:${result.id}`, { cluster_name, manager_id }, req);
        res.status(201).json({ message: 'Tạo cụm thành công.', id: result.id });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Tên cụm hoặc Trưởng Cụm này đã được gán cho cụm khác.' });
        }
        res.status(500).json({ error: 'Lỗi khi tạo cụm.' });
    }
});

app.put('/api/clusters/:id', auth.requireAuth, auth.isAdmin, async (req, res) => {
    const clusterId = req.params.id;
    const { cluster_name, manager_id } = req.body;

    try {
        if (manager_id) {
            const mgrUser = await db.get('SELECT role FROM users WHERE id = ?', [manager_id]);
            if (!mgrUser) {
                return res.status(400).json({ error: 'Người quản lý được gán không tồn tại.' });
            }
            if (mgrUser.role !== 'cluster_leader') {
                return res.status(400).json({ error: 'Chỉ có tài khoản vai trò Trưởng Cụm mới được gán quản lý Cụm.' });
            }
        }

        await db.run(
            'UPDATE clusters SET cluster_name = ?, manager_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [cluster_name, manager_id || null, clusterId]
        );
        await audit.logAction(req.session.user.id, 'UPDATE_CLUSTER', `cluster:${clusterId}`, { cluster_name, manager_id }, req);
        res.json({ message: 'Cập nhật cụm thành công.' });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            return res.status(400).json({ error: 'Tên cụm hoặc Trưởng Cụm này đã được gán cho cụm khác.' });
        }
        res.status(500).json({ error: 'Lỗi khi cập nhật cụm.' });
    }
});

app.delete('/api/clusters/:id', auth.requireAuth, auth.isAdmin, async (req, res) => {
    const clusterId = req.params.id;
    try {
        await db.run('DELETE FROM clusters WHERE id = ?', [clusterId]);
        await audit.logAction(req.session.user.id, 'DELETE_CLUSTER', `cluster:${clusterId}`, `Đã xóa cụm ID ${clusterId}`, req);
        res.json({ message: 'Xóa cụm thành công.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi xóa cụm.' });
    }
});

// --- REGIONS CRUD ---
app.get('/api/regions', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, all: isAll } = req.userScope;
    try {
        let query = `
            SELECT r.*, c.cluster_name, u.full_name as manager_name 
            FROM regions r 
            LEFT JOIN clusters c ON r.cluster_id = c.id
            LEFT JOIN users u ON r.manager_id = u.id
        `;
        let params = [];

        if (!isAll) {
            if (role === 'cluster_leader') {
                query += ' WHERE r.cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?)';
                params.push(managerId);
            } else if (role === 'region_leader') {
                query += ' WHERE r.manager_id = ?';
                params.push(managerId);
            }
        }

        const regions = await db.all(query, params);
        res.json(regions);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách vùng.' });
    }
});

app.post('/api/regions', auth.requireAuth, auth.isAdmin, async (req, res) => {
    const { region_name, cluster_id, manager_id, zalo_group_id, zalo_group_name, sheet_id, sheet_url, sheet_name } = req.body;
    if (!region_name || !zalo_group_id || !zalo_group_name) {
        return res.status(400).json({ error: 'Thiếu thông tin vùng bắt buộc.' });
    }

    try {
        if (manager_id) {
            const mgrUser = await db.get('SELECT role FROM users WHERE id = ?', [manager_id]);
            if (!mgrUser) {
                return res.status(400).json({ error: 'Người quản lý được gán không tồn tại.' });
            }
            if (mgrUser.role !== 'region_leader') {
                return res.status(400).json({ error: 'Chỉ có tài khoản vai trò Trưởng Vùng mới được gán quản lý Vùng.' });
            }
        }

        const result = await db.run(
            `INSERT INTO regions (region_name, cluster_id, manager_id, zalo_group_id, zalo_group_name, sheet_id, sheet_url, sheet_name) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [region_name, cluster_id || null, manager_id || null, zalo_group_id, zalo_group_name, sheet_id || null, sheet_url || null, sheet_name || null]
        );
        await audit.logAction(req.session.user.id, 'CREATE_REGION', `region:${result.id}`, { region_name, cluster_id, manager_id }, req);
        res.status(201).json({ message: 'Tạo vùng thành công.', id: result.id });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            if (err.message.includes('sheet_id')) {
                return res.status(400).json({ error: 'Google Sheet ID này đã được liên kết với một Vùng khác.' });
            }
            if (err.message.includes('manager_id')) {
                return res.status(400).json({ error: 'Trưởng Vùng này đã được phân công quản lý một Vùng khác.' });
            }
            return res.status(400).json({ error: 'Tên vùng hoặc Zalo Group ID đã tồn tại.' });
        }
        res.status(500).json({ error: 'Lỗi khi tạo vùng.' });
    }
});

app.put('/api/regions/:id', auth.requireAuth, auth.isAdmin, async (req, res) => {
    const regionId = req.params.id;
    const { region_name, cluster_id, manager_id, zalo_group_id, zalo_group_name, status, sheet_id, sheet_url, sheet_name } = req.body;

    try {
        if (manager_id) {
            const mgrUser = await db.get('SELECT role FROM users WHERE id = ?', [manager_id]);
            if (!mgrUser) {
                return res.status(400).json({ error: 'Người quản lý được gán không tồn tại.' });
            }
            if (mgrUser.role !== 'region_leader') {
                return res.status(400).json({ error: 'Chỉ có tài khoản vai trò Trưởng Vùng mới được gán quản lý Vùng.' });
            }
        }

        await db.run(
            `UPDATE regions 
             SET region_name = ?, cluster_id = ?, manager_id = ?, zalo_group_id = ?, zalo_group_name = ?, status = ?, sheet_id = ?, sheet_url = ?, sheet_name = ?, updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [region_name, cluster_id || null, manager_id || null, zalo_group_id, zalo_group_name, status || 'active', sheet_id || null, sheet_url || null, sheet_name || null, regionId]
        );
        await audit.logAction(req.session.user.id, 'UPDATE_REGION', `region:${regionId}`, { region_name, cluster_id, manager_id, status }, req);
        res.json({ message: 'Cập nhật vùng thành công.' });
    } catch (err) {
        if (err.message.includes('UNIQUE constraint failed')) {
            if (err.message.includes('sheet_id')) {
                return res.status(400).json({ error: 'Google Sheet ID này đã được liên kết với một Vùng khác.' });
            }
            if (err.message.includes('manager_id')) {
                return res.status(400).json({ error: 'Trưởng Vùng này đã được phân công quản lý một Vùng khác.' });
            }
            return res.status(400).json({ error: 'Tên vùng hoặc Zalo Group ID đã tồn tại.' });
        }
        res.status(500).json({ error: 'Lỗi khi cập nhật vùng.' });
    }
});

app.delete('/api/regions/:id', auth.requireAuth, auth.isAdmin, async (req, res) => {
    const regionId = req.params.id;
    try {
        await db.run('DELETE FROM regions WHERE id = ?', [regionId]);
        await audit.logAction(req.session.user.id, 'DELETE_REGION', `region:${regionId}`, `Đã xóa vùng ID ${regionId}`, req);
        res.json({ message: 'Xóa vùng thành công.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi xóa vùng.' });
    }
});

// ==========================================
// 4. API NGHIỆP VỤ (TASKS, SUBMISSIONS, REPORTS)
// ==========================================

// Lấy danh sách Tasks
app.get('/api/tasks', auth.requireAuth, async (req, res) => {
    try {
        const tasks = await db.all('SELECT * FROM tasks ORDER BY publish_date DESC');
        res.json(tasks);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách tasks.' });
    }
});

// Lấy danh sách Submissions (Lọc theo Scope)
app.get('/api/submissions', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, all: isAll } = req.userScope;
    try {
        let query = `
            SELECT s.*, m.real_name, m.zalo_name, r.region_name, t.task_code, t.title as task_title 
            FROM submissions s 
            LEFT JOIN members m ON s.member_id = m.id
            LEFT JOIN regions r ON m.region_id = r.id
            LEFT JOIN tasks t ON s.task_id = t.id
        `;
        let params = [];

        if (!isAll) {
            if (role === 'cluster_leader') {
                query += ' WHERE r.cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?)';
                params.push(managerId);
            } else if (role === 'region_leader') {
                query += ' WHERE r.manager_id = ?';
                params.push(managerId);
            }
        }

        query += ' ORDER BY s.submitted_at DESC';
        const submissions = await db.all(query, params);
        res.json(submissions);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách nộp bài.' });
    }
});

// Lấy danh sách Reports (Lọc theo Scope)
app.get('/api/reports', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, all: isAll } = req.userScope;
    try {
        let query = `
            SELECT rep.*, t.task_code, c.cluster_name, r.region_name 
            FROM reports rep 
            LEFT JOIN tasks t ON rep.task_id = t.id
            LEFT JOIN clusters c ON rep.cluster_id = c.id
            LEFT JOIN regions r ON rep.region_id = r.id
        `;
        let params = [];

        if (!isAll) {
            if (role === 'cluster_leader') {
                query += ` WHERE rep.cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?)
                           OR rep.region_id IN (SELECT id FROM regions WHERE cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?))`;
                params.push(managerId, managerId);
            } else if (role === 'region_leader') {
                query += ' WHERE rep.region_id IN (SELECT id FROM regions WHERE manager_id = ?)';
                params.push(managerId);
            }
        }

        query += ' ORDER BY rep.created_at DESC';
        const reports = await db.all(query, params);
        res.json(reports);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách báo cáo.' });
    }
});

// API Kích hoạt đồng bộ báo cáo của Vùng sang Google Sheet tương ứng
app.post('/api/reports/:id/sync-sheet', auth.requireAuth, async (req, res) => {
    const reportId = req.params.id;
    try {
        const report = await db.get(`
            SELECT rep.*, r.sheet_id, r.sheet_name, r.sheet_url, r.cluster_id AS region_cluster_id
            FROM reports rep 
            LEFT JOIN regions r ON rep.region_id = r.id 
            WHERE rep.id = ?
        `, [reportId]);

        if (!report) {
            return res.status(404).json({ error: 'Không tìm thấy báo cáo vùng hợp lệ.' });
        }
        
        // Xác định cluster_id thực tế của báo cáo (dù là báo cáo cụm hay báo cáo vùng)
        const reportClusterId = report.report_type === 'cluster' ? report.cluster_id : report.region_cluster_id;

        // Kiểm tra quyền hạn phạm vi dữ liệu (RBAC) cho người dùng không phải Admin
        if (req.session.user.role !== 'admin') {
            const { role, id: userId } = req.session.user;
            if (role === 'cluster_leader') {
                const managedCluster = await db.get('SELECT id FROM clusters WHERE manager_id = ?', [userId]);
                if (!managedCluster || managedCluster.id !== reportClusterId) {
                    return res.status(403).json({ error: 'Bạn không có quyền đồng bộ báo cáo ngoài cụm quản lý.' });
                }
            } else if (role === 'region_leader') {
                const managedRegion = await db.get('SELECT id FROM regions WHERE manager_id = ?', [userId]);
                if (!managedRegion || managedRegion.id !== report.region_id) {
                    return res.status(403).json({ error: 'Bạn không có quyền đồng bộ báo cáo ngoài vùng quản lý.' });
                }
            }
        }

        let syncSuccess = false;
        if (report.report_type === 'cluster') {
            const childRegions = await db.all('SELECT id, sheet_id, sheet_name FROM regions WHERE cluster_id = ? AND sheet_id IS NOT NULL', [report.cluster_id]);
            if (childRegions.length === 0) {
                return res.status(400).json({ error: 'Không có vùng nào thuộc cụm này được cấu hình Google Sheet.' });
            }
            
            console.log(`[SHEET SYNC] Đang đồng bộ báo cáo cụm ID ${reportId} sang Google Sheets của ${childRegions.length} vùng...`);
            let allSync = true;
            for (const r of childRegions) {
                const ok = await syncRegionSheet(r.id, report.task_id);
                if (!ok) allSync = false;
            }
            syncSuccess = allSync;
        } else {
            if (!report.sheet_id) {
                return res.status(400).json({ error: 'Vùng này chưa được cấu hình Google Sheet.' });
            }
            console.log(`[SHEET SYNC] Đang đồng bộ báo cáo ID ${reportId} sang Google Sheet "${report.sheet_name}" (ID: ${report.sheet_id})...`);
            syncSuccess = await syncRegionSheet(report.region_id, report.task_id);
        }
        
        if (!syncSuccess) {
            return res.status(500).json({ error: 'Đồng bộ Google Sheet thất bại. Vui lòng kiểm tra lại cấu hình hoặc log.' });
        }
        
        await db.run('UPDATE reports SET sent_at = CURRENT_TIMESTAMP WHERE id = ?', [reportId]);
        await audit.logAction(req.session.user.id, 'SYNC_SHEET', `report:${reportId}`, `Đồng bộ Sheet thành công cho báo cáo ID ${reportId}`, req);

        const targetName = report.report_type === 'cluster' ? `Cụm ID ${report.cluster_id}` : `Google Sheet "${report.sheet_name}"`;
        res.json({ message: `Đã đồng bộ báo cáo thành công sang ${targetName}.` });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi đồng bộ Google Sheet.' });
    }
});

// ==========================================
// 5. API NHẬT KÝ HỆ THỐNG (AUDIT LOGS)
// ==========================================

app.get('/api/audit-logs', auth.requireAuth, auth.isAdmin, async (req, res) => {
    try {
        const logs = await db.all(`
            SELECT a.*, u.username, u.full_name 
            FROM audit_logs a 
            LEFT JOIN users u ON a.user_id = u.id 
            ORDER BY a.created_at DESC 
            LIMIT 200
        `);
        res.json(logs);
    } catch (err) {
        res.status(500).json({ error: 'Lỗi lấy danh sách nhật ký.' });
    }
});

module.exports = app;

const express = require('express');
const router = express.Router();
const db = require('../config/db');
const auth = require('../middlewares/auth');
const audit = require('../services/audit');
const { cleanZaloSenderName } = require('../utils/name_cleaner');

// GET /api/members
router.get('/', auth.requireAuth, auth.checkScope, async (req, res) => {
    const { role, managerId, regionId, all: isAll } = req.userScope;
    try {
        let query = `
            SELECT m.*, r.region_name, c.cluster_name,
                   COALESCE(im.zalo_display_name, '') as zalo_name,
                   COALESCE(im.zalo_user_id, '') as zalo_id
            FROM members m
            LEFT JOIN regions r ON m.region_id = r.id
            LEFT JOIN clusters c ON r.cluster_id = c.id
            LEFT JOIN identity_mappings im ON m.id = im.member_id
        `;
        let params = [];
        if (!isAll) {
            if (role === 'cluster_leader') {
                query += ' WHERE r.cluster_id IN (SELECT id FROM clusters WHERE manager_id = ?)';
                params.push(managerId);
            } else if (role === 'region_leader') {
                query += ' WHERE (m.region_id IN (SELECT id FROM regions WHERE manager_id = ?) OR m.region_id = ?)';
                params.push(managerId, regionId || 0);
            }
        }
        query += ` GROUP BY m.id 
                   ORDER BY 
                       r.id ASC, 
                       CASE 
                           WHEN m.role = 'LEADER' THEN 1 
                           WHEN m.role = 'DEPUTY' THEN 2 
                           ELSE 3 
                       END ASC, 
                       m.sheet_row_index ASC, 
                       m.real_name ASC`;
        const members = await db.all(query, params);
        const cleanedMembers = members.map(m => ({
            ...m,
            zalo_name: cleanZaloSenderName(m.zalo_name)
        }));
        res.json(cleanedMembers);
    } catch (err) {
        console.error('Lỗi lấy danh sách Sứ giả:', err);
        res.status(500).json({ error: 'Lỗi lấy danh sách Sứ giả.' });
    }
});

// POST /api/members
router.post('/', auth.requireAuth, async (req, res) => {
    const { real_name, zalo_name, zalo_id, region_id, role, status } = req.body;
    if (!real_name) {
        return res.status(400).json({ error: 'Họ tên Sứ giả là bắt buộc.' });
    }

    try {
        const targetRegionId = region_id || 25;
        const roleDb = (role === 'Trưởng Vùng' || role === 'LEADER') ? 'LEADER'
                     : (role === 'Phó Vùng' || role === 'DEPUTY') ? 'DEPUTY'
                     : 'EMISSARY';

        // Nếu tạo mới với vai trò Trưởng/Phó Vùng, bắt buộc phải có quyền Admin hoặc Trưởng Cụm quản lý Vùng này
        if (roleDb !== 'EMISSARY') {
            const perm = await verifyRoleChangePermission(req.session && req.session.user, targetRegionId);
            if (!perm.allowed) {
                return res.status(perm.status).json({ error: perm.error });
            }
        }

        const lastRow = await db.get(
            'SELECT MAX(sheet_row_index) as max_row FROM members WHERE region_id = ?',
            [targetRegionId]
        );
        const nextRow = (lastRow && lastRow.max_row) ? lastRow.max_row + 1 : 4;

        const result = await db.run(
            `INSERT INTO members (region_id, sheet_row_index, real_name, role, status)
             VALUES (?, ?, ?, ?, ?)`,
            [targetRegionId, nextRow, real_name.trim(), roleDb, status || 'Active']
        );

        const normReal = real_name.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
        await db.run(
            `INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
             VALUES (?, ?, ?, ?, 1.0)`,
            [result.id, `real_${result.id}`, real_name.trim(), normReal]
        );

        if (zalo_name) {
            const cleanZalo = cleanZaloSenderName(zalo_name);
            const alias = cleanZalo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            await db.run(
                `INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                 VALUES (?, ?, ?, ?, 1.0)`,
                [result.id, zalo_id || `uid_${result.id}`, cleanZalo, alias]
            );
        }

        await audit.logAction(req.session.user.id, 'CREATE_MEMBER', `member:${result.id}`, { real_name, zalo_name, region_id: targetRegionId }, req);
        res.status(201).json({ message: 'Thêm Sứ giả thành công.', id: result.id });
    } catch (err) {
        console.error('Lỗi khi thêm Sứ giả:', err);
        res.status(500).json({ error: 'Lỗi khi thêm Sứ giả: ' + err.message });
    }
});

/**
 * Lấy ID Cụm do người dùng quản lý (dành cho vai trò cluster_leader)
 */
async function getClusterIdForUser(user) {
    if (!user) return null;
    if (user.managed_cluster_id) return user.managed_cluster_id;
    const cluster = await db.get('SELECT id FROM clusters WHERE manager_id = ?', [user.id]);
    if (cluster) return cluster.id;
    const match = (user.username || '').match(/\d+/);
    if (match) {
        const cId = parseInt(match[0], 10);
        const exists = await db.get('SELECT id FROM clusters WHERE id = ?', [cId]);
        if (exists) {
            await db.run('UPDATE clusters SET manager_id = ? WHERE id = ? AND manager_id IS NULL', [user.id, cId]);
            return cId;
        }
    }
    return null;
}

/**
 * Kiểm tra quyền hạn chặt chẽ khi thay đổi vai trò Sứ giả / Trưởng Vùng / Phó Vùng
 * - Tài khoản Vùng (region_leader): 100% BỊ CHẶN (403 Forbidden).
 * - Admin: Toàn quyền trên mọi Vùng và Cụm.
 * - Trưởng Cụm (cluster_leader): Chỉ được phép đổi vai trò trong các Vùng thuộc Cụm mình quản lý.
 *   Nếu thuộc Cụm khác -> 100% BỊ CHẶN (403 Forbidden).
 */
async function verifyRoleChangePermission(user, targetRegionId) {
    if (!user) {
        return { allowed: false, status: 401, error: 'SESSION_UNAUTHENTICATED' };
    }

    // 1. Tài khoản Vùng tuyệt đối KHÔNG có quyền đổi role
    if (user.role === 'region_leader') {
        return {
            allowed: false,
            status: 403,
            error: 'Tài khoản Trưởng/Phó Vùng không có quyền điều chỉnh vai trò Trưởng/Phó Vùng hoặc Sứ giả. Quyền này chỉ thuộc về Quản lý Cụm trực tiếp hoặc Admin.'
        };
    }

    // 2. Admin có toàn quyền
    if (user.role === 'admin') {
        return { allowed: true };
    }

    // 3. Trưởng Cụm: Chỉ được sửa các vùng thuộc Cụm mình quản lý
    if (user.role === 'cluster_leader') {
        const region = await db.get('SELECT id, cluster_id, region_name FROM regions WHERE id = ?', [targetRegionId]);
        if (!region) {
            return { allowed: false, status: 404, error: 'Không tìm thấy Vùng tương ứng.' };
        }

        const userClusterId = await getClusterIdForUser(user);
        if (!userClusterId || region.cluster_id !== userClusterId) {
            return {
                allowed: false,
                status: 403,
                error: `Tài khoản Cụm chỉ có quyền điều chỉnh chức vụ các Vùng thuộc Cụm ${userClusterId || 'mình quản lý'}. Không có quyền điều chỉnh ${region.region_name} (thuộc Cụm ${region.cluster_id || 'khác'}).`
            };
        }

        return { allowed: true };
    }

    return {
        allowed: false,
        status: 403,
        error: 'Bạn không có quyền thực hiện thao tác này.'
    };
}

/**
 * Hàm nghiệp vụ cốt lõi: Bổ nhiệm hoặc Hủy chức vụ Trưởng / Phó Vùng cho Sứ giả
 * Đảm bảo tính toàn vẹn 100% giữa members, regions và users.
 */
async function assignMemberRole(memberId, targetRole, actorId, req = null) {
    const normRole = (targetRole === 'Trưởng Vùng' || targetRole === 'LEADER') ? 'LEADER'
                   : (targetRole === 'Phó Vùng' || targetRole === 'DEPUTY') ? 'DEPUTY'
                   : 'EMISSARY';

    const member = await db.get('SELECT * FROM members WHERE id = ?', [memberId]);
    if (!member) {
        throw new Error('Không tìm thấy Sứ giả với ID ' + memberId);
    }

    if (normRole !== 'EMISSARY' && member.status === 'Inactive') {
        throw new Error('Không thể bổ nhiệm Sứ giả đang ở trạng thái Inactive làm Trưởng Vùng hoặc Phó Vùng.');
    }

    if (!member.region_id) {
        throw new Error('Sứ giả chưa được chỉ định Vùng hoạt động.');
    }

    const regionId = member.region_id;
    const realName = member.real_name;

    if (normRole === 'LEADER') {
        if (member.role === 'LEADER') {
            return { member, message: `${realName} hiện đã là Trưởng Vùng.` };
        }

        // 1. Nếu trước đó đang là Phó Vùng, thu hồi chức vụ Phó Vùng cũ
        if (member.role === 'DEPUTY') {
            await db.run(
                'UPDATE regions SET deputy_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deputy_name = ?',
                [regionId, realName]
            );
            await db.run(
                'UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
                [`Phó Vùng ${regionId}`, `phovung${regionId}`]
            );
        }

        // 2. Chuyển Trưởng Vùng hiện tại của Vùng này về làm Sứ giả bình thường
        await db.run(
            "UPDATE members SET role = 'EMISSARY', updated_at = CURRENT_TIMESTAMP WHERE region_id = ? AND role = 'LEADER' AND id != ?",
            [regionId, member.id]
        );

        // 3. Bổ nhiệm Sứ giả này làm Trưởng Vùng
        await db.run(
            "UPDATE members SET role = 'LEADER', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [member.id]
        );

        // 4. Đồng bộ tên vào bảng regions
        await db.run(
            'UPDATE regions SET leader_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [realName, regionId]
        );

        // 5. Đồng bộ tên vào tài khoản đăng nhập truongvung{R}
        await db.run(
            'UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
            [realName, `truongvung${regionId}`]
        );

        if (actorId) {
            await audit.logAction(actorId, 'ASSIGN_ROLE', `member:${member.id}`, {
                action: 'PROMOTE_LEADER',
                real_name: realName,
                region_id: regionId
            }, req);
        }

        return { member, message: `Đã bổ nhiệm ${realName} làm Trưởng Vùng ${regionId} thành công.` };

    } else if (normRole === 'DEPUTY') {
        if (member.role === 'DEPUTY') {
            return { member, message: `${realName} hiện đã là Phó Vùng.` };
        }

        // 1. Nếu trước đó đang là Trưởng Vùng, thu hồi chức Trưởng Vùng cũ
        if (member.role === 'LEADER') {
            await db.run(
                'UPDATE regions SET leader_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND leader_name = ?',
                [`Trưởng Vùng ${regionId}`, regionId, realName]
            );
            await db.run(
                'UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
                [`Trưởng Vùng ${regionId}`, `truongvung${regionId}`]
            );
        }

        // 2. Chuyển Phó Vùng hiện tại của Vùng này về làm Sứ giả bình thường
        await db.run(
            "UPDATE members SET role = 'EMISSARY', updated_at = CURRENT_TIMESTAMP WHERE region_id = ? AND role = 'DEPUTY' AND id != ?",
            [regionId, member.id]
        );

        // 3. Bổ nhiệm Sứ giả này làm Phó Vùng
        await db.run(
            "UPDATE members SET role = 'DEPUTY', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [member.id]
        );

        // 4. Đồng bộ tên vào bảng regions
        await db.run(
            'UPDATE regions SET deputy_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
            [realName, regionId]
        );

        // 5. Đồng bộ tên vào tài khoản đăng nhập phovung{R}
        await db.run(
            'UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
            [realName, `phovung${regionId}`]
        );

        if (actorId) {
            await audit.logAction(actorId, 'ASSIGN_ROLE', `member:${member.id}`, {
                action: 'PROMOTE_DEPUTY',
                real_name: realName,
                region_id: regionId
            }, req);
        }

        return { member, message: `Đã bổ nhiệm ${realName} làm Phó Vùng ${regionId} thành công.` };

    } else {
        // Tắt chức vụ / Hủy bổ nhiệm -> Trở về làm Sứ giả bình thường (EMISSARY)
        const previousRole = member.role;

        await db.run(
            "UPDATE members SET role = 'EMISSARY', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            [member.id]
        );

        if (previousRole === 'LEADER') {
            await db.run(
                'UPDATE regions SET leader_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND leader_name = ?',
                [`Trưởng Vùng ${regionId}`, regionId, realName]
            );
            await db.run(
                'UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
                [`Trưởng Vùng ${regionId}`, `truongvung${regionId}`]
            );
        } else if (previousRole === 'DEPUTY') {
            await db.run(
                'UPDATE regions SET deputy_name = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND deputy_name = ?',
                [regionId, realName]
            );
            await db.run(
                'UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?',
                [`Phó Vùng ${regionId}`, `phovung${regionId}`]
            );
        }

        if (actorId) {
            await audit.logAction(actorId, 'REVOKE_ROLE', `member:${member.id}`, {
                action: 'DEMOTE_EMISSARY',
                previous_role: previousRole,
                real_name: realName,
                region_id: regionId
            }, req);
        }

        return { member, message: `Đã hủy chức vụ của ${realName}, chuyển về Sứ giả thành công.` };
    }
}

// POST /api/members/:id/assign-role (Chỉ Admin hoặc Trưởng Cụm trực tiếp quản lý mới được gán hoặc hủy chức vụ)
router.post('/:id/assign-role', auth.requireAuth, async (req, res) => {
    const memberId = req.params.id;
    const { role } = req.body;

    if (!role) {
        return res.status(400).json({ error: 'Vui lòng cung cấp vai trò cần gán (LEADER, DEPUTY hoặc EMISSARY).' });
    }

    try {
        const user = req.session && req.session.user ? req.session.user : null;
        if (!user) {
            return res.status(401).json({ error: 'SESSION_UNAUTHENTICATED' });
        }

        const member = await db.get('SELECT * FROM members WHERE id = ?', [memberId]);
        if (!member) {
            return res.status(404).json({ error: 'Không tìm thấy Sứ giả.' });
        }

        // Kiểm tra quyền hạn: region_leader bị cấm 100%, cluster_leader chỉ trong cụm mình, admin toàn quyền
        const perm = await verifyRoleChangePermission(user, member.region_id);
        if (!perm.allowed) {
            return res.status(perm.status).json({ error: perm.error });
        }

        const actorId = user.id;
        const result = await assignMemberRole(memberId, role, actorId, req);
        res.json({ success: true, message: result.message });
    } catch (err) {
        console.error('Lỗi khi phân vai trò Sứ giả:', err);
        res.status(400).json({ error: err.message || 'Lỗi khi phân vai trò Sứ giả.' });
    }
});

// PUT /api/members/:id
router.put('/:id', auth.requireAuth, async (req, res) => {
    const memberId = req.params.id;
    const { real_name, zalo_name, zalo_id, region_id, role, status } = req.body;
    try {
        const existing = await db.get('SELECT * FROM members WHERE id = ?', [memberId]);
        if (!existing) {
            return res.status(404).json({ error: 'Không tìm thấy Sứ giả.' });
        }

        const actorId = req.session && req.session.user ? req.session.user.id : 1;

        // 1. Cập nhật vai trò nếu có thay đổi và có quyền admin/cluster_leader của cụm này
        if (role !== undefined && role !== null) {
            const roleDb = (role === 'Trưởng Vùng' || role === 'LEADER') ? 'LEADER'
                         : (role === 'Phó Vùng' || role === 'DEPUTY') ? 'DEPUTY'
                         : 'EMISSARY';

            if (roleDb !== existing.role) {
                const perm = await verifyRoleChangePermission(req.session && req.session.user, existing.region_id);
                if (!perm.allowed) {
                    return res.status(perm.status).json({ error: perm.error });
                }
                await assignMemberRole(memberId, roleDb, actorId, req);
            }
        }

        // 2. Cập nhật thông tin cơ bản
        const newRealName = real_name ? real_name.trim() : existing.real_name;
        const newRegionId = region_id || existing.region_id;
        const newStatus = status || existing.status;

        // Nếu sứ giả bị chuyển sang Inactive trong khi đang là Trưởng/Phó Vùng -> tự động hạ chức
        if (newStatus === 'Inactive' && existing.role !== 'EMISSARY') {
            await assignMemberRole(memberId, 'EMISSARY', actorId, req);
        }

        // Nếu đổi tên thật của Trưởng/Phó Vùng -> đồng bộ vào regions và users
        if (real_name && real_name.trim() !== existing.real_name) {
            if (existing.role === 'LEADER') {
                await db.run('UPDATE regions SET leader_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newRealName, newRegionId]);
                await db.run('UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?', [newRealName, `truongvung${newRegionId}`]);
            } else if (existing.role === 'DEPUTY') {
                await db.run('UPDATE regions SET deputy_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [newRealName, newRegionId]);
                await db.run('UPDATE users SET full_name = ?, updated_at = CURRENT_TIMESTAMP WHERE username = ?', [newRealName, `phovung${newRegionId}`]);
            }
        }

        await db.run(
            `UPDATE members 
             SET real_name = ?,
                 region_id = ?,
                 status = ?,
                 updated_at = CURRENT_TIMESTAMP 
             WHERE id = ?`,
            [newRealName, newRegionId, newStatus, memberId]
        );

        if (zalo_name) {
            const cleanZalo = cleanZaloSenderName(zalo_name);
            const alias = cleanZalo.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
            const existingMapping = await db.get('SELECT id FROM identity_mappings WHERE member_id = ?', [memberId]);
            if (existingMapping) {
                await db.run(
                    `UPDATE identity_mappings 
                     SET zalo_display_name = ?, normalized_alias = ?, zalo_user_id = COALESCE(?, zalo_user_id), updated_at = CURRENT_TIMESTAMP 
                     WHERE member_id = ?`,
                    [cleanZalo, alias, zalo_id || null, memberId]
                );
            } else {
                await db.run(
                    `INSERT INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
                     VALUES (?, ?, ?, ?, 1.0)`,
                    [memberId, zalo_id || `uid_${memberId}`, cleanZalo, alias]
                );
            }
        }

        await audit.logAction(actorId, 'UPDATE_MEMBER', `member:${memberId}`, { real_name: newRealName, zalo_name, region_id: newRegionId, status: newStatus }, req);
        res.json({ message: 'Cập nhật Sứ giả thành công.' });
    } catch (err) {
        console.error('Lỗi khi cập nhật Sứ giả:', err);
        res.status(400).json({ error: 'Lỗi khi cập nhật Sứ giả: ' + err.message });
    }
});

// DELETE /api/members/:id
router.delete('/:id', auth.requireAuth, async (req, res) => {
    const memberId = req.params.id;
    try {
        const member = await db.get('SELECT * FROM members WHERE id = ?', [memberId]);
        if (member && member.role !== 'EMISSARY') {
            // Hủy chức vụ trước khi xóa để không bỏ sót liên kết regions
            const actorId = req.session && req.session.user ? req.session.user.id : 1;
            await assignMemberRole(memberId, 'EMISSARY', actorId, req);
        }
        await db.run('DELETE FROM members WHERE id = ?', [memberId]);
        await audit.logAction(req.session && req.session.user ? req.session.user.id : 1, 'DELETE_MEMBER', `member:${memberId}`, `Đã xóa Sứ giả ID ${memberId}`, req);
        res.json({ message: 'Xóa Sứ giả thành công.' });
    } catch (err) {
        res.status(500).json({ error: 'Lỗi khi xóa Sứ giả.' });
    }
});

router.assignMemberRole = assignMemberRole;

module.exports = router;



-- ============================================================================
-- VNV-BOT V2: SEED DATA (CỤM 5 & 7 VÙNG 25-31 DỰA TRÊN GOOGLE SHEET THỰC TẾ)
-- ============================================================================

-- 1. Seed Cụm 5
INSERT OR REPLACE INTO clusters (id, cluster_name, leader_name) 
VALUES (5, 'Cụm 5', 'Nguyễn Thuận An');

-- 2. Seed 7 Vùng (Vùng 25 - Vùng 31)
INSERT OR REPLACE INTO regions (id, region_name, cluster_id, zalo_group_id, zalo_group_name, leader_name, deputy_name, manager_id, sheet_id, sheet_name, sheet_url, task_start_time, task_end_time, report_start_time, report_end_time)
VALUES 
(25, 'SỨ GIẢ VÙNG 25', 5, 'SỨ GIẢ VÙNG 25', 'SỨ GIẢ VÙNG 25', 'Nguyễn Ngọc Bảo Trâm', 'Nguyễn Trần Yến Nhi', 10, '1OO1Tf_ljdM5aw36aGbvqXb2OqWVVw0qN4kyu-b1SN4A', 'T9/26', 'https://docs.google.com/spreadsheets/d/1OO1Tf_ljdM5aw36aGbvqXb2OqWVVw0qN4kyu-b1SN4A/edit?usp=sharing', '10:00', '15:00', '21:00', '22:30'),
(26, 'SỨ GIẢ VÙNG 26', 5, 'SỨ GIẢ VÙNG 26', 'SỨ GIẢ VÙNG 26', 'Trần Hoàng Vũ', 'Mai Thị Hồng Lý', 9, '1mFVgxltnPa5CBBDDzzfDSAlS_lhGxniL4hKvnvdvLPE', 'T9/26', 'https://docs.google.com/spreadsheets/d/1mFVgxltnPa5CBBDDzzfDSAlS_lhGxniL4hKvnvdvLPE', '10:00', '15:00', '21:00', '22:30'),
(27, 'SỨ GIẢ VÙNG 27', 5, 'SỨ GIẢ VÙNG 27', 'SỨ GIẢ VÙNG 27', 'Phạm Quang Đại', 'Nguyễn Thị Thanh Trà', 3, '1o36kM3Z68ZqAId7YxfC4Nnoq8RRO-xhQSls-lNXfgds', 'T9/26', 'https://docs.google.com/spreadsheets/d/1o36kM3Z68ZqAId7YxfC4Nnoq8RRO-xhQSls-lNXfgds', '10:00', '15:00', '21:00', '22:30'),
(28, 'SỨ GIẢ VÙNG 28', 5, 'SỨ GIẢ VÙNG 28', 'SỨ GIẢ VÙNG 28', 'Trưởng Vùng 28', 'Trương Nhật My', 8, '15mwyQvcP-gm1for2Djq5VEnE2TGJImbXaJvkN2TXvpw', 'T9/26', 'https://docs.google.com/spreadsheets/d/15mwyQvcP-gm1for2Djq5VEnE2TGJImbXaJvkN2TXvpw', '10:00', '15:00', '21:00', '22:30'),
(29, 'SỨ GIẢ VÙNG 29', 5, 'SỨ GIẢ VÙNG 29', 'SỨ GIẢ VÙNG 29', 'Vũ Thanh Hiền', 'Lê Kim Chi', 5, '10QqeK08y9jkgRZNWdzTN4iN0iBq-p55h9_lONQ0dUUQ', 'T9/26', 'https://docs.google.com/spreadsheets/d/10QqeK08y9jkgRZNWdzTN4iN0iBq-p55h9_lONQ0dUUQ', '10:00', '15:00', '21:00', '22:30'),
(30, 'SỨ GIẢ VÙNG 30', 5, 'SỨ GIẢ VÙNG 30', 'SỨ GIẢ VÙNG 30', 'Lê Thị Thanh Phương', 'Nguyễn Thị Thanh Trúc', 6, '17BBhw8C4Zc5wdGJLuH6doB9pNyZwRJPpfnTWs6IOETI', 'T9/26', 'https://docs.google.com/spreadsheets/d/17BBhw8C4Zc5wdGJLuH6doB9pNyZwRJPpfnTWs6IOETI', '10:00', '15:00', '21:00', '22:30'),
(31, 'SỨ GIẢ VÙNG 31', 5, 'SỨ GIẢ VÙNG 31', 'SỨ GIẢ VÙNG 31', 'Nguyễn Thanh Tân', 'Kiều Minh Trang', 7, '1d4MhYP3z-qE-c6YzPNVmj86RewjVwxhIPniOE5IV6qs', 'T9/26', 'https://docs.google.com/spreadsheets/d/1d4MhYP3z-qE-c6YzPNVmj86RewjVwxhIPniOE5IV6qs', '10:00', '15:00', '21:00', '22:30');

-- 3. Seed Danh bạ Master VÙNG 27 (Khớp 100% dòng thực tế trên Sheet T8/26)
-- Lãnh đạo Vùng 27 (Hàng 4-5)
INSERT OR REPLACE INTO members (id, region_id, sheet_row_index, real_name, role, join_date, status)
VALUES
(2701, 27, 4, 'Phạm Quang Đại', 'LEADER', '24/08/2025', 'Active'),
(2702, 27, 5, 'Nguyễn Thị Thanh Trà', 'DEPUTY', '18/08/2024', 'Active');

-- 17 Sứ giả Vùng 27 (Hàng 8 đến 24)
INSERT OR REPLACE INTO members (id, region_id, sheet_row_index, real_name, role, join_date, status)
VALUES
(2703, 27, 8, 'Nguyễn Thị Phương Trinh', 'EMISSARY', '8/10/2025', 'Active'),
(2704, 27, 9, 'Thàn Thị Quỳnh Nhi', 'EMISSARY', '01/01/2026', 'Active'),
(2705, 27, 10, 'Nguyễn Thị Mỹ Duyên', 'EMISSARY', '16/4/2026', 'Active'),
(2706, 27, 11, 'Phạm Ngọc Phương Chi', 'EMISSARY', '16/4/2026', 'Active'),
(2707, 27, 12, 'Mai Thị Thủy', 'EMISSARY', '16/4/2026', 'Active'),
(2708, 27, 13, 'Nguyễn Lê Tuyết Trinh', 'EMISSARY', '25/4/2026', 'Active'),
(2709, 27, 14, 'Cao Thị Hồng Ngọc', 'EMISSARY', '25/4/2026', 'Active'),
(2710, 27, 15, 'Nguyễn Phúc Minh Lân', 'EMISSARY', '25/4/2026', 'Active'),
(2711, 27, 16, 'Vương Văn Toàn', 'EMISSARY', '25/4/2026', 'Active'),
(2712, 27, 17, 'Nguyễn Thanh Thuý', 'EMISSARY', '16/5/2026', 'Active'),
(2713, 27, 18, 'Hoàng Ngọc Kim Liên', 'EMISSARY', '16/5/2026', 'Active'),
(2714, 27, 19, 'Nguyễn Thị Minh Hằng', 'EMISSARY', '16/5/2026', 'Active'),
(2715, 27, 20, 'Nguyễn Văn Chương', 'EMISSARY', '16/5/2026', 'Active'),
(2716, 27, 21, 'Vũ Thị Yến Ly', 'EMISSARY', '16/5/2026', 'Active'),
(2717, 27, 22, 'Đặng Vũ Thu Hằng', 'EMISSARY', '16/5/2026', 'Active'),
(2718, 27, 23, 'Quách Lê Quỳnh Anh', 'EMISSARY', '16/5/2026', 'Active'),
(2719, 27, 24, 'Hoàng Linh Nhi', 'EMISSARY', '16/5/2026', 'Active');

-- 4. Seed Mapping Danh tính (Identity Mappings) cho Vùng 27
INSERT OR REPLACE INTO identity_mappings (member_id, zalo_user_id, zalo_display_name, normalized_alias, confidence_score)
VALUES
(2701, 'uid_dai_v27', 'Quang Đại', 'pham quang dai', 1.0),
(2702, 'uid_tra_v27', 'Thanh Trà', 'nguyen thi thanh tra', 1.0),
(2703, 'uid_ptrinh_v27', 'Phương Trinh', 'nguyen thi phuong trinh', 1.0),
(2704, 'uid_nhi_v27', 'Quỳnh Nhi', 'than thi quynh nhi', 1.0),
(2705, 'uid_duyen_v27', 'Mỹ Duyên', 'nguyen thi my duyen', 1.0),
(2706, 'uid_chi_v27', 'Phương Chi', 'pham ngoc phuong chi', 1.0),
(2707, 'uid_thuy_v27', 'Mai Thủy', 'mai thi thuy', 1.0),
(2708, 'uid_ttrinh_v27', 'Tuyết Trinh', 'nguyen le tuyet trinh', 1.0),
(2709, 'uid_ngoc_v27', 'Hồng Ngọc', 'cao thi hong ngoc', 1.0),
(2710, 'uid_lan_v27', 'Minh Lân', 'nguyen phuc minh lan', 1.0),
(2711, 'uid_toan_v27', 'Văn Toàn', 'vuong van toan', 1.0),
(2712, 'uid_thuy_nt_v27', 'Thanh Thuý', 'nguyen thanh thuy', 1.0),
(2713, 'uid_lien_v27', 'Kim Liên', 'hoang ngoc kim lien', 1.0),
(2714, 'uid_hang_v27', 'Minh Hằng', 'nguyen thi minh hang', 1.0),
(2715, 'uid_chuong_v27', 'Văn Chương', 'nguyen van chuong', 1.0),
(2716, 'uid_ly_v27', 'Yến Ly', 'vu thi yen ly', 1.0),
(2717, 'uid_hang_dv_v27', 'Thu Hằng', 'dang vu thu hang', 1.0),
(2718, 'uid_anh_v27', 'Quỳnh Anh', 'quach le quynh anh', 1.0),
(2719, 'uid_nhi_hl_v27', 'Linh Nhi', 'hoang linh nhi', 1.0);

-- =====================================================================
-- 002: Hồ sơ chụp ảnh (Giai đoạn A1)
-- Mỗi hồ sơ mô tả CÁCH chụp: camera nào, độ phân giải mong muốn, độ chồng ảnh,
-- tốc độ, góc gimbal, kiểu kích hoạt chụp. Bộ sinh tuyến bay (A2) đọc hồ sơ này để tạo KMZ.
-- =====================================================================

CREATE TABLE IF NOT EXISTS `capture_profiles` (
    `profile_id` INT AUTO_INCREMENT PRIMARY KEY,
    `profile_code` VARCHAR(50) NOT NULL UNIQUE,
    `profile_name` VARCHAR(150) NOT NULL,
    `purpose` ENUM('MAP_2D', 'SOLAR_THERMAL', 'CLOSE_UP', 'DCL_POINT', 'TRAINING', 'CUSTOM') NOT NULL DEFAULT 'CUSTOM',
    `route_kind` ENUM('GRID', 'POINTS') NOT NULL DEFAULT 'GRID' COMMENT 'GRID: quét lưới phủ khu, POINTS: dừng chụp tại điểm',
    `lenses` VARCHAR(30) NOT NULL DEFAULT 'ir,wide' COMMENT 'Camera chụp, phân cách dấu phẩy: ir, wide, zoom',
    `gsd_lens` ENUM('ir', 'wide', 'zoom') NOT NULL DEFAULT 'ir' COMMENT 'Camera dùng để tính độ phân giải và độ chồng ảnh',
    `target_gsd_cm` DOUBLE DEFAULT NULL COMMENT 'Độ phân giải mặt đất mong muốn (cm/điểm ảnh); dùng khi không đặt độ cao',
    `altitude_m` DOUBLE DEFAULT NULL COMMENT 'Độ cao bay so với điểm cất cánh (m); đặt thì bỏ qua target_gsd_cm',
    `front_overlap_pct` DOUBLE NOT NULL DEFAULT 70 COMMENT 'Chồng ảnh dọc tuyến (%)',
    `side_overlap_pct` DOUBLE NOT NULL DEFAULT 30 COMMENT 'Chồng ảnh giữa 2 đường bay (%)',
    `speed_mps` DOUBLE NOT NULL DEFAULT 5 COMMENT 'Tốc độ tối đa (m/s); bộ sinh tuyến có thể giảm để kịp chụp',
    `gimbal_pitch` DOUBLE NOT NULL DEFAULT -90,
    `heading_mode` ENUM('ALONG_ROWS', 'FIXED', 'AUTO') NOT NULL DEFAULT 'ALONG_ROWS' COMMENT 'Hướng đường bay: dọc dãy pin, góc cố định, hoặc theo cạnh dài khu',
    `heading_deg` DOUBLE DEFAULT NULL COMMENT 'Dùng khi heading_mode = FIXED (độ, 0 = Bắc)',
    `trigger_mode` ENUM('DISTANCE', 'TIME', 'POINT') NOT NULL DEFAULT 'DISTANCE' COMMENT 'Chụp mỗi N mét / mỗi N giây / tại điểm',
    `trigger_interval` DOUBLE DEFAULT NULL COMMENT 'N mét hoặc N giây; để trống thì tự tính từ độ chồng ảnh',
    `zoom_factor` DOUBLE DEFAULT NULL COMMENT 'Độ zoom camera zoom (lần)',
    `hover_seconds` INT NOT NULL DEFAULT 0 COMMENT 'Thời gian dừng tại điểm trước khi chụp (s)',
    `photos_per_point` INT NOT NULL DEFAULT 1,
    `margin_m` DOUBLE NOT NULL DEFAULT 5 COMMENT 'Nới rộng ra ngoài ranh giới khu (m) để ảnh phủ kín mép',
    `require_rtk` TINYINT(1) NOT NULL DEFAULT 1,
    `min_irradiance_wm2` INT DEFAULT NULL COMMENT 'Bức xạ tối thiểu khi bay (W/m²), để trống = không yêu cầu',
    `time_window_start` TIME DEFAULT NULL,
    `time_window_end` TIME DEFAULT NULL,
    `notes` TEXT DEFAULT NULL,
    `is_system` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Mẫu mặc định: sửa được, không xóa được',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5 mẫu mặc định (thông số khởi điểm, chốt lại sau khi bay thử).
-- Nguồn tham khảo: hướng dẫn bay M3T của Raptor Maps, IEC TS 62446-3 (bức xạ >= 600 W/m²).
INSERT IGNORE INTO `capture_profiles`
    (`profile_code`, `profile_name`, `purpose`, `route_kind`, `lenses`, `gsd_lens`, `target_gsd_cm`, `front_overlap_pct`, `side_overlap_pct`,
     `speed_mps`, `gimbal_pitch`, `heading_mode`, `trigger_mode`, `hover_seconds`, `photos_per_point`, `margin_m`, `require_rtk`,
     `min_irradiance_wm2`, `time_window_start`, `time_window_end`, `notes`, `is_system`)
VALUES
    ('MAP_2D', 'Quét bản đồ 2D', 'MAP_2D', 'GRID', 'wide', 'wide', 2.0, 80, 70,
     4, -90, 'AUTO', 'DISTANCE', 0, 1, 10, 1,
     NULL, NULL, NULL, 'Ghép ảnh bằng DJI Terra rồi tải lên mục Bản đồ nền. Bay 1-2 lần/năm hoặc khi thay đổi lắp đặt.', 1),
    ('SOLAR_THERMAL', 'Quét nhiệt pin định kỳ', 'SOLAR_THERMAL', 'GRID', 'ir,wide', 'ir', 5.0, 70, 30,
     5, -90, 'ALONG_ROWS', 'DISTANCE', 0, 1, 5, 1,
     600, '10:00:00', '14:00:00', 'Ảnh nhiệt + ảnh thường cùng lúc cho AI Vision. Bay khi nắng, nhà máy đang phát điện.', 1),
    ('CLOSE_UP', 'Chụp cận lỗi', 'CLOSE_UP', 'POINTS', 'wide,zoom', 'wide', NULL, 0, 0,
     5, -90, 'AUTO', 'POINT', 2, 2, 0, 1,
     NULL, NULL, NULL, 'Sinh từ các điểm nghi lỗi sau chuyến quét nhiệt, bay thấp chụp chi tiết.', 1),
    ('DCL_POINT', 'Dao cách ly điểm cố định', 'DCL_POINT', 'POINTS', 'ir,zoom', 'ir', NULL, 0, 0,
     4, -20, 'AUTO', 'POINT', 3, 1, 0, 1,
     NULL, NULL, NULL, 'Bay qua các điểm chụp ảnh đã khai báo của DCL / mối nối, lần nào cũng cùng vị trí và góc.', 1),
    ('TRAINING_RGB', 'Thu dữ liệu huấn luyện (RGB)', 'TRAINING', 'GRID', 'wide', 'wide', 0.8, 70, 60,
     3, -90, 'ALONG_ROWS', 'DISTANCE', 0, 1, 5, 1,
     NULL, NULL, NULL, 'Bay thấp chụp ảnh thường độ phân giải cao cho đội Vision gán nhãn lỗi nhìn thấy được.', 1);

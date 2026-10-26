-- =====================================================================
-- 001: Bản đồ & tài sản (Giai đoạn 1)
-- Chỉ THÊM bảng / cột mới, không xóa dữ liệu có sẵn.
-- =====================================================================

-- 1. Bản đồ nền của nhà máy (ô ảnh XYZ/TMS đã giải nén vào backend/tiles/basemaps/<map_code>)
CREATE TABLE IF NOT EXISTS `base_maps` (
    `map_id` INT AUTO_INCREMENT PRIMARY KEY,
    `plant_id` INT DEFAULT NULL,
    `map_code` VARCHAR(64) NOT NULL UNIQUE COMMENT 'Tên thư mục, chỉ a-z0-9_-',
    `map_name` VARCHAR(150) NOT NULL,
    `scheme` ENUM('xyz', 'tms') NOT NULL DEFAULT 'xyz' COMMENT 'tms: trục Y đảo ngược',
    `tile_ext` VARCHAR(8) NOT NULL DEFAULT 'png',
    `min_zoom` TINYINT DEFAULT NULL,
    `max_zoom` TINYINT DEFAULT NULL,
    `bounds_json` TEXT DEFAULT NULL COMMENT '[[south, west], [north, east]]',
    `tile_count` INT NOT NULL DEFAULT 0,
    `size_bytes` BIGINT NOT NULL DEFAULT 0,
    `is_active` TINYINT(1) NOT NULL DEFAULT 0 COMMENT 'Bản đồ nền mặc định khi mở bản đồ',
    `opacity` DOUBLE NOT NULL DEFAULT 1.0,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`plant_id`) REFERENCES `plants`(`plant_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Đường nối các tấm pin của một chuỗi (vẽ trên bản đồ)
ALTER TABLE `solar_strings`
    ADD COLUMN `line_geojson` LONGTEXT DEFAULT NULL COMMENT 'LineString GeoJSON của chuỗi pin';

-- 3. Tìm tấm pin nhanh theo mã
ALTER TABLE `solar_panels`
    ADD INDEX `idx_panel_serial` (`panel_serial`);

-- 4. Mối nối của dao cách ly (đầu cực, lưỡi dao...)
CREATE TABLE IF NOT EXISTS `dcl_contacts` (
    `contact_id` INT AUTO_INCREMENT PRIMARY KEY,
    `disconnector_id` INT NOT NULL,
    `contact_code` VARCHAR(50) NOT NULL COMMENT 'Mã mối nối, VD: 171-7A-01',
    `contact_name` VARCHAR(150) DEFAULT NULL,
    `position_desc` VARCHAR(150) DEFAULT NULL COMMENT 'Vị trí: đầu cực phía thanh cái, lưỡi dao...',
    `latitude` DOUBLE DEFAULT NULL,
    `longitude` DOUBLE DEFAULT NULL,
    `altitude` DOUBLE DEFAULT NULL,
    `max_allowed_temp` DOUBLE DEFAULT NULL COMMENT 'Để trống: dùng ngưỡng của dao cách ly',
    `sort_order` INT NOT NULL DEFAULT 0,
    `notes` TEXT DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`disconnector_id`) REFERENCES `disconnectors`(`disconnector_id`) ON DELETE CASCADE,
    UNIQUE KEY `uk_dcl_contact` (`disconnector_id`, `contact_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Điểm chụp ảnh gắn với tài sản (dùng để sinh đường bay ở Giai đoạn 3)
CREATE TABLE IF NOT EXISTS `photo_points` (
    `point_id` INT AUTO_INCREMENT PRIMARY KEY,
    `asset_type` ENUM('SOLAR_AREA', 'SOLAR_STRING', 'SOLAR_PANEL', 'BAY', 'DISCONNECTOR', 'DCL_CONTACT') NOT NULL,
    `asset_id` INT NOT NULL,
    `point_name` VARCHAR(150) DEFAULT NULL,
    `latitude` DOUBLE NOT NULL COMMENT 'Vị trí máy bay khi chụp',
    `longitude` DOUBLE NOT NULL,
    `altitude_m` DOUBLE NOT NULL DEFAULT 30 COMMENT 'Độ cao so với điểm cất cánh (m)',
    `gimbal_pitch` DOUBLE NOT NULL DEFAULT -90,
    `gimbal_yaw` DOUBLE DEFAULT NULL,
    `aircraft_heading` DOUBLE DEFAULT NULL,
    `camera_mode` ENUM('WIDE', 'ZOOM', 'IR', 'WIDE_IR') NOT NULL DEFAULT 'WIDE_IR',
    `zoom_factor` DOUBLE DEFAULT NULL,
    `hover_seconds` INT NOT NULL DEFAULT 2,
    `sort_order` INT NOT NULL DEFAULT 0,
    `notes` TEXT DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_point_asset` (`asset_type`, `asset_id`),
    INDEX `idx_point_coords` (`latitude`, `longitude`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Gắn kết quả AI với đúng tài sản
ALTER TABLE `ai_defect_detections`
    ADD COLUMN `panel_id` INT DEFAULT NULL,
    ADD COLUMN `disconnector_id` INT DEFAULT NULL,
    ADD COLUMN `contact_id` INT DEFAULT NULL,
    ADD INDEX `idx_det_panel` (`panel_id`),
    ADD INDEX `idx_det_dcl` (`disconnector_id`),
    ADD INDEX `idx_det_contact` (`contact_id`),
    ADD CONSTRAINT `fk_det_panel` FOREIGN KEY (`panel_id`) REFERENCES `solar_panels`(`panel_id`) ON DELETE SET NULL,
    ADD CONSTRAINT `fk_det_dcl` FOREIGN KEY (`disconnector_id`) REFERENCES `disconnectors`(`disconnector_id`) ON DELETE SET NULL,
    ADD CONSTRAINT `fk_det_contact` FOREIGN KEY (`contact_id`) REFERENCES `dcl_contacts`(`contact_id`) ON DELETE SET NULL;

-- ==========================================================
-- Hệ Thống Quản Lý UAV & Kiểm Tra Năng Lượng Mặt Trời / Dao Cách Ly
-- Database Schema: dji_uav_management (18 Bảng Chuẩn Hoàn Chỉnh)
-- ==========================================================

CREATE DATABASE IF NOT EXISTS `dji_uav_management` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `dji_uav_management`;

SET FOREIGN_KEY_CHECKS = 0;

-- 1. BẢNG NGƯỜI DÙNG (Quản lý tài khoản, phân quyền)
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
    `user_id` INT AUTO_INCREMENT PRIMARY KEY,
    `username` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Tên đăng nhập',
    `password_hash` VARCHAR(255) NOT NULL COMMENT 'Mật khẩu đã băm bcrypt',
    `full_name` VARCHAR(100) NOT NULL COMMENT 'Họ và tên',
    `email` VARCHAR(100) DEFAULT NULL,
    `phone` VARCHAR(20) DEFAULT NULL,
    `role` ENUM('ADMIN', 'ENGINEER', 'OPERATOR', 'VIEWER') NOT NULL DEFAULT 'OPERATOR' COMMENT 'Vai trò người dùng',
    `status` ENUM('ACTIVE', 'INACTIVE', 'LOCKED') NOT NULL DEFAULT 'ACTIVE',
    `last_login` DATETIME DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_users_role` (`role`),
    INDEX `idx_users_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. BẢNG PHIÊN ĐĂNG NHẬP (Lưu token, đa thiết bị PC, iPad, Mobile)
DROP TABLE IF EXISTS `user_sessions`;
CREATE TABLE `user_sessions` (
    `session_id` VARCHAR(128) NOT NULL PRIMARY KEY,
    `user_id` INT NOT NULL,
    `device_type` ENUM('PC', 'IPAD', 'MOBILE', 'UNKNOWN') NOT NULL DEFAULT 'PC',
    `user_agent` TEXT DEFAULT NULL,
    `ip_address` VARCHAR(45) DEFAULT NULL,
    `refresh_token` TEXT NOT NULL,
    `expires_at` DATETIME NOT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`user_id`) REFERENCES `users`(`user_id`) ON DELETE CASCADE,
    INDEX `idx_sessions_user` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. BẢNG NHÀ MÁY ĐIỆN MẶT TRỜI / DỰ ÁN
DROP TABLE IF EXISTS `plants`;
CREATE TABLE `plants` (
    `plant_id` INT AUTO_INCREMENT PRIMARY KEY,
    `plant_code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã dự án (VD: NLMT-LN01)',
    `plant_name` VARCHAR(150) NOT NULL COMMENT 'Tên nhà máy điện mặt trời',
    `capacity_mwp` DOUBLE DEFAULT NULL COMMENT 'Công suất thiết kế (MWp)',
    `center_lat` DOUBLE DEFAULT NULL COMMENT 'Tọa độ trung tâm vĩ độ',
    `center_lng` DOUBLE DEFAULT NULL COMMENT 'Tọa độ trung tâm kinh độ',
    `boundary_geojson` LONGTEXT DEFAULT NULL COMMENT 'Ranh giới nhà máy định dạng GeoJSON',
    `address` VARCHAR(255) DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. BẢNG TRẠM BIẾN ÁP (TBA 110kV/220kV)
DROP TABLE IF EXISTS `substations`;
CREATE TABLE `substations` (
    `substation_id` INT AUTO_INCREMENT PRIMARY KEY,
    `plant_id` INT NOT NULL,
    `substation_code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã trạm (VD: TBA-110KV-LN)',
    `substation_name` VARCHAR(150) NOT NULL COMMENT 'Tên trạm biến áp',
    `voltage_level` VARCHAR(50) NOT NULL DEFAULT '110kV' COMMENT 'Cấp điện áp',
    `center_lat` DOUBLE DEFAULT NULL,
    `center_lng` DOUBLE DEFAULT NULL,
    `boundary_geojson` LONGTEXT DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`plant_id`) REFERENCES `plants`(`plant_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. BẢNG KHU VỰC PIN (Inverter Zone / Block pin)
DROP TABLE IF EXISTS `solar_areas`;
CREATE TABLE `solar_areas` (
    `area_id` INT AUTO_INCREMENT PRIMARY KEY,
    `plant_id` INT NOT NULL,
    `area_code` VARCHAR(50) NOT NULL COMMENT 'Mã khu vực (VD: INV-01, BLOCK-A)',
    `area_name` VARCHAR(150) NOT NULL COMMENT 'Tên khu vực pin',
    `center_lat` DOUBLE DEFAULT NULL,
    `center_lng` DOUBLE DEFAULT NULL,
    `polygon_geojson` LONGTEXT DEFAULT NULL COMMENT 'Đa giác ranh giới khu vực',
    `total_capacity_kwp` DOUBLE DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`plant_id`) REFERENCES `plants`(`plant_id`) ON DELETE CASCADE,
    UNIQUE KEY `uk_plant_area` (`plant_id`, `area_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. BẢNG CHUỖI PIN (String quang điện)
DROP TABLE IF EXISTS `solar_strings`;
CREATE TABLE `solar_strings` (
    `string_id` INT AUTO_INCREMENT PRIMARY KEY,
    `area_id` INT NOT NULL,
    `string_code` VARCHAR(50) NOT NULL COMMENT 'Mã chuỗi pin (VD: STR-01-01)',
    `string_name` VARCHAR(100) DEFAULT NULL,
    `inverter_channel` VARCHAR(50) DEFAULT NULL COMMENT 'Ngõ vào Inverter MPPT',
    `panel_count` INT NOT NULL DEFAULT 24 COMMENT 'Số lượng tấm pin trong chuỗi',
    `rated_power_w` DOUBLE DEFAULT NULL COMMENT 'Công suất định mức chuỗi (W)',
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`area_id`) REFERENCES `solar_areas`(`area_id`) ON DELETE CASCADE,
    UNIQUE KEY `uk_area_string` (`area_id`, `string_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 7. BẢNG TỪNG TẤM PIN QUANG ĐIỆN (Vị trí chính xác từng tấm pin)
DROP TABLE IF EXISTS `solar_panels`;
CREATE TABLE `solar_panels` (
    `panel_id` INT AUTO_INCREMENT PRIMARY KEY,
    `string_id` INT NOT NULL,
    `panel_serial` VARCHAR(100) DEFAULT NULL COMMENT 'Mã Serial tấm pin',
    `panel_index` INT NOT NULL COMMENT 'Vị trí thứ tự trong chuỗi (1, 2, 3...)',
    `latitude` DOUBLE DEFAULT NULL COMMENT 'Tọa độ GPS chính xác',
    `longitude` DOUBLE DEFAULT NULL,
    `altitude` DOUBLE DEFAULT NULL,
    `status` ENUM('NORMAL', 'DEFECT', 'WARNING', 'OFFLINE') NOT NULL DEFAULT 'NORMAL',
    `last_inspected_at` DATETIME DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`string_id`) REFERENCES `solar_strings`(`string_id`) ON DELETE CASCADE,
    INDEX `idx_panel_coords` (`latitude`, `longitude`),
    INDEX `idx_panel_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. BẢNG NGĂN LỘ TRẠM BIẾN ÁP (Ngăn 171, 172, 112...)
DROP TABLE IF EXISTS `substation_bays`;
CREATE TABLE `substation_bays` (
    `bay_id` INT AUTO_INCREMENT PRIMARY KEY,
    `substation_id` INT NOT NULL,
    `bay_code` VARCHAR(50) NOT NULL COMMENT 'Mã ngăn lộ (VD: NL-171, NL-172)',
    `bay_name` VARCHAR(150) NOT NULL COMMENT 'Tên ngăn lộ',
    `description` TEXT DEFAULT NULL,
    `center_lat` DOUBLE DEFAULT NULL,
    `center_lng` DOUBLE DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`substation_id`) REFERENCES `substations`(`substation_id`) ON DELETE CASCADE,
    UNIQUE KEY `uk_substation_bay` (`substation_id`, `bay_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. BẢNG DAO CÁCH LY (DCL - Disconnector)
DROP TABLE IF EXISTS `disconnectors`;
CREATE TABLE `disconnectors` (
    `disconnector_id` INT AUTO_INCREMENT PRIMARY KEY,
    `bay_id` INT NOT NULL,
    `dcl_code` VARCHAR(50) NOT NULL COMMENT 'Mã DCL (VD: 171-1, 171-2, 171-7)',
    `phase` ENUM('A', 'B', 'C', '3PHASE') NOT NULL DEFAULT '3PHASE' COMMENT 'Pha của dao cách ly',
    `dcl_name` VARCHAR(150) NOT NULL,
    `latitude` DOUBLE DEFAULT NULL COMMENT 'Tọa độ GPS chính xác vị trí DCL',
    `longitude` DOUBLE DEFAULT NULL,
    `altitude` DOUBLE DEFAULT NULL,
    `state` ENUM('CLOSED', 'OPEN', 'UNKNOWN') NOT NULL DEFAULT 'CLOSED' COMMENT 'Trạng thái đóng/cắt',
    `max_allowed_temp` DOUBLE NOT NULL DEFAULT 70.0 COMMENT 'Ngưỡng nhiệt cảnh báo tiếp xúc (°C)',
    `last_inspected_temp` DOUBLE DEFAULT NULL COMMENT 'Nhiệt độ đo được gần nhất (°C)',
    `last_inspected_at` DATETIME DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`bay_id`) REFERENCES `substation_bays`(`bay_id`) ON DELETE CASCADE,
    UNIQUE KEY `uk_bay_dcl_phase` (`bay_id`, `dcl_code`, `phase`),
    INDEX `idx_dcl_coords` (`latitude`, `longitude`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 10. BẢNG THIẾT BỊ UAV & ĐIỀU KHIỂN (Mavic 3T, Remote DJI RC, Dock)
DROP TABLE IF EXISTS `uav_devices`;
CREATE TABLE `uav_devices` (
    `device_sn` VARCHAR(64) NOT NULL PRIMARY KEY COMMENT 'Số Serial Number của UAV hoặc RC',
    `device_name` VARCHAR(100) NOT NULL DEFAULT 'DJI Mavic 3T',
    `device_model` VARCHAR(50) NOT NULL DEFAULT 'Mavic 3T',
    `device_type` ENUM('DRONE', 'REMOTE_CONTROLLER', 'DOCK') NOT NULL DEFAULT 'DRONE',
    `status` ENUM('OFFLINE', 'ONLINE', 'IN_FLIGHT') NOT NULL DEFAULT 'OFFLINE',
    `last_latitude` DOUBLE DEFAULT NULL COMMENT 'Vĩ độ GPS gần nhất',
    `last_longitude` DOUBLE DEFAULT NULL COMMENT 'Kinh độ GPS gần nhất',
    `last_altitude` DOUBLE DEFAULT NULL COMMENT 'Độ cao ASL (m)',
    `last_relative_height` DOUBLE DEFAULT NULL COMMENT 'Độ cao AGL (m)',
    `last_battery` INT DEFAULT NULL COMMENT 'Mức pin %',
    `last_speed` DOUBLE DEFAULT NULL COMMENT 'Vận tốc bay (m/s)',
    `last_yaw` DOUBLE DEFAULT NULL COMMENT 'Góc hướng mũi máy bay (độ)',
    `last_pitch` DOUBLE DEFAULT NULL,
    `last_roll` DOUBLE DEFAULT NULL,
    `payload_type` VARCHAR(50) DEFAULT 'THERMAL_RGB' COMMENT 'Camera quang học + nhiệt',
    `livestream_status` ENUM('STOPPED', 'STREAMING', 'ERROR') NOT NULL DEFAULT 'STOPPED',
    `livestream_url` VARCHAR(255) DEFAULT NULL,
    `last_seen` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX `idx_uav_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 11. BẢNG ĐƯỜNG BAY TỰ ĐỘNG (Waylines / KMZ)
DROP TABLE IF EXISTS `flight_routes`;
CREATE TABLE `flight_routes` (
    `route_id` INT AUTO_INCREMENT PRIMARY KEY,
    `route_name` VARCHAR(150) NOT NULL COMMENT 'Tên đường bay',
    `route_type` ENUM('SOLAR_FARM_MAPPING', 'SUBSTATION_DISCONNECTOR', 'TRANSMISSION_LINE', 'CUSTOM') NOT NULL DEFAULT 'SOLAR_FARM_MAPPING',
    `kmz_file_name` VARCHAR(255) NOT NULL COMMENT 'Tên file KMZ lưu trữ',
    `kmz_file_path` VARCHAR(500) NOT NULL COMMENT 'Đường dẫn file KMZ trên MinIO / Server',
    `waypoint_count` INT DEFAULT 0 COMMENT 'Số lượng điểm bay',
    `target_area` VARCHAR(255) DEFAULT NULL COMMENT 'Khu vực áp dụng',
    `target_plant_id` INT DEFAULT NULL,
    `description` TEXT DEFAULT NULL,
    `created_by` INT DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (`target_plant_id`) REFERENCES `plants`(`plant_id`) ON DELETE SET NULL,
    FOREIGN KEY (`created_by`) REFERENCES `users`(`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 12. BẢNG PHIẾU KIỂM TRA (Inspection Tickets)
DROP TABLE IF EXISTS `inspection_tickets`;
CREATE TABLE `inspection_tickets` (
    `ticket_id` INT AUTO_INCREMENT PRIMARY KEY,
    `ticket_code` VARCHAR(50) NOT NULL UNIQUE COMMENT 'Mã phiếu (VD: PKT-PIN-2026-001, PKT-DCL-2026-001)',
    `ticket_name` VARCHAR(255) NOT NULL COMMENT 'Tiêu đề phiếu kiểm tra',
    `inspection_type` ENUM('SOLAR_PANEL', 'DISCONNECTOR', 'OVERALL_SURVEY') NOT NULL,
    `target_facility` VARCHAR(255) NOT NULL COMMENT 'Mô tả khu vực hoặc đối tượng kiểm tra',
    `status` ENUM('PENDING', 'ASSIGNED', 'EXECUTING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    `assigned_route_id` INT DEFAULT NULL,
    `assigned_device_sn` VARCHAR(64) DEFAULT NULL,
    `inspector_id` INT DEFAULT NULL COMMENT 'Người phụ trách kiểm tra',
    `livestream_channel` VARCHAR(100) DEFAULT NULL,
    `start_time` DATETIME DEFAULT NULL,
    `end_time` DATETIME DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `notes` TEXT DEFAULT NULL,
    FOREIGN KEY (`assigned_route_id`) REFERENCES `flight_routes`(`route_id`) ON DELETE SET NULL,
    FOREIGN KEY (`inspector_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
    INDEX `idx_ticket_status` (`status`),
    INDEX `idx_ticket_type` (`inspection_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 13. BẢNG CHI TIẾT PHIẾU KIỂM TRA (Ticket Details - Liên kết từng tấm pin hoặc từng dao cách ly)
DROP TABLE IF EXISTS `ticket_details`;
CREATE TABLE `ticket_details` (
    `detail_id` INT AUTO_INCREMENT PRIMARY KEY,
    `ticket_id` INT NOT NULL,
    `item_type` ENUM('SOLAR_PANEL', 'DISCONNECTOR') NOT NULL,
    `panel_id` INT DEFAULT NULL,
    `disconnector_id` INT DEFAULT NULL,
    `inspection_result` ENUM('PASSED', 'DEFECT_FOUND', 'NOT_INSPECTED') NOT NULL DEFAULT 'NOT_INSPECTED',
    `max_temperature` DOUBLE DEFAULT NULL,
    `notes` TEXT DEFAULT NULL,
    FOREIGN KEY (`ticket_id`) REFERENCES `inspection_tickets`(`ticket_id`) ON DELETE CASCADE,
    FOREIGN KEY (`panel_id`) REFERENCES `solar_panels`(`panel_id`) ON DELETE SET NULL,
    FOREIGN KEY (`disconnector_id`) REFERENCES `disconnectors`(`disconnector_id`) ON DELETE SET NULL,
    INDEX `idx_ticket_detail` (`ticket_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 14. BẢNG KHO ẢNH CHỤP KIỂM TRA (RGB & Thermal R-JPEG)
DROP TABLE IF EXISTS `media_files`;
CREATE TABLE `media_files` (
    `media_id` INT AUTO_INCREMENT PRIMARY KEY,
    `ticket_id` INT DEFAULT NULL,
    `device_sn` VARCHAR(64) NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `file_url` VARCHAR(500) NOT NULL,
    `file_path_local` VARCHAR(500) DEFAULT NULL COMMENT 'Đường dẫn file ảnh trên máy chủ',
    `media_type` ENUM('RGB_PHOTO', 'THERMAL_PHOTO', 'ZOOM_PHOTO', 'VIDEO') NOT NULL DEFAULT 'RGB_PHOTO',
    `latitude` DOUBLE DEFAULT NULL,
    `longitude` DOUBLE DEFAULT NULL,
    `altitude` DOUBLE DEFAULT NULL,
    `gimbal_pitch` DOUBLE DEFAULT NULL,
    `gimbal_yaw` DOUBLE DEFAULT NULL,
    `captured_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `uploaded_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `has_hotspot` TINYINT(1) DEFAULT 0,
    `max_temperature` DOUBLE DEFAULT NULL,
    `notes` TEXT DEFAULT NULL,
    FOREIGN KEY (`ticket_id`) REFERENCES `inspection_tickets`(`ticket_id`) ON DELETE SET NULL,
    INDEX `idx_media_ticket` (`ticket_id`),
    INDEX `idx_media_type` (`media_type`),
    INDEX `idx_media_coords` (`latitude`, `longitude`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 15. BẢNG KẾT QUẢ AI PHÁT HIỆN KHIẾM KHUYẾT (AI Defect Detections)
DROP TABLE IF EXISTS `ai_defect_detections`;
CREATE TABLE `ai_defect_detections` (
    `detection_id` INT AUTO_INCREMENT PRIMARY KEY,
    `media_id` INT NOT NULL,
    `ticket_id` INT DEFAULT NULL,
    `defect_type` ENUM('HOTSPOT_PANEL', 'CRACKED_CELL', 'DIRT_DUST', 'DISCONNECTOR_OVERHEAT', 'CONTACT_DEFECT', 'OTHER') NOT NULL,
    `confidence` DOUBLE NOT NULL DEFAULT 0.0 COMMENT 'Độ tin cậy của mô hình AI (0 - 1.0)',
    `bounding_box_json` JSON DEFAULT NULL COMMENT 'Tọa độ hộp bao [x, y, w, h]',
    `max_temperature` DOUBLE DEFAULT NULL COMMENT 'Nhiệt độ cao nhất đo được tại vị trí lỗi (°C)',
    `delta_temperature` DOUBLE DEFAULT NULL COMMENT 'Chênh lệch nhiệt so với môi trường xung quanh (°C)',
    `crop_image_url` VARCHAR(500) DEFAULT NULL COMMENT 'Đường dẫn ảnh cắt vị trí lỗi',
    `detected_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `verified_by_human` TINYINT(1) DEFAULT 0 COMMENT 'Kỹ sư đã xác thực kết quả hay chưa',
    `verified_by_user_id` INT DEFAULT NULL,
    FOREIGN KEY (`media_id`) REFERENCES `media_files`(`media_id`) ON DELETE CASCADE,
    FOREIGN KEY (`ticket_id`) REFERENCES `inspection_tickets`(`ticket_id`) ON DELETE SET NULL,
    FOREIGN KEY (`verified_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
    INDEX `idx_defect_type` (`defect_type`),
    INDEX `idx_defect_media` (`media_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 16. BẢNG CẢNH BÁO LỖI (Defect Alerts)
DROP TABLE IF EXISTS `defect_alerts`;
CREATE TABLE `defect_alerts` (
    `alert_id` INT AUTO_INCREMENT PRIMARY KEY,
    `detection_id` INT DEFAULT NULL,
    `ticket_id` INT DEFAULT NULL,
    `alert_level` ENUM('INFO', 'WARNING', 'CRITICAL') NOT NULL DEFAULT 'WARNING',
    `title` VARCHAR(255) NOT NULL,
    `message` TEXT NOT NULL,
    `status` ENUM('UNREAD', 'ACKNOWLEDGED', 'RESOLVED', 'DISMISSED') NOT NULL DEFAULT 'UNREAD',
    `handled_by_user_id` INT DEFAULT NULL,
    `handled_at` DATETIME DEFAULT NULL,
    `created_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (`detection_id`) REFERENCES `ai_defect_detections`(`detection_id`) ON DELETE CASCADE,
    FOREIGN KEY (`ticket_id`) REFERENCES `inspection_tickets`(`ticket_id`) ON DELETE SET NULL,
    FOREIGN KEY (`handled_by_user_id`) REFERENCES `users`(`user_id`) ON DELETE SET NULL,
    INDEX `idx_alert_level` (`alert_level`),
    INDEX `idx_alert_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 17. BẢNG NHẬT KÝ TỌA ĐỘ TELEMETRY (Realtime Flight Logs)
DROP TABLE IF EXISTS `telemetry_logs`;
CREATE TABLE `telemetry_logs` (
    `log_id` BIGINT AUTO_INCREMENT PRIMARY KEY,
    `ticket_id` INT DEFAULT NULL,
    `device_sn` VARCHAR(64) NOT NULL,
    `latitude` DOUBLE NOT NULL,
    `longitude` DOUBLE NOT NULL,
    `altitude` DOUBLE NOT NULL COMMENT 'Độ cao ASL (m)',
    `relative_height` DOUBLE NOT NULL COMMENT 'Độ cao AGL (m)',
    `horizontal_speed` DOUBLE DEFAULT 0,
    `vertical_speed` DOUBLE DEFAULT 0,
    `yaw` DOUBLE DEFAULT 0,
    `pitch` DOUBLE DEFAULT 0,
    `roll` DOUBLE DEFAULT 0,
    `battery_percent` INT DEFAULT 100,
    `satellites` INT DEFAULT 0,
    `flight_mode` VARCHAR(50) DEFAULT 'MANUAL',
    `recorded_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    INDEX `idx_dev_time` (`device_sn`, `recorded_at`),
    INDEX `idx_ticket_time` (`ticket_id`, `recorded_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 18. BẢNG CẤU HÌNH HỆ THỐNG (System Settings)
DROP TABLE IF EXISTS `system_settings`;
CREATE TABLE `system_settings` (
    `setting_key` VARCHAR(50) PRIMARY KEY,
    `setting_value` TEXT NOT NULL,
    `description` VARCHAR(255) DEFAULT NULL,
    `updated_at` DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

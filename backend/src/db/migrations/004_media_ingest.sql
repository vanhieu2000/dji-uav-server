-- =====================================================================
-- 004: Nhận ảnh đúng (Giai đoạn A3)
-- Thêm thông tin chụp thật cho media_files và phiên đăng nhập DJI Pilot 2.
-- =====================================================================

ALTER TABLE `media_files`
    ADD COLUMN `lens` ENUM('IR', 'WIDE', 'ZOOM', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN `relative_altitude` DOUBLE DEFAULT NULL COMMENT 'Độ cao so với điểm cất cánh (m)',
    ADD COLUMN `gimbal_roll` DOUBLE DEFAULT NULL,
    ADD COLUMN `flight_yaw` DOUBLE DEFAULT NULL COMMENT 'Hướng mũi máy bay (độ)',
    ADD COLUMN `rtk_flag` INT DEFAULT NULL COMMENT '50 = RTK FIX',
    ADD COLUMN `rtk_std_m` DOUBLE DEFAULT NULL COMMENT 'Sai số chuẩn ngang RTK (m)',
    ADD COLUMN `position_quality` ENUM('HIGH', 'LOW', 'UNKNOWN') NOT NULL DEFAULT 'UNKNOWN',
    ADD COLUMN `min_temperature` DOUBLE DEFAULT NULL,
    ADD COLUMN `avg_temperature` DOUBLE DEFAULT NULL,
    ADD COLUMN `thermal_engine` VARCHAR(40) DEFAULT NULL COMMENT 'Bộ đọc nhiệt đã dùng (DJI TSDK / dự phòng)',
    ADD COLUMN `source` ENUM('CLOUD', 'SD_IMPORT', 'MANUAL', 'DISK_SCAN') NOT NULL DEFAULT 'CLOUD',
    ADD COLUMN `sha256` CHAR(64) DEFAULT NULL COMMENT 'Chống nhận trùng ảnh',
    ADD COLUMN `file_size` BIGINT DEFAULT NULL,
    ADD COLUMN `original_name` VARCHAR(255) DEFAULT NULL,
    ADD COLUMN `flight_id` VARCHAR(64) DEFAULT NULL COMMENT 'Mã chuyến bay DJI (từ upload callback)',
    ADD COLUMN `route_id` INT DEFAULT NULL,
    ADD COLUMN `photo_point_id` INT DEFAULT NULL,
    ADD COLUMN `pilot_session_id` INT DEFAULT NULL,
    ADD COLUMN `meta_json` TEXT DEFAULT NULL COMMENT 'Toàn bộ thông tin chụp đã đọc',
    ADD INDEX `idx_media_sha` (`sha256`),
    ADD INDEX `idx_media_ticket_time` (`ticket_id`, `captured_at`),
    ADD INDEX `idx_media_point` (`photo_point_id`);

CREATE TABLE IF NOT EXISTS `pilot_sessions` (
    `session_id` INT AUTO_INCREMENT PRIMARY KEY,
    `user_id` INT DEFAULT NULL,
    `username` VARCHAR(100) DEFAULT NULL,
    `ticket_id` INT DEFAULT NULL,
    `rc_sn` VARCHAR(64) DEFAULT NULL COMMENT 'Số serial tay điều khiển',
    `aircraft_sn` VARCHAR(64) DEFAULT NULL COMMENT 'Số serial máy bay',
    `started_at` DATETIME DEFAULT CURRENT_TIMESTAMP,
    `ended_at` DATETIME DEFAULT NULL,
    INDEX `idx_session_active` (`ended_at`, `started_at`),
    FOREIGN KEY (`ticket_id`) REFERENCES `inspection_tickets`(`ticket_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

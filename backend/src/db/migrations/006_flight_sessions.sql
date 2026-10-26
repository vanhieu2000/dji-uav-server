-- =====================================================================
-- 006: Chuyến bay & giám sát (Giai đoạn C)
-- =====================================================================

CREATE TABLE IF NOT EXISTS `flight_sessions` (
    `flight_session_id` INT AUTO_INCREMENT PRIMARY KEY,
    `device_sn` VARCHAR(64) NOT NULL,
    `ticket_id` INT DEFAULT NULL,
    `pilot_session_id` INT DEFAULT NULL,
    `started_at` DATETIME NOT NULL,
    `ended_at` DATETIME DEFAULT NULL,
    `end_reason` ENUM('LANDED', 'LOST_LINK', 'SERVER_RESTART') DEFAULT NULL,
    `start_lat` DOUBLE DEFAULT NULL,
    `start_lng` DOUBLE DEFAULT NULL,
    `duration_s` INT DEFAULT NULL,
    `distance_m` DOUBLE DEFAULT NULL,
    `max_relative_height` DOUBLE DEFAULT NULL,
    `battery_start` INT DEFAULT NULL,
    `battery_end` INT DEFAULT NULL,
    `rtk_fix_ratio` DOUBLE DEFAULT NULL COMMENT 'Tỉ lệ thời gian bay có RTK FIX (0–1)',
    `photo_count` INT DEFAULT NULL,
    INDEX `idx_fs_device_time` (`device_sn`, `started_at`),
    INDEX `idx_fs_ticket` (`ticket_id`),
    FOREIGN KEY (`ticket_id`) REFERENCES `inspection_tickets`(`ticket_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE `telemetry_logs`
    ADD COLUMN `flight_session_id` INT DEFAULT NULL,
    ADD COLUMN `rtk_fixed` TINYINT(1) DEFAULT NULL,
    ADD INDEX `idx_tl_flight` (`flight_session_id`, `recorded_at`);

ALTER TABLE `uav_devices`
    ADD COLUMN `gateway_sn` VARCHAR(64) DEFAULT NULL COMMENT 'Tay điều khiển đang ghép',
    ADD COLUMN `rtk_state` VARCHAR(20) DEFAULT NULL COMMENT 'FIX / FLOAT / NONE',
    ADD COLUMN `last_mode_code` INT DEFAULT NULL;

ALTER TABLE `media_files`
    ADD COLUMN `flight_session_id` INT DEFAULT NULL,
    ADD INDEX `idx_media_flight` (`flight_session_id`);

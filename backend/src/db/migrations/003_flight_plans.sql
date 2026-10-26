-- =====================================================================
-- 003: Lưu đường bay sinh từ hồ sơ chụp (Giai đoạn A2)
-- Thêm cột cho bảng flight_routes có sẵn, không xóa dữ liệu.
-- =====================================================================

ALTER TABLE `flight_routes`
    ADD COLUMN `route_uuid` VARCHAR(36) DEFAULT NULL COMMENT 'Mã đường bay cố định gửi cho DJI Pilot 2',
    ADD COLUMN `capture_profile_id` INT DEFAULT NULL,
    ADD COLUMN `route_kind` ENUM('GRID', 'POINTS', 'MANUAL') NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN `area_id` INT DEFAULT NULL COMMENT 'Khu pin (tuyến quét lưới)',
    ADD COLUMN `targets_json` TEXT DEFAULT NULL COMMENT 'Tài sản trên tuyến điểm: [{asset_type, asset_id}]',
    ADD COLUMN `plan_json` LONGTEXT DEFAULT NULL COMMENT 'Hình học + thống kê + đường đi (GeoJSON) để xem lại trên bản đồ',
    ADD COLUMN `kmz_md5` VARCHAR(32) DEFAULT NULL,
    ADD COLUMN `altitude_m` DOUBLE DEFAULT NULL,
    ADD COLUMN `photo_count` INT DEFAULT NULL,
    ADD COLUMN `duration_s` INT DEFAULT NULL,
    ADD UNIQUE KEY `uk_route_uuid` (`route_uuid`),
    ADD INDEX `idx_route_area` (`area_id`),
    ADD CONSTRAINT `fk_route_profile` FOREIGN KEY (`capture_profile_id`) REFERENCES `capture_profiles`(`profile_id`) ON DELETE SET NULL,
    ADD CONSTRAINT `fk_route_area` FOREIGN KEY (`area_id`) REFERENCES `solar_areas`(`area_id`) ON DELETE SET NULL;

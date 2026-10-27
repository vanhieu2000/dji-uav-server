SET NAMES utf8mb4;

-- ==========================================================
-- Dữ Liệu Khởi Tạo Ban Đầu (Seed Data)
-- Database: dji_uav_management
-- ==========================================================

USE `dji_uav_management`;

-- 1. Tài khoản quản trị mặc định (Mật khẩu: admin123)
-- Hash bcrypt của 'admin123': $2a$10$Y1s4u9tL1E9Zz2kUqy4lQ.1rXmQ5m9Yh.cM0wS9zYlqE2D6o5lqVy (hoặc hash chuẩn)
INSERT INTO `users` (`user_id`, `username`, `password_hash`, `full_name`, `email`, `role`, `status`)
VALUES 
(1, 'admin', '$2a$10$vI8aWBnW3fID.ZQ4/zo1G.q1qvzE2F6wZ0ZfD8QGg5yYyO7y2JqKy', 'Quản Trị Viên Hệ Thống', 'admin@uav-solar.vn', 'ADMIN', 'ACTIVE'),
(2, 'engineer_duc', '$2a$10$vI8aWBnW3fID.ZQ4/zo1G.q1qvzE2F6wZ0ZfD8QGg5yYyO7y2JqKy', 'Kỹ Sư Kiểm Tra Nguyễn Văn Đức', 'duc.nv@uav-solar.vn', 'ENGINEER', 'ACTIVE'),
(3, 'operator_dung', '$2a$10$vI8aWBnW3fID.ZQ4/zo1G.q1qvzE2F6wZ0ZfD8QGg5yYyO7y2JqKy', 'Vận Hành Viên Pilot Trần Dũng', 'dung.tt@uav-solar.vn', 'OPERATOR', 'ACTIVE')
ON DUPLICATE KEY UPDATE `full_name` = VALUES(`full_name`);

-- 2. Nhà máy điện mặt trời mẫu
INSERT INTO `plants` (`plant_id`, `plant_code`, `plant_name`, `capacity_mwp`, `center_lat`, `center_lng`, `address`)
VALUES 
(1, 'NLMT-LN01', 'Nhà Máy Điện Mặt Trời Lộc Ninh 1', 50.0, 11.831200, 106.591300, 'Huyện Lộc Ninh, Tỉnh Bình Phước')
ON DUPLICATE KEY UPDATE `plant_name` = VALUES(`plant_name`);

-- 3. Trạm biến áp 110kV mẫu
INSERT INTO `substations` (`substation_id`, `plant_id`, `substation_code`, `substation_name`, `voltage_level`, `center_lat`, `center_lng`)
VALUES 
(1, 1, 'TBA-110KV-LN', 'Trạm Biến Áp 110kV Lộc Ninh', '110kV', 11.832500, 106.592500)
ON DUPLICATE KEY UPDATE `substation_name` = VALUES(`substation_name`);

-- 4. Ngăn lộ trạm biến áp (Ngăn 171, Ngăn 172)
INSERT INTO `substation_bays` (`bay_id`, `substation_id`, `bay_code`, `bay_name`, `center_lat`, `center_lng`)
VALUES 
(1, 1, 'NL-171', 'Ngăn lộ 171 - Xuất tuyến đường dây 110kV', 11.832600, 106.592600),
(2, 1, 'NL-172', 'Ngăn lộ 172 - Máy biến áp chính T1', 11.832400, 106.592400)
ON DUPLICATE KEY UPDATE `bay_name` = VALUES(`bay_name`);

-- 5. Dao cách ly mẫu (DCL 171-1, 171-7 các pha A, B, C)
INSERT INTO `disconnectors` (`bay_id`, `dcl_code`, `phase`, `dcl_name`, `latitude`, `longitude`, `state`, `max_allowed_temp`)
VALUES 
(1, '171-1', 'A', 'Dao cách ly 171-1 Pha A', 11.832620, 106.592610, 'CLOSED', 70.0),
(1, '171-1', 'B', 'Dao cách ly 171-1 Pha B', 11.832622, 106.592620, 'CLOSED', 70.0),
(1, '171-1', 'C', 'Dao cách ly 171-1 Pha C', 11.832624, 106.592630, 'CLOSED', 70.0),
(1, '171-7', 'A', 'Dao cách ly 171-7 Pha A', 11.832650, 106.592615, 'CLOSED', 70.0),
(1, '171-7', 'B', 'Dao cách ly 171-7 Pha B', 11.832652, 106.592625, 'CLOSED', 70.0),
(1, '171-7', 'C', 'Dao cách ly 171-7 Pha C', 11.832654, 106.592635, 'CLOSED', 70.0)
ON DUPLICATE KEY UPDATE `dcl_name` = VALUES(`dcl_name`);

-- 6. Khu vực pin mẫu (Khu vực Inverter 01, Inverter 02)
INSERT INTO `solar_areas` (`area_id`, `plant_id`, `area_code`, `area_name`, `center_lat`, `center_lng`, `total_capacity_kwp`)
VALUES 
(1, 1, 'INV-01', 'Khu Vực Dãy Pin Inverter 01', 11.830500, 106.590500, 2500.0),
(2, 1, 'INV-02', 'Khu Vực Dãy Pin Inverter 02', 11.831500, 106.590500, 2500.0)
ON DUPLICATE KEY UPDATE `area_name` = VALUES(`area_name`);

-- 7. Chuỗi pin mẫu (String 01, 02 thuộc INV-01)
INSERT INTO `solar_strings` (`string_id`, `area_id`, `string_code`, `string_name`, `inverter_channel`, `panel_count`, `rated_power_w`)
VALUES 
(1, 1, 'STR-01-01', 'Chuỗi Pin MPPT 1 - Kênh 1', 'MPPT1-CH1', 24, 12000.0),
(2, 1, 'STR-01-02', 'Chuỗi Pin MPPT 1 - Kênh 2', 'MPPT1-CH2', 24, 12000.0)
ON DUPLICATE KEY UPDATE `string_name` = VALUES(`string_name`);

-- 8. Tấm pin mẫu trong chuỗi STR-01-01
INSERT INTO `solar_panels` (`string_id`, `panel_serial`, `panel_index`, `latitude`, `longitude`, `status`)
VALUES 
(1, 'PANEL-LN-01-001', 1, 11.830510, 106.590510, 'NORMAL'),
(1, 'PANEL-LN-01-002', 2, 11.830512, 106.590514, 'NORMAL'),
(1, 'PANEL-LN-01-003', 3, 11.830514, 106.590518, 'WARNING'),
(1, 'PANEL-LN-01-004', 4, 11.830516, 106.590522, 'NORMAL')
ON DUPLICATE KEY UPDATE `panel_serial` = VALUES(`panel_serial`);

-- 9. Thiết bị UAV mẫu (Mavic 3T và DJI RC Pro Enterprise)
INSERT INTO `uav_devices` (`device_sn`, `device_name`, `device_model`, `device_type`, `status`, `last_battery`)
VALUES 
('1581F5FJC243K00DNRRT', 'DJI Mavic 3 Enterprise Thermal', 'Mavic 3T', 'DRONE', 'ONLINE', 95),
('5YSZM3K0031EYQ', 'Tay Cầm Điều Khiển DJI RC Pro', 'DJI RC', 'REMOTE_CONTROLLER', 'ONLINE', 62)
ON DUPLICATE KEY UPDATE `device_name` = VALUES(`device_name`);

-- 10. Cấu hình hệ thống mặc định
INSERT INTO `system_settings` (`setting_key`, `setting_value`, `description`)
VALUES 
('MAP_MODE', 'AUTO', 'Chế độ bản đồ: AUTO (Tự động phát hiện mạng), ONLINE (Ưu tiên mạng), OFFLINE (Bản đồ nội bộ)'),
('ONLINE_TILE_URL', 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', 'URL máy chủ tile vệ tinh/bản đồ online'),
('OFFLINE_TILE_URL', '/tiles/{z}/{x}/{y}.png', 'Đường dẫn thư mục tile bản đồ offline cục bộ'),
('MAX_TEMP_HOTSPOT_ALERT', '65.0', 'Ngưỡng nhiệt độ cảnh báo điểm phát nhiệt tấm pin (°C)'),
('MAX_TEMP_DCL_ALERT', '70.0', 'Ngưỡng nhiệt độ cảnh báo tiếp xúc quá nhiệt dao cách ly (°C)'),
('AI_DETECTION_ENDPOINT', 'http://ai_service:5000/api/v1/detect', 'URL Endpoint gọi mô hình AI kiểm tra khiếm khuyết'),
('MQTT_BROKER_HOST', 'emqx', 'Host MQTT Broker nội bộ trong Docker'),
('MQTT_BROKER_PORT', '1883', 'Port MQTT Broker')
ON DUPLICATE KEY UPDATE `setting_value` = VALUES(`setting_value`);

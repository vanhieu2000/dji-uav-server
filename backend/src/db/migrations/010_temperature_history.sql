-- G: chỉ lưu số đo từ kết quả thật đã gắn tài sản; không seed nhiệt độ.
CREATE TABLE IF NOT EXISTS temperature_history (
    history_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    history_key CHAR(64) NOT NULL,
    asset_type ENUM('PANEL','DISCONNECTOR','CONTACT') NOT NULL,
    asset_id INT NOT NULL,
    detection_id INT DEFAULT NULL,
    vision_job_id CHAR(36) NOT NULL,
    result_version INT NOT NULL,
    model_version VARCHAR(100) NOT NULL,
    ticket_id INT DEFAULT NULL,
    flight_session_id INT DEFAULT NULL,
    captured_at DATETIME NOT NULL,
    max_temp_c DOUBLE NOT NULL,
    delta_t_c DOUBLE DEFAULT NULL,
    measurement_source VARCHAR(30) NOT NULL DEFAULT 'VISION',
    valid TINYINT(1) NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_temperature_key (history_key),
    INDEX idx_temp_asset_time (asset_type,asset_id,captured_at),
    INDEX idx_temp_ticket (ticket_id),
    INDEX idx_temp_job (vision_job_id),
    FOREIGN KEY (detection_id) REFERENCES ai_defect_detections(detection_id) ON DELETE SET NULL,
    FOREIGN KEY (ticket_id) REFERENCES inspection_tickets(ticket_id) ON DELETE SET NULL,
    FOREIGN KEY (flight_session_id) REFERENCES flight_sessions(flight_session_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE alert_rules ADD COLUMN trend_horizon_days DOUBLE DEFAULT NULL;
CREATE TABLE IF NOT EXISTS asset_alert_rules (
    rule_id INT AUTO_INCREMENT PRIMARY KEY,
    asset_type ENUM('PANEL','DISCONNECTOR','CONTACT') NOT NULL,
    asset_id INT NOT NULL,
    max_temp_c DOUBLE DEFAULT NULL,
    delta_t_c DOUBLE DEFAULT NULL,
    min_confidence DOUBLE NOT NULL DEFAULT 0.8,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    trend_horizon_days DOUBLE DEFAULT NULL,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_asset_rule (asset_type,asset_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE dcl_contacts
    ADD COLUMN last_inspected_temp DOUBLE DEFAULT NULL,
    ADD COLUMN last_inspected_at DATETIME DEFAULT NULL;
ALTER TABLE solar_panels ADD COLUMN last_inspected_temp DOUBLE DEFAULT NULL;
ALTER TABLE defect_alerts
    ADD COLUMN asset_type VARCHAR(20) DEFAULT NULL,
    ADD COLUMN asset_id INT DEFAULT NULL,
    ADD COLUMN alert_kind ENUM('DETECTION','TREND') NOT NULL DEFAULT 'DETECTION',
    ADD COLUMN trend_key CHAR(64) DEFAULT NULL,
    ADD UNIQUE KEY uk_trend_alert (trend_key);
CREATE TABLE IF NOT EXISTS alert_changes (
    change_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    alert_id INT NOT NULL,
    from_status VARCHAR(30) NOT NULL,
    to_status VARCHAR(30) NOT NULL,
    user_id INT DEFAULT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_alert_changes (alert_id,change_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

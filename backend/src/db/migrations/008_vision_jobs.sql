-- D: hàng đợi bền vững, webhook có version/idempotency, không chứa mô hình AI.
CREATE TABLE IF NOT EXISTS vision_jobs (
    job_id CHAR(36) PRIMARY KEY,
    media_id INT NOT NULL,
    input_sha256 CHAR(64) NOT NULL,
    status ENUM('QUEUED','SENDING','DISPATCHED','RETRY_WAIT','SUCCEEDED','FAILED','INVALID') NOT NULL DEFAULT 'QUEUED',
    attempts INT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    lease_until DATETIME DEFAULT NULL,
    last_error VARCHAR(500) DEFAULT NULL,
    result_version INT NOT NULL DEFAULT 0,
    result_sha256 CHAR(64) DEFAULT NULL,
    model_version VARCHAR(100) DEFAULT NULL,
    result_json JSON DEFAULT NULL,
    projection_json JSON DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_vision_input (media_id, input_sha256),
    INDEX idx_vision_queue (status, next_attempt_at),
    FOREIGN KEY (media_id) REFERENCES media_files(media_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ai_defect_detections
    ADD COLUMN vision_job_id CHAR(36) DEFAULT NULL,
    ADD COLUMN defect_code VARCHAR(64) DEFAULT NULL,
    ADD COLUMN model_version VARCHAR(100) DEFAULT NULL,
    ADD COLUMN result_version INT DEFAULT NULL,
    ADD COLUMN projected_latitude DOUBLE DEFAULT NULL,
    ADD COLUMN projected_longitude DOUBLE DEFAULT NULL,
    ADD COLUMN mapping_status VARCHAR(40) DEFAULT NULL,
    ADD INDEX idx_detection_job (vision_job_id);

CREATE TABLE IF NOT EXISTS alert_rules (
    rule_id INT AUTO_INCREMENT PRIMARY KEY,
    asset_type ENUM('PANEL','DISCONNECTOR','CONTACT','OTHER') NOT NULL,
    max_temp_c DOUBLE DEFAULT NULL,
    delta_t_c DOUBLE DEFAULT NULL,
    min_confidence DOUBLE NOT NULL DEFAULT 0.8,
    enabled TINYINT(1) NOT NULL DEFAULT 1,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_rule_type (asset_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS vision_asset_reviews (
    review_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    detection_id INT DEFAULT NULL,
    vision_job_id CHAR(36) NOT NULL,
    result_version INT NOT NULL,
    user_id INT NOT NULL,
    asset_type VARCHAR(20) NOT NULL,
    asset_id INT NOT NULL,
    reviewed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (detection_id) REFERENCES ai_defect_detections(detection_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

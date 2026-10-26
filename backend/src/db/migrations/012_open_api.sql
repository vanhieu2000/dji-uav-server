CREATE TABLE IF NOT EXISTS api_keys (
 key_id CHAR(36) PRIMARY KEY,user_id INT NOT NULL,label VARCHAR(100) NOT NULL,key_hash CHAR(64) NOT NULL UNIQUE,
 auth_version INT NOT NULL,permissions_json JSON NOT NULL,plant_ids_json JSON NOT NULL,expires_at DATETIME NOT NULL,revoked_at DATETIME DEFAULT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,last_used_at DATETIME DEFAULT NULL,
 FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE inspection_tickets
 ADD COLUMN external_source VARCHAR(64) DEFAULT NULL,
 ADD COLUMN external_id VARCHAR(128) DEFAULT NULL,
 ADD COLUMN external_request_sha CHAR(64) DEFAULT NULL,
 ADD UNIQUE KEY uk_external_task (external_source,external_id);

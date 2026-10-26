-- E: tài khoản thật, thu hồi phiên, đơn vị và phạm vi dữ liệu.
CREATE TABLE IF NOT EXISTS units (
    unit_id INT AUTO_INCREMENT PRIMARY KEY,
    unit_code VARCHAR(50) NOT NULL UNIQUE,
    unit_name VARCHAR(150) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE users
    ADD COLUMN unit_id INT DEFAULT NULL,
    ADD COLUMN auth_version INT NOT NULL DEFAULT 0,
    ADD COLUMN must_change_password TINYINT(1) NOT NULL DEFAULT 0,
    ADD CONSTRAINT fk_user_unit FOREIGN KEY (unit_id) REFERENCES units(unit_id) ON DELETE SET NULL;
ALTER TABLE inspection_tickets
    ADD COLUMN plant_id INT DEFAULT NULL,
    ADD COLUMN unit_id INT DEFAULT NULL,
    ADD CONSTRAINT fk_ticket_plant FOREIGN KEY (plant_id) REFERENCES plants(plant_id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_ticket_unit FOREIGN KEY (unit_id) REFERENCES units(unit_id) ON DELETE SET NULL;
ALTER TABLE uav_devices
    ADD COLUMN plant_id INT DEFAULT NULL,
    ADD CONSTRAINT fk_uav_plant FOREIGN KEY (plant_id) REFERENCES plants(plant_id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS user_plant_scopes (
    user_id INT NOT NULL,plant_id INT NOT NULL,
    PRIMARY KEY (user_id,plant_id),
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE,
    FOREIGN KEY (plant_id) REFERENCES plants(plant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS role_permissions (
    role VARCHAR(20) NOT NULL,permission VARCHAR(50) NOT NULL,
    PRIMARY KEY(role,permission)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO role_permissions (role,permission) VALUES
 ('ENGINEER','tasks:read'),('ENGINEER','tasks:write'),('ENGINEER','assets:read'),('ENGINEER','media:write'),('ENGINEER','alerts:write'),('ENGINEER','reports:read'),
 ('OPERATOR','tasks:read'),('OPERATOR','tasks:write'),('OPERATOR','assets:read'),('OPERATOR','media:write'),('OPERATOR','reports:read'),
 ('VIEWER','tasks:read'),('VIEWER','assets:read'),('VIEWER','reports:read');
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token_hash CHAR(64) PRIMARY KEY,user_id INT NOT NULL,expires_at DATETIME NOT NULL,used_at DATETIME DEFAULT NULL,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS access_audit (
    audit_id BIGINT AUTO_INCREMENT PRIMARY KEY,user_id INT DEFAULT NULL,method VARCHAR(10) NOT NULL,
    path VARCHAR(512) NOT NULL,status_code INT NOT NULL,created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_access_time(created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS common_catalog (
    catalog_id INT AUTO_INCREMENT PRIMARY KEY,catalog_type VARCHAR(50) NOT NULL,code VARCHAR(64) NOT NULL,
    label VARCHAR(255) NOT NULL,enabled TINYINT(1) NOT NULL DEFAULT 1,
    UNIQUE KEY uk_catalog_code(catalog_type,code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE uav_devices
    ADD COLUMN unit_id INT DEFAULT NULL,
    ADD CONSTRAINT fk_uav_unit FOREIGN KEY (unit_id) REFERENCES units(unit_id) ON DELETE SET NULL;

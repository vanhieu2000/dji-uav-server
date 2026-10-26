-- F: phạm vi, tổ công tác, kế hoạch và đối soát riêng với trạng thái bay.
CREATE TABLE IF NOT EXISTS inspection_teams (
    team_id INT AUTO_INCREMENT PRIMARY KEY,
    team_name VARCHAR(150) NOT NULL,
    UNIQUE KEY uk_team_name (team_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
CREATE TABLE IF NOT EXISTS inspection_team_members (
    team_id INT NOT NULL, user_id INT NOT NULL,
    PRIMARY KEY (team_id,user_id),
    FOREIGN KEY (team_id) REFERENCES inspection_teams(team_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE inspection_tickets
    ADD COLUMN team_id INT DEFAULT NULL,
    ADD COLUMN capture_profile_id INT DEFAULT NULL,
    ADD COLUMN planned_start_at DATETIME DEFAULT NULL,
    ADD COLUMN planned_end_at DATETIME DEFAULT NULL,
    ADD COLUMN expected_media_count INT DEFAULT NULL,
    ADD COLUMN reconciled_at DATETIME DEFAULT NULL,
    ADD COLUMN reconciliation_note VARCHAR(1000) DEFAULT NULL,
    ADD COLUMN vision_required TINYINT(1) NOT NULL DEFAULT 0,
    ADD COLUMN revision INT NOT NULL DEFAULT 0,
    ADD CONSTRAINT fk_ticket_team FOREIGN KEY (team_id) REFERENCES inspection_teams(team_id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_ticket_profile FOREIGN KEY (capture_profile_id) REFERENCES capture_profiles(profile_id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS ticket_members (
    ticket_id INT NOT NULL, user_id INT NOT NULL,
    PRIMARY KEY (ticket_id,user_id),
    FOREIGN KEY (ticket_id) REFERENCES inspection_tickets(ticket_id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE ticket_details
    MODIFY COLUMN item_type ENUM('SOLAR_AREA','SOLAR_STRING','SOLAR_PANEL','SUBSTATION_BAY','DISCONNECTOR','DCL_CONTACT') NOT NULL,
    ADD COLUMN area_id INT DEFAULT NULL,
    ADD COLUMN string_id INT DEFAULT NULL,
    ADD COLUMN bay_id INT DEFAULT NULL,
    ADD COLUMN contact_id INT DEFAULT NULL,
    ADD CONSTRAINT fk_detail_area FOREIGN KEY (area_id) REFERENCES solar_areas(area_id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_detail_string FOREIGN KEY (string_id) REFERENCES solar_strings(string_id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_detail_bay FOREIGN KEY (bay_id) REFERENCES substation_bays(bay_id) ON DELETE SET NULL,
    ADD CONSTRAINT fk_detail_contact FOREIGN KEY (contact_id) REFERENCES dcl_contacts(contact_id) ON DELETE SET NULL;
CREATE TABLE IF NOT EXISTS media_ingest_events (
    ingest_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    media_id INT DEFAULT NULL,
    ticket_id INT DEFAULT NULL,
    original_name VARCHAR(255) NOT NULL,
    status ENUM('created','duplicate','failed') NOT NULL,
    note VARCHAR(500) DEFAULT NULL,
    received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX idx_ingest_ticket (ticket_id,ingest_id),
    FOREIGN KEY (media_id) REFERENCES media_files(media_id) ON DELETE SET NULL,
    FOREIGN KEY (ticket_id) REFERENCES inspection_tickets(ticket_id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE pilot_sessions
    ADD COLUMN upload_namespace CHAR(36) DEFAULT NULL,
    ADD UNIQUE KEY uk_pilot_upload_namespace (upload_namespace);
CREATE TABLE IF NOT EXISTS ticket_changes (
    change_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    revision INT NOT NULL,
    change_type VARCHAR(30) NOT NULL,
    details_json JSON NOT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ticket_id) REFERENCES inspection_tickets(ticket_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
ALTER TABLE media_files
    ADD COLUMN assignment_status ENUM('EXPLICIT','SESSION','FLIGHT','UNRESOLVED') NOT NULL DEFAULT 'UNRESOLVED';

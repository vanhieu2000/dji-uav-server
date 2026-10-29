-- Gateway can stream without an inspection ticket.
ALTER TABLE ticket_live_streams MODIFY COLUMN ticket_id INT DEFAULT NULL;
ALTER TABLE inspection_tickets ADD COLUMN inspection_cycle VARCHAR(16) NOT NULL DEFAULT 'AD_HOC';
ALTER TABLE inspection_tickets ADD COLUMN target_category VARCHAR(32) NOT NULL DEFAULT 'OTHER';
ALTER TABLE inspection_tickets ADD COLUMN assigned_rc_sn VARCHAR(64) DEFAULT NULL;
ALTER TABLE pilot_sessions ADD COLUMN ticket_bound_at DATETIME(3) DEFAULT NULL;
ALTER TABLE pilot_sessions ADD COLUMN route_verification VARCHAR(24) NOT NULL DEFAULT 'LEGACY';
ALTER TABLE media_files ADD COLUMN planned_waypoint_index INT DEFAULT NULL;
ALTER TABLE media_files ADD COLUMN waypoint_error_m DOUBLE DEFAULT NULL;
ALTER TABLE media_files ADD COLUMN waypoint_check VARCHAR(24) DEFAULT NULL;
CREATE TABLE IF NOT EXISTS ticket_executions (
 execution_id BIGINT AUTO_INCREMENT PRIMARY KEY,
 ticket_id INT NOT NULL, pilot_session_id INT NOT NULL, device_sn VARCHAR(64) NOT NULL,
 route_id INT NOT NULL, route_md5 CHAR(32) NOT NULL, plan_snapshot LONGTEXT NOT NULL, route_state VARCHAR(24) NOT NULL DEFAULT 'UNKNOWN',
 started_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3), ended_at DATETIME(3) DEFAULT NULL,
 actor_user_id INT NOT NULL, INDEX idx_execution_device (device_sn,ended_at),
 FOREIGN KEY(ticket_id) REFERENCES inspection_tickets(ticket_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE IF NOT EXISTS safety_exclusions (
 exclusion_id INT AUTO_INCREMENT PRIMARY KEY, plant_id INT NOT NULL, polygon_geojson JSON NOT NULL,
 FOREIGN KEY(plant_id) REFERENCES plants(plant_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

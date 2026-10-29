ALTER TABLE pilot_sessions
 ADD COLUMN mqtt_password_hash CHAR(64) DEFAULT NULL,
 ADD COLUMN auth_session_id VARCHAR(64) DEFAULT NULL,
 ADD COLUMN auth_version INT DEFAULT NULL;

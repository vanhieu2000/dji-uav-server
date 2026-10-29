-- C3-C5: HMS bền vững và kênh phát riêng từng phiếu / thiết bị.
CREATE TABLE IF NOT EXISTS uav_hms_events (
    event_id BIGINT AUTO_INCREMENT PRIMARY KEY,
    event_key CHAR(64) NOT NULL,
    device_sn VARCHAR(64) NOT NULL,
    gateway_sn VARCHAR(64) DEFAULT NULL,
    code VARCHAR(128) NOT NULL,
    level INT DEFAULT NULL,
    message VARCHAR(500) DEFAULT NULL,
    source_timestamp BIGINT DEFAULT NULL,
    received_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    acknowledged_at DATETIME DEFAULT NULL,
    UNIQUE KEY uk_hms_event (event_key),
    INDEX idx_hms_device (device_sn, event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ticket_live_streams (
    stream_id INT AUTO_INCREMENT PRIMARY KEY,
    ticket_id INT NOT NULL,
    device_sn VARCHAR(64) NOT NULL,
    channel VARCHAR(100) NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uk_ticket_device_stream (ticket_id, device_sn),
    UNIQUE KEY uk_stream_channel (channel),
    FOREIGN KEY (ticket_id) REFERENCES inspection_tickets(ticket_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

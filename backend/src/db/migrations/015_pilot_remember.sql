CREATE TABLE IF NOT EXISTS pilot_remember_tokens (
 token_hash CHAR(64) PRIMARY KEY,
 user_id INT NOT NULL,
 auth_version INT NOT NULL,
 expires_at DATETIME NOT NULL,
 created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX idx_pilot_remember_expiry(expires_at),
 FOREIGN KEY (user_id) REFERENCES users(user_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

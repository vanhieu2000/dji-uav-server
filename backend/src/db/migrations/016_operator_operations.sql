-- Per-account temporary broad business access; ADMIN-only account/system management remains separate.
ALTER TABLE users ADD COLUMN all_operation_scopes TINYINT(1) NOT NULL DEFAULT 0;

-- Some early installations predate file_path_local in the base schema.
-- Additive only; fresh schemas already contain the column and the migration runner skips it.
ALTER TABLE media_files ADD COLUMN file_path_local VARCHAR(500) DEFAULT NULL COMMENT 'Đường dẫn file ảnh trên máy chủ';

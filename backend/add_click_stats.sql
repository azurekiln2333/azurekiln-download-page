-- 为已有数据库补充点击统计字段和事件日志表，可重复执行
USE azurekiln_download_page;

SET @add_view_count_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE download_files ADD COLUMN view_count BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER short_url',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'download_files'
    AND COLUMN_NAME = 'view_count'
);
PREPARE add_view_count_stmt FROM @add_view_count_sql;
EXECUTE add_view_count_stmt;
DEALLOCATE PREPARE add_view_count_stmt;

SET @add_click_count_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE download_files ADD COLUMN click_count BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER view_count',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'download_files'
    AND COLUMN_NAME = 'click_count'
);
PREPARE add_click_count_stmt FROM @add_click_count_sql;
EXECUTE add_click_count_stmt;
DEALLOCATE PREPARE add_click_count_stmt;

SET @add_link_click_count_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE download_storage_links ADD COLUMN click_count BIGINT UNSIGNED NOT NULL DEFAULT 0 AFTER is_active',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'download_storage_links'
    AND COLUMN_NAME = 'click_count'
);
PREPARE add_link_click_count_stmt FROM @add_link_click_count_sql;
EXECUTE add_link_click_count_stmt;
DEALLOCATE PREPARE add_link_click_count_stmt;

SET @add_link_last_clicked_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE download_storage_links ADD COLUMN last_clicked_at DATETIME NULL AFTER click_count',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'download_storage_links'
    AND COLUMN_NAME = 'last_clicked_at'
);
PREPARE add_link_last_clicked_stmt FROM @add_link_last_clicked_sql;
EXECUTE add_link_last_clicked_stmt;
DEALLOCATE PREPARE add_link_last_clicked_stmt;

CREATE TABLE IF NOT EXISTS download_click_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id BIGINT UNSIGNED NOT NULL,
  link_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(16) NOT NULL,
  storage_key VARCHAR(64) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_click_logs_time (created_at),
  KEY idx_click_logs_file_time (file_id, created_at),
  CONSTRAINT fk_click_logs_file
    FOREIGN KEY (file_id)
    REFERENCES download_files (id)
    ON DELETE CASCADE,
  CONSTRAINT fk_click_logs_link
    FOREIGN KEY (link_id)
    REFERENCES download_storage_links (id)
    ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

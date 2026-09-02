-- 为已有数据库补充访客 IP 统计，可重复执行
USE azurekiln_download_page;

SET @add_log_ip_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE download_click_logs ADD COLUMN ip VARCHAR(64) NULL AFTER storage_key',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'download_click_logs'
    AND COLUMN_NAME = 'ip'
);
PREPARE add_log_ip_stmt FROM @add_log_ip_sql;
EXECUTE add_log_ip_stmt;
DEALLOCATE PREPARE add_log_ip_stmt;

CREATE TABLE IF NOT EXISTS download_ip_stats (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id BIGINT UNSIGNED NOT NULL,
  ip VARCHAR(64) NOT NULL,
  view_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  click_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  first_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_ip_stats_file_ip (file_id, ip),
  KEY idx_ip_stats_ip (ip),
  KEY idx_ip_stats_last_seen (last_seen_at),
  CONSTRAINT fk_ip_stats_file
    FOREIGN KEY (file_id)
    REFERENCES download_files (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

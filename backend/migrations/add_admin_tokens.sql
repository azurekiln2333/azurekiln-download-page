-- 管理后台多令牌：可命名、可启停、可删除的管理令牌（只存哈希）
-- 用法：mysql -u root -p azurekiln_download_page < backend/migrations/add_admin_tokens.sql

CREATE TABLE IF NOT EXISTS admin_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(128) NOT NULL,
  token_hash CHAR(64) NOT NULL,
  token_prefix VARCHAR(32) NOT NULL DEFAULT '',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_used_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_admin_tokens_hash (token_hash),
  KEY idx_admin_tokens_active (is_active, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

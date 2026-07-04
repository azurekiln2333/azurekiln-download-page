USE azurekiln_download_page;

SET @add_short_url_id_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE download_files ADD COLUMN short_url_id VARCHAR(128) NULL AFTER access_code_hash',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'download_files'
    AND COLUMN_NAME = 'short_url_id'
);
PREPARE add_short_url_id_stmt FROM @add_short_url_id_sql;
EXECUTE add_short_url_id_stmt;
DEALLOCATE PREPARE add_short_url_id_stmt;

SET @add_short_url_sql = (
  SELECT IF(
    COUNT(*) = 0,
    'ALTER TABLE download_files ADD COLUMN short_url VARCHAR(255) NULL AFTER short_url_id',
    'SELECT 1'
  )
  FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'download_files'
    AND COLUMN_NAME = 'short_url'
);
PREPARE add_short_url_stmt FROM @add_short_url_sql;
EXECUTE add_short_url_stmt;
DEALLOCATE PREPARE add_short_url_stmt;

ALTER TABLE download_storage_links
  MODIFY storage_icon VARCHAR(255) NOT NULL DEFAULT 'cloud_download';

CREATE TABLE IF NOT EXISTS download_storage_providers (
  storage_key VARCHAR(64) NOT NULL,
  display_name VARCHAR(128) NOT NULL,
  icon_url VARCHAR(512) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (storage_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

UPDATE download_storage_links
SET storage_key = 'baidunetdisk'
WHERE storage_key IN ('baidu', 'baidunetdisk');

UPDATE download_storage_links
SET storage_key = 'googledrive'
WHERE storage_key IN ('google-drive', 'googledrive');

UPDATE download_storage_links
SET storage_key = 'onedrive'
WHERE storage_key IN ('onedrive', 'onedrive-main', 'onedrive-backup');

INSERT INTO download_storage_providers (
  storage_key,
  display_name,
  icon_url,
  sort_order,
  is_active
) VALUES
('lanzou', '蓝奏云', 'https://statics.azurekiln.cn/clouddrive/lanzou/favicon.ico', 10, 1),
('123pan', '123云盘', 'https://statics.azurekiln.cn/clouddrive/123pan/favicon.ico', 20, 1),
('baidunetdisk', '百度云盘', 'https://statics.azurekiln.cn/clouddrive/baidunetdisk/favicon-main.ico', 30, 1),
('quark', '夸克云盘', 'https://statics.azurekiln.cn/clouddrive/quark/f6439020-13b4-11f1-9342-3944993de2f6.png', 40, 1),
('xunlei', '迅雷云盘', 'https://statics.azurekiln.cn/clouddrive/xunlei/icon.png', 50, 1),
('189cloud', '天翼云盘', 'https://statics.azurekiln.cn/clouddrive/189cloud/logo.ico', 60, 1),
('onedrive', 'OneDrive', 'https://statics.azurekiln.cn/clouddrive/onedrive/odbfavicon.ico', 70, 1),
('googledrive', 'Google Drive', 'https://statics.azurekiln.cn/clouddrive/googledrive/drive_favicon_2026_32dp.png', 80, 1),
('guangyapan', '光亚云盘', 'https://statics.azurekiln.cn/clouddrive/guangyapan/icon.png', 90, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  icon_url = VALUES(icon_url),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active);

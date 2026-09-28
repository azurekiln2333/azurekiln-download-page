CREATE DATABASE IF NOT EXISTS azurekiln_download_page
  DEFAULT CHARACTER SET utf8mb4
  DEFAULT COLLATE utf8mb4_unicode_ci;

USE azurekiln_download_page;

CREATE TABLE IF NOT EXISTS download_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  description TEXT NULL,
  icon VARCHAR(64) NOT NULL DEFAULT 'folder_zip',
  size_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  size_label VARCHAR(64) NULL,
  access_code_hash CHAR(64) NULL,
  short_url_id VARCHAR(128) NULL,
  short_url VARCHAR(255) NULL,
  view_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  click_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  owner VARCHAR(128) NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_download_files_public_id (public_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS download_storage_links (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  public_id VARCHAR(128) NOT NULL,
  file_id BIGINT UNSIGNED NOT NULL,
  storage_key VARCHAR(64) NOT NULL,
  storage_name VARCHAR(128) NOT NULL,
  storage_icon VARCHAR(255) NOT NULL DEFAULT 'cloud_download',
  url TEXT NOT NULL,
  extract_code VARCHAR(64) NULL,
  note VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  click_count BIGINT UNSIGNED NOT NULL DEFAULT 0,
  last_clicked_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_storage_links_public_id (public_id),
  KEY idx_storage_links_file_active_order (file_id, is_active, sort_order),
  CONSTRAINT fk_storage_links_file
    FOREIGN KEY (file_id)
    REFERENCES download_files (id)
    ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS download_click_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  file_id BIGINT UNSIGNED NOT NULL,
  link_id BIGINT UNSIGNED NULL,
  event_type VARCHAR(16) NOT NULL,
  storage_key VARCHAR(64) NULL,
  ip VARCHAR(64) NULL,
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
('guangyapan', '光鸭云盘', 'https://statics.azurekiln.cn/clouddrive/guangyapan/icon.png', 90, 1)
ON DUPLICATE KEY UPDATE
  display_name = VALUES(display_name),
  icon_url = VALUES(icon_url),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active);

INSERT INTO download_files (
  public_id,
  title,
  file_name,
  description,
  icon,
  size_bytes,
  size_label,
  access_code_hash,
  owner,
  updated_at,
  expires_at,
  is_active
) VALUES
(
  'project-assets',
  'Project_Final_Design_Assets.zip',
  'Project_Final_Design_Assets.zip',
  'Comprehensive design assets for the new project including Figma source files, high-resolution exports, and brand documentation.',
  'folder_zip',
  1277752770,
  '1.19 GB',
  SHA2('2024', 256),
  'SecureShare Distribution',
  '2026-06-16 10:43:00',
  '2026-12-31 23:59:59',
  1
),
(
  'brand-doc',
  'Brand_Documentation.pdf',
  'Brand_Documentation.pdf',
  'Typography, spacing, color, and usage guidance.',
  'description',
  52428800,
  '50 MB',
  SHA2('2024', 256),
  'SecureShare Distribution',
  '2026-06-16 10:43:00',
  '2026-12-31 23:59:59',
  1
)
ON DUPLICATE KEY UPDATE
  title = VALUES(title),
  file_name = VALUES(file_name),
  description = VALUES(description),
  icon = VALUES(icon),
  size_bytes = VALUES(size_bytes),
  size_label = VALUES(size_label),
  access_code_hash = VALUES(access_code_hash),
  owner = VALUES(owner),
  updated_at = VALUES(updated_at),
  expires_at = VALUES(expires_at),
  is_active = VALUES(is_active);

INSERT INTO download_storage_links (
  public_id,
  file_id,
  storage_key,
  storage_name,
  storage_icon,
  url,
  extract_code,
  note,
  sort_order,
  is_active
) VALUES
(
  'project-assets-123pan',
  (SELECT id FROM download_files WHERE public_id = 'project-assets'),
  '123pan',
  '123网盘',
  'cloud_queue',
  'https://example.com/123pan/project-assets',
  '2024',
  '高速外链，推荐优先使用',
  10,
  1
),
(
  'project-assets-lanzou',
  (SELECT id FROM download_files WHERE public_id = 'project-assets'),
  'lanzou',
  '蓝奏云盘',
  'cloud_queue',
  'https://example.com/lanzou/project-assets',
  '2024',
  '小文件和文档备用链接',
  20,
  1
),
(
  'project-assets-quark',
  (SELECT id FROM download_files WHERE public_id = 'project-assets'),
  'quark',
  '夸克网盘',
  'bolt',
  'https://example.com/quark/project-assets',
  '2024',
  '移动端访问体验较好',
  30,
  1
),
(
  'brand-doc-123pan',
  (SELECT id FROM download_files WHERE public_id = 'brand-doc'),
  '123pan',
  '123网盘',
  'cloud_queue',
  'https://example.com/123pan/brand-doc',
  '2024',
  '文档主下载链接',
  10,
  1
),
(
  'brand-doc-lanzou',
  (SELECT id FROM download_files WHERE public_id = 'brand-doc'),
  'lanzou',
  '蓝奏云盘',
  'cloud_queue',
  'https://example.com/lanzou/brand-doc',
  '2024',
  '备用下载链接',
  20,
  1
)
ON DUPLICATE KEY UPDATE
  file_id = VALUES(file_id),
  storage_key = VALUES(storage_key),
  storage_name = VALUES(storage_name),
  storage_icon = VALUES(storage_icon),
  url = VALUES(url),
  extract_code = VALUES(extract_code),
  note = VALUES(note),
  sort_order = VALUES(sort_order),
  is_active = VALUES(is_active);

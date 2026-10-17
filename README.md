# AzureKiln Download Page

前后端已分离：

- `backend/`: Node.js API、MySQL 数据源、提取码验证、文件对应存储链接下发。
- `frontend/`: Vite 前端，复用现有 SecureShare 视觉风格。

## 数据模型

一个文件 ID 可以对应多个存储链接：

- `download_files`: 文件下载页本体，例如 `project-assets`、`brand-doc`。
- `download_storage_links`: 文件对应的存储/网盘分享链接，例如同一个文件有 123 网盘、蓝奏云盘、夸克网盘；另一个文件可以只有 123 网盘和蓝奏云盘。

初始化 MySQL：

```powershell
cd backend
mysql -u root -p < schema.sql
copy .env.example .env
```

已有旧库时，执行增量迁移补充点击统计字段：

```powershell
cd backend
mysql -u root -p < add_click_stats.sql
mysql -u root -p < add_visitor_ip_stats.sql
```

按实际环境修改 `backend/.env` 里的 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。

## 点击统计

- 访客打开分享页会记一次页面访问（同一浏览器会话内刷新不重复计数）。
- 访客点击存储链接按钮会按链接记一次点击。
- 计数存储在 `download_files.view_count`、`download_files.click_count`、`download_storage_links.click_count`，明细写入 `download_click_logs` 事件日志。
- 上报接口：`POST /api/files/:fileId/track`，body 为 `{"event":"view"}` 或 `{"event":"click","linkId":"<链接 publicId>"}`。

## 访客 IP 统计

- 服务端会记录访客 IP：优先取反向代理头 `X-Forwarded-For` / `X-Real-IP`（生产环境在 nginx 后面时生效），否则取 TCP 连接地址，并归一化 IPv6 映射前缀。直连部署时可设 `TRUST_PROXY=0` 忽略代理头，避免伪造。
- `download_ip_stats` 表按 `(file_id, ip)` 唯一键去重：同一资源同一 IP 只有一行，即一个独立访客；重复访问只累加该行的 `view_count` / `click_count` 并更新 `last_seen_at`，不会增加独立访客数。
- 管理后台展示：概览卡「独立访客 IP」（含今日活跃）、文件行的 IP 数、编辑弹窗里的「IP 访客」列表（IP、访问次数、点击次数、最近访问时间），最近动态也会附带 IP。
- 接口：`GET /api/admin/files/:fileId/visitors` 返回单个文件的访客 IP 列表。

## 管理后台

访问 `http://127.0.0.1:5173/?admin=dashboard`（或生产站点的 `/admin`），输入管理令牌登录后可以：

- 查看文件总数、访问量、点击量、今日数据和近 14 天趋势图。
- 管理分享文件：编辑标题、文件名、大小、说明、提取码、过期时间，启用/停用/删除。
- 管理存储链接：新增、编辑、删除链接，查看每条链接的点击次数。
- 查看最近 50 条访问/点击动态。
- 管理多枚后台令牌（命名、启用/停用、删除、查看最近使用时间）。

管理接口统一走 `/api/admin/*`（统计概览 `GET /api/admin/stats`、文件列表 `GET /api/admin/files`、文件详情/更新/删除 `GET|PUT|DELETE /api/admin/files/:fileId`、链接新增 `POST /api/admin/files/:fileId/links`、链接更新/删除 `PUT|DELETE /api/admin/links/:id`），需要在请求头带 `X-Admin-Token`（也接受 `Authorization: Bearer <token>`）。

## 管理令牌

后台令牌有两种来源，二者同时生效：

1. **环境变量超级令牌**：`backend/.env` 里的 `ADMIN_IMPORT_TOKEN`。始终可用、不可删除，作为兜底（例如忘记其它令牌、或需要重建令牌表时）。修改后需重启后端。
2. **数据库令牌**：表 `admin_tokens`，可在后台「令牌管理」里创建多枚，带名称、启用/停用、删除，并记录最近使用时间。

- 库里只存 SHA-256 哈希（`token_hash`）和前缀（`token_prefix`，用于识别，不是凭证），明文只在创建时返回一次。
- 校验时先用 `timingSafeEqual` 比对 env 令牌，再逐个比对启用中令牌的哈希；命中数据库令牌会刷新 `last_used_at`。
- 停用或删除令牌后立即失效。

首次在已有库上启用需要迁移：

```powershell
mysql -u root -p azurekiln_download_page < backend/migrations/add_admin_tokens.sql
```

令牌接口（均需 `X-Admin-Token`）：

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/admin/tokens` | 列表，返回 `{ tokens, envTokenEnabled }`，不含明文和哈希 |
| POST | `/api/admin/tokens` | body `{ "name": "ci-bot" }`，返回 `{ token, item, message }`，`token` 仅此一次可见 |
| PUT | `/api/admin/tokens/:id` | body `{ "name"?, "isActive"? }`，返回 `{ item }` |
| DELETE | `/api/admin/tokens/:id` | 返回 `{ ok: true }` |

## 运行

后端：

```powershell
cd backend
npm install
npm run dev
```

前端：

```powershell
cd frontend
npm install
npm run dev
```

默认访问 `http://127.0.0.1:5173/?file=project-assets`，演示提取码是 `2024`。
另一个示例文件：`http://127.0.0.1:5173/?file=brand-doc`，它只有两条存储链接，页面会按数据库动态渲染。

后端不代理文件、不输出文件下载流，只在提取码验证成功后把当前文件对应的存储链接返回给前端。

前端生产构建后也可以由后端直接托管：

```powershell
cd frontend
npm run build
cd ..\backend
npm run start
```

然后访问 `http://127.0.0.1:3001`。

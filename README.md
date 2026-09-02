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
```

按实际环境修改 `backend/.env` 里的 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。

## 点击统计

- 访客打开分享页会记一次页面访问（同一浏览器会话内刷新不重复计数）。
- 访客点击存储链接按钮会按链接记一次点击。
- 计数存储在 `download_files.view_count`、`download_files.click_count`、`download_storage_links.click_count`，明细写入 `download_click_logs` 事件日志。
- 上报接口：`POST /api/files/:fileId/track`，body 为 `{"event":"view"}` 或 `{"event":"click","linkId":"<链接 publicId>"}`。

## 管理后台

访问 `http://127.0.0.1:5173/?admin=dashboard`（或生产站点的 `/admin`），输入 `ADMIN_IMPORT_TOKEN` 登录后可以：

- 查看文件总数、访问量、点击量、今日数据和近 14 天趋势图。
- 管理分享文件：编辑标题、文件名、大小、说明、提取码、过期时间，启用/停用/删除。
- 管理存储链接：新增、编辑、删除链接，查看每条链接的点击次数。
- 查看最近 50 条访问/点击动态。

管理接口统一走 `/api/admin/*`（统计概览 `GET /api/admin/stats`、文件列表 `GET /api/admin/files`、文件详情/更新/删除 `GET|PUT|DELETE /api/admin/files/:fileId`、链接新增 `POST /api/admin/files/:fileId/links`、链接更新/删除 `PUT|DELETE /api/admin/links/:id`），需要在请求头带 `X-Admin-Token`。

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

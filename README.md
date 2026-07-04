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

按实际环境修改 `backend/.env` 里的 `DB_HOST`、`DB_USER`、`DB_PASSWORD`、`DB_NAME`。

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

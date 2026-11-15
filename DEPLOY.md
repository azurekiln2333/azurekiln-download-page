# 服务器部署指南

整条链路：本地 push tag `v*` → GitHub Actions 测试并构建镜像 → 推送 GHCR → 服务器 `git pull` 或 Watchtower 自动拉取 → 容器经桥接网络连接宿主机 MySQL。

## 首次部署

```bash
# 1. 拉取仓库
git clone https://github.com/azurekiln2333/azurekiln-download-page.git
cd azurekiln-download-page

# 2. 准备环境变量
cp .env.example .env
vim .env   # 至少改 DB_USER / DB_PASSWORD / ACCESS_TOKEN_SECRET / ADMIN_IMPORT_TOKEN

# 3. 初始化数据库（宿主机 MySQL 里执行一次）
mysql -u root -p < backend/schema.sql
mysql -u root -p azurekiln_download_page < backend/migrations/add_admin_tokens.sql

# 4. 启动（应用 + watchtower）
docker compose up -d
docker compose logs -f app   # 确认 /api/health 通过
```

容器监听 3001，默认只绑定宿主机 `127.0.0.1:3001`，由 nginx 反代到 `dl.azurekiln.cn`：

```nginx
server {
    server_name dl.azurekiln.cn;
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## 日常更新

两种方式，任选：

```bash
# 方式一：手动（compose 文件或 .env 有变动时必用）
git pull
docker compose up -d          # 自动拉取新镜像并重建容器

# 方式二：全自动 —— watchtower 每 WATCHTOWER_POLL_INTERVAL 秒（默认 600）
# 检查 GHCR 上的 :latest，有新镜像就重建 app 容器并清理旧镜像
docker compose logs -f watchtower
```

只改了代码没改 compose/.env 时，无需上服务器，push tag 后等 watchtower 轮询即可。

## 桥接网络连宿主机 MySQL（原理与配置）

**结论：桥接模式完全可以连宿主机 MySQL，不需要 `network_mode: host`。**

- `docker-compose.yaml` 已配置 `extra_hosts: host.docker.internal:host-gateway`（要求 Docker ≥ 20.10）。
- 容器内 `host.docker.internal` 会解析为宿主机在 docker 桥接网络上的网关地址（docker0，通常 `172.17.0.1`）。
- 容器里 `DB_HOST=host.docker.internal` 即可连到宿主机的 3306。

`network_mode: host` 虽然能用 localhost 直连，但会失去网络隔离、端口直接暴露在宿主机、`ports` 映射失效，还可能与宿主机上其他服务抢端口，不推荐。

宿主机侧需要三件事（一次性）：

1. **MySQL 监听地址**：`/etc/mysql/mysql.conf.d/mysqld.cnf` 中 `bind-address` 不能只有 `127.0.0.1`，改为 `0.0.0.0`（或保留 `127.0.0.1` 并追加一行 `bind-address = 172.17.0.1`）后重启 MySQL。

2. **MySQL 账号授权**：compose 项目使用独立网段（172.17~172.31 之间动态分配），直接授权 `%` 最省心：

   ```sql
   CREATE USER 'azurekiln'@'%' IDENTIFIED BY '你的密码';
   GRANT ALL PRIVILEGES ON azurekiln_download_page.* TO 'azurekiln'@'%';
   FLUSH PRIVILEGES;
   ```

3. **防火墙**：只放行 docker 网段访问 3306，绝不对公网开放：

   ```bash
   # ufw 示例
   sudo ufw allow from 172.16.0.0/12 to any port 3306 proto tcp
   ```

验证连通性：

```bash
docker compose exec app node -e \
  "require('/app/backend/node_modules/mysql2/promise').createConnection({host:process.env.DB_HOST,port:+process.env.DB_PORT,user:process.env.DB_USER,password:process.env.DB_PASSWORD}).then(c=>console.log('OK')).catch(e=>{console.error(e.code);process.exit(1)})"
```

## GHCR 镜像拉取权限

CI 推出的 GHCR 包默认是**私有**的，二选一：

- **公开（推荐）**：GitHub → 你的头像 → Packages → `azurekiln-download-page` → Package settings → Change visibility → Public。之后服务器无需任何凭证即可 pull，watchtower 也能直接工作。
- **保持私有**：在 GitHub 生成带 `read:packages` 的 PAT，服务器 `docker login ghcr.io`，并给 watchtower 挂载凭证（`~/.docker/config.json` 只读挂载进容器）。

## 本地构建调试

```bash
docker compose -f docker-compose.yaml -f docker-compose.build.yaml up -d --build
```

此模式下 app 使用本地构建的 `azurekiln-download-page:local` 且关闭 watchtower 跟踪（`profiles: [auto-update]`，加 `--profile auto-update` 才启动）。

## 常用命令

```bash
docker compose ps                     # 状态（app 应为 healthy）
docker compose logs -f app            # 应用日志
docker compose exec app env | grep ^DB_   # 检查注入的数据库配置
docker compose pull && docker compose up -d   # 手动更新镜像
docker image prune -f                 # 清理悬空镜像（watchtower 开了 cleanup 一般不需要）
```

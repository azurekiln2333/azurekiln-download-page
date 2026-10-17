# 后端多令牌（pi-3）

父任务：`.trellis/tasks/10-18-admin-console-newapi`

## 目标
把管理后台的单一 `ADMIN_IMPORT_TOKEN` 扩展为「env 兜底超级令牌 + 数据库可管理多令牌」。

## 范围（只改这些文件）
- `backend/schema.sql`（新增 `admin_tokens` 建表语句）
- `backend/migrations/add_admin_tokens.sql`（新增，供已有库升级）
- `backend/server.js`（`requireAdmin` + `/api/admin/tokens` CRUD）
- `README.md`（管理后台一节补充令牌说明）

不碰 `backend/.env`、`backend/*.sql` 的删除状态、`backend/importer.py`、前端文件。

## 需求
1. 新表 `admin_tokens`：`id, name, token_hash(sha256 hex), token_prefix, is_active, created_at, last_used_at`。
2. `requireAdmin` 同时接受：
   - env `ADMIN_IMPORT_TOKEN`（兜底超级令牌，比较值本身，兼容旧客户端）；
   - `admin_tokens` 中 `is_active = 1` 的令牌（比较 sha256 哈希，`crypto.timingSafeEqual`），命中后更新 `last_used_at`。
3. API：
   - `GET /api/admin/tokens` 列表，不返回明文/哈希，只返回 `tokenPrefix` 等元信息；
   - `POST /api/admin/tokens` `{name}` → 201，返回**一次性明文** `token`；
   - `PUT /api/admin/tokens/:id` `{name?, isActive?}` → 200 更新后的令牌；
   - `DELETE /api/admin/tokens/:id` → 200 `{ok:true}`。
   风格与现有 `/api/admin/*` 一致（`HttpError`、`sendJson`、`toIsoDate`、camelCase 字段）。
4. 错误语义：姓名必填/过长 400、ID 非法 400、令牌不存在 404、方法不支持 405。

## 验收
- `node --check backend/server.js` 通过。
- env 超级令牌仍可用（向后兼容）；禁用/删除后的令牌立即失效。
- 列表接口不泄露明文或哈希。
- conventional commit：`feat(api): ...`。
- 接口契约写入本文件「接口契约」节，供 pi-4 前端使用。

## 接口契约（供 pi-4 前端使用）

认证：所有 `/api/admin/*` 请求头带 `X-Admin-Token: <token>`（也接受 `Authorization: Bearer <token>`）。
token 可以是 env `ADMIN_IMPORT_TOKEN`，或令牌管理里创建出来的明文令牌。

### 令牌对象（TokenItem）
```json
{
  "id": 3,
  "name": "ci-bot",
  "tokenPrefix": "ak_9f3d2c1a",
  "isActive": true,
  "createdAt": "2026-10-18T09:12:33.000Z",
  "lastUsedAt": null,
  "lastUsedLabel": "从未使用",
  "isEnvToken": false
}
```
- `tokenPrefix`：令牌前 16 个字符，仅用于识别，不是凭证明文。
- `createdAt` / `lastUsedAt`：ISO 字符串或 `null`；`lastUsedLabel` 为可直接展示的中文标签。
- 列表响应里可能包含一条 `isEnvToken: true`、`id: 0` 的虚拟条目，代表 env 兜底超级令牌（只有 `name`/`tokenPrefix`/`isActive`/`isEnvToken`，其余为 `null`），前端应只读展示、禁删禁改。

### GET /api/admin/tokens → 200
```json
{
  "tokens": [ { "...": "TokenItem" } ],
  "envTokenEnabled": true
}
```
`envTokenEnabled`：env 超级令牌是否已配置且不是占位值。

### POST /api/admin/tokens
请求：
```json
{ "name": "ci-bot" }
```
响应 201：
```json
{
  "token": "ak_V1StGXR8_Z5jdHi6B-myT",
  "item": { "...": "TokenItem" },
  "message": "令牌只显示这一次，请立即保存"
}
```
`token` 是唯一一次返回的明文（`ak_` + 40 位随机 base62）。

### PUT /api/admin/tokens/:id
请求（字段可选，至少一个）：
```json
{ "name": "ci-bot-2", "isActive": false }
```
响应 200：
```json
{ "item": { "...": "TokenItem" } }
```

### DELETE /api/admin/tokens/:id → 200
```json
{ "ok": true }
```

### 错误响应（与现有接口一致）
```json
{ "message": "令牌不存在" }
```
状态码：400（参数不合法）、401（令牌不正确）、404（令牌不存在/接口不存在）、405（方法不支持）、503（未配置任何令牌来源）。

## 实现结果（pi-3 已完成）

### 提交
- `feat(db): add admin_tokens table for multi admin tokens` — `backend/schema.sql`、`backend/migrations/add_admin_tokens.sql`
- `feat(api): accept env and db admin tokens in requireAdmin` — `backend/server.js`
- `feat(api): add admin token CRUD endpoints under /api/admin/tokens` — `backend/server.js`
- `fix(api): degrade to env token when admin_tokens table is unavailable` — `backend/server.js`
- `docs(readme): document multi admin tokens` — `README.md`

### 落地情况
- `admin_tokens` 表：`id, name, token_hash CHAR(64) UNIQUE, token_prefix VARCHAR(32), is_active, created_at, last_used_at`，迁移脚本 `backend/migrations/add_admin_tokens.sql`。
- `requireAdmin` 改为 async：先 `timingSafeEqual` 比对 env 超级令牌（`ADMIN_IMPORT_TOKEN`，占位值 `change-this-import-token` 视为未配置），再查启用中令牌并用 `timingSafeHexEqual` 比对哈希，命中刷新 `last_used_at`。表不存在/数据库异常时仅在 env 令牌已配置的情况下退化为 env-only，不阻断后台。`GET /api/admin/*` 之外的分支（公开接口）不受影响。
- 明文格式 `ak_` + 40 位 base62；`tokenPrefix` 取前 16 字符。
- CRUD 契约与本文件「接口契约」完全一致，路由位于 `handleApi` 的 `segments[2] === "tokens"` 分支，`segments[4]` 存在时返回 404。
- 无数据库环境下已做冒烟验证：无 token / 错误 token（Header 与 Bearer 两种取法）→ 401，正确 env token 通过鉴权，`OPTIONS` → 204；`node --check backend/server.js` 通过。

### 给 pi-4 的注意事项
- 列表接口第一项可能是 `isEnvToken: true, id: 0` 的虚拟条目（env 超级令牌），前端应只读展示、禁用编辑/删除。
- `tokenPrefix` 是识别前缀不是凭证；只在 POST 响应里出现一次明文 `token`。
- 创建后请提示用户立即保存；`message` 字段可直接展示。

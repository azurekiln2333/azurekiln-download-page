# pi-1 · 管理后台布局骨架（New API 风格外壳）

父任务：`.trellis/tasks/10-18-admin-console-newapi`

## 负责范围（只改这两处）

- `frontend/src/admin.js`：外壳渲染（登录后的 admin shell）、侧栏/顶栏/路由、各页面挂载函数占位。
- `frontend/src/styles.css`：新增圆角 token 与 admin 布局段落（`.admin-shell` 及子类），并把 admin 区的大圆角替换为 token。

不负责、不许改：`frontend/src/main.js`（公开下载页）、`frontend/src/shared.js`（其他并行任务可能用）、后端任何文件、`backend/.env`、`backend/*.sql` 的删除状态、`backend/importer.py`。

## 需求

1. 圆角：`:root` 定义 `--radius: 0.5rem` 及派生 `--radius-xs/sm/md/lg/full`；admin 区面板/卡片/弹窗/按钮全部使用 token，不再出现 10/12/16px 硬编码大圆角。
2. 布局：New API 式「左侧栏 + 顶栏 + 主体」三区结构；admin 页不再使用公开站的 `.topbar` / `.footer`（`renderShell` 的通用外壳）。
3. 侧栏导航项：概览 / 文件管理 / 访问动态 / 令牌管理；hash 路由（`#overview`、`#files`、`#activity`、`#tokens`），支持 query 兜底与浏览器前进后退。
4. 侧栏展开/收起：`width` transition 动画；收起态仅显示图标；状态持久化到 `localStorage`。
5. 右上角顶栏：页面标题（唯一一处）+ 账号信息 + 头像下拉（含「导入分享」「退出登录」）。
6. 删除：侧栏「管理工作区/管理员」卡片、侧栏底部「管理员会话」、主体底部「AzureKiln · 管理控制台」页脚。
7. 页面标题只出现一处（顶栏），主体内不再重复 `<h1>管理后台</h1>`。
8. 现有功能不丢：概览统计、趋势、文件列表、最近动态、编辑弹窗、刷新、退出在骨架阶段全部保留可用（pi-2 再迁移细化）。

## 交付物

- `renderAdminDashboard` → 认证后进入 `renderAdminShell()`。
- 页面挂载函数（供 pi-2 / pi-4 填充，注释写在 admin.js 顶部）：
  - `renderOverviewPage()`（pi-2）
  - `renderFilesPage()`（pi-2）
  - `renderActivityPage()`（pi-2）
  - `renderTokensPage()`（pi-4，占位）
- 导航/路由 API：`navigateAdminPage(page)`、`currentAdminPage()`。

## 验收

- `cd frontend && npm run build` 通过。
- 侧栏可展开/收起且带宽度动画；收起仅图标。
- 顶栏右侧头像下拉可退出；无侧栏卡片、无侧栏底部会话卡、无主体页脚。
- 页面标题只出现一次。
- 每个改动单元一个 conventional commit，不 push。

---

## 结果（已完成）

### 提交

| commit | 内容 |
| --- | --- |
| `chore(trellis): add pi-1 admin layout skeleton task` | 本任务 prd/task 元数据 |
| `feat(admin): add 0.5rem radius token scale` | `:root` 新增 `--radius: 0.5rem` 及 `--radius-xs/sm/md/lg/full` |
| `refactor(admin): replace hardcoded admin radii with radius tokens` | admin 段 12/10/8/6px 全部换成 token |
| `fix(admin): isolate admin token storage from the import page key` | 后台令牌改用 `azurekilnshare:admin-session-token`，旧 key 一次性迁移后删除（否则 admin token 会留在 sessionStorage 被导入页复用） |
| `feat(admin): new api style sidebar shell with animated collapse and hash routing` | 外壳 + 侧栏 + 顶栏 + hash 路由 + 页面挂载函数 |
| `style(admin): use base 8px radius for admin cards` | 卡片统一 8px 基础圆角（原先 l=12px，与「0.5 档」不一致） |

### 实现要点

- **外壳**：`.admin-shell` 用 CSS Grid `sidebar / topbar / main` 三区；不再调用 `renderShell()`，因此后台页没有公开站的 `.topbar` / `.footer`。登录页、加载态、错误态使用独立的 `.admin-auth` 居中容器。
- **侧栏动画**：`grid-template-columns: var(--admin-sidebar-width)` ↔ `--admin-sidebar-collapsed-width`，配 `transition: grid-template-columns var(--admin-motion)`（200ms cubic-bezier(0.33,1,0.68,1)）；收起态文字 `opacity: 0` 而非卸载，图标位置不跳动；状态存 `localStorage`（`azurekilnshare:admin-sidebar-collapsed`）。
- **路由**：`#overview` / `#files` / `#activity` / `#tokens`，`hashchange` 驱动重渲染，支持浏览器前进后退；`?page=` 作为兜底；`currentAdminPage()` / `navigateAdminPage()` 为对外 API。
- **页面标题**：只存在于顶栏 `.admin-topbar__title > h1`（并同步 `document.title`），主体内不再出现 `<h1>管理后台</h1>`。
- **账号区**：右上角头像按钮 + 下拉（导入分享 / 退出登录），点击外部关闭，`aria-expanded` 同步。
- **删除项**：侧栏「管理工作区 / 管理员」卡片、侧栏底部「管理员会话」、主体底部「AzureKiln · 管理控制台」页脚 —— 静态断言均为 0 命中。
- **挂载函数**（供 pi-2 / pi-4 填充，已在 admin.js 顶部注释写清）：`renderOverviewPage()`、`renderFilesPage()`、`renderActivityPage()`、`renderTokensPage()`；新增页面只需在 `ADMIN_PAGES` 加一项 + 实现同名函数。
- **响应式**：≤900px 侧栏固定收缩为 64px 图标轨道，顶栏出现菜单按钮；≤640px 隐藏账号文字与顶栏 eyebrow，避免横向溢出。

### 验证

- `node --check frontend/src/admin.js` 通过；`npm --prefix frontend run build` 通过。
- 几何断言（Playwright，本地 backend + `frontend/dist`，`/api/admin/*` 用 route stub 注入假数据）：
  - 1440×950：sidebar `0,0,232×950`；topbar `232,0,1208×64`；main `232,64,1208×…`；无横向溢出。
  - `h1` 数量 = 1，文本「概览」；`管理控制台` / `管理工作区` / `管理员会话` 均不存在；`.topbar` / `.footer` 均不存在。
  - 侧栏宽度 232 → 97.7（60ms 时）→ 64：宽度过渡动画确实在跑；收起后 `.admin-nav__text` opacity 0、品牌文字 opacity 0、主体 x = 64。
  - 点击导航 → `#files` 且标题变「文件管理」；`goBack()` → hash 回空、标题回「概览」。
  - 账号下拉展开后 `right=1416 ≤ 1440`，不溢出视口；菜单项 2 个。
  - 760×950：侧栏 64px、菜单按钮 `display:flex`、导航文字 `display:none`、无横向溢出。
  - 卡片圆角实测 8px（`.admin-card` / `.admin-stat-card`）。
- 公开页回归：`?file=` 仍渲染 `.app-shell` + `.topbar` + `.footer`，无 `.admin-shell`，`admin-session-token` 不被写入。
- `pageerror` 全程为空。

### 遗留 / 交接

- 本机没有可用的 MySQL（3306 拒绝连接，WSL Ubuntu 发行版磁盘缺失），因此视觉检查只能靠几何断言 + 真实数据 stub，未做像素级人工确认。pi-4 在全量检查时建议补一次真实数据的视觉确认。
- `admin.js` 在本任务进行期间也被 pi-2 / pi-4 并行编辑；本任务只提交自己负责的区域（外壳 / 路由 / 圆角 token / admin 布局 CSS），未回退他人改动。
- 公开下载页 `main.js` 与 `shared.js` 未做任何修改。

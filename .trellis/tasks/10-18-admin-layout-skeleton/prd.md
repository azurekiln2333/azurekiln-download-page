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

# pi-2 · 现有页面迁移与去重（Admin 控制台）

父任务：`.trellis/tasks/10-18-admin-console-newapi`（New API 风格改版）

## 背景
pi-1 负责布局骨架（壳/侧栏/顶栏/路由/半径 token）。pi-2 在 pi-1 定义的页面挂载函数上，把
`frontend/src/admin.js` 现有全部功能迁移进新页面结构，并做视觉去重。

## 范围（只改这些区域）
- `frontend/src/admin.js`：概览 / 文件管理 / 访问动态 三个页面的渲染与挂载函数，以及编辑弹窗
  （文件信息表单、存储链接增删改、IP 访客列表）。登录/致命错误页按需最小适配。
- `frontend/src/styles.css`：仅 `admin-*` 与页面内容相关的样式块。
- 不改 `frontend/src/main.js`、`shared.js`（除非 pi-1 已改动，需最小适配）。
- 不碰 `backend/*`。

## 依赖
- 阻塞于 pi-1 首个 `feat(admin)` 骨架提交（提供页面挂载函数与 class 命名约定）。
- 等 pi-1 期间先研读现有 admin.js 与 `D:\My2KProjects\new-api\web` 的卡片/表格样式。

## 需求
1. 页面拆分（功能零丢失）：
   - 概览页：统计卡（文件数/访问量/点击量/独立 IP/链接总数）+ 近 14 天趋势图。
   - 文件管理页：文件列表（含每行统计 chip、启用/停用/编辑/删除）+ 编辑弹窗
     （文件信息表单、分享链接展示、存储链接增删改、IP 访客列表）。
   - 访问动态页：最近 50 条访问/点击记录（目前 `stats.recent` 只取少量，按后端实际字段渲染）。
2. 视觉：
   - 圆角统一 0.5rem 档（`--radius` 派生），不得出现大圆角。
   - New API 风格的卡片与表格（表格化文件列表、卡内无多余双线）。
   - 保持 Azure Stream 原配色（现有 CSS 变量）。
3. 去重：无重复标题、无重复面包屑、卡片上下多余分割线、重复额度条/重复进度条。
4. 交互保留：编辑弹窗内保存文件信息、新增/保存/删除链接、访客列表刷新、登出、刷新数据、
   401 处理、错误提示与成功提示。

## 验收
- `cd frontend && npm run build` 通过。
- 三个页面均可切换，功能全部可用；弹窗内所有表单仍可提交。
- 无重复标题/分割线，圆角 0.5rem 档。
- 按页面分别 conventional commit（`feat(admin): ...`），只 add 自己改的文件。
- 不 push；不提交 `backend/.env`、`backend/*.sql` 删除态、`backend/importer.py`。

## 结果

全部完成，按页面分四次提交（不含并行 pi 的令牌页改动）：

| 提交 | 内容 |
|------|------|
| `1d52a12` feat(admin): rebuild overview page with stat cards and activity table | 概览页：`renderOverviewPage` 改为 New API `TitledCard` + `StatCard` 结构；`renderStatCard` 由「图标/值/标签/提示」四行堆叠改为「图标+标题 → 数值 → 2×详情小格」；统计卡从 5 张（含与其它卡重复的「独立访客 IP」）收敛为 4 张，访客数/今日数据移入详情格，去掉重复指标；`renderRecentRow` + 新增 `renderRecentTable` 由 div 列表改为表格；新增 `.admin-stat-grid`/`.admin-table`/`.admin-event`/`.admin-card__title` 样式，删除 `.admin-stats`/`.admin-stat-card__hint`。 |
| `0a21955` feat(admin): migrate file management page to a data table layout | 文件管理页：`renderFileRow` 由「卡片式 article + chip 组」改为表格行（文件 / 访问 / 点击 / 访客 IP / 链接 / 状态 / 操作）；新增 `renderFileTable` 与 `.admin-file-cell`/`.admin-status`/`.admin-file-actions`/`.admin-empty`；卡片头部加「导入分享 + 刷新」动作，绑定 `#admin-files-refresh`；`bindAdminPageEvents` 只在 files 页绑定文件列表，避免与概览页重复。 |
| `b7d0b72` feat(admin): build activity page with event filter segments | 访问动态页：`renderActivityPage` 渲染后端 `recent` 全部（最多 50 条）；新增事件筛选分段器（全部 / 访问 / 点击，含计数），状态存于 hash `#activity?filter=click`（`currentAdminPage` 已剥离 query，兼容）；新增 `.admin-segment` 样式。 |
| `9890052` feat(admin): restructure file editor dialog into tabbed panels | 编辑弹窗：原先「文件表单 + 存储链接 + IP 访客」三段式堆叠（每段一个 h2 + 一条 `border-top`，即重复标题/重复分割线）改为「身份头 + 3 个 tab + 单面板」；拆出 `renderFileInfoForm`/`renderLinksPanel`/`renderVisitorsPanel`/`selectDialogTab`/`syncDialogTabCounts`；`renderVisitorRow` 改为表格行；保存链接后保留当前 tab 与滚动位置，不再重置到顶部；弹窗 `border-radius` 改为 `var(--radius)`、宽度 820px、`overflow: hidden` + 内层滚动。 |
| `56204b7` fix(admin): restore muted chip style and tokenize auth card radius | 补回被一并删除的 `.chip--muted`（令牌页仍在用）；登录/加载卡片圆角 `12px` → `var(--radius-lg)`。 |

### 保留的功能（无丢失）
- 文件：编辑、启用/停用、删除、刷新、导入入口
- 弹窗：文件信息保存、提取码设置/清除、分享短链展示、存储链接新增/保存/删除、IP 访客列表
- 统计：totals / 14 天趋势 / 最近动态
- 认证：401 处理、登出、登录态存储

### 与并行任务的关系
- 只改 `renderOverviewPage` / `renderFilesPage` / `renderActivityPage` / `renderStatCard` / `renderFileTable` / `renderFileRow` / `renderRecentTable` / `renderRecentRow` / `renderVisitorRow` / 弹窗渲染与 `bindAdminPageEvents`。
- 未触碰 `renderTokensPage`、令牌 API、`backend/*`、`main.js`、`shared.js`。
- pi-1 随后提交的 `1bc1bca`（admin 卡片统一 `var(--radius)`）与本任务的 0.5rem 圆角档一致，无冲突。

### 验证
- `cd frontend && npm run build` 通过（每次提交前各跑一次）。
- `node --check frontend/src/admin.js` 通过。
- 渲染函数冒烟脚本验证：`renderFileRow` / `renderRecentRow` / `renderVisitorRow` 均输出 `<tr>`，`renderRecentTable` 输出 `<table>` 且空态回退 `.empty-preview`，`renderStatCard` 正确千分位与详情格。
- 检查确认 admin.js 不再引用 `.admin-stats`/`.admin-file-row`/`.admin-recent*`/`.admin-visitor-row`/`.admin-dialog-section` 等已删样式。

### 遗留
- `.access-card`/`.loading-panel` 与导入页共用的 `.import-*` 标记样式仍保留 `8px/999px` 字面值，属页面外壳与导入页共有区域，未在本任务范围内改动。


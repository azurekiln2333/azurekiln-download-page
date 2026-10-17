/**
 * AzureKilnShare · 管理后台（`?admin=dashboard` / `/admin`）
 *
 * 外壳（shell / 侧边栏 / 顶栏 / 路由）由本文件的「布局骨架」负责。
 * 各页面的内容挂载函数：
 *   - renderOverviewPage()  概览页（统计卡片、趋势、最近动态）—— pi-2 负责填充
 *   - renderFilesPage()     文件管理页（文件列表、编辑弹窗）—— pi-2 负责填充
 *   - renderActivityPage()  访问动态页（访客 IP / 访问日志）—— pi-2 负责填充
 *   - renderTokensPage()    令牌管理页（列表 / 新建 / 重命名 / 启停 / 删除）
 *
 * 新增页面：在 ADMIN_PAGES 里加一项，并实现对应的 render<Name>Page() 返回 HTML 字符串，
 * 然后按需在 renderAdminPage() 的绑定点注册事件。
 */
import { escapeHtml, formatDate, formatDateTime, renderIcon } from "./shared.js";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const ADMIN_TOKEN_STORAGE_KEY = "azurekilnshare:admin-session-token";
const LEGACY_ADMIN_TOKEN_SESSION_KEY = "azurekilnshare:admin-token";
const SIDEBAR_STORAGE_KEY = "azurekilnshare:admin-sidebar-collapsed";

const ADMIN_PAGES = [
  { id: "overview", label: "概览", icon: "dashboard", summary: "访问与点击统计总览" },
  { id: "files", label: "文件管理", icon: "folder_managed", summary: "分享文件与存储链接" },
  { id: "activity", label: "访问动态", icon: "history", summary: "访客 IP 与最近访问记录" },
  { id: "tokens", label: "令牌管理", icon: "key", summary: "管理后台访问令牌" }
];

const state = {
  token: readStoredAdminToken(),
  stats: null,
  files: [],
  pending: false,
  page: "overview",
  sidebarCollapsed: readSidebarCollapsed(),
  accountMenuOpen: false,
  loaded: false,
  tokens: [],
  envTokenEnabled: false,
  tokensLoading: false,
  tokensError: "",
  createdToken: ""
};
let editingFile = null;
let editingVisitors = [];
let editingTokenId = null;
let routerBound = false;
let outsideClickBound = false;

function readStoredAdminToken() {
  const token = window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY);
  if (token) {
    return token;
  }
  // Migrate the legacy key once, then drop it so the import page stops reusing it.
  const legacy = window.sessionStorage.getItem(LEGACY_ADMIN_TOKEN_SESSION_KEY);
  if (!legacy) {
    return "";
  }
  window.sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_SESSION_KEY);
  window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, legacy);
  return legacy;
}

function storeAdminToken(token) {
  window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
  window.sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_SESSION_KEY);
}

function clearStoredAdminToken() {
  window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
  window.sessionStorage.removeItem(LEGACY_ADMIN_TOKEN_SESSION_KEY);
}

function readSidebarCollapsed() {
  try {
    return window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function writeSidebarCollapsed(collapsed) {
  try {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(collapsed));
  } catch {
    /* 无法持久化时仅本次会话生效 */
  }
}

/* ------------------------------------------------------------------ *
 * 路由
 * ------------------------------------------------------------------ */

function currentAdminPage() {
  const hash = window.location.hash.replace(/^#\/?/, "").split("?")[0].trim();
  if (ADMIN_PAGES.some((page) => page.id === hash)) {
    return hash;
  }
  const query = new URLSearchParams(window.location.search).get("page");
  if (ADMIN_PAGES.some((page) => page.id === query)) {
    return query;
  }
  return "overview";
}

function navigateAdminPage(pageId, options = {}) {
  if (!ADMIN_PAGES.some((page) => page.id === pageId)) {
    return;
  }
  const nextHash = `#${pageId}`;
  if (window.location.hash === nextHash) {
    if (!options.silent) {
      state.page = pageId;
      renderAdminPage();
    }
    return;
  }
  // hashchange 监听器会负责重新渲染
  window.location.hash = nextHash;
}

function bindRouter() {
  if (routerBound) {
    return;
  }
  routerBound = true;
  window.addEventListener("hashchange", () => {
    state.page = currentAdminPage();
    state.accountMenuOpen = false;
    renderAdminPage();
  });
}

function bindOutsideClick() {
  if (outsideClickBound) {
    return;
  }
  outsideClickBound = true;
  document.addEventListener("click", (event) => {
    if (!state.accountMenuOpen) {
      return;
    }
    if (event.target.closest(".admin-account")) {
      return;
    }
    state.accountMenuOpen = false;
    syncAccountMenu();
  });
}

/* ------------------------------------------------------------------ *
 * 数据加载
 * ------------------------------------------------------------------ */

export function renderAdminDashboard() {
  if (!state.token) {
    renderLogin();
    return;
  }
  refreshData();
}

async function adminApi(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (state.token) {
    headers.set("X-Admin-Token", state.token);
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  let payload = null;
  const text = await response.text();
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { message: text };
    }
  }

  if (!response.ok) {
    const error = new Error(payload?.message || `请求失败：${response.status}`);
    error.status = response.status;
    throw error;
  }
  return payload;
}

function handleAuthError(error) {
  if (error.status !== 401) {
    return false;
  }
  state.token = "";
  state.pending = false;
  state.loaded = false;
  clearStoredAdminToken();
  renderLogin(error.message);
  return true;
}

async function refreshData(options = {}) {
  if (!options.silent || !state.loaded) {
    renderAdminLoading();
  }
  try {
    const [stats, filesPayload] = await Promise.all([
      adminApi("/admin/stats"),
      adminApi("/admin/files")
    ]);
    state.stats = stats;
    state.files = filesPayload.files || [];
    state.loaded = true;
    renderDashboard();
  } catch (error) {
    if (handleAuthError(error)) {
      return;
    }
    renderAdminFatal(error.message);
  }
}
async function refreshDashboardData() {
  try {
    const [stats, filesPayload] = await Promise.all([
      adminApi("/admin/stats"),
      adminApi("/admin/files")
    ]);
    state.stats = stats;
    state.files = filesPayload.files || [];
    const dialog = document.getElementById("admin-file-dialog");
    if (dialog?.open) {
      renderAdminBreadcrumbOnly();
    } else {
      renderAdminPage();
    }
  } catch (error) {
    handleAuthError(error);
  }
}

/* ------------------------------------------------------------------ *
 * 未登录 / 加载 / 错误
 *
 * 这些状态使用独立的 `.admin-auth` 居中容器，不套用登录后的侧栏外壳，
 * 因此公开下载页（main.js / shared.js）完全不受影响。
 * ------------------------------------------------------------------ */

function renderAdminLoading() {
  document.getElementById("app").innerHTML = `
    <div class="admin-auth">
      <section class="loading-panel" aria-live="polite">
        <span class="material-symbols-outlined loading-panel__icon" aria-hidden="true">progress_activity</span>
        <span>正在加载管理数据...</span>
      </section>
    </div>
  `;
}

function renderAdminFatal(message) {
  document.getElementById("app").innerHTML = `
    <div class="admin-auth">
      <section class="access-card">
        <div class="access-card__icon access-card__icon--error">
          <span class="material-symbols-outlined" aria-hidden="true">error</span>
        </div>
        <div class="access-card__header">
          <h1>管理后台</h1>
          <p>${escapeHtml(message)}</p>
        </div>
        <button class="primary-button" type="button" id="admin-retry">
          <span>重试</span>
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
        </button>
      </section>
    </div>
  `;
  document.getElementById("admin-retry")?.addEventListener("click", () => refreshData());
}

function renderLogin(message = "") {
  document.getElementById("app").innerHTML = `
    <div class="admin-auth">
      <section class="access-card">
        <div class="access-card__icon">
          <span class="material-symbols-outlined" aria-hidden="true">admin_panel_settings</span>
        </div>
        <div class="access-card__header">
          <h1>管理后台</h1>
          <p>输入后台管理密钥，查看访问统计并管理分享文件。</p>
        </div>
        <form class="access-form" id="admin-login-form">
          <label class="sr-only" for="admin-token-input">后台管理密钥</label>
          <div class="password-field">
            <span class="material-symbols-outlined password-field__icon" aria-hidden="true">key</span>
            <input id="admin-token-input" name="adminToken" type="password" autocomplete="current-password" placeholder="输入后台管理密钥" required />
          </div>
          ${message ? `<p class="form-error" role="alert">${escapeHtml(message)}</p>` : ""}
          <button class="primary-button" type="submit" ${state.pending ? "disabled" : ""}>
            ${
              state.pending
                ? `<span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span><span>验证中...</span>`
                : `<span>登录后台</span><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>`
            }
          </button>
        </form>
      </section>
    </div>
  `;

  const form = document.getElementById("admin-login-form");
  const input = document.getElementById("admin-token-input");

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const token = String(new FormData(form).get("adminToken") || "").trim();
    if (!token || state.pending) {
      return;
    }
    state.pending = true;
    const previousToken = state.token;
    state.token = token;
    renderLogin();
    try {
      await adminApi("/admin/stats");
      storeAdminToken(token);
      state.pending = false;
      await refreshData();
    } catch (error) {
      state.pending = false;
      state.token = previousToken;
      renderLogin(error.message);
    }
  });

  input.focus();
}

/* ------------------------------------------------------------------ *
 * 外壳
 * ------------------------------------------------------------------ */

function renderDashboard() {
  state.loaded = true;
  state.page = currentAdminPage();
  renderAdminShell();
  bindRouter();
  bindOutsideClick();
  renderAdminPage();
  syncSidebarState();
}

function renderAdminShell() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="admin-shell${state.sidebarCollapsed ? " admin-shell--collapsed" : ""}" id="admin-shell">
      <aside class="admin-sidebar" id="admin-sidebar" aria-label="后台导航">
        <div class="admin-sidebar__brand">
          <a class="admin-brand" href="/" aria-label="AzureKilnShare 首页">
            <span class="admin-brand__mark material-symbols-outlined" aria-hidden="true">shield</span>
            <span class="admin-brand__text">AzureKiln<span>Share</span></span>
          </a>
          <button class="admin-sidebar__collapse icon-button" id="admin-sidebar-toggle" type="button" aria-controls="admin-sidebar" aria-expanded="true" aria-label="收起导航" title="收起导航">
            <span class="material-symbols-outlined" aria-hidden="true">left_panel_close</span>
          </button>
        </div>
        <nav class="admin-nav">
          ${ADMIN_PAGES.map(renderNavItem).join("")}
        </nav>
      </aside>

      <div class="admin-topbar">
        <div class="admin-topbar__left">
          <button class="admin-topbar__menu icon-button" id="admin-sidebar-toggle-inline" type="button" aria-controls="admin-sidebar" aria-label="展开导航" title="展开导航">
            <span class="material-symbols-outlined" aria-hidden="true">menu</span>
          </button>
          <div class="admin-topbar__title">
            <span class="admin-topbar__eyebrow">管理后台</span>
            <h1 id="admin-page-title">概览</h1>
          </div>
        </div>
        <div class="admin-topbar__right">
          <button class="icon-button" id="admin-refresh" type="button" aria-label="刷新数据" title="刷新数据">
            <span class="material-symbols-outlined" aria-hidden="true">sync</span>
          </button>
          ${renderAccountMenu()}
        </div>
      </div>

      <main class="admin-main" id="admin-main"></main>
    </div>
    <dialog class="import-dialog" id="admin-file-dialog"></dialog>
  `;

  const dialog = document.getElementById("admin-file-dialog");
  dialog.addEventListener("click", onDialogClick);
  dialog.addEventListener("submit", onDialogSubmit);
  dialog.addEventListener("close", () => {
    editingFile = null;
    state.accountMenuOpen = false;
  });

  document.getElementById("admin-sidebar-toggle").addEventListener("click", () => toggleSidebar());
  document.getElementById("admin-sidebar-toggle-inline").addEventListener("click", () => toggleSidebar());
  document.getElementById("admin-refresh").addEventListener("click", () => refreshData());

  document.querySelector(".admin-nav").addEventListener("click", (event) => {
    const link = event.target.closest("[data-page]");
    if (!link) {
      return;
    }
    event.preventDefault();
    navigateAdminPage(link.dataset.page);
  });

  document.getElementById("admin-account-button").addEventListener("click", (event) => {
    event.stopPropagation();
    state.accountMenuOpen = !state.accountMenuOpen;
    syncAccountMenu();
  });

  document.querySelector(".admin-account__menu").addEventListener("click", (event) => {
    const action = event.target.closest("[data-account-action]")?.dataset.accountAction;
    if (action === "logout") {
      logoutAdmin();
    }
  });

  syncSidebarState();
  syncAccountMenu();
}

function renderNavItem(page) {
  return `
    <a class="admin-nav__item" href="#${page.id}" data-page="${page.id}" title="${escapeHtml(page.label)}">
      <span class="admin-nav__icon material-symbols-outlined" aria-hidden="true">${escapeHtml(page.icon)}</span>
      <span class="admin-nav__text">${escapeHtml(page.label)}</span>
    </a>
  `;
}

function renderAccountMenu() {
  return `
    <div class="admin-account">
      <button class="admin-account__button" id="admin-account-button" type="button" aria-haspopup="menu" aria-expanded="false">
        <span class="admin-account__avatar material-symbols-outlined" aria-hidden="true">shield_person</span>
        <span class="admin-account__meta">
          <strong>管理员</strong>
          <small>已登录会话</small>
        </span>
        <span class="admin-account__caret material-symbols-outlined" aria-hidden="true">expand_more</span>
      </button>
      <div class="admin-account__menu" role="menu" hidden>
        <a class="admin-account__item" role="menuitem" href="/?admin=import">
          <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
          <span>导入分享</span>
        </a>
        <button class="admin-account__item admin-account__item--danger" type="button" role="menuitem" data-account-action="logout">
          <span class="material-symbols-outlined" aria-hidden="true">logout</span>
          <span>退出登录</span>
        </button>
      </div>
    </div>
  `;
}

function toggleSidebar() {
  state.sidebarCollapsed = !state.sidebarCollapsed;
  writeSidebarCollapsed(state.sidebarCollapsed);
  syncSidebarState();
}

function syncSidebarState() {
  const shell = document.getElementById("admin-shell");
  if (!shell) {
    return;
  }
  shell.classList.toggle("admin-shell--collapsed", state.sidebarCollapsed);

  const toggle = document.getElementById("admin-sidebar-toggle");
  if (toggle) {
    const label = state.sidebarCollapsed ? "展开导航" : "收起导航";
    toggle.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
    toggle.setAttribute("aria-label", label);
    toggle.setAttribute("title", label);
    const icon = toggle.querySelector(".material-symbols-outlined");
    if (icon) {
      icon.textContent = state.sidebarCollapsed ? "left_panel_open" : "left_panel_close";
    }
  }
}

function syncAccountMenu() {
  const button = document.getElementById("admin-account-button");
  const menu = document.querySelector(".admin-account__menu");
  if (!button || !menu) {
    return;
  }
  button.setAttribute("aria-expanded", String(state.accountMenuOpen));
  menu.hidden = !state.accountMenuOpen;
  document.querySelector(".admin-account")?.classList.toggle("admin-account--open", state.accountMenuOpen);
}

function logoutAdmin() {
  state.token = "";
  state.stats = null;
  state.files = [];
  state.loaded = false;
  state.accountMenuOpen = false;
  clearStoredAdminToken();
  renderLogin();
}

/* ------------------------------------------------------------------ *
 * 页面渲染入口
 * ------------------------------------------------------------------ */

function renderAdminPage() {
  const main = document.getElementById("admin-main");
  if (!main) {
    return;
  }
  const page = ADMIN_PAGES.find((item) => item.id === state.page) || ADMIN_PAGES[0];
  document.title = `${page.label} · AzureKilnShare 管理后台`;
  const title = document.getElementById("admin-page-title");
  if (title) {
    title.textContent = page.label;
  }
  document.querySelectorAll(".admin-nav__item").forEach((item) => {
    const active = item.dataset.page === page.id;
    item.classList.toggle("admin-nav__item--active", active);
    if (active) {
      item.setAttribute("aria-current", "page");
    } else {
      item.removeAttribute("aria-current");
    }
  });

  main.innerHTML = renderAdminPageContent(page.id);
  bindAdminPageEvents(page.id);
}

function renderAdminPageContent(pageId) {
  switch (pageId) {
    case "files":
      return renderFilesPage();
    case "activity":
      return renderActivityPage();
    case "tokens":
      return renderTokensPage();
    case "overview":
    default:
      return renderOverviewPage();
  }
}

function bindAdminPageEvents(pageId) {
  if (pageId === "tokens") {
    bindTokensPageEvents();
    return;
  }
  if (pageId === "files") {
    const fileList = document.getElementById("admin-file-list");
    fileList?.addEventListener("click", onFileListClick);
    document.getElementById("admin-files-refresh")?.addEventListener("click", () => refreshData({ silent: true }));
    return;
  }
  if (pageId === "activity") {
    document.querySelector(".admin-segment")?.addEventListener("click", (event) => {
      const button = event.target.closest("[data-activity-filter]");
      if (!button) {
        return;
      }
      const value = button.dataset.activityFilter;
      const nextHash = value === "all" ? "#activity" : `#activity?filter=${value}`;
      if (window.location.hash === nextHash) {
        return;
      }
      window.location.hash = nextHash;
    });
  }
}

function renderAdminBreadcrumbOnly() {
  // 弹窗打开期间数据变化时不要重建主体，避免输入丢失
  const title = document.getElementById("admin-page-title");
  if (title) {
    const page = ADMIN_PAGES.find((item) => item.id === state.page) || ADMIN_PAGES[0];
    title.textContent = page.label;
  }
}

/* ------------------------------------------------------------------ *
 * 页面：概览
 *
 * 版式参考 New API 的 TitledCard + StatCard：
 *   - 统计卡一行（图标 + 标题 → 数值 → 详情小格），无重复标题与进度条。
 *   - 趋势卡与动态卡各自只有一个标题，卡内不再出现第二条分割线。
 * ------------------------------------------------------------------ */

function renderOverviewPage() {
  const totals = state.stats?.totals || {};
  const daily = state.stats?.daily || [];
  const recent = state.stats?.recent || [];
  const linkTotal = state.files.reduce((sum, file) => sum + Number(file.storageCount || 0), 0);
  const activeLinks = state.files.reduce((sum, file) => sum + Number(file.activeStorageCount ?? file.storageCount ?? 0), 0);

  return `
    <div class="admin-page" data-admin-page="overview">
      <section class="admin-stat-grid">
        ${renderStatCard({
          icon: "folder_shared",
          value: totals.files ?? 0,
          label: "分享文件总数",
          details: [
            { label: "启用中", value: `${totals.activeFiles ?? 0} 个` },
            { label: "已停用", value: `${Math.max(0, Number(totals.files ?? 0) - Number(totals.activeFiles ?? 0))} 个` }
          ]
        })}
        ${renderStatCard({
          icon: "visibility",
          value: totals.views ?? 0,
          label: "页面访问量",
          details: [
            { label: "今日", value: `${totals.todayViews ?? 0} 次` },
            { label: "独立 IP", value: `${totals.visitors ?? 0} 个` }
          ]
        })}
        ${renderStatCard({
          icon: "ads_click",
          value: totals.clicks ?? 0,
          label: "链接点击量",
          details: [
            { label: "今日", value: `${totals.todayClicks ?? 0} 次` },
            { label: "今日访客 IP", value: `${totals.todayVisitors ?? 0} 个` }
          ]
        })}
        ${renderStatCard({
          icon: "link",
          value: linkTotal,
          label: "存储链接总数",
          details: [
            { label: "启用中", value: `${activeLinks} 条` },
            { label: "覆盖文件", value: `${state.files.filter((file) => Number(file.storageCount || 0) > 0).length} 个` }
          ]
        })}
      </section>

      <section class="admin-card admin-card--trend" data-admin-card="trend">
        <div class="admin-card__head">
          <div class="admin-card__title">
            <h2>近 14 天趋势</h2>
            <p>每天的访问与链接点击量</p>
          </div>
          <span class="admin-trend-legend">
            <span><i class="admin-dot admin-dot--view"></i>访问</span>
            <span><i class="admin-dot admin-dot--click"></i>点击</span>
          </span>
        </div>
        ${renderTrend(daily)}
      </section>

      <section class="admin-card" data-admin-card="recent">
        <div class="admin-card__head">
          <div class="admin-card__title">
            <h2>最近动态</h2>
            <p>最新的访问与点击记录</p>
          </div>
          <a class="admin-card__link" href="#activity" data-page="activity">查看全部</a>
        </div>
        ${renderRecentTable(recent.slice(0, 8))}
      </section>
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * 页面：文件管理
 *
 * 文件列表是 New API 风格表格（每行一个文件），行内直接放统计数据与操作，
 * 表格底部不再接一条重复提示；编辑弹窗负责文件信息 / 存储链接 / IP 访客。
 * ------------------------------------------------------------------ */

function renderFilesPage() {
  const files = state.files;
  const activeCount = files.filter((file) => file.isActive).length;
  return `
    <div class="admin-page" data-admin-page="files">
      <section class="admin-card" data-admin-card="files">
        <div class="admin-card__head">
          <div class="admin-card__title">
            <h2>分享文件</h2>
            <p>共 ${files.length} 个文件，${activeCount} 个启用中</p>
          </div>
          <div class="admin-card__actions">
            <a class="secondary-button secondary-button--compact" href="/?admin=import">
              <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
              <span>导入分享</span>
            </a>
            <button class="secondary-button secondary-button--compact" id="admin-files-refresh" type="button">
              <span class="material-symbols-outlined" aria-hidden="true">sync</span>
              <span>刷新</span>
            </button>
          </div>
        </div>
        ${renderFileTable(files)}
      </section>
    </div>
  `;
}

function renderFileTable(files) {
  if (!files.length) {
    return `
      <div class="admin-empty">
        <span class="material-symbols-outlined" aria-hidden="true">folder_open</span>
        <p>还没有分享文件，先去导入一个吧。</p>
        <a class="primary-button primary-button--compact" href="/?admin=import">
          <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
          <span>导入分享</span>
        </a>
      </div>
    `;
  }

  return `
    <div class="admin-table-wrap">
      <table class="admin-table admin-table--files" id="admin-file-list">
        <thead>
          <tr>
            <th scope="col">文件</th>
            <th scope="col" class="admin-table__num">访问</th>
            <th scope="col" class="admin-table__num">点击</th>
            <th scope="col" class="admin-table__num">访客 IP</th>
            <th scope="col" class="admin-table__num">链接</th>
            <th scope="col">状态</th>
            <th scope="col" class="admin-table__right">操作</th>
          </tr>
        </thead>
        <tbody>
          ${files.map(renderFileRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * 页面：访问动态
 *
 * 后端 /admin/stats 的 recent 最多返回 50 条，这里直接渲染全部；
 * 事件类型作为筛选项，避免出现「标题 + 计数 + 另一块标题」的重复堆叠。
 * ------------------------------------------------------------------ */

function renderActivityPage() {
  const recent = state.stats?.recent || [];
  const clickCount = recent.filter((entry) => entry.event === "click").length;
  const viewCount = recent.length - clickCount;
  const filter = activityFilter();
  const visible = filter === "all" ? recent : recent.filter((entry) => entry.event === filter);

  return `
    <div class="admin-page" data-admin-page="activity">
      <section class="admin-card" data-admin-card="activity">
        <div class="admin-card__head">
          <div class="admin-card__title">
            <h2>访问动态</h2>
            <p>最近 ${recent.length} 条记录 · ${viewCount} 次访问 · ${clickCount} 次点击</p>
          </div>
          <div class="admin-segment" role="tablist" aria-label="按事件筛选">
            ${renderActivityFilter("all", "全部", recent.length, filter)}
            ${renderActivityFilter("view", "访问", viewCount, filter)}
            ${renderActivityFilter("click", "点击", clickCount, filter)}
          </div>
        </div>
        ${visible.length ? renderRecentTable(visible) : `<p class="empty-preview">暂无访问记录。</p>`}
      </section>
    </div>
  `;
}

function renderActivityFilter(value, label, count, active) {
  return `
    <button class="admin-segment__item ${value === active ? "admin-segment__item--active" : ""}" type="button" role="tab" aria-selected="${value === active}" data-activity-filter="${value}">
      <span>${label}</span>
      <span class="admin-segment__count">${count}</span>
    </button>
  `;
}

function activityFilter() {
  const params = new URLSearchParams(window.location.hash.split("?")[1] || "");
  const value = params.get("filter");
  return value === "view" || value === "click" ? value : "all";
}

/* ------------------------------------------------------------------ *
 * 页面：令牌管理
 *
 * 数据来自 /api/admin/tokens（见 .trellis/tasks/10-18-admin-tokens-api/prd.md）：
 *   GET    列表 { tokens: TokenItem[], envTokenEnabled }
 *   POST   { name } → { token, item }，token 明文仅此一次
 *   PUT    { name?, isActive? } → { item }
 *   DELETE → { ok }
 * 列表首项可能是 isEnvToken 的只读环境变量超级令牌。
 * ------------------------------------------------------------------ */

function renderTokensPage() {
  return `
    <div class="admin-page" data-admin-page="tokens">
      <section class="admin-card">
        <div class="admin-card__head">
          <h2>管理令牌</h2>
          <button class="primary-button primary-button--compact" id="admin-token-create" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">add</span>
            <span>新建令牌</span>
          </button>
        </div>
        <p class="admin-card__hint">令牌用于脚本或第三方工具调用 <code>/api/admin/*</code>；明文只在创建时显示一次。</p>
        ${renderTokenList()}
      </section>

      <dialog class="import-dialog admin-token-dialog" id="admin-token-dialog"></dialog>
    </div>
  `;
}

function renderTokenList() {
  if (state.tokensLoading) {
    return `<p class="empty-preview admin-token-loading"><span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span> 正在加载令牌...</p>`;
  }
  if (state.tokensError) {
    return `
      <div class="admin-token-error">
        <p class="form-error" role="alert">${escapeHtml(state.tokensError)}</p>
        <button class="secondary-button secondary-button--compact" type="button" data-token-action="reload">
          <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
          <span>重试</span>
        </button>
      </div>
    `;
  }
  if (!state.tokens.length) {
    return `<p class="empty-preview">还没有可管理的令牌，点击「新建令牌」生成一个。</p>`;
  }
  return `<div class="admin-token-list">${state.tokens.map(renderTokenRow).join("")}</div>`;
}

function renderTokenRow(token) {
  const env = Boolean(token.isEnvToken);
  const active = token.isActive !== false;
  const lastUsed = token.lastUsedLabel || (token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "从未使用");
  const created = token.createdAt ? formatDate(token.createdAt) : (env ? "随环境变量配置" : "未知日期");
  return `
    <article class="admin-token-row ${active ? "" : "admin-token-row--inactive"}" data-token-row="${escapeHtml(token.id)}">
      <div class="admin-token-row__icon">
        <span class="material-symbols-outlined" aria-hidden="true">${env ? "shield_lock" : "key"}</span>
      </div>
      <div class="admin-token-row__main">
        <div class="admin-token-row__title">
          <strong>${escapeHtml(token.name)}</strong>
          ${env ? `<span class="chip">环境变量</span>` : ""}
          <span class="chip ${active ? "" : "chip--muted"}">${active ? "已启用" : "已停用"}</span>
        </div>
        <code class="admin-token-row__prefix">${escapeHtml(token.tokenPrefix || "")}…</code>
        <small class="admin-token-row__meta">
          <span>创建于 ${escapeHtml(created)}</span>
          <span>最近使用 ${escapeHtml(lastUsed)}</span>
        </small>
      </div>
      <div class="admin-token-row__actions">
        ${
          env
            ? `<span class="admin-token-row__note">只读</span>`
            : `
              <button class="secondary-button secondary-button--compact" type="button" data-token-action="rename" data-token-id="${escapeHtml(token.id)}">
                <span class="material-symbols-outlined" aria-hidden="true">edit</span>
                <span>重命名</span>
              </button>
              <button class="secondary-button secondary-button--compact" type="button" data-token-action="toggle" data-token-id="${escapeHtml(token.id)}">
                <span>${active ? "停用" : "启用"}</span>
              </button>
              <button class="secondary-button secondary-button--compact admin-danger-button" type="button" data-token-action="delete" data-token-id="${escapeHtml(token.id)}">
                <span class="material-symbols-outlined" aria-hidden="true">delete</span>
                <span>删除</span>
              </button>
            `
        }
      </div>
    </article>
  `;
}

function bindTokensPageEvents() {
  document.getElementById("admin-token-create")?.addEventListener("click", () => openTokenDialog("create"));

  // 列表内容会被局部重绘，事件统一挂在外层容器上（只用 addEventListener 绑一次）
  const card = document.querySelector("[data-admin-page='tokens'] .admin-card");
  card?.addEventListener("click", (event) => {
    if (event.target.closest('[data-token-action="reload"]')) {
      loadAdminTokens();
      return;
    }
    onTokenListClick(event);
  });

  const dialog = document.getElementById("admin-token-dialog");
  if (!dialog) {
    return;
  }
  dialog.addEventListener("click", onTokenDialogClick);
  // form 在 dialog 内部，submit 会冒泡到 dialog；submit 事件 target 可能是 form，也可能是 dialog 本身
  dialog.addEventListener("submit", onTokenDialogSubmit);
  dialog.addEventListener("close", () => {
    editingTokenId = null;
    state.createdToken = "";
    // 关闭时立即销毁一次明文，避免再次打开弹窗时被重绘/恢复
    if (dialog.querySelector("#admin-token-secret")) {
      dialog.innerHTML = "";
    }
  });

  if (!state.tokens.length && !state.tokensLoading && !state.tokensError) {
    loadAdminTokens();
  }
}

async function loadAdminTokens() {
  state.tokensLoading = true;
  state.tokensError = "";
  renderTokenListInPlace();
  try {
    const payload = await adminApi("/admin/tokens");
    state.tokens = payload.tokens || [];
    state.envTokenEnabled = Boolean(payload.envTokenEnabled);
  } catch (error) {
    if (handleAuthError(error)) {
      return;
    }
    state.tokens = [];
    state.tokensError = error.message;
  } finally {
    state.tokensLoading = false;
    renderTokenListInPlace();
  }
}

function renderTokenListInPlace() {
  const card = document.querySelector("[data-admin-page='tokens'] .admin-card");
  if (!card) {
    return;
  }
  // 只替换列表容器，避免重建侧栏与顶栏
  // 注意：找不到容器的兼容分支要先删除旧内容再插入，否则会残留重复列表
  let slot = card.querySelector(".admin-token-slot");
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "admin-token-slot";
    card.querySelectorAll(".admin-token-list, .empty-preview, .admin-token-error").forEach((node) => node.remove());
    card.append(slot);
  }
  slot.innerHTML = renderTokenList();
}

async function onTokenListClick(event) {
  const button = event.target.closest("[data-token-action]");
  if (!button || button.disabled) {
    return;
  }
  const action = button.dataset.tokenAction;
  const token = state.tokens.find((item) => String(item.id) === button.dataset.tokenId);
  if (!token) {
    return;
  }

  if (action === "rename") {
    openTokenDialog("rename", token);
    return;
  }

  if (action === "toggle") {
    button.disabled = true;
    try {
      const { item } = await adminApi(`/admin/tokens/${encodeURIComponent(token.id)}`, {
        method: "PUT",
        body: { isActive: !token.isActive }
      });
      replaceToken(item);
      renderTokenListInPlace();
    } catch (error) {
      if (!handleAuthError(error)) {
        window.alert(error.message);
      }
      button.disabled = false;
    }
    return;
  }

  if (action === "delete") {
    if (!window.confirm(`确定删除令牌「${token.name}」？使用该令牌的脚本会立即失效。`)) {
      return;
    }
    button.disabled = true;
    try {
      await adminApi(`/admin/tokens/${encodeURIComponent(token.id)}`, { method: "DELETE" });
      state.tokens = removeToken(token.id);
      renderTokenListInPlace();
    } catch (error) {
      if (!handleAuthError(error)) {
        window.alert(error.message);
      }
      button.disabled = false;
    }
  }
}

function replaceToken(item) {
  if (!item) {
    return;
  }
  state.tokens = state.tokens.map((token) => (token.id === item.id ? item : token));
}

function removeToken(id) {
  return state.tokens.filter((token) => token.id !== id);
}

// 新建令牌后保持「env 只读条目在最前、且不重复、不重复插入」
function prependCreatedToken(item) {
  const envToken = state.tokens.find((token) => token.isEnvToken);
  const rest = state.tokens.filter(
    (token) => !token.isEnvToken && (!item || token.id !== item.id)
  );
  state.tokens = [envToken, item, ...rest].filter(Boolean);
}

function openTokenDialog(mode, token = null) {
  const dialog = document.getElementById("admin-token-dialog");
  if (!dialog) {
    return;
  }
  if (mode === "rename" && !token) {
    return;
  }
  editingTokenId = mode === "rename" ? token.id : null;
  state.createdToken = "";
  dialog.innerHTML = renderTokenDialogContent(mode, token);
  if (typeof dialog.showModal === "function") {
    if (!dialog.open) {
      dialog.showModal();
    }
  } else {
    dialog.setAttribute("open", "");
  }
  const input = dialog.querySelector("input[name='name']");
  input?.focus();
  input?.select();
}

function renderTokenDialogContent(mode, token) {
  const isRename = mode === "rename";
  return `
    <div class="admin-dialog__body">
      <div class="import-dialog__header">
        <div>
          <h2>${isRename ? "重命名令牌" : "新建管理令牌"}</h2>
          <p>${isRename ? `当前前缀 ${escapeHtml(token.tokenPrefix || "")}…` : "给令牌起一个便于识别的名字，例如 ci-bot 或 监控脚本。"}</p>
        </div>
        <button class="icon-button" type="button" data-token-dialog-action="close" aria-label="关闭">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <form class="admin-token-form" id="admin-token-form" data-token-mode="${isRename ? "rename" : "create"}">
        <label class="field">
          <span>令牌名称</span>
          <input name="name" type="text" required maxlength="128" autocomplete="off" value="${isRename ? escapeHtml(token.name) : ""}" placeholder="例如 ci-bot" />
        </label>
        <p class="form-error" data-token-error role="alert" hidden></p>
        <div class="import-actions">
          <button class="secondary-button" type="button" data-token-dialog-action="close">取消</button>
          <button class="primary-button" type="submit">
            <span class="material-symbols-outlined" aria-hidden="true">${isRename ? "save" : "key"}</span>
            <span>${isRename ? "保存名称" : "创建令牌"}</span>
          </button>
        </div>
      </form>
    </div>
  `;
}

function renderCreatedTokenPanel(token) {
  return `
    <div class="admin-dialog__body">
      <div class="import-dialog__header">
        <div>
          <h2>令牌已创建</h2>
          <p>明文只显示这一次，关闭后无法再次查看。</p>
        </div>
        <button class="icon-button" type="button" data-token-dialog-action="close" aria-label="关闭">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>
      <div class="admin-token-secret">
        <code id="admin-token-secret">${escapeHtml(token)}</code>
        <button class="secondary-button secondary-button--compact" type="button" data-token-dialog-action="copy">
          <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
          <span>复制</span>
        </button>
      </div>
      <p class="admin-token-secret__note">请把令牌发给需要使用它的脚本，并妥善保管。</p>
      <div class="import-actions">
        <button class="primary-button" type="button" data-token-dialog-action="close">我已保存</button>
      </div>
    </div>
  `;
}

async function onTokenDialogClick(event) {
  const action = event.target.closest("[data-token-dialog-action]")?.dataset.tokenDialogAction;
  if (!action) {
    return;
  }
  const dialog = event.target.closest("dialog");
  if (!dialog) {
    return;
  }
  if (action === "close") {
    dialog.close();
    return;
  }
  if (action === "copy") {
    const button = event.target.closest("[data-token-dialog-action='copy']");
    // 以 DOM 中的实际明文为准，避免 state 被清理后复制到空串
    const value = dialog.querySelector("#admin-token-secret")?.textContent || state.createdToken;
    if (!value) {
      window.alert("令牌已不可见，请关闭弹窗后重新创建。");
      return;
    }
    try {
      await copyToClipboard(value);
      const label = button?.querySelector("span:last-child");
      if (label) {
        label.textContent = "已复制";
      }
    } catch {
      window.alert("复制失败，请手动选择令牌文本复制。");
    }
  }
}

async function copyToClipboard(value) {
  if (!value) {
    throw new Error("nothing to copy");
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.append(textarea);
  textarea.select();
  const ok = document.execCommand("copy");
  textarea.remove();
  if (!ok) {
    throw new Error("copy failed");
  }
}

async function onTokenDialogSubmit(event) {
  // submit 由 <dialog> 内的 <form> 发出：target 是 form，closest() 能命中；
  // 若浏览器把 target 归一为 dialog，则向下查找 form。
  const form =
    event.target instanceof HTMLFormElement
      ? event.target
      : event.target.closest("#admin-token-form") || event.currentTarget?.querySelector("#admin-token-form");
  if (!form || form.id !== "admin-token-form") {
    return;
  }
  event.preventDefault();
  if (form.dataset.submitting === "true") {
    return;
  }
  const dialog = form.closest("dialog");
  const errorElement = form.querySelector("[data-token-error]");
  const submit = form.querySelector("button[type='submit']");
  const name = String(new FormData(form).get("name") || "").trim();
  if (errorElement) {
    errorElement.hidden = true;
  }

  if (!name) {
    if (errorElement) {
      errorElement.textContent = "令牌名称不能为空。";
      errorElement.hidden = false;
    }
    return;
  }

  form.dataset.submitting = "true";
  if (submit) {
    submit.disabled = true;
  }
  try {
    if (form.dataset.tokenMode === "rename") {
      const { item } = await adminApi(`/admin/tokens/${encodeURIComponent(editingTokenId)}`, {
        method: "PUT",
        body: { name }
      });
      replaceToken(item);
      renderTokenListInPlace();
      dialog?.close();
      return;
    }

    const payload = await adminApi("/admin/tokens", { method: "POST", body: { name } });
    state.createdToken = payload.token || "";
    prependCreatedToken(payload.item);
    renderTokenListInPlace();
    if (dialog) {
      dialog.innerHTML = renderCreatedTokenPanel(state.createdToken);
      dialog.querySelector("[data-token-dialog-action='copy']")?.focus();
    }
  } catch (error) {
    if (handleAuthError(error)) {
      return;
    }
    if (errorElement) {
      errorElement.textContent = error.message;
      errorElement.hidden = false;
    }
  } finally {
    form.dataset.submitting = "false";
    if (submit) {
      submit.disabled = false;
    }
  }
}

/* ------------------------------------------------------------------ *
 * 组件：统计卡（New API StatCard 版式）
 * ------------------------------------------------------------------ */

function renderStatCard({ icon, value, label, details = [] }) {
  return `
    <article class="admin-stat-card">
      <div class="admin-stat-card__head">
        <span class="admin-stat-card__icon material-symbols-outlined" aria-hidden="true">${escapeHtml(icon)}</span>
        <span class="admin-stat-card__label">${escapeHtml(label)}</span>
      </div>
      <span class="admin-stat-card__value">${Number(value || 0).toLocaleString("zh-CN")}</span>
      ${
        details.length
          ? `<dl class="admin-stat-card__details">${details
              .map(
                (detail) => `
                  <div class="admin-stat-card__detail">
                    <dt>${escapeHtml(detail.label)}</dt>
                    <dd>${escapeHtml(detail.value)}</dd>
                  </div>
                `
              )
              .join("")}</dl>`
          : ""
      }
    </article>
  `;
}

function renderTrend(daily) {
  if (!daily.length) {
    return `<p class="empty-preview">暂无统计数据。</p>`;
  }
  const max = Math.max(1, ...daily.map((day) => Number(day.views || 0) + Number(day.clicks || 0)));
  return `
    <div class="admin-trend">
      ${daily
        .map((day) => {
          const views = Number(day.views || 0);
          const clicks = Number(day.clicks || 0);
          const total = views + clicks;
          const height = total ? Math.max(8, Math.round((total / max) * 100)) : 6;
          const clickHeight = total ? Math.max(total > views ? 8 : 0, Math.round((clicks / total) * height)) : 0;
          const viewHeight = Math.max(0, height - clickHeight);
          return `
            <div class="admin-trend__bar" title="${escapeHtml(day.date)}：访问 ${views} 次 / 点击 ${clicks} 次">
              <div class="admin-trend__stack">
                ${
                  total
                    ? `<span class="admin-trend__fill admin-trend__fill--click" style="height:${clickHeight}%"></span>
                       <span class="admin-trend__fill admin-trend__fill--view" style="height:${viewHeight}%"></span>`
                    : `<span class="admin-trend__fill admin-trend__fill--empty" style="height:100%"></span>`
                }
              </div>
              <span class="admin-trend__day">${escapeHtml(String(day.date).slice(5))}</span>
            </div>
          `;
        })
        .join("")}
    </div>
  `;
}

function renderFileRow(file) {
  return `
    <tr class="admin-table__row ${file.isActive ? "" : "admin-table__row--inactive"}">
      <td>
        <div class="admin-file-cell">
          <span class="admin-file-cell__icon">${renderIcon(file.icon)}</span>
          <div class="admin-file-cell__main">
            <strong title="${escapeHtml(file.title)}">${escapeHtml(file.title)}</strong>
            <small>${escapeHtml(file.id)} · 更新于 ${formatDate(file.updatedAt)}</small>
          </div>
        </div>
      </td>
      <td class="admin-table__num">${Number(file.viewCount || 0).toLocaleString("zh-CN")}</td>
      <td class="admin-table__num">${Number(file.clickCount || 0).toLocaleString("zh-CN")}</td>
      <td class="admin-table__num">${Number(file.visitorCount || 0).toLocaleString("zh-CN")}</td>
      <td class="admin-table__num">${Number(file.storageCount || 0).toLocaleString("zh-CN")}</td>
      <td>
        <span class="admin-status ${file.isActive ? "admin-status--on" : "admin-status--off"}">
          ${file.isActive ? "已启用" : "已停用"}
        </span>
      </td>
      <td class="admin-table__right">
        <div class="admin-file-actions">
          <button class="secondary-button secondary-button--compact" type="button" data-edit-file="${escapeHtml(file.id)}">
            <span class="material-symbols-outlined" aria-hidden="true">edit</span>
            <span>编辑</span>
          </button>
          <button class="secondary-button secondary-button--compact" type="button" data-toggle-file="${escapeHtml(file.id)}">
            <span>${file.isActive ? "停用" : "启用"}</span>
          </button>
          <button class="secondary-button secondary-button--compact admin-danger-button" type="button" data-delete-file="${escapeHtml(file.id)}">
            <span class="material-symbols-outlined" aria-hidden="true">delete</span>
            <span>删除</span>
          </button>
        </div>
      </td>
    </tr>
  `;
}

function renderRecentTable(entries) {
  if (!entries.length) {
    return `<p class="empty-preview">暂无访问记录。</p>`;
  }
  return `
    <div class="admin-table-wrap">
      <table class="admin-table admin-table--activity">
        <thead>
          <tr>
            <th scope="col">事件</th>
            <th scope="col">文件</th>
            <th scope="col">详情</th>
            <th scope="col">来源 IP</th>
            <th scope="col" class="admin-table__right">时间</th>
          </tr>
        </thead>
        <tbody>
          ${entries.map(renderRecentRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderRecentRow(entry) {
  const isClick = entry.event === "click";
  const detail = isClick
    ? `点击「${entry.linkName || entry.storageKey || "链接"}」`
    : "打开了分享页";
  return `
    <tr class="admin-table__row">
      <td>
        <span class="admin-event ${isClick ? "admin-event--click" : ""}">
          <span class="material-symbols-outlined" aria-hidden="true">${isClick ? "ads_click" : "visibility"}</span>
          <span>${isClick ? "点击" : "访问"}</span>
        </span>
      </td>
      <td class="admin-table__strong" title="${escapeHtml(entry.fileTitle || entry.fileId)}">${escapeHtml(entry.fileTitle || entry.fileId)}</td>
      <td class="admin-table__secondary">${escapeHtml(detail)}</td>
      <td class="admin-table__mono">${entry.ip ? escapeHtml(entry.ip) : "—"}</td>
      <td class="admin-table__right admin-table__secondary">${escapeHtml(formatDateTime(entry.createdAt))}</td>
    </tr>
  `;
}

/* ------------------------------------------------------------------ *
 * 文件操作（pi-2 负责细化）
 * ------------------------------------------------------------------ */

async function onFileListClick(event) {
  const editButton = event.target.closest("[data-edit-file]");
  const toggleButton = event.target.closest("[data-toggle-file]");
  const deleteButton = event.target.closest("[data-delete-file]");

  if (editButton) {
    await openFileEditor(editButton.dataset.editFile);
    return;
  }

  if (toggleButton) {
    const file = state.files.find((item) => item.id === toggleButton.dataset.toggleFile);
    if (!file) {
      return;
    }
    toggleButton.disabled = true;
    try {
      await adminApi(`/admin/files/${encodeURIComponent(file.id)}`, {
        method: "PUT",
        body: { isActive: !file.isActive }
      });
      await refreshData({ silent: true });
    } catch (error) {
      if (!handleAuthError(error)) {
        window.alert(error.message);
      }
      toggleButton.disabled = false;
    }
    return;
  }

  if (deleteButton) {
    const file = state.files.find((item) => item.id === deleteButton.dataset.deleteFile);
    if (!file) {
      return;
    }
    if (!window.confirm(`确定删除「${file.title}」？该文件的所有链接与点击记录会一并删除，且无法恢复。`)) {
      return;
    }
    deleteButton.disabled = true;
    try {
      await adminApi(`/admin/files/${encodeURIComponent(file.id)}`, { method: "DELETE" });
      await refreshData({ silent: true });
    } catch (error) {
      if (!handleAuthError(error)) {
        window.alert(error.message);
      }
      deleteButton.disabled = false;
    }
  }
}

async function openFileEditor(fileId) {
  try {
    const [filePayload, visitorsPayload] = await Promise.all([
      adminApi(`/admin/files/${encodeURIComponent(fileId)}`),
      adminApi(`/admin/files/${encodeURIComponent(fileId)}/visitors`)
    ]);
    editingFile = filePayload.file;
    editingVisitors = visitorsPayload.visitors || [];
    const dialog = document.getElementById("admin-file-dialog");
    renderDialogContent(editingFile);
    dialog.showModal();
  } catch (error) {
    if (!handleAuthError(error)) {
      window.alert(error.message);
    }
  }
}

function renderDialogContent(file) {
  const dialog = document.getElementById("admin-file-dialog");
  dialog.innerHTML = `
    <div class="admin-dialog__body" data-admin-dialog="file">
      <div class="import-dialog__header admin-dialog__header">
        <div class="admin-dialog__identity">
          <span class="admin-dialog__icon">${renderIcon(file.icon)}</span>
          <div>
            <h2>${escapeHtml(file.title)}</h2>
            <p>${escapeHtml(file.id)} · 更新于 ${formatDate(file.updatedAt)}</p>
          </div>
        </div>
        <button class="icon-button" id="admin-dialog-close" type="button" aria-label="关闭">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

      <div class="admin-dialog-tabs" role="tablist" aria-label="编辑弹窗分区">
        ${renderDialogTab("info", "文件信息", "description")}
        ${renderDialogTab("links", `存储链接 ${file.links.length}`, "link")}
        ${renderDialogTab("visitors", `IP 访客 ${editingVisitors.length}`, "group")}
      </div>

      <div class="admin-dialog-panel" data-dialog-panel="info"></div>
      <div class="admin-dialog-panel" data-dialog-panel="links" hidden></div>
      <div class="admin-dialog-panel" data-dialog-panel="visitors" hidden></div>
    </div>
  `;

  renderDialogPanels(file);

  document.getElementById("admin-dialog-close").addEventListener("click", () => {
    dialog.close();
  });

  dialog.querySelector(".admin-dialog-tabs").addEventListener("click", (event) => {
    const tab = event.target.closest("[data-dialog-tab]");
    if (tab) {
      selectDialogTab(tab.dataset.dialogTab);
    }
  });
}

function renderDialogTab(id, label, icon) {
  return `
    <button class="admin-dialog-tabs__item" type="button" role="tab" aria-selected="false" data-dialog-tab="${id}">
      <span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(icon)}</span>
      <span>${escapeHtml(label)}</span>
    </button>
  `;
}

function selectDialogTab(id, options = {}) {
  const dialog = document.getElementById("admin-file-dialog");
  if (!dialog) {
    return;
  }
  dialog.querySelectorAll("[data-dialog-tab]").forEach((tab) => {
    const active = tab.dataset.dialogTab === id;
    tab.classList.toggle("admin-dialog-tabs__item--active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  dialog.querySelectorAll("[data-dialog-panel]").forEach((panel) => {
    panel.hidden = panel.dataset.dialogPanel !== id;
  });
  if (options.focus) {
    dialog.querySelector(`[data-dialog-panel="${id}"] input, [data-dialog-panel="${id}"] button`)?.focus();
  }
}

function renderDialogPanels(file, options = {}) {
  const dialog = document.getElementById("admin-file-dialog");
  if (!dialog) {
    return;
  }
  const info = dialog.querySelector('[data-dialog-panel="info"]');
  const links = dialog.querySelector('[data-dialog-panel="links"]');
  const visitors = dialog.querySelector('[data-dialog-panel="visitors"]');
  if (!info || !links || !visitors) {
    return;
  }
  info.innerHTML = renderFileInfoForm(file);
  links.innerHTML = renderLinksPanel(file);
  visitors.innerHTML = renderVisitorsPanel();

  // 保持当前激活的分区，默认停在文件信息
  const active = options.activeTab || dialog.dataset.activeTab || "info";
  selectDialogTab(active);
  dialog.dataset.activeTab = active;
}

function renderFileInfoForm(file) {
  return `
    <form class="admin-file-form" id="admin-file-form">
      <div class="field-grid">
        <label class="field">
          <span>标题</span>
          <input name="title" type="text" value="${escapeHtml(file.title)}" required />
        </label>
        <label class="field">
          <span>文件名</span>
          <input name="fileName" type="text" value="${escapeHtml(file.name || "")}" />
        </label>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>大小标签</span>
          <input name="sizeLabel" type="text" value="${escapeHtml(file.sizeLabel || "")}" placeholder="例如 1.2 GB" />
        </label>
        <label class="field">
          <span>过期时间</span>
          <input name="expiresAt" type="datetime-local" value="${escapeHtml(toLocalInputValue(file.expiresAt))}" />
        </label>
      </div>
      <label class="field">
        <span>说明</span>
        <input name="description" type="text" value="${escapeHtml(file.description || "")}" placeholder="显示在下载页的文件说明" />
      </label>
      <div class="field-grid">
        <label class="field">
          <span>提取码</span>
          <input name="accessCode" type="text" placeholder="${file.protected ? "已设置，留空保持不变" : "未设置"}" autocomplete="new-password" />
        </label>
        <label class="toggle-field">
          <input name="isActive" type="checkbox" ${file.isActive ? "checked" : ""} />
          <span>启用分享</span>
        </label>
      </div>
      <label class="toggle-field">
        <input name="clearAccessCode" type="checkbox" />
        <span>清除提取码（访问页面将不再需要提取码）</span>
      </label>
      <div class="admin-share-urls">
        <code>${escapeHtml(buildShareUrl(file.id))}</code>
        ${file.shortUrl ? `<code>${escapeHtml(file.shortUrl)}</code>` : `<code class="admin-share-urls__muted">短链未生成</code>`}
      </div>
      <p class="form-error" id="admin-file-form-error" role="alert" hidden></p>
      <div class="import-actions">
        <button class="primary-button" type="submit">
          <span class="material-symbols-outlined" aria-hidden="true">save</span>
          <span>保存文件信息</span>
        </button>
      </div>
    </form>
  `;
}

function renderLinksPanel(file) {
  return `
    <div class="admin-link-list" id="admin-link-list">
      ${file.links.map(renderLinkRow).join("") || `<p class="empty-preview">还没有存储链接。</p>`}
    </div>
    <form class="admin-link-add" id="admin-link-add-form">
      <div class="admin-link-add__title">新增链接</div>
      <label class="field">
        <span>链接 URL</span>
        <input name="url" type="text" required placeholder="https://..." />
      </label>
      <div class="field-grid">
        <label class="field">
          <span>网盘名称</span>
          <input name="storageName" type="text" placeholder="例如 123云盘，留空自动识别" />
        </label>
        <label class="field">
          <span>提取码</span>
          <input name="extractCode" type="text" placeholder="可留空" />
        </label>
      </div>
      <label class="field">
        <span>说明（按钮文字）</span>
        <input name="note" type="text" placeholder="留空显示为 打开" />
      </label>
      <p class="form-error" id="admin-link-add-error" role="alert" hidden></p>
      <div class="import-actions">
        <button class="secondary-button" type="submit">
          <span class="material-symbols-outlined" aria-hidden="true">add_link</span>
          <span>添加链接</span>
        </button>
      </div>
    </form>
  `;
}

function renderVisitorsPanel() {
  if (!editingVisitors.length) {
    return `<p class="empty-preview">暂无访客记录。</p>`;
  }
  return `
    <div class="admin-table-wrap">
      <table class="admin-table admin-table--visitors">
        <thead>
          <tr>
            <th scope="col">IP 地址</th>
            <th scope="col" class="admin-table__num">访问</th>
            <th scope="col" class="admin-table__num">点击</th>
            <th scope="col" class="admin-table__right">最近访问</th>
          </tr>
        </thead>
        <tbody>
          ${editingVisitors.map(renderVisitorRow).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderLinkRow(link) {
  return `
    <form class="admin-link-row" data-link-id="${link.id}">
      <div class="admin-link-row__head">
        <div class="admin-link-row__title">
          ${renderIcon(link.icon)}
          <strong>${escapeHtml(link.name)}</strong>
        </div>
        <span class="chip" title="最近点击：${escapeHtml(link.lastClickedAt ? formatDateTime(link.lastClickedAt) : "暂无")}">
          <span class="material-symbols-outlined" aria-hidden="true">ads_click</span>${link.clickCount} 次点击
        </span>
      </div>
      <label class="field">
        <span>链接 URL</span>
        <input name="url" type="text" value="${escapeHtml(link.url)}" required />
      </label>
      <div class="field-grid">
        <label class="field">
          <span>网盘名称</span>
          <input name="storageName" type="text" value="${escapeHtml(link.name)}" required />
        </label>
        <label class="field">
          <span>提取码</span>
          <input name="extractCode" type="text" value="${escapeHtml(link.extractCode)}" />
        </label>
      </div>
      <div class="field-grid">
        <label class="field">
          <span>说明（按钮文字）</span>
          <input name="note" type="text" value="${escapeHtml(link.note)}" />
        </label>
        <label class="field">
          <span>排序</span>
          <input name="sortOrder" type="number" value="${escapeHtml(link.sortOrder)}" />
        </label>
      </div>
      <div class="admin-link-row__foot">
        <label class="toggle-field">
          <input name="isActive" type="checkbox" ${link.isActive ? "checked" : ""} />
          <span>启用</span>
        </label>
        <span class="admin-link-row__key">${escapeHtml(link.storageKey)}</span>
        <button class="secondary-button secondary-button--compact admin-danger-button" type="button" data-delete-link>
          <span>删除</span>
        </button>
        <button class="secondary-button secondary-button--compact" type="submit">
          <span class="material-symbols-outlined" aria-hidden="true">save</span>
          <span>保存</span>
        </button>
      </div>
      <p class="form-error" data-link-error role="alert" hidden></p>
    </form>
  `;
}

async function onDialogSubmit(event) {
  event.preventDefault();
  const form = event.target;

  if (form.id === "admin-file-form") {
    await saveFileForm(form);
    return;
  }

  if (form.id === "admin-link-add-form") {
    await addLink(form);
    return;
  }

  if (form.dataset.linkId) {
    await saveLinkRow(form);
  }
}

async function saveFileForm(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const errorElement = document.getElementById("admin-file-form-error");
  const submit = form.querySelector("button[type='submit']");
  errorElement.hidden = true;

  const body = {
    title: data.title,
    fileName: data.fileName,
    description: data.description,
    sizeLabel: data.sizeLabel,
    expiresAt: data.expiresAt || "",
    isActive: form.elements.isActive.checked,
    clearAccessCode: form.elements.clearAccessCode.checked
  };
  if (String(data.accessCode || "").trim()) {
    body.accessCode = String(data.accessCode).trim();
  }

  submit.disabled = true;
  try {
    const { file } = await adminApi(`/admin/files/${encodeURIComponent(editingFile.id)}`, {
      method: "PUT",
      body
    });
    editingFile = file;
    renderDialogPanels(file, { activeTab: "info" });
    await refreshDashboardData();
    const savedNote = document.createElement("p");
    savedNote.className = "success-box";
    savedNote.textContent = "文件信息已保存。";
    document.getElementById("admin-file-form").prepend(savedNote);
    window.setTimeout(() => savedNote.remove(), 2400);
  } catch (error) {
    if (handleAuthError(error)) {
      return;
    }
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function saveLinkRow(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const errorElement = form.querySelector("[data-link-error]");
  const submit = form.querySelector("button[type='submit']");
  errorElement.hidden = true;

  const body = {
    storageName: data.storageName,
    url: data.url,
    extractCode: data.extractCode || "",
    note: data.note || "",
    sortOrder: data.sortOrder,
    isActive: form.elements.isActive.checked
  };

  submit.disabled = true;
  try {
    await adminApi(`/admin/links/${form.dataset.linkId}`, { method: "PUT", body });
    await reloadEditingFile();
    await refreshDashboardData();
  } catch (error) {
    if (handleAuthError(error)) {
      return;
    }
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function addLink(form) {
  const data = Object.fromEntries(new FormData(form).entries());
  const errorElement = document.getElementById("admin-link-add-error");
  const submit = form.querySelector("button[type='submit']");
  errorElement.hidden = true;

  const body = {
    storageName: data.storageName || "",
    url: data.url,
    extractCode: data.extractCode || "",
    note: data.note || ""
  };

  submit.disabled = true;
  try {
    await adminApi(`/admin/files/${encodeURIComponent(editingFile.id)}/links`, {
      method: "POST",
      body
    });
    form.reset();
    await reloadEditingFile();
    await refreshDashboardData();
  } catch (error) {
    if (handleAuthError(error)) {
      return;
    }
    errorElement.textContent = error.message;
    errorElement.hidden = false;
  } finally {
    submit.disabled = false;
  }
}

async function onDialogClick(event) {
  const closeButton = event.target.closest("#admin-dialog-close");
  if (closeButton) {
    closeButton.closest("dialog").close();
    return;
  }

  const deleteButton = event.target.closest("[data-delete-link]");
  if (deleteButton) {
    const form = deleteButton.closest("[data-link-id]");
    const link = editingFile?.links.find((item) => String(item.id) === form.dataset.linkId);
    if (!link) {
      return;
    }
    if (!window.confirm(`确定删除链接「${link.name}」？该链接的点击记录会保留在文件统计里。`)) {
      return;
    }
    deleteButton.disabled = true;
    try {
      await adminApi(`/admin/links/${link.id}`, { method: "DELETE" });
      await reloadEditingFile();
      await refreshDashboardData();
    } catch (error) {
      if (!handleAuthError(error)) {
        window.alert(error.message);
      }
      deleteButton.disabled = false;
    }
  }
}

async function reloadEditingFile() {
  if (!editingFile) {
    return;
  }
  const [filePayload, visitorsPayload] = await Promise.all([
    adminApi(`/admin/files/${encodeURIComponent(editingFile.id)}`),
    adminApi(`/admin/files/${encodeURIComponent(editingFile.id)}/visitors`)
  ]);
  editingFile = filePayload.file;
  editingVisitors = visitorsPayload.visitors || [];
  const dialog = document.getElementById("admin-file-dialog");
  if (dialog.open) {
    // 保留当前分区与滚动位置，避免保存后跳回顶部
    renderDialogPanels(editingFile, { activeTab: dialog.dataset.activeTab || "info" });
    syncDialogTabCounts();
  }
}

function syncDialogTabCounts() {
  const dialog = document.getElementById("admin-file-dialog");
  if (!dialog || !editingFile) {
    return;
  }
  const counts = { info: "文件信息", links: `存储链接 ${editingFile.links.length}`, visitors: `IP 访客 ${editingVisitors.length}` };
  dialog.querySelectorAll("[data-dialog-tab]").forEach((tab) => {
    const label = counts[tab.dataset.dialogTab];
    const text = tab.querySelector("span:last-child");
    if (label && text) {
      text.textContent = label;
    }
  });
}

function renderVisitorRow(visitor) {
  return `
    <tr class="admin-table__row">
      <td class="admin-table__mono">${escapeHtml(visitor.ip)}</td>
      <td class="admin-table__num">${Number(visitor.viewCount || 0).toLocaleString("zh-CN")}</td>
      <td class="admin-table__num">${Number(visitor.clickCount || 0).toLocaleString("zh-CN")}</td>
      <td class="admin-table__right admin-table__secondary" title="首次访问：${escapeHtml(formatDateTime(visitor.firstSeenAt))}">
        ${escapeHtml(formatDateTime(visitor.lastSeenAt))}
      </td>
    </tr>
  `;
}

function buildShareUrl(fileId) {
  return `${window.location.origin}/?file=${encodeURIComponent(fileId)}`;
}

function toLocalInputValue(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
  if (pageId === "overview" || pageId === "files") {
    const fileList = document.getElementById("admin-file-list");
    fileList?.addEventListener("click", onFileListClick);
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
 * 页面：概览（pi-2 负责细化）
 * ------------------------------------------------------------------ */

function renderOverviewPage() {
  const totals = state.stats?.totals || {};
  const daily = state.stats?.daily || [];
  const recent = state.stats?.recent || [];

  return `
    <div class="admin-page" data-admin-page="overview">
      <section class="admin-stats">
        ${renderStatCard("folder_shared", totals.files ?? 0, "分享文件总数", `${totals.activeFiles ?? 0} 个启用中`)}
        ${renderStatCard("visibility", totals.views ?? 0, "页面访问量", `今日 ${totals.todayViews ?? 0} 次`)}
        ${renderStatCard("ads_click", totals.clicks ?? 0, "链接点击量", `今日 ${totals.todayClicks ?? 0} 次`)}
        ${renderStatCard("group", totals.visitors ?? 0, "独立访客 IP", `今日 ${totals.todayVisitors ?? 0} 个`)}
        ${renderStatCard("link", state.files.reduce((sum, file) => sum + Number(file.storageCount || 0), 0), "存储链接总数", "全部文件合计")}
      </section>

      <section class="admin-card admin-card--trend">
        <div class="admin-card__head">
          <h2>近 14 天趋势</h2>
          <span class="admin-trend-legend">
            <span><i class="admin-dot admin-dot--view"></i>访问</span>
            <span><i class="admin-dot admin-dot--click"></i>点击</span>
          </span>
        </div>
        ${renderTrend(daily)}
      </section>

      <section class="admin-card">
        <div class="admin-card__head">
          <h2>最近动态</h2>
          <a class="admin-card__link" href="#activity" data-page="activity">查看全部</a>
        </div>
        <div class="admin-recent">
          ${recent.slice(0, 8).map(renderRecentRow).join("") || `<p class="empty-preview">暂无访问记录。</p>`}
        </div>
      </section>
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * 页面：文件管理（pi-2 负责细化）
 * ------------------------------------------------------------------ */

function renderFilesPage() {
  return `
    <div class="admin-page" data-admin-page="files">
      <section class="admin-card">
        <div class="admin-card__head">
          <h2>分享文件</h2>
          <span class="admin-card__meta">${state.files.length} 个</span>
        </div>
        <div class="admin-file-list" id="admin-file-list">
          ${state.files.map(renderFileRow).join("") || `<p class="empty-preview">还没有分享文件，先去导入一个吧。</p>`}
        </div>
      </section>
    </div>
  `;
}

/* ------------------------------------------------------------------ *
 * 页面：访问动态（pi-2 负责细化）
 * ------------------------------------------------------------------ */

function renderActivityPage() {
  const recent = state.stats?.recent || [];
  return `
    <div class="admin-page" data-admin-page="activity">
      <section class="admin-card">
        <div class="admin-card__head">
          <h2>最近动态</h2>
          <span class="admin-card__meta">${recent.length} 条</span>
        </div>
        <div class="admin-recent">
          ${recent.map(renderRecentRow).join("") || `<p class="empty-preview">暂无访问记录。</p>`}
        </div>
      </section>
    </div>
  `;
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
    return `<p class="empty-preview"><span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span> 正在加载令牌...</p>`;
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
  const lastUsed = token.lastUsedLabel || (token.lastUsedAt ? formatDateTime(token.lastUsedAt) : "从未使用");
  const created = token.createdAt ? formatDate(token.createdAt) : "随环境变量配置";
  return `
    <article class="admin-token-row ${token.isActive ? "" : "admin-token-row--inactive"}" data-token-row="${escapeHtml(token.id)}">
      <div class="admin-token-row__icon">
        <span class="material-symbols-outlined" aria-hidden="true">${env ? "shield_lock" : "key"}</span>
      </div>
      <div class="admin-token-row__main">
        <div class="admin-token-row__title">
          <strong>${escapeHtml(token.name)}</strong>
          ${env ? `<span class="chip">环境变量</span>` : ""}
          <span class="chip ${token.isActive ? "" : "chip--muted"}">${token.isActive ? "已启用" : "已停用"}</span>
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
                <span>${token.isActive ? "停用" : "启用"}</span>
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
  dialog.addEventListener("submit", onTokenDialogSubmit);
  dialog.addEventListener("close", () => {
    editingTokenId = null;
    state.createdToken = "";
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
  let slot = card.querySelector(".admin-token-slot");
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "admin-token-slot";
    const previous = card.querySelector(".admin-token-list, .empty-preview, .admin-token-error");
    if (previous) {
      previous.replaceWith(slot);
    } else {
      card.append(slot);
    }
  }
  slot.innerHTML = renderTokenList();
}

async function onTokenListClick(event) {
  const button = event.target.closest("[data-token-action]");
  if (!button) {
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
      state.tokens = state.tokens.filter((item) => item.id !== token.id);
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

function openTokenDialog(mode, token = null) {
  const dialog = document.getElementById("admin-token-dialog");
  if (!dialog) {
    return;
  }
  editingTokenId = mode === "rename" ? token.id : null;
  state.createdToken = "";
  dialog.innerHTML = renderTokenDialogContent(mode, token);
  dialog.showModal();
  dialog.querySelector("input[name='name']")?.focus();
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
  if (action === "close") {
    dialog.close();
    return;
  }
  if (action === "copy") {
    const button = event.target.closest("[data-token-dialog-action='copy']");
    try {
      await copyToClipboard(state.createdToken);
      const label = button.querySelector("span:last-child");
      if (label) {
        label.textContent = "已复制";
      }
    } catch {
      window.alert("复制失败，请手动选择令牌文本复制。");
    }
  }
}

async function copyToClipboard(value) {
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
  const form = event.target.closest("#admin-token-form");
  if (!form) {
    return;
  }
  event.preventDefault();
  const dialog = form.closest("dialog");
  const errorElement = form.querySelector("[data-token-error]");
  const submit = form.querySelector("button[type='submit']");
  const name = String(new FormData(form).get("name") || "").trim();
  errorElement.hidden = true;

  if (!name) {
    errorElement.textContent = "令牌名称不能为空。";
    errorElement.hidden = false;
    return;
  }

  submit.disabled = true;
  try {
    if (form.dataset.tokenMode === "rename") {
      const { item } = await adminApi(`/admin/tokens/${encodeURIComponent(editingTokenId)}`, {
        method: "PUT",
        body: { name }
      });
      replaceToken(item);
      dialog.close();
      renderTokenListInPlace();
      return;
    }

    const payload = await adminApi("/admin/tokens", { method: "POST", body: { name } });
    state.createdToken = payload.token || "";
    state.tokens = [state.tokens.find((token) => token.isEnvToken), payload.item, ...state.tokens.filter((token) => !token.isEnvToken)].filter(Boolean);
    renderTokenListInPlace();
    dialog.innerHTML = renderCreatedTokenPanel(state.createdToken);
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

/* ------------------------------------------------------------------ *
 * 组件：统计 / 趋势 / 列表行（pi-2 可继续细化）
 * ------------------------------------------------------------------ */

function renderStatCard(icon, value, label, hint) {
  return `
    <article class="admin-stat-card">
      <span class="admin-stat-card__icon material-symbols-outlined" aria-hidden="true">${escapeHtml(icon)}</span>
      <span class="admin-stat-card__value">${Number(value || 0).toLocaleString("zh-CN")}</span>
      <span class="admin-stat-card__label">${escapeHtml(label)}</span>
      <span class="admin-stat-card__hint">${escapeHtml(hint || "")}</span>
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
    <article class="admin-file-row ${file.isActive ? "" : "admin-file-row--inactive"}">
      <div class="admin-file-row__icon">${renderIcon(file.icon)}</div>
      <div class="admin-file-row__main">
        <h3 title="${escapeHtml(file.title)}">${escapeHtml(file.title)}</h3>
        <small>${escapeHtml(file.id)} · ${file.storageCount} 条链接 · 更新于 ${formatDate(file.updatedAt)}</small>
      </div>
      <div class="admin-file-row__stats">
        <span class="chip" title="页面访问量"><span class="material-symbols-outlined" aria-hidden="true">visibility</span>${file.viewCount}</span>
        <span class="chip" title="链接点击量"><span class="material-symbols-outlined" aria-hidden="true">ads_click</span>${file.clickCount}</span>
        <span class="chip" title="独立访客 IP 数"><span class="material-symbols-outlined" aria-hidden="true">person</span>${file.visitorCount ?? 0}</span>
        <span class="chip ${file.isActive ? "" : "chip--muted"}">${file.isActive ? "已启用" : "已停用"}</span>
      </div>
      <div class="admin-file-row__actions">
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
    </article>
  `;
}

function renderRecentRow(entry) {
  const isClick = entry.event === "click";
  return `
    <div class="admin-recent-row">
      <span class="admin-recent-row__icon ${isClick ? "admin-recent-row__icon--click" : ""}">
        <span class="material-symbols-outlined" aria-hidden="true">${isClick ? "ads_click" : "visibility"}</span>
      </span>
      <span class="admin-recent-row__text">
        <strong>${escapeHtml(entry.fileTitle || entry.fileId)}</strong>
        <span>${isClick ? `点击「${escapeHtml(entry.linkName || entry.storageKey || "链接")}」` : "打开了分享页"}${entry.ip ? ` · IP ${escapeHtml(entry.ip)}` : ""}</span>
      </span>
      <time>${escapeHtml(formatDateTime(entry.createdAt))}</time>
    </div>
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
    <div class="admin-dialog__body">
      <div class="import-dialog__header">
        <div>
          <h2>编辑分享</h2>
          <p>${escapeHtml(file.id)} · 更新于 ${formatDate(file.updatedAt)}</p>
        </div>
        <button class="icon-button" id="admin-dialog-close" type="button" aria-label="关闭">
          <span class="material-symbols-outlined" aria-hidden="true">close</span>
        </button>
      </div>

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
          <button class="primary-button primary-button--wide" type="submit">
            <span class="material-symbols-outlined" aria-hidden="true">save</span>
            <span>保存文件信息</span>
          </button>
        </div>
      </form>

      <div class="admin-dialog-section">
        <div class="section-heading">
          <h2><span class="material-symbols-outlined" aria-hidden="true">link</span>存储链接</h2>
          <span>${file.links.length} 条</span>
        </div>
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
      </div>

      <div class="admin-dialog-section">
        <div class="section-heading">
          <h2><span class="material-symbols-outlined" aria-hidden="true">group</span>IP 访客</h2>
          <span>${editingVisitors.length} 个独立 IP</span>
        </div>
        <div class="admin-visitor-list">
          ${editingVisitors.map(renderVisitorRow).join("") || `<p class="empty-preview">暂无访客记录。</p>`}
        </div>
      </div>
    </div>
  `;

  document.getElementById("admin-dialog-close").addEventListener("click", () => {
    dialog.close();
  });
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
    renderDialogContent(file);
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
    renderDialogContent(editingFile);
  }
}

function renderVisitorRow(visitor) {
  return `
    <div class="admin-visitor-row">
      <span class="admin-visitor-row__ip">
        <span class="material-symbols-outlined" aria-hidden="true">public</span>
        ${escapeHtml(visitor.ip)}
      </span>
      <span class="admin-visitor-row__meta">访问 ${visitor.viewCount} 次 · 点击 ${visitor.clickCount} 次</span>
      <time title="首次访问：${escapeHtml(formatDateTime(visitor.firstSeenAt))}">最近 ${escapeHtml(formatDateTime(visitor.lastSeenAt))}</time>
    </div>
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

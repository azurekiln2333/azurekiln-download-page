import { escapeHtml, formatDate, formatDateTime, renderIcon, renderShell } from "./shared.js";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const ADMIN_TOKEN_STORAGE_KEY = "azurekilnshare:admin-session-token";
const LEGACY_ADMIN_TOKEN_SESSION_KEY = "azurekilnshare:admin-token";

const state = {
  token: readStoredAdminToken(),
  stats: null,
  files: [],
  pending: false
};
let editingFile = null;
let editingVisitors = [];

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
  clearStoredAdminToken();
  renderLogin(error.message);
  return true;
}

async function refreshData(options = {}) {
  if (!options.silent) {
    renderLoading();
  }
  try {
    const [stats, filesPayload] = await Promise.all([
      adminApi("/admin/stats"),
      adminApi("/admin/files")
    ]);
    state.stats = stats;
    state.files = filesPayload.files || [];
    renderDashboard();
  } catch (error) {
    if (handleAuthError(error)) {
      return;
    }
    renderFatal(error.message);
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
    if (!dialog?.open) {
      renderDashboard();
    }
  } catch (error) {
    handleAuthError(error);
  }
}

function renderLoading() {
  renderShell(
    `<section class="loading-panel" aria-live="polite">
      <span class="material-symbols-outlined loading-panel__icon" aria-hidden="true">progress_activity</span>
      <span>正在加载管理数据...</span>
    </section>`,
    { centered: true }
  );
}

function renderFatal(message) {
  renderShell(
    `<section class="access-card">
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
    </section>`,
    { centered: true }
  );
  document.getElementById("admin-retry")?.addEventListener("click", () => refreshData());
}

function renderLogin(message = "") {
  renderShell(
    `<section class="access-card">
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
    </section>`,
    { centered: true }
  );

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

function renderDashboard() {
  const totals = state.stats?.totals || {};
  const daily = state.stats?.daily || [];
  const recent = state.stats?.recent || [];

  renderShell(`
    <div class="import-layout">
      <section class="import-panel">
        <div class="import-heading">
          <div>
            <h1>管理后台</h1>
            <p>查看访问与点击统计，管理分享文件与存储链接。</p>
          </div>
          <div class="admin-heading-actions">
            <a class="secondary-button" href="/?admin=import">
              <span class="material-symbols-outlined" aria-hidden="true">upload_file</span>
              <span>导入分享</span>
            </a>
            <button class="icon-button" id="admin-logout" type="button" aria-label="退出登录">
              <span class="material-symbols-outlined" aria-hidden="true">logout</span>
            </button>
          </div>
        </div>
      </section>

      <section class="admin-stats">
        ${renderStatCard("folder_shared", totals.files ?? 0, "分享文件总数", `${totals.activeFiles ?? 0} 个启用中`)}
        ${renderStatCard("visibility", totals.views ?? 0, "页面访问量", `今日 ${totals.todayViews ?? 0} 次`)}
        ${renderStatCard("ads_click", totals.clicks ?? 0, "链接点击量", `今日 ${totals.todayClicks ?? 0} 次`)}
        ${renderStatCard("group", totals.visitors ?? 0, "独立访客 IP", `今日 ${totals.todayVisitors ?? 0} 个`)}
        ${renderStatCard("link", state.files.reduce((sum, file) => sum + Number(file.storageCount || 0), 0), "存储链接总数", "全部文件合计")}
      </section>

      <section class="import-panel">
        <div class="section-heading">
          <h2><span class="material-symbols-outlined" aria-hidden="true">trending_up</span>近 14 天趋势</h2>
          <span class="admin-trend-legend">
            <span><i class="admin-dot admin-dot--view"></i>访问</span>
            <span><i class="admin-dot admin-dot--click"></i>点击</span>
          </span>
        </div>
        ${renderTrend(daily)}
      </section>

      <section class="import-panel">
        <div class="section-heading">
          <h2><span class="material-symbols-outlined" aria-hidden="true">database</span>分享文件</h2>
          <span>${state.files.length} 个</span>
        </div>
        <div class="admin-file-list" id="admin-file-list">
          ${state.files.map(renderFileRow).join("") || `<p class="empty-preview">还没有分享文件，先去导入一个吧。</p>`}
        </div>
      </section>

      <section class="import-panel">
        <div class="section-heading">
          <h2><span class="material-symbols-outlined" aria-hidden="true">history</span>最近动态</h2>
          <button class="secondary-button secondary-button--compact" id="admin-refresh" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">sync</span>
            <span>刷新</span>
          </button>
        </div>
        <div class="admin-recent">
          ${recent.map(renderRecentRow).join("") || `<p class="empty-preview">暂无访问记录。</p>`}
        </div>
      </section>
    </div>

    <dialog class="import-dialog" id="admin-file-dialog"></dialog>
  `);

  document.getElementById("admin-logout").addEventListener("click", () => {
    state.token = "";
    clearStoredAdminToken();
    renderLogin();
  });
  document.getElementById("admin-refresh").addEventListener("click", () => refreshData());

  const fileList = document.getElementById("admin-file-list");
  fileList.addEventListener("click", onFileListClick);

  const dialog = document.getElementById("admin-file-dialog");
  dialog.addEventListener("click", onDialogClick);
  dialog.addEventListener("submit", onDialogSubmit);
  dialog.addEventListener("close", () => {
    editingFile = null;
    renderDashboard();
  });
}

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
      await refreshData();
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
      await refreshData();
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

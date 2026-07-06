import "./styles.css";

const API_BASE = (import.meta.env.VITE_API_BASE_URL || "/api").replace(/\/$/, "");
const HASH_CHECK_TOOL_URL = "https://azurekiln.cn/hashchecktool";
const LEGACY_LINK_BASE_URL = "https://azurekiln.cn/link.php";
const params = new URLSearchParams(window.location.search);
const IS_IMPORT_PAGE = params.get("admin") === "import" || window.location.pathname.replace(/\/+$/, "") === "/import";
const FILE_ID = params.get("file") || params.get("share");
const AUTO_ACCESS_CODE = params.get("pwd") || params.get("code");
const LEGACY_LINK_CODE = getLegacyLinkCode();
const tokenKey = `azurekilnshare:${FILE_ID}:token`;

const root = document.getElementById("app");
const state = {
  publicFile: null,
  file: null,
  token: window.sessionStorage.getItem(tokenKey) || "",
  error: "",
  pending: false
};
const importState = {
  pending: false,
  error: "",
  result: null,
  providers: [],
  providerMap: new Map()
};
const ADMIN_TOKEN_STORAGE_KEY = "azurekilnshare:admin-token";

init();

async function init() {
  if (LEGACY_LINK_CODE) {
    redirectLegacyLink(LEGACY_LINK_CODE);
    return;
  }

  if (IS_IMPORT_PAGE) {
    renderImportPage();
    return;
  }

  renderLoading();
  if (!FILE_ID) {
    renderFatal("缺少分享参数");
    return;
  }

  try {
    const { file } = await api(`/files/${encodeURIComponent(FILE_ID)}`, { auth: false });
    state.publicFile = file;
    if (!file.protected) {
      await loadContent();
      return;
    }
    if (state.token) {
      await loadContent();
      return;
    }
    if (AUTO_ACCESS_CODE) {
      await verifyCode(AUTO_ACCESS_CODE, { silent: true });
      return;
    }
    renderAccessPage();
  } catch (error) {
    renderFatal(error.message);
  }
}

function getLegacyLinkCode() {
  const pathname = decodeURIComponent(window.location.pathname || "").replace(/^\/+|\/+$/g, "");
  if (!pathname || pathname === "import" || pathname.includes("/") || /\.[A-Za-z0-9]+$/.test(pathname)) {
    return "";
  }
  return /^[A-Za-z0-9_-]{4,128}$/.test(pathname) ? pathname : "";
}

function redirectLegacyLink(code) {
  const target = new URL(LEGACY_LINK_BASE_URL);
  target.searchParams.set("id", code);
  window.location.replace(target.toString());
}

async function api(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  if (options.auth !== false && state.token) {
    headers.set("Authorization", `Bearer ${state.token}`);
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
    throw new Error(payload?.message || `请求失败：${response.status}`);
  }
  return payload;
}

async function verifyCode(code, options = {}) {
  state.pending = true;
  state.error = "";
  if (!options.silent) {
    renderAccessPage();
  }

  try {
    const payload = await api(`/files/${encodeURIComponent(FILE_ID)}/verify`, {
      method: "POST",
      auth: false,
      body: { code }
    });
    state.token = payload.accessToken;
    state.file = payload.file;
    window.sessionStorage.setItem(tokenKey, state.token);
    renderDownloadPage();
  } catch (error) {
    state.error = error.message;
    state.pending = false;
    renderAccessPage();
  }
}

async function loadContent() {
  try {
    const { file } = await api(`/files/${encodeURIComponent(FILE_ID)}/content`);
    state.file = file;
    renderDownloadPage();
  } catch (error) {
    window.sessionStorage.removeItem(tokenKey);
    state.token = "";
    state.error = error.message;
    renderAccessPage();
  }
}

function renderShell(mainContent, options = {}) {
  const centered = options.centered ? " app-main--centered" : "";
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="topbar__inner">
          <a class="brand" href="/" aria-label="AzureKilnShare">
            <span class="brand__mark material-symbols-outlined" aria-hidden="true">shield</span>
            <span class="brand__name">AzureKilnShare</span>
          </a>
          <button class="icon-button" type="button" aria-label="帮助">
            <span class="material-symbols-outlined" aria-hidden="true">help_outline</span>
          </button>
        </div>
      </header>
      <main class="app-main${centered}">
        ${mainContent}
      </main>
      <footer class="footer">
        <div class="footer__inner">
          <div class="footer__brand">
            <span class="footer__name">AzureKilnShare</span>
            <span class="footer__copy">© 2026 AzureKilnShare. All rights reserved.</span>
          </div>
          <div class="footer__links">
            <a href="#">Terms of Service</a>
            <a href="#">Privacy Policy</a>
            <a href="#">Support</a>
          </div>
        </div>
      </footer>
    </div>
  `;
}

function renderLoading() {
  renderShell(
    `<section class="loading-panel" aria-live="polite">
      <span class="material-symbols-outlined loading-panel__icon" aria-hidden="true">progress_activity</span>
      <span>正在加载分享信息...</span>
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
        <h1>无法打开分享</h1>
        <p>${escapeHtml(message)}</p>
      </div>
    </section>`,
    { centered: true }
  );
}

function renderAccessPage() {
  const file = state.publicFile || {};
  renderShell(
    `<section class="access-card">
      <div class="access-card__icon">
        <span class="material-symbols-outlined" aria-hidden="true">lock</span>
      </div>
      <div class="access-card__header">
        <h1>请输入提取码以访问文件</h1>
        <p>此文件受密码保护，请输入由分享者提供的提取码。</p>
      </div>
      <div class="share-context">
        <span class="material-symbols-outlined" aria-hidden="true">folder_zip</span>
        <span>${escapeHtml(file.title || "受保护的文件分享")}</span>
      </div>
      <form class="access-form" id="access-form">
        <label class="sr-only" for="access-code">提取码</label>
        <div class="password-field">
          <span class="material-symbols-outlined password-field__icon" aria-hidden="true">key</span>
          <input id="access-code" name="code" type="password" inputmode="numeric" autocomplete="one-time-code" placeholder="输入 4-6 位提取码" required />
          <button class="password-field__toggle" id="toggle-password" type="button" aria-label="显示或隐藏提取码">
            <span class="material-symbols-outlined" id="eye-icon" aria-hidden="true">visibility</span>
          </button>
        </div>
        ${state.error ? `<p class="form-error" role="alert">${escapeHtml(state.error)}</p>` : ""}
        <button class="primary-button" type="submit" ${state.pending ? "disabled" : ""}>
          ${
            state.pending
              ? `<span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span><span>验证中...</span>`
              : `<span>验证并进入</span><span class="material-symbols-outlined" aria-hidden="true">arrow_forward</span>`
          }
        </button>
      </form>
      <a class="support-link" href="#">
        <span class="material-symbols-outlined" aria-hidden="true">contact_support</span>
        联系支持
      </a>
    </section>
    <div class="security-note">
      <span class="material-symbols-outlined" aria-hidden="true">shield_lock</span>
      <span>Access verification enabled</span>
    </div>`,
    { centered: true }
  );

  const input = document.getElementById("access-code");
  const toggle = document.getElementById("toggle-password");
  const eyeIcon = document.getElementById("eye-icon");
  const form = document.getElementById("access-form");

  toggle.addEventListener("click", () => {
    const nextType = input.type === "password" ? "text" : "password";
    input.type = nextType;
    eyeIcon.textContent = nextType === "password" ? "visibility" : "visibility_off";
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const code = new FormData(form).get("code");
    verifyCode(String(code || "").trim());
  });

  input.focus();
}

function renderImportPage() {
  renderShell(`
    <div class="import-layout">
      <section class="import-panel">
        <div class="import-heading">
          <div>
            <h1>导入分享链接</h1>
            <p>粘贴 BBCode 链接列表，解析后写入下载数据库。</p>
          </div>
          <span class="chip"><span class="material-symbols-outlined" aria-hidden="true">database</span>Admin</span>
        </div>

        <form class="import-form" id="import-form">
          <label class="field">
            <span>后台导入密钥</span>
            <input name="adminToken" type="password" autocomplete="off" required />
          </label>

          <label class="field">
            <span>链接文本</span>
            <textarea id="raw-links" name="rawLinks" rows="10" required placeholder="[*][url=miuibatchunlock658109lz]蓝奏云（推荐）[/url]
[*][url=miuibatchunlock658109123]123云盘[/url]
[*][url=miuibatchunlock658109bd]百度云盘[/url]"></textarea>
          </label>

          <div class="import-actions">
            <button class="primary-button primary-button--wide" id="import-submit" type="submit">
              <span class="material-symbols-outlined" aria-hidden="true">manage_search</span>
              <span>解析链接</span>
            </button>
          </div>
        </form>
      </section>

      <section class="import-panel">
        <div class="section-heading">
          <h2><span class="material-symbols-outlined" aria-hidden="true">fact_check</span>解析预览</h2>
          <span id="preview-count">0 条</span>
        </div>
        <div class="import-preview" id="import-preview"></div>
        <div class="import-result" id="import-result" aria-live="polite"></div>
      </section>

      <section class="import-panel">
        <div class="section-heading">
          <h2><span class="material-symbols-outlined" aria-hidden="true">settings</span>网盘图标配置</h2>
          <button class="secondary-button secondary-button--compact" id="load-providers" type="button">
            <span class="material-symbols-outlined" aria-hidden="true">sync</span>
            <span>加载配置</span>
          </button>
        </div>
        <div class="provider-list" id="provider-list">
          <p class="empty-preview">输入后台导入密钥后加载配置。</p>
        </div>
      </section>

      <dialog class="import-dialog" id="import-dialog">
        <form class="import-dialog__form" id="import-details-form" method="dialog">
          <div class="import-dialog__header">
            <div>
              <h2>写入文件信息</h2>
              <p>确认文件信息和 fileId 后，一并写入数据库。</p>
            </div>
            <button class="icon-button" id="close-import-dialog" type="button" aria-label="关闭">
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>

          <div class="field-grid">
            <label class="field field--with-action">
              <span>fileId</span>
              <div class="inline-control">
                <input id="import-file-id" name="fileId" type="text" minlength="6" maxlength="64" pattern="[A-Za-z0-9]{6,64}" required />
                <button class="icon-button" id="generate-file-id" type="button" aria-label="重新生成 fileId">
                  <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
                </button>
              </div>
            </label>
            <label class="field">
              <span>页面提取码</span>
              <input name="accessCode" type="text" placeholder="访问此分享页需要的提取码，可留空" />
            </label>
          </div>

          <div class="field-grid">
            <label class="field">
              <span>文件标题</span>
              <input name="title" type="text" placeholder="例如 MIUI Batch Unlock" required />
            </label>
            <label class="field">
              <span>文件名</span>
              <input name="fileName" type="text" placeholder="留空则使用标题" />
            </label>
          </div>

          <div class="field-grid">
            <label class="field">
              <span>大小标签</span>
              <input name="sizeLabel" type="text" placeholder="例如 1.2 GB" />
            </label>
            <label class="field">
              <span>过期时间</span>
              <input name="expiresAt" type="datetime-local" />
            </label>
          </div>

          <label class="field">
            <span>说明</span>
            <input name="description" type="text" placeholder="显示在下载页的文件说明" />
          </label>

          <div class="dialog-preview">
            <span id="dialog-preview-count">0 条链接将写入数据库</span>
          </div>

          <div class="import-actions">
            <button class="secondary-button" id="cancel-import" type="button">取消</button>
            <button class="primary-button primary-button--wide" id="write-import" type="submit">
              <span class="material-symbols-outlined" aria-hidden="true">upload</span>
              <span>写入数据库</span>
            </button>
          </div>
        </form>
      </dialog>
    </div>
  `);

  const form = document.getElementById("import-form");
  const adminTokenInput = form.elements.adminToken;
  const rawLinks = document.getElementById("raw-links");
  const submitButton = document.getElementById("import-submit");
  const result = document.getElementById("import-result");
  const loadProvidersButton = document.getElementById("load-providers");
  const providerList = document.getElementById("provider-list");
  const dialog = document.getElementById("import-dialog");
  const detailsForm = document.getElementById("import-details-form");
  const fileIdInput = document.getElementById("import-file-id");
  const generateButton = document.getElementById("generate-file-id");
  const writeButton = document.getElementById("write-import");
  const closeDialog = document.getElementById("close-import-dialog");
  const cancelImport = document.getElementById("cancel-import");
  const dialogPreviewCount = document.getElementById("dialog-preview-count");

  adminTokenInput.value = window.sessionStorage.getItem(ADMIN_TOKEN_STORAGE_KEY) || "";
  fileIdInput.value = generateClientFileId();
  rawLinks.addEventListener("input", () => updateImportPreview(rawLinks.value));
  adminTokenInput.addEventListener("change", async () => {
    const token = getAdminTokenFromForm(form);
    if (!token) {
      window.sessionStorage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
      return;
    }
    window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    await loadStorageProviders(token);
  });
  generateButton.addEventListener("click", () => {
    fileIdInput.value = generateClientFileId();
    fileIdInput.focus();
  });
  updateImportPreview(rawLinks.value);
  if (adminTokenInput.value) {
    loadStorageProviders(adminTokenInput.value);
  }

  loadProvidersButton.addEventListener("click", async () => {
    const token = getAdminTokenFromForm(form);
    if (!token) {
      providerList.innerHTML = `<p class="form-error" role="alert">请先填写后台导入密钥</p>`;
      return;
    }
    window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    await loadStorageProviders(token);
  });

  providerList.addEventListener("submit", async (event) => {
    event.preventDefault();
    const providerForm = event.target.closest("[data-provider-form]");
    if (!providerForm) {
      return;
    }
    const token = getAdminTokenFromForm(form);
    if (!token) {
      providerList.insertAdjacentHTML("afterbegin", `<p class="form-error" role="alert">请先填写后台导入密钥</p>`);
      return;
    }
    window.sessionStorage.setItem(ADMIN_TOKEN_STORAGE_KEY, token);
    const data = Object.fromEntries(new FormData(providerForm).entries());
    const submit = providerForm.querySelector("button[type='submit']");
    submit.disabled = true;
    try {
      await api("/admin/storage-providers", {
        method: "PUT",
        auth: false,
        headers: {
          "X-Admin-Token": token
        },
        body: {
          storageKey: data.storageKey,
          displayName: data.displayName,
          iconUrl: data.iconUrl,
          sortOrder: data.sortOrder,
          active: data.active === "on"
        }
      });
      await loadStorageProviders(token);
    } catch (error) {
      providerForm.querySelector("[data-provider-status]").textContent = error.message;
    } finally {
      submit.disabled = false;
    }
  });

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(form).entries());
    const links = parseImportLinks(data.rawLinks);

    if (!links.length) {
      result.innerHTML = `<p class="form-error" role="alert">没有识别到可导入的链接</p>`;
      return;
    }

    importState.error = "";
    importState.result = { adminToken: data.adminToken, rawLinks: data.rawLinks, links };
    dialogPreviewCount.textContent = `${links.length} 条链接将写入数据库`;
    result.innerHTML = "";
    fileIdInput.value = generateClientFileId();
    dialog.showModal();
    detailsForm.querySelector("[name='title']").focus();
  });

  detailsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const source = importState.result;
    if (!source) {
      dialog.close();
      return;
    }

    const data = Object.fromEntries(new FormData(detailsForm).entries());
    importState.pending = true;
    writeButton.disabled = true;
    submitButton.disabled = true;
    result.innerHTML = `<p class="status-note"><span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span>正在写入数据库...</p>`;

    try {
      const payload = await api("/admin/import", {
        method: "POST",
        auth: false,
        headers: {
          "X-Admin-Token": source.adminToken
        },
        body: {
          fileId: data.fileId,
          title: data.title,
          fileName: data.fileName,
          accessCode: data.accessCode,
          sizeLabel: data.sizeLabel,
          description: data.description,
          expiresAt: data.expiresAt,
          rawLinks: source.rawLinks
        }
      });
      const shareUrl = `${window.location.origin}/?file=${encodeURIComponent(payload.fileId)}`;
      const shortUrl = payload.shortLink?.shortUrl || "";
      dialog.close();
      result.innerHTML = `
        <div class="success-box">
          <strong>已导入 ${payload.importedLinks} 条链接</strong>
          <a href="${escapeHtml(shareUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(shareUrl)}</a>
          ${
            shortUrl
              ? `<a href="${escapeHtml(shortUrl)}" target="_blank" rel="noopener noreferrer">短链：${escapeHtml(shortUrl)}</a>`
              : `<span>短链未创建，可稍后重试或手动创建。</span>`
          }
        </div>
      `;
      detailsForm.reset();
      fileIdInput.value = generateClientFileId();
      importState.result = null;
    } catch (error) {
      result.innerHTML = `<p class="form-error" role="alert">${escapeHtml(error.message)}</p>`;
    } finally {
      importState.pending = false;
      writeButton.disabled = false;
      submitButton.disabled = false;
    }
  });

  closeDialog.addEventListener("click", () => {
    dialog.close();
  });

  cancelImport.addEventListener("click", () => {
    dialog.close();
  });
}

function getAdminTokenFromForm(form) {
  return String(new FormData(form).get("adminToken") || "").trim();
}

async function loadStorageProviders(adminToken) {
  const providerList = document.getElementById("provider-list");
  providerList.innerHTML = `<p class="status-note"><span class="material-symbols-outlined spin" aria-hidden="true">progress_activity</span>正在加载网盘配置...</p>`;
  try {
    const { providers } = await api("/admin/storage-providers", {
      auth: false,
      headers: {
        "X-Admin-Token": adminToken
      }
    });
    importState.providers = providers || [];
    importState.providerMap = new Map(importState.providers.map((provider) => [provider.storageKey, provider]));
    providerList.innerHTML = renderProviderList(importState.providers);
    updateImportPreview(document.getElementById("raw-links").value);
  } catch (error) {
    providerList.innerHTML = `<p class="form-error" role="alert">${escapeHtml(error.message)}</p>`;
  }
}

function renderProviderList(providers) {
  if (!providers.length) {
    return `<p class="empty-preview">还没有网盘配置。</p>`;
  }

  return providers
    .map(
      (provider) => `
        <form class="provider-row" data-provider-form>
          <div class="provider-row__icon">
            ${renderIcon(provider.iconUrl || "cloud_download")}
          </div>
          <label class="field">
            <span>key</span>
            <input name="storageKey" type="text" value="${escapeHtml(provider.storageKey)}" readonly />
          </label>
          <label class="field">
            <span>名称</span>
            <input name="displayName" type="text" value="${escapeHtml(provider.displayName)}" required />
          </label>
          <label class="field provider-row__url">
            <span>icon URL</span>
            <input name="iconUrl" type="url" value="${escapeHtml(provider.iconUrl)}" placeholder="https://example.com/icon.png" />
          </label>
          <label class="field provider-row__sort">
            <span>排序</span>
            <input name="sortOrder" type="number" value="${escapeHtml(provider.sortOrder)}" />
          </label>
          <label class="toggle-field">
            <input name="active" type="checkbox" ${provider.active ? "checked" : ""} />
            <span>启用</span>
          </label>
          <button class="secondary-button secondary-button--compact" type="submit">
            <span class="material-symbols-outlined" aria-hidden="true">save</span>
            <span>保存</span>
          </button>
          <span class="provider-row__status" data-provider-status></span>
        </form>
      `
    )
    .join("");
}

function updateImportPreview(rawText) {
  const preview = document.getElementById("import-preview");
  const count = document.getElementById("preview-count");
  const links = parseImportLinks(rawText);
  count.textContent = `${links.length} 条`;

  if (!links.length) {
    preview.innerHTML = `<p class="empty-preview">还没有识别到链接。</p>`;
    return;
  }

  preview.innerHTML = links
    .map(
      (link) => `
        <article class="preview-row">
            ${renderIcon(link.icon)}
          <div>
            <strong>${escapeHtml(link.name)}</strong>
            <small>${escapeHtml(link.key)} · ${escapeHtml(link.label)}${link.code ? ` · 访问码 ${escapeHtml(link.code)}` : ""}</small>
            <code>${escapeHtml(link.url)}</code>
          </div>
        </article>
      `
    )
    .join("");
}

function parseImportLinks(rawText) {
  const text = String(rawText || "");
  const links = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const item = line.replace(/^\[\*\]\s*/i, "");
    const codeMatch = item.match(/(?:访问码|提取码|密码)\s*[:：]\s*([A-Za-z0-9_-]+)/i);
    const headingMatch = item.match(/\[b\]([\s\S]*?)\[\/b\]/i);
    const heading = headingMatch ? cleanBbcodeText(headingMatch[1]) : "";
    const urlPattern = /\[url=([^\]]+)\]([\s\S]*?)\[\/url\]/gi;
    let match = null;
    const lineUrls = [];

    while ((match = urlPattern.exec(item))) {
      lineUrls.push({
        url: match[1].trim(),
        label: cleanBbcodeText(match[2]) || `链接${lineUrls.length + 1}`
      });
    }

    for (const link of lineUrls) {
      const storage = inferStorage(link.url, heading || link.label);
      links.push({
        url: link.url,
        label: normalizeLinkLabel(link.label, storage.name),
        name: storage.name,
        key: storage.key,
        icon: storage.icon,
        code: codeMatch ? codeMatch[1] : ""
      });
    }
  }

  return links;
}

function cleanBbcodeText(value) {
  return String(value || "")
    .replace(/\[(?:\/)?b\]/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^\[|\]$/g, "")
    .replace(/[：:]\s*$/g, "")
    .trim();
}

function normalizeLinkLabel(label, storageName) {
  const value = cleanBbcodeText(label);
  if (!value || value === storageName || storageName.includes(value) || value.includes(storageName)) {
    return "打开";
  }
  return value;
}

function inferStorage(rawUrl, rawName) {
  const text = `${rawUrl} ${rawName}`.toLowerCase();
  if (/蓝奏|lanzou|\blz\b/.test(text)) {
    return storageDefinition("lanzou", rawName || "蓝奏云");
  }
  if (/123|123pan/.test(text)) {
    return storageDefinition("123pan", rawName || "123云盘");
  }
  if (/百度|\bbd\b|baidu/.test(text)) {
    return storageDefinition("baidunetdisk", rawName || "百度云盘");
  }
  if (/夸克|quark/.test(text)) {
    return storageDefinition("quark", rawName || "夸克云盘");
  }
  if (/迅雷|\bxl\b|xunlei/.test(text)) {
    return storageDefinition("xunlei", rawName || "迅雷云盘");
  }
  if (/天翼|189/.test(text)) {
    return storageDefinition("189cloud", rawName || "天翼云盘");
  }
  if (/光鸭|光亚|guangya|\bgy\b/.test(text)) {
    return storageDefinition("guangyapan", rawName || "光鸭网盘");
  }
  if (/onedrive|od1/.test(text)) {
    return storageDefinition("onedrive", rawName || "OneDrive");
  }
  if (/google|drive|\bgd\b/.test(text)) {
    return storageDefinition("googledrive", rawName || "Google Drive");
  }
  return { key: "storage", name: rawName || "存储链接", icon: "cloud_download" };
}

function storageDefinition(key, name) {
  const provider = importState.providerMap.get(key);
  return { key, name, icon: provider?.iconUrl || "cloud_download" };
}

function generateClientFileId() {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const values = new Uint32Array(12);
  window.crypto.getRandomValues(values);
  return Array.from(values, (value) => alphabet[value % alphabet.length]).join("");
}

function renderDownloadPage() {
  const file = state.file;
  const links = file.storageLinks || [];
  const availableLinks = links.filter((link) => link.url);
  const storageGroups = groupStorageLinks(links);
  const invalidLinkMailto = buildInvalidLinkMailto(file);
  const longShareUrl = buildLongShareUrl(file);
  const shortShareUrl = file.shortUrl || "";

  renderShell(`
    <div class="download-layout">
      <section class="file-summary-card">
        <div class="file-summary-card__icon">
          <span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(file.icon || "folder_zip")}</span>
        </div>
        <div class="file-summary-card__body">
          <h1>${escapeHtml(file.title)}</h1>
          <div class="chips">
            <span class="chip"><span class="material-symbols-outlined" aria-hidden="true">database</span>${escapeHtml(file.sizeLabel || formatBytes(file.sizeBytes))}</span>
            <span class="chip"><span class="material-symbols-outlined" aria-hidden="true">cloud_download</span>${file.storageCount} 个链接</span>
            <span class="chip"><span class="material-symbols-outlined" aria-hidden="true">event</span>${formatDate(file.updatedAt)}</span>
            ${file.protected ? `<span class="chip"><span class="material-symbols-outlined" aria-hidden="true">lock_person</span>受保护</span>` : ""}
          </div>
          <p>${escapeHtml(file.description || "")}</p>
        </div>
      </section>

      <div class="download-content">
        <section class="section-block section-block--primary">
          <div class="section-heading">
            <h2><span class="material-symbols-outlined" aria-hidden="true">cloud_download</span>存储链接</h2>
            <span>${availableLinks.length} 个可用链接</span>
          </div>
          <div class="file-grid">
            ${storageGroups.map(renderStorageGroupCard).join("")}
          </div>
        </section>

        <aside class="download-sidebar">
          <section class="side-panel">
            <div class="side-panel__heading">
              <h2><span class="material-symbols-outlined" aria-hidden="true">ios_share</span>分享</h2>
            </div>
            <div class="share-copy-actions share-copy-actions--stacked">
              <button class="copy-button" type="button" data-copy-value="${escapeHtml(longShareUrl)}">
                <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
                <span>复制长链接</span>
              </button>
              <button class="copy-button" type="button" data-copy-value="${escapeHtml(shortShareUrl)}" ${shortShareUrl ? "" : "disabled"}>
                <span class="material-symbols-outlined" aria-hidden="true">link</span>
                <span>${shortShareUrl ? "复制短链接" : "短链接未生成"}</span>
              </button>
            </div>
          </section>

          <section class="side-panel">
            <div class="side-panel__heading">
              <h2><span class="material-symbols-outlined" aria-hidden="true">info</span>文件信息</h2>
            </div>
            <dl class="detail-list">
              <div>
                <dt>文件名</dt>
                <dd>${escapeHtml(file.name || file.title)}</dd>
              </div>
              <div>
                <dt>文件大小</dt>
                <dd>${escapeHtml(file.sizeLabel || formatBytes(file.sizeBytes))}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>${formatDate(file.updatedAt)}</dd>
              </div>
              ${
                file.expiresAt
                  ? `<div>
                      <dt>过期时间</dt>
                      <dd>${formatDate(file.expiresAt)}</dd>
                    </div>`
                  : ""
              }
              <div>
                <dt>链接数</dt>
                <dd>${availableLinks.length}</dd>
              </div>
            </dl>
          </section>

          <section class="download-help">
            <div class="download-help__item">
              <span class="material-symbols-outlined" aria-hidden="true">report</span>
              <div>
                <strong>遇到下载链接失效？</strong>
                <p>发送帖子链接并说明哪条下载链接失效。</p>
              </div>
              <a class="help-button" href="${escapeHtml(invalidLinkMailto)}">
                <span class="material-symbols-outlined" aria-hidden="true">mail</span>
                <span>邮件反馈</span>
              </a>
            </div>
            <div class="download-help__item">
              <span class="material-symbols-outlined" aria-hidden="true">verified</span>
              <div>
                <strong>文件下载好了，如何获取文件校验值？</strong>
                <p>使用校验工具计算文件 Hash。</p>
              </div>
              <a class="help-button" href="${HASH_CHECK_TOOL_URL}" target="_blank" rel="noopener noreferrer">
                <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
                <span>传送门</span>
              </a>
            </div>
          </section>
        </aside>
      </div>
    </div>
  `);

  document.querySelectorAll("[data-open-link]").forEach((button) => {
    button.addEventListener("click", () => {
      const link = links.find((item) => item.id === button.dataset.openLink);
      if (link) {
        openLinks([link]);
      }
    });
  });

  document.querySelectorAll("[data-copy-value]").forEach((button) => {
    button.addEventListener("click", async () => {
      const value = button.dataset.copyValue || "";
      if (!value) {
        return;
      }
      await copyText(value);
      const label = button.querySelector("span:last-child");
      if (label) {
        const previous = label.textContent;
        label.textContent = "已复制";
        window.setTimeout(() => {
          label.textContent = previous;
        }, 1400);
      }
    });
  });
}

function buildLongShareUrl(file) {
  return `${window.location.origin}${window.location.pathname}?file=${encodeURIComponent(file.id || FILE_ID || "")}`;
}

function buildInvalidLinkMailto(file) {
  const shareUrl = buildLongShareUrl(file);
  const subject = `下载链接失效反馈：${file.title || file.name || file.id || ""}`;
  const body = [
    "帖子链接：",
    shareUrl,
    "",
    "失效的下载链接：",
    "请填写网盘名称和按钮名称，例如：123云盘 / 备用1",
    "",
    "补充说明："
  ].join("\n");

  return `mailto:azurekiln@foxmail.com?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

async function copyText(value) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const input = document.createElement("textarea");
  input.value = value;
  input.setAttribute("readonly", "");
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.select();
  document.execCommand("copy");
  input.remove();
}

function groupStorageLinks(links) {
  const groups = new Map();
  for (const link of links) {
    const key = link.storageKey || link.id;
    if (!groups.has(key)) {
      groups.set(key, {
        storageKey: key,
        name: link.name,
        icon: link.icon,
        extractCode: link.extractCode || "",
        links: []
      });
    }
    const group = groups.get(key);
    if (!group.extractCode && link.extractCode) {
      group.extractCode = link.extractCode;
    }
    group.links.push(link);
  }
  return Array.from(groups.values());
}

function renderStorageGroupCard(group) {
  const availableLinks = group.links.filter((link) => link.url);
  const available = Boolean(availableLinks.length);
  return `
    <article class="file-card ${available ? "" : "file-card--disabled"}">
      <div class="file-card__header">
        <div class="file-card__icon">
          ${renderIcon(group.icon)}
        </div>
        <div class="file-card__title">
          <h3 title="${escapeHtml(group.name)}">${escapeHtml(group.name)}</h3>
          <p>${group.links.length > 1 ? `${group.links.length} 个链接` : escapeHtml(group.links[0]?.note || "分享链接")}</p>
        </div>
        <div class="file-card__meta">
          <span class="sr-only">${escapeHtml(group.storageKey)}</span>
          ${
            group.extractCode
              ? `<button class="extract-code-button" type="button" data-copy-value="${escapeHtml(group.extractCode)}">
                  <span class="material-symbols-outlined" aria-hidden="true">content_copy</span>
                  <span>复制提取码：${escapeHtml(group.extractCode)}</span>
                </button>`
              : ""
          }
        </div>
      </div>
      <div class="file-card__links">
        ${group.links.map(renderStorageLinkButton).join("")}
      </div>
    </article>
  `;
}

function renderStorageLinkButton(link) {
  const available = Boolean(link.url);
  const label = link.note || "打开";
  return `
    <button class="file-card__button" type="button" data-open-link="${escapeHtml(link.id)}" ${available ? "" : "disabled"}>
      <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
      <span>${escapeHtml(available ? label : "未配置")}</span>
    </button>
  `;
}

function renderIcon(icon) {
  const value = String(icon || "cloud_download");
  if (/^(https?:)?\/\//.test(value) || value.startsWith("/") || /\.(?:png|jpe?g|webp|gif|svg|ico)(?:\?.*)?$/i.test(value)) {
    return `<img src="${escapeHtml(value)}" alt="" loading="lazy" decoding="async" />`;
  }
  return `<span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(value)}</span>`;
}

function openLinks(links) {
  links.filter((link) => link.url).forEach((link, index) => {
    window.setTimeout(() => {
      const anchor = document.createElement("a");
      anchor.href = normalizeDownloadUrl(link.url);
      anchor.target = "_blank";
      anchor.rel = "noopener noreferrer";
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    }, index * 180);
  });
}

function normalizeDownloadUrl(url) {
  const value = String(url || "").trim();
  if (/^(https?:)?\/\//i.test(value) || value.startsWith("/") || value.startsWith("mailto:")) {
    return value;
  }
  return `/${encodeURIComponent(value)}`;
}

function formatBytes(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) {
    return `${value} B`;
  }
  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`;
}

function formatDate(value) {
  if (!value) {
    return "未知日期";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

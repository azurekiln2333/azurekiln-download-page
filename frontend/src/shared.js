let topbarScrollBound = false;

export function renderShell(mainContent, options = {}) {
  const centered = options.centered ? " app-main--centered" : "";
  const root = document.getElementById("app");
  root.innerHTML = `
    <div class="app-shell">
      <header class="topbar topbar--top">
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
  setupTopbarScrollState();
}

function setupTopbarScrollState() {
  updateTopbarScrollState();
  if (topbarScrollBound) {
    return;
  }
  topbarScrollBound = true;
  window.addEventListener("scroll", updateTopbarScrollState, { passive: true });
}

function updateTopbarScrollState() {
  const topbar = document.querySelector(".topbar");
  if (!topbar) {
    return;
  }
  topbar.classList.toggle("topbar--top", window.scrollY <= 4);
}

export function renderIcon(icon) {
  const value = String(icon || "cloud_download");
  if (/^(https?:)?\/\//.test(value) || value.startsWith("/") || /\.(?:png|jpe?g|webp|gif|svg|ico)(?:\?.*)?$/i.test(value)) {
    return `<img src="${escapeHtml(value)}" alt="" loading="lazy" decoding="async" />`;
  }
  return `<span class="material-symbols-outlined" aria-hidden="true">${escapeHtml(value)}</span>`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatBytes(bytes) {
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

export function formatDate(value) {
  if (!value) {
    return "未知日期";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(new Date(value));
}

export function formatDateTime(value) {
  if (!value) {
    return "—";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

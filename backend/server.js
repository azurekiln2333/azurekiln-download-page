const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const http = require("node:http");
const path = require("node:path");
const mysql = require("mysql2/promise");

loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || "127.0.0.1";
const TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS || 60 * 60);
const TOKEN_SECRET = process.env.ACCESS_TOKEN_SECRET || "secureshare-local-dev-secret";
const FRONTEND_DIST = path.resolve(__dirname, "..", "frontend", "dist");
const FILE_ID_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const LEGACY_LINK_BASE_URL = process.env.LEGACY_LINK_BASE_URL || "https://azurekiln.cn/link.php";
const PUBLIC_DOWNLOAD_BASE_URL = process.env.PUBLIC_DOWNLOAD_BASE_URL || "https://dl.azurekiln.cn";
const SHORT_URL_API_URL = process.env.SHORT_URL_API_URL || "https://azurekiln.cn/sl/api.php";
const SHORT_URL_PUBLIC_PREFIX = process.env.SHORT_URL_PUBLIC_PREFIX || "https://azurekiln.cn/";
const SHORT_URL_CUSTOM_PREFIX = process.env.SHORT_URL_CUSTOM_PREFIX || "dl";
const TRUST_PROXY = process.env.TRUST_PROXY !== "0";

let pool = null;

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed
      .slice(separatorIndex + 1)
      .trim()
      .replace(/^['"]|['"]$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env.DB_HOST || "127.0.0.1",
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER || "root",
      password: process.env.DB_PASSWORD || "",
      database: process.env.DB_NAME || "azurekiln_download_page",
      waitForConnections: true,
      connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
      charset: "utf8mb4"
    });
  }
  return pool;
}

function jsonHeaders(extra = {}) {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Admin-Token",
    "Content-Type": "application/json; charset=utf-8",
    ...extra
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, jsonHeaders(extraHeaders));
  res.end(JSON.stringify(payload));
}

function sendError(res, error) {
  const statusCode = error.statusCode || 500;
  const dbCodes = new Set(["ECONNREFUSED", "ER_ACCESS_DENIED_ERROR", "ER_BAD_DB_ERROR", "ER_NO_SUCH_TABLE"]);
  const message =
    statusCode === 500 && dbCodes.has(error.code)
      ? `MySQL 不可用或未初始化：${error.code}`
      : statusCode === 500
        ? "服务器内部错误"
        : error.message;

  sendJson(res, statusCode, { message });
  if (statusCode === 500) {
    console.error(error);
  }
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1024 * 1024) {
        reject(new HttpError(413, "请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, "JSON 格式不正确"));
      }
    });
    req.on("error", reject);
  });
}

function hashAccessCode(code) {
  return crypto.createHash("sha256").update(String(code || ""), "utf8").digest("hex");
}

function timingSafeHexEqual(leftHex, rightHex) {
  if (!leftHex || !rightHex || leftHex.length !== rightHex.length) {
    return false;
  }
  const left = Buffer.from(leftHex, "hex");
  const right = Buffer.from(rightHex, "hex");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}

function signToken(payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyToken(token, fileId) {
  if (!token || !token.includes(".")) {
    return null;
  }

  const [body, signature] = token.split(".");
  const expectedSignature = crypto.createHmac("sha256", TOKEN_SECRET).update(body).digest("base64url");
  const given = Buffer.from(signature || "");
  const expected = Buffer.from(expectedSignature);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    const now = Math.floor(Date.now() / 1000);
    if (payload.fileId !== fileId || payload.exp <= now) {
      return null;
    }
    return payload;
  } catch {
    return null;
  }
}

function getRequestToken(req) {
  const header = req.headers.authorization || "";
  if (header.toLowerCase().startsWith("bearer ")) {
    return header.slice(7).trim();
  }
  return "";
}

function getAdminToken(req) {
  const headerToken = req.headers["x-admin-token"];
  if (Array.isArray(headerToken)) {
    return headerToken[0] || "";
  }
  return headerToken || getRequestToken(req);
}

function getVisitorIp(req) {
  let ip = "";
  if (TRUST_PROXY) {
    const forwarded = req.headers["x-forwarded-for"];
    if (typeof forwarded === "string" && forwarded.trim()) {
      ip = forwarded.split(",")[0].trim();
    } else if (req.headers["x-real-ip"]) {
      ip = String(req.headers["x-real-ip"]).trim();
    }
  }
  if (!ip) {
    ip = (req.socket && req.socket.remoteAddress) || "";
  }
  if (ip.startsWith("::ffff:")) {
    ip = ip.slice(7);
  }
  return (ip || "unknown").slice(0, 64);
}

function getEnvAdminToken() {
  const expected = String(process.env.ADMIN_IMPORT_TOKEN || "").trim();
  if (!expected || expected === "change-this-import-token") {
    return "";
  }
  return expected;
}

function hashAdminToken(token) {
  return crypto.createHash("sha256").update(String(token || ""), "utf8").digest("hex");
}

function envAdminTokenMatches(token) {
  const expected = getEnvAdminToken();
  if (!expected || !token) {
    return false;
  }
  return timingSafeHexEqual(Buffer.from(token, "utf8").toString("hex"), Buffer.from(expected, "utf8").toString("hex"));
}

async function requireAdmin(req) {
  const token = getAdminToken(req);
  if (!token) {
    throw new HttpError(401, "后台令牌不正确");
  }

  if (envAdminTokenMatches(token)) {
    return { kind: "env", id: 0, name: "ADMIN_IMPORT_TOKEN" };
  }

  let rows = [];
  try {
    [rows] = await getPool().execute(
      `SELECT id, name, token_hash FROM admin_tokens WHERE is_active = 1`
    );
  } catch (error) {
    if (error.code === "ER_NO_SUCH_TABLE") {
      throw new HttpError(503, "admin_tokens 表不存在，请执行 backend/migrations/add_admin_tokens.sql");
    }
    throw error;
  }

  const tokenHash = hashAdminToken(token);
  const hit = rows.find((row) => timingSafeHexEqual(row.token_hash, tokenHash));
  if (hit) {
    await getPool().execute(
      `UPDATE admin_tokens SET last_used_at = CURRENT_TIMESTAMP WHERE id = ?`,
      [hit.id]
    );
    return { kind: "db", id: Number(hit.id), name: hit.name };
  }

  if (!getEnvAdminToken()) {
    throw new HttpError(503, "后台令牌未配置，请设置 ADMIN_IMPORT_TOKEN 或在令牌管理中创建令牌");
  }
  throw new HttpError(401, "后台令牌不正确");
}

const ADMIN_TOKEN_ALPHABET = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const ADMIN_TOKEN_PREFIX = "ak_";

function generateAdminToken() {
  let value = "";
  for (let index = 0; index < 40; index += 1) {
    value += ADMIN_TOKEN_ALPHABET[crypto.randomInt(ADMIN_TOKEN_ALPHABET.length)];
  }
  return `${ADMIN_TOKEN_PREFIX}${value}`;
}

function normalizeAdminTokenId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "令牌 ID 不正确");
  }
  return id;
}

function normalizeAdminTokenName(value) {
  const name = String(value || "").trim();
  if (!name) {
    throw new HttpError(400, "令牌名称不能为空");
  }
  if (name.length > 128) {
    throw new HttpError(400, "令牌名称不能超过 128 个字符");
  }
  return name;
}

function formatAdminTokenLastUsed(value) {
  if (!value) {
    return "从未使用";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "从未使用";
  }
  const pad = (input) => String(input).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toAdminToken(row) {
  return {
    id: Number(row.id),
    name: row.name,
    tokenPrefix: row.token_prefix || "",
    isActive: Boolean(row.is_active),
    createdAt: toIsoDate(row.created_at),
    lastUsedAt: toIsoDate(row.last_used_at),
    lastUsedLabel: formatAdminTokenLastUsed(row.last_used_at),
    isEnvToken: false
  };
}

function envAdminTokenItem() {
  const expected = getEnvAdminToken();
  if (!expected) {
    return null;
  }
  return {
    id: 0,
    name: "环境变量超级令牌",
    tokenPrefix: `${expected.slice(0, 8)}${expected.length > 8 ? "…" : ""}`,
    isActive: true,
    createdAt: null,
    lastUsedAt: null,
    lastUsedLabel: "始终可用",
    isEnvToken: true
  };
}

async function listAdminTokens() {
  const [rows] = await getPool().query(
    `SELECT id, name, token_prefix, is_active, created_at, last_used_at
     FROM admin_tokens
     ORDER BY id DESC`
  );
  const items = rows.map(toAdminToken);
  const envItem = envAdminTokenItem();
  return {
    tokens: envItem ? [envItem, ...items] : items,
    envTokenEnabled: Boolean(getEnvAdminToken())
  };
}

async function createAdminToken(body) {
  const name = normalizeAdminTokenName(body.name);
  const token = generateAdminToken();
  const tokenHash = hashAdminToken(token);
  const tokenPrefix = token.slice(0, 16);

  const [result] = await getPool().execute(
    `INSERT INTO admin_tokens (name, token_hash, token_prefix, is_active) VALUES (?, ?, ?, 1)`,
    [name, tokenHash, tokenPrefix]
  );

  const [rows] = await getPool().execute(
    `SELECT id, name, token_prefix, is_active, created_at, last_used_at FROM admin_tokens WHERE id = ? LIMIT 1`,
    [result.insertId]
  );

  return {
    token,
    item: toAdminToken(rows[0]),
    message: "令牌只显示这一次，请立即保存"
  };
}

async function getAdminTokenRow(id) {
  const [rows] = await getPool().execute(
    `SELECT id, name, token_prefix, is_active, created_at, last_used_at FROM admin_tokens WHERE id = ? LIMIT 1`,
    [id]
  );
  if (!rows.length) {
    throw new HttpError(404, "令牌不存在");
  }
  return rows[0];
}

async function updateAdminToken(id, body) {
  const updates = [];
  const params = [];

  if (body.name !== undefined) {
    updates.push("name = ?");
    params.push(normalizeAdminTokenName(body.name));
  }
  if (body.isActive !== undefined) {
    updates.push("is_active = ?");
    params.push(body.isActive ? 1 : 0);
  }

  if (!updates.length) {
    throw new HttpError(400, "没有需要更新的字段");
  }

  await getAdminTokenRow(id);
  params.push(id);
  await getPool().execute(`UPDATE admin_tokens SET ${updates.join(", ")} WHERE id = ?`, params);

  return { item: toAdminToken(await getAdminTokenRow(id)) };
}

async function deleteAdminToken(id) {
  const [result] = await getPool().execute(`DELETE FROM admin_tokens WHERE id = ?`, [id]);
  if (!result.affectedRows) {
    throw new HttpError(404, "令牌不存在");
  }
}

function randomFileId(length = 12) {
  let value = "";
  for (let index = 0; index < length; index += 1) {
    value += FILE_ID_ALPHABET[crypto.randomInt(FILE_ID_ALPHABET.length)];
  }
  return value;
}

function normalizeFileId(value) {
  const fileId = String(value || "").trim();
  if (!fileId) {
    return "";
  }
  if (!/^[A-Za-z0-9]{6,64}$/.test(fileId)) {
    throw new HttpError(400, "fileId 只能是 6-64 位字母数字组合");
  }
  return fileId;
}

function publicIdPart(value, fallback) {
  return String(value || fallback || "link")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || fallback;
}

function storageDefinition(key, name) {
  return { key, name, icon: "cloud_download" };
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
  return { key: publicIdPart(rawName || rawUrl, "storage"), name: rawName || "存储链接", icon: "cloud_download" };
}

function parseImportLinks(rawText) {
  const text = String(rawText || "");
  const links = [];
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  for (const line of lines) {
    const item = line.replace(/^\[\*\]\s*/i, "");
    const accessCodeMatch = item.match(/(?:访问码|提取码|密码)\s*[:：]\s*([A-Za-z0-9_-]+)/i);
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
        storageKey: storage.key,
        storageName: storage.name,
        storageIcon: storage.icon,
        url: link.url,
        extractCode: accessCodeMatch ? accessCodeMatch[1] : "",
        note: normalizeLinkLabel(link.label, storage.name),
        sortOrder: (links.length + 1) * 10
      });
    }
  }

  if (!links.length) {
    throw new HttpError(400, "没有识别到可导入的链接");
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

function requestJson(url, payload, timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    const body = JSON.stringify(payload);
    const req = https.request(
      target,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body)
        },
        timeout: timeoutMs
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8").replace(/^\uFEFF/, "");
          if (res.statusCode < 200 || res.statusCode >= 300) {
            reject(new Error(`短链接口请求失败：${res.statusCode}`));
            return;
          }
          try {
            resolve(JSON.parse(text));
          } catch (error) {
            reject(error);
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy(new Error("短链接口请求超时"));
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function downloadPageUrl(fileId) {
  const target = new URL(PUBLIC_DOWNLOAD_BASE_URL);
  target.searchParams.set("file", fileId);
  return target.toString();
}

async function createShortUrl(longUrl, customId, password = "") {
  try {
    const payload = await requestJson(SHORT_URL_API_URL, {
      url: longUrl,
      cust: customId,
      pass: password
    });
    if (payload.error) {
      return null;
    }
    const shortUrl = String(payload.shorturl || "");
    const shortId = extractShortId(shortUrl || customId);
    return shortId ? { shortId, shortUrl: normalizeShortUrl(shortUrl || shortId) } : null;
  } catch (error) {
    console.warn("Create short URL failed:", error.message);
    return null;
  }
}

function extractShortId(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return "";
  }
  return raw
    .replace(/^https?:\/\/[^/]+\/sl\//i, "")
    .replace(/^https?:\/\/[^/]+\//i, "")
    .replace(/^\/?sl\//i, "")
    .replace(/^\/+/, "");
}

function normalizeShortUrl(value) {
  const shortId = extractShortId(value);
  if (!shortId) {
    return "";
  }
  return `${SHORT_URL_PUBLIC_PREFIX}${shortId}`;
}

function toNullableDate(value) {
  const raw = String(value || "").trim();
  if (!raw) {
    return null;
  }
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new HttpError(400, "过期时间格式不正确");
  }
  return raw;
}

async function insertImportedFile(body, generatedFileId) {
  const fileId = generatedFileId || normalizeFileId(body.fileId);
  const title = String(body.title || body.fileName || "").trim();
  if (!title) {
    throw new HttpError(400, "文件标题不能为空");
  }

  const fileName = String(body.fileName || title).trim();
  const links = parseImportLinks(body.rawLinks);
  const accessCode = String(body.accessCode || "").trim();
  const connection = await getPool().getConnection();

  try {
    await connection.beginTransaction();
    const [fileResult] = await connection.execute(
      `INSERT INTO download_files (
         public_id,
         title,
         file_name,
         description,
         icon,
         size_bytes,
         size_label,
         access_code_hash,
         owner,
         updated_at,
         expires_at,
         is_active
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, 1)`,
      [
        fileId,
        title,
        fileName,
        String(body.description || "").trim() || null,
        String(body.icon || "folder_zip").trim() || "folder_zip",
        Number(body.sizeBytes || 0),
        String(body.sizeLabel || "").trim() || null,
        accessCode ? hashAccessCode(accessCode) : null,
        String(body.owner || "AzureKilnShare").trim() || "AzureKilnShare",
        toNullableDate(body.expiresAt)
      ]
    );

    const usedPublicIds = new Set();
    for (const link of links) {
      const basePublicId = `${fileId}-${publicIdPart(link.storageKey, "link")}`.slice(0, 118);
      let publicId = basePublicId;
      let suffix = 2;
      while (usedPublicIds.has(publicId)) {
        publicId = `${basePublicId}-${suffix}`.slice(0, 128);
        suffix += 1;
      }
      usedPublicIds.add(publicId);

      await connection.execute(
        `INSERT INTO download_storage_links (
           public_id,
           file_id,
           storage_key,
           storage_name,
           storage_icon,
           url,
           extract_code,
           note,
           sort_order,
           is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
        [
          publicId,
          fileResult.insertId,
          link.storageKey.slice(0, 64),
          link.storageName.slice(0, 128),
          link.storageIcon,
          link.url,
          link.extractCode || null,
          link.note || null,
          link.sortOrder
        ]
      );
    }

    await connection.commit();
    const shortLink = await createShortUrl(downloadPageUrl(fileId), `${SHORT_URL_CUSTOM_PREFIX}${fileId}`);
    if (shortLink) {
      await getPool().execute(
        `UPDATE download_files
         SET short_url_id = ?, short_url = ?
         WHERE id = ?`,
        [shortLink.shortId, shortLink.shortUrl, fileResult.insertId]
      );
    }
    return {
      fileId,
      file: await getProtectedFile(fileId),
      importedLinks: links.length,
      shortLink
    };
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") {
      throw new HttpError(409, "fileId 或链接 publicId 已存在，请换一个 fileId");
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function importDownloadFile(body) {
  const providedFileId = normalizeFileId(body.fileId);
  if (providedFileId) {
    return insertImportedFile(body, providedFileId);
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await insertImportedFile(body, randomFileId());
    } catch (error) {
      if (error.statusCode !== 409) {
        throw error;
      }
    }
  }

  throw new HttpError(500, "随机 fileId 生成失败，请重试");
}

function toIsoDate(value) {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  return new Date(value).toISOString();
}

function toPublicFile(row, includeLinks, links = []) {
  return {
    id: row.public_id,
    title: row.title,
    name: row.file_name,
    description: row.description || "",
    icon: row.icon || "folder_zip",
    protected: Boolean(row.access_code_hash),
    owner: row.owner || "",
    sizeBytes: Number(row.size_bytes || 0),
    sizeLabel: row.size_label || "",
    updatedAt: toIsoDate(row.updated_at),
    expiresAt: toIsoDate(row.expires_at),
    shortUrlId: row.short_url_id || "",
    shortUrl: normalizeShortUrl(row.short_url),
    viewCount: Number(row.view_count || 0),
    clickCount: Number(row.click_count || 0),
    storageCount: Number(row.storage_count || links.length || 0),
    storageLinks: includeLinks ? links : []
  };
}

function toPublicStorageLink(row) {
  return {
    id: row.public_id,
    storageKey: row.storage_key,
    name: row.storage_name,
    icon: row.storage_icon || "cloud_download",
    url: row.url,
    extractCode: row.extract_code || "",
    note: row.note || "",
    sortOrder: Number(row.sort_order || 0),
    clickCount: Number(row.click_count || 0)
  };
}

async function getDownloadFile(fileId) {
  const [rows] = await getPool().execute(
    `SELECT
       f.id,
       f.public_id,
       f.title,
       f.file_name,
       f.description,
       f.icon,
       f.size_bytes,
       f.size_label,
       f.access_code_hash,
       f.short_url_id,
       f.short_url,
       f.view_count,
       f.click_count,
       f.owner,
       f.updated_at,
       f.expires_at,
       (
         SELECT COUNT(*)
         FROM download_storage_links l
         WHERE l.file_id = f.id AND l.is_active = 1
       ) AS storage_count
     FROM download_files f
     WHERE f.public_id = ? AND f.is_active = 1
     LIMIT 1`,
    [fileId]
  );

  if (!rows.length) {
    throw new HttpError(404, "文件不存在");
  }

  return rows[0];
}

async function getStorageLinks(fileDbId) {
  const [rows] = await getPool().execute(
    `SELECT
       l.public_id,
       l.storage_key,
       l.storage_name,
       COALESCE(NULLIF(p.icon_url, ''), l.storage_icon) AS storage_icon,
       l.url,
       l.extract_code,
       l.note,
       l.sort_order,
       l.click_count
     FROM download_storage_links l
     LEFT JOIN download_storage_providers p
       ON p.storage_key = l.storage_key AND p.is_active = 1
     WHERE l.file_id = ? AND l.is_active = 1
     ORDER BY l.sort_order ASC, l.id ASC`,
    [fileDbId]
  );
  return rows.map(toPublicStorageLink);
}

async function listStorageProviders() {
  const [rows] = await getPool().execute(
    `SELECT
       storage_key,
       display_name,
       icon_url,
       sort_order,
       is_active
     FROM download_storage_providers
     ORDER BY sort_order ASC, storage_key ASC`
  );
  return rows.map((row) => ({
    storageKey: row.storage_key,
    displayName: row.display_name,
    iconUrl: row.icon_url || "",
    sortOrder: Number(row.sort_order || 0),
    active: Boolean(row.is_active)
  }));
}

function normalizeStorageKey(value) {
  const storageKey = String(value || "").trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,64}$/.test(storageKey)) {
    throw new HttpError(400, "storageKey 只能是 2-64 位小写字母、数字、下划线或横线");
  }
  return storageKey;
}

function normalizeIconUrl(value) {
  const iconUrl = String(value || "").trim();
  if (!iconUrl) {
    return "";
  }
  if (!/^(https?:)?\/\//i.test(iconUrl) && !iconUrl.startsWith("/")) {
    throw new HttpError(400, "iconUrl 必须是 http(s) URL 或 / 开头的站内路径");
  }
  if (iconUrl.length > 512) {
    throw new HttpError(400, "iconUrl 不能超过 512 个字符");
  }
  return iconUrl;
}

async function saveStorageProvider(body) {
  const storageKey = normalizeStorageKey(body.storageKey);
  const displayName = String(body.displayName || "").trim();
  if (!displayName) {
    throw new HttpError(400, "displayName 不能为空");
  }
  const iconUrl = normalizeIconUrl(body.iconUrl);
  const sortOrder = Number(body.sortOrder || 0);
  const active = body.active === undefined ? 1 : body.active ? 1 : 0;

  await getPool().execute(
    `INSERT INTO download_storage_providers (
       storage_key,
       display_name,
       icon_url,
       sort_order,
       is_active
     ) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       display_name = VALUES(display_name),
       icon_url = VALUES(icon_url),
       sort_order = VALUES(sort_order),
       is_active = VALUES(is_active)`,
    [storageKey, displayName, iconUrl || null, sortOrder, active]
  );

  return { provider: (await listStorageProviders()).find((provider) => provider.storageKey === storageKey) };
}

function normalizeDbId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw new HttpError(400, "链接 ID 不正确");
  }
  return id;
}

function validateLinkUrl(value) {
  const url = String(value || "").trim();
  if (!url) {
    throw new HttpError(400, "链接 URL 不能为空");
  }
  if (url.length > 2048) {
    throw new HttpError(400, "链接 URL 不能超过 2048 个字符");
  }
  return url;
}

function toAdminFile(row, links = []) {
  return {
    id: row.public_id,
    title: row.title,
    name: row.file_name,
    description: row.description || "",
    icon: row.icon || "folder_zip",
    protected: Boolean(row.access_code_hash),
    owner: row.owner || "",
    sizeBytes: Number(row.size_bytes || 0),
    sizeLabel: row.size_label || "",
    createdAt: toIsoDate(row.created_at),
    updatedAt: toIsoDate(row.updated_at),
    expiresAt: toIsoDate(row.expires_at),
    isActive: Boolean(row.is_active),
    shortUrlId: row.short_url_id || "",
    shortUrl: normalizeShortUrl(row.short_url),
    viewCount: Number(row.view_count || 0),
    clickCount: Number(row.click_count || 0),
    visitorCount: Number(row.visitor_count || 0),
    storageCount: Number(row.storage_count || links.length || 0),
    links
  };
}

function toAdminLink(row) {
  return {
    id: row.id,
    publicId: row.public_id,
    storageKey: row.storage_key,
    name: row.storage_name,
    icon: row.icon || row.storage_icon || "cloud_download",
    url: row.url,
    extractCode: row.extract_code || "",
    note: row.note || "",
    sortOrder: Number(row.sort_order || 0),
    isActive: Boolean(row.is_active),
    clickCount: Number(row.click_count || 0),
    lastClickedAt: toIsoDate(row.last_clicked_at),
    createdAt: toIsoDate(row.created_at)
  };
}

async function getAdminLinks(fileDbId) {
  const [rows] = await getPool().execute(
    `SELECT l.*,
       COALESCE(NULLIF(p.icon_url, ''), l.storage_icon) AS icon
     FROM download_storage_links l
     LEFT JOIN download_storage_providers p
       ON p.storage_key = l.storage_key AND p.is_active = 1
     WHERE l.file_id = ?
     ORDER BY l.sort_order ASC, l.id ASC`,
    [fileDbId]
  );
  return rows.map(toAdminLink);
}

async function getAdminStats() {
  const [totalsRows] = await getPool().query(
    `SELECT
       (SELECT COUNT(*) FROM download_files) AS file_total,
       (SELECT COUNT(*) FROM download_files WHERE is_active = 1) AS file_active,
       (SELECT COALESCE(SUM(view_count), 0) FROM download_files) AS view_total,
       (SELECT COALESCE(SUM(click_count), 0) FROM download_files) AS click_total,
       (SELECT COUNT(*) FROM download_click_logs WHERE event_type = 'view' AND created_at >= CURRENT_DATE) AS view_today,
       (SELECT COUNT(*) FROM download_click_logs WHERE event_type = 'click' AND created_at >= CURRENT_DATE) AS click_today,
       (SELECT COUNT(*) FROM download_ip_stats) AS visitor_total,
       (SELECT COUNT(*) FROM download_ip_stats WHERE last_seen_at >= CURRENT_DATE) AS visitor_today`
  );

  const [dailyRows] = await getPool().query(
    `SELECT DATE_FORMAT(created_at, '%Y-%m-%d') AS day,
            SUM(event_type = 'view') AS views,
            SUM(event_type = 'click') AS clicks
     FROM download_click_logs
     WHERE created_at >= CURRENT_DATE - INTERVAL 13 DAY
     GROUP BY day
     ORDER BY day ASC`
  );
  const dailyMap = new Map(dailyRows.map((row) => [row.day, row]));
  const daily = [];
  for (let offset = 13; offset >= 0; offset -= 1) {
    const day = new Date();
    day.setDate(day.getDate() - offset);
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
    const row = dailyMap.get(key);
    daily.push({
      date: key,
      views: Number(row?.views || 0),
      clicks: Number(row?.clicks || 0)
    });
  }

  const [recentRows] = await getPool().query(
    `SELECT c.id, c.event_type, c.storage_key, c.ip, c.created_at,
            f.public_id AS file_public_id, f.title AS file_title,
            l.storage_name AS link_name
     FROM download_click_logs c
     JOIN download_files f ON f.id = c.file_id
     LEFT JOIN download_storage_links l ON l.id = c.link_id
     ORDER BY c.id DESC
     LIMIT 50`
  );

  return {
    totals: {
      files: Number(totalsRows[0].file_total),
      activeFiles: Number(totalsRows[0].file_active),
      views: Number(totalsRows[0].view_total),
      clicks: Number(totalsRows[0].click_total),
      todayViews: Number(totalsRows[0].view_today),
      todayClicks: Number(totalsRows[0].click_today),
      visitors: Number(totalsRows[0].visitor_total),
      todayVisitors: Number(totalsRows[0].visitor_today)
    },
    daily,
    recent: recentRows.map((row) => ({
      id: row.id,
      event: row.event_type,
      fileId: row.file_public_id,
      fileTitle: row.file_title,
      linkName: row.link_name || "",
      storageKey: row.storage_key || "",
      ip: row.ip || "",
      createdAt: toIsoDate(row.created_at)
    }))
  };
}

async function listAdminFiles() {
  const [rows] = await getPool().query(
    `SELECT f.*,
       (
         SELECT COUNT(*)
         FROM download_storage_links l
         WHERE l.file_id = f.id
       ) AS storage_count,
       (
         SELECT COUNT(*)
         FROM download_ip_stats v
         WHERE v.file_id = f.id
       ) AS visitor_count
     FROM download_files f
     ORDER BY f.created_at DESC, f.id DESC`
  );
  return rows.map((row) => toAdminFile(row));
}

async function getFileRowByPublicId(fileId) {
  const [rows] = await getPool().execute(
    `SELECT * FROM download_files WHERE public_id = ? LIMIT 1`,
    [fileId]
  );
  return rows[0] || null;
}

async function getAdminFile(fileId) {
  const fileRow = await getFileRowByPublicId(fileId);
  if (!fileRow) {
    throw new HttpError(404, "文件不存在");
  }
  const links = await getAdminLinks(fileRow.id);
  return toAdminFile(
    { ...fileRow, storage_count: links.length, visitor_count: await countFileVisitors(fileRow.id) },
    links
  );
}

async function countFileVisitors(fileDbId) {
  const [rows] = await getPool().execute(
    `SELECT COUNT(*) AS visitor_count FROM download_ip_stats WHERE file_id = ?`,
    [fileDbId]
  );
  return Number(rows[0].visitor_count || 0);
}

async function getAdminFileVisitors(fileId) {
  const [rows] = await getPool().execute(
    `SELECT v.ip, v.view_count, v.click_count, v.first_seen_at, v.last_seen_at
     FROM download_ip_stats v
     JOIN download_files f ON f.id = v.file_id
     WHERE f.public_id = ?
     ORDER BY v.last_seen_at DESC, v.id DESC
     LIMIT 200`,
    [fileId]
  );
  return rows.map((row) => ({
    ip: row.ip || "",
    viewCount: Number(row.view_count || 0),
    clickCount: Number(row.click_count || 0),
    firstSeenAt: toIsoDate(row.first_seen_at),
    lastSeenAt: toIsoDate(row.last_seen_at)
  }));
}

async function updateAdminFile(fileId, body) {
  const updates = [];
  const params = [];

  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title) {
      throw new HttpError(400, "文件标题不能为空");
    }
    updates.push("title = ?");
    params.push(title);
  }
  if (body.fileName !== undefined) {
    const fileName = String(body.fileName).trim();
    if (!fileName) {
      throw new HttpError(400, "文件名不能为空");
    }
    updates.push("file_name = ?");
    params.push(fileName);
  }
  if (body.description !== undefined) {
    updates.push("description = ?");
    params.push(String(body.description).trim() || null);
  }
  if (body.icon !== undefined) {
    updates.push("icon = ?");
    params.push(String(body.icon).trim() || "folder_zip");
  }
  if (body.sizeLabel !== undefined) {
    updates.push("size_label = ?");
    params.push(String(body.sizeLabel).trim() || null);
  }
  if (body.sizeBytes !== undefined) {
    const sizeBytes = Number(body.sizeBytes);
    if (!Number.isFinite(sizeBytes) || sizeBytes < 0) {
      throw new HttpError(400, "sizeBytes 不正确");
    }
    updates.push("size_bytes = ?");
    params.push(Math.floor(sizeBytes));
  }
  if (body.owner !== undefined) {
    updates.push("owner = ?");
    params.push(String(body.owner).trim() || null);
  }
  if (body.accessCode !== undefined && String(body.accessCode).trim()) {
    updates.push("access_code_hash = ?");
    params.push(hashAccessCode(String(body.accessCode).trim()));
  } else if (body.clearAccessCode === true) {
    updates.push("access_code_hash = NULL");
  }
  if (body.expiresAt !== undefined) {
    updates.push("expires_at = ?");
    params.push(String(body.expiresAt).trim() ? toNullableDate(body.expiresAt) : null);
  }
  if (body.isActive !== undefined) {
    updates.push("is_active = ?");
    params.push(body.isActive ? 1 : 0);
  }

  if (!updates.length) {
    throw new HttpError(400, "没有需要更新的字段");
  }

  updates.push("updated_at = CURRENT_TIMESTAMP");
  params.push(fileId);

  const [result] = await getPool().execute(
    `UPDATE download_files SET ${updates.join(", ")} WHERE public_id = ?`,
    params
  );
  if (!result.affectedRows) {
    throw new HttpError(404, "文件不存在");
  }
  return getAdminFile(fileId);
}

async function deleteAdminFile(fileId) {
  const [result] = await getPool().execute(
    `DELETE FROM download_files WHERE public_id = ?`,
    [fileId]
  );
  if (!result.affectedRows) {
    throw new HttpError(404, "文件不存在");
  }
}

async function addAdminLink(fileId, body) {
  const fileRow = await getFileRowByPublicId(fileId);
  if (!fileRow) {
    throw new HttpError(404, "文件不存在");
  }

  const url = validateLinkUrl(body.url);
  const storageName = String(body.storageName || "").trim();
  const inferred = inferStorage(url, storageName || url);
  const storageKey = body.storageKey ? normalizeStorageKey(body.storageKey) : inferred.key;
  const name = storageName || inferred.name;
  const extractCode = String(body.extractCode || "").trim() || null;
  const note = String(body.note || "").trim() || null;
  const isActive = body.isActive === undefined ? 1 : body.isActive ? 1 : 0;

  let sortOrder = Number(body.sortOrder);
  if (!Number.isFinite(sortOrder)) {
    const [rows] = await getPool().execute(
      `SELECT COALESCE(MAX(sort_order), 0) + 10 AS next_order FROM download_storage_links WHERE file_id = ?`,
      [fileRow.id]
    );
    sortOrder = Number(rows[0].next_order);
  } else {
    sortOrder = Math.floor(sortOrder);
  }

  const basePublicId = `${fileRow.public_id}-${publicIdPart(storageKey, "link")}`.slice(0, 118);
  for (let suffix = 1; suffix <= 20; suffix += 1) {
    const publicId = suffix === 1 ? basePublicId : `${basePublicId}-${suffix}`.slice(0, 128);
    try {
      await getPool().execute(
        `INSERT INTO download_storage_links (
           public_id,
           file_id,
           storage_key,
           storage_name,
           storage_icon,
           url,
           extract_code,
           note,
           sort_order,
           is_active
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          publicId,
          fileRow.id,
          storageKey,
          name.slice(0, 128),
          inferred.icon,
          url,
          extractCode,
          note,
          sortOrder,
          isActive
        ]
      );
      const [linkRows] = await getPool().execute(
        `SELECT l.*, COALESCE(NULLIF(p.icon_url, ''), l.storage_icon) AS icon
         FROM download_storage_links l
         LEFT JOIN download_storage_providers p
           ON p.storage_key = l.storage_key AND p.is_active = 1
         WHERE l.public_id = ? LIMIT 1`,
        [publicId]
      );
      return toAdminLink(linkRows[0]);
    } catch (error) {
      if (error.code !== "ER_DUP_ENTRY") {
        throw error;
      }
    }
  }

  throw new HttpError(409, "链接 publicId 生成失败，请修改网盘 key");
}

async function updateAdminLink(linkId, body) {
  const [rows] = await getPool().execute(
    `SELECT * FROM download_storage_links WHERE id = ? LIMIT 1`,
    [linkId]
  );
  if (!rows.length) {
    throw new HttpError(404, "链接不存在");
  }

  const updates = [];
  const params = [];

  if (body.storageKey !== undefined) {
    updates.push("storage_key = ?");
    params.push(normalizeStorageKey(body.storageKey));
  }
  if (body.storageName !== undefined) {
    const name = String(body.storageName).trim();
    if (!name) {
      throw new HttpError(400, "网盘名称不能为空");
    }
    updates.push("storage_name = ?");
    params.push(name.slice(0, 128));
  }
  if (body.url !== undefined) {
    updates.push("url = ?");
    params.push(validateLinkUrl(body.url));
  }
  if (body.extractCode !== undefined) {
    updates.push("extract_code = ?");
    params.push(String(body.extractCode).trim() || null);
  }
  if (body.note !== undefined) {
    updates.push("note = ?");
    params.push(String(body.note).trim() || null);
  }
  if (body.sortOrder !== undefined) {
    const sortOrder = Number(body.sortOrder);
    if (!Number.isFinite(sortOrder)) {
      throw new HttpError(400, "排序不正确");
    }
    updates.push("sort_order = ?");
    params.push(Math.floor(sortOrder));
  }
  if (body.isActive !== undefined) {
    updates.push("is_active = ?");
    params.push(body.isActive ? 1 : 0);
  }

  if (!updates.length) {
    throw new HttpError(400, "没有需要更新的字段");
  }

  params.push(linkId);
  await getPool().execute(
    `UPDATE download_storage_links SET ${updates.join(", ")} WHERE id = ?`,
    params
  );

  const [updatedRows] = await getPool().execute(
    `SELECT l.*, COALESCE(NULLIF(p.icon_url, ''), l.storage_icon) AS icon
     FROM download_storage_links l
     LEFT JOIN download_storage_providers p
       ON p.storage_key = l.storage_key AND p.is_active = 1
     WHERE l.id = ? LIMIT 1`,
    [linkId]
  );
  return toAdminLink(updatedRows[0]);
}

async function deleteAdminLink(linkId) {
  const [result] = await getPool().execute(
    `DELETE FROM download_storage_links WHERE id = ?`,
    [linkId]
  );
  if (!result.affectedRows) {
    throw new HttpError(404, "链接不存在");
  }
}

async function getPublicFile(fileId) {
  const row = await getDownloadFile(fileId);
  return toPublicFile(row, false);
}

async function getProtectedFile(fileId) {
  const row = await getDownloadFile(fileId);
  const links = await getStorageLinks(row.id);
  return toPublicFile(row, true, links);
}

function requireAccess(req, fileRow) {
  if (!fileRow.access_code_hash) {
    return;
  }
  if (!verifyToken(getRequestToken(req), fileRow.public_id)) {
    throw new HttpError(401, "需要有效提取码");
  }
}

async function trackFileEvent(fileId, body, ip) {
  const event = String(body.event || "").trim().toLowerCase();
  if (event !== "view" && event !== "click") {
    throw new HttpError(400, "event 只支持 view 或 click");
  }

  if (event === "view") {
    const [rows] = await getPool().execute(
      `SELECT id FROM download_files WHERE public_id = ? AND is_active = 1 LIMIT 1`,
      [fileId]
    );
    if (!rows.length) {
      throw new HttpError(404, "文件不存在");
    }
    await getPool().execute(
      `UPDATE download_files SET view_count = view_count + 1 WHERE id = ?`,
      [rows[0].id]
    );
    await getPool().execute(
      `INSERT INTO download_click_logs (file_id, link_id, event_type, ip) VALUES (?, NULL, 'view', ?)`,
      [rows[0].id, ip]
    );
    await getPool().execute(
      `INSERT INTO download_ip_stats (file_id, ip, view_count) VALUES (?, ?, 1)
       ON DUPLICATE KEY UPDATE view_count = view_count + 1`,
      [rows[0].id, ip]
    );
    return;
  }

  const linkId = String(body.linkId || "").trim();
  if (!linkId) {
    throw new HttpError(400, "linkId 不能为空");
  }

  const [rows] = await getPool().execute(
    `SELECT l.id, l.storage_key, f.id AS file_db_id
     FROM download_storage_links l
     JOIN download_files f ON f.id = l.file_id
     WHERE l.public_id = ? AND f.public_id = ? AND l.is_active = 1 AND f.is_active = 1
     LIMIT 1`,
    [linkId, fileId]
  );
  if (!rows.length) {
    throw new HttpError(404, "链接不存在");
  }
  const link = rows[0];

  await getPool().execute(
    `UPDATE download_storage_links SET click_count = click_count + 1, last_clicked_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [link.id]
  );
  await getPool().execute(
    `UPDATE download_files SET click_count = click_count + 1 WHERE id = ?`,
    [link.file_db_id]
  );
  await getPool().execute(
    `INSERT INTO download_click_logs (file_id, link_id, event_type, storage_key, ip) VALUES (?, ?, 'click', ?, ?)`,
    [link.file_db_id, link.id, link.storage_key, ip]
  );
  await getPool().execute(
    `INSERT INTO download_ip_stats (file_id, ip, click_count) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE click_count = click_count + 1`,
    [link.file_db_id, ip]
  );
}

async function handleApi(req, res, requestUrl) {
  const segments = requestUrl.pathname
    .split("/")
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));

  if (segments[0] !== "api") {
    return false;
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, jsonHeaders({ "Content-Type": "text/plain; charset=utf-8" }));
    res.end();
    return true;
  }

  if (req.method === "GET" && segments[1] === "health") {
    await getPool().query("SELECT 1");
    sendJson(res, 200, { ok: true, db: true });
    return true;
  }

  if (segments[1] === "admin") {
    await requireAdmin(req);

    if (segments[2] === "import") {
      if (req.method !== "POST") {
        throw new HttpError(405, "请求方法不支持");
      }
      const result = await importDownloadFile(await readJsonBody(req));
      sendJson(res, 201, result);
      return true;
    }

    if (segments[2] === "storage-providers") {
      if (req.method === "GET") {
        sendJson(res, 200, { providers: await listStorageProviders() });
        return true;
      }
      if (req.method === "POST" || req.method === "PUT") {
        sendJson(res, 200, await saveStorageProvider(await readJsonBody(req)));
        return true;
      }
      throw new HttpError(405, "请求方法不支持");
    }

    if (segments[2] === "tokens") {
      if (!segments[3]) {
        if (req.method === "GET") {
          sendJson(res, 200, await listAdminTokens());
          return true;
        }
        if (req.method === "POST") {
          sendJson(res, 201, await createAdminToken(await readJsonBody(req)));
          return true;
        }
        throw new HttpError(405, "请求方法不支持");
      }

      if (segments[4]) {
        throw new HttpError(404, "接口不存在");
      }

      const tokenId = normalizeAdminTokenId(segments[3]);
      if (req.method === "PUT") {
        sendJson(res, 200, await updateAdminToken(tokenId, await readJsonBody(req)));
        return true;
      }
      if (req.method === "DELETE") {
        await deleteAdminToken(tokenId);
        sendJson(res, 200, { ok: true });
        return true;
      }
      throw new HttpError(405, "请求方法不支持");
    }

    if (segments[2] === "stats") {
      if (req.method !== "GET") {
        throw new HttpError(405, "请求方法不支持");
      }
      sendJson(res, 200, await getAdminStats());
      return true;
    }

    if (segments[2] === "files") {
      if (!segments[3]) {
        if (req.method !== "GET") {
          throw new HttpError(405, "请求方法不支持");
        }
        sendJson(res, 200, { files: await listAdminFiles() });
        return true;
      }

      if (!segments[4]) {
        if (req.method === "GET") {
          sendJson(res, 200, { file: await getAdminFile(segments[3]) });
          return true;
        }
        if (req.method === "PUT") {
          sendJson(res, 200, { file: await updateAdminFile(segments[3], await readJsonBody(req)) });
          return true;
        }
        if (req.method === "DELETE") {
          await deleteAdminFile(segments[3]);
          sendJson(res, 200, { ok: true });
          return true;
        }
        throw new HttpError(405, "请求方法不支持");
      }

      if (segments[4] === "links") {
        if (req.method !== "POST") {
          throw new HttpError(405, "请求方法不支持");
        }
        sendJson(res, 201, { link: await addAdminLink(segments[3], await readJsonBody(req)) });
        return true;
      }

      if (segments[4] === "visitors") {
        if (req.method !== "GET") {
          throw new HttpError(405, "请求方法不支持");
        }
        sendJson(res, 200, { visitors: await getAdminFileVisitors(segments[3]) });
        return true;
      }

      throw new HttpError(404, "接口不存在");
    }

    if (segments[2] === "links" && segments[3] && !segments[4]) {
      const linkId = normalizeDbId(segments[3]);
      if (req.method === "PUT") {
        sendJson(res, 200, { link: await updateAdminLink(linkId, await readJsonBody(req)) });
        return true;
      }
      if (req.method === "DELETE") {
        await deleteAdminLink(linkId);
        sendJson(res, 200, { ok: true });
        return true;
      }
      throw new HttpError(405, "请求方法不支持");
    }

    throw new HttpError(404, "接口不存在");
  }

  if (segments[1] !== "files" || !segments[2]) {
    throw new HttpError(404, "接口不存在");
  }

  const fileId = segments[2];

  if (req.method === "GET" && segments.length === 3) {
    sendJson(res, 200, { file: await getPublicFile(fileId) });
    return true;
  }

  if (req.method === "POST" && segments[3] === "verify") {
    const fileRow = await getDownloadFile(fileId);
    const body = await readJsonBody(req);

    if (fileRow.access_code_hash && !timingSafeHexEqual(hashAccessCode(body.code), fileRow.access_code_hash)) {
      throw new HttpError(401, "提取码不正确");
    }

    const now = Math.floor(Date.now() / 1000);
    const exp = now + TOKEN_TTL_SECONDS;
    const accessToken = signToken({ fileId: fileRow.public_id, exp });
    sendJson(res, 200, {
      accessToken,
      expiresAt: new Date(exp * 1000).toISOString(),
      file: await getProtectedFile(fileId)
    });
    return true;
  }

  if (req.method === "GET" && segments[3] === "content") {
    const fileRow = await getDownloadFile(fileId);
    requireAccess(req, fileRow);
    sendJson(res, 200, { file: await getProtectedFile(fileId) });
    return true;
  }

  if (req.method === "POST" && segments[3] === "track") {
    await trackFileEvent(fileId, await readJsonBody(req), getVisitorIp(req));
    sendJson(res, 200, { ok: true });
    return true;
  }

  throw new HttpError(404, "接口不存在");
}

function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".svg": "image/svg+xml"
  };
  return types[ext] || "application/octet-stream";
}

function isLegacyLinkCode(requestUrl) {
  const pathname = decodeURIComponent(requestUrl.pathname || "").replace(/^\/+|\/+$/g, "");
  if (!pathname || pathname === "import" || pathname === "admin" || pathname.includes("/")) {
    return false;
  }
  if (path.extname(pathname)) {
    return false;
  }
  return /^[A-Za-z0-9_-]{4,128}$/.test(pathname);
}

function redirectLegacyLink(res, requestUrl) {
  const id = decodeURIComponent(requestUrl.pathname).replace(/^\/+|\/+$/g, "");
  const target = new URL(LEGACY_LINK_BASE_URL);
  target.searchParams.set("id", id);
  res.writeHead(302, {
    Location: target.toString(),
    "Cache-Control": "no-store"
  });
  res.end();
}

async function serveStatic(req, res, requestUrl) {
  if (!fs.existsSync(FRONTEND_DIST)) {
    sendJson(res, 404, { message: "前端 dist 不存在，请先在 frontend 执行 npm run build" });
    return;
  }

  const relativePath = requestUrl.pathname === "/" ? "index.html" : requestUrl.pathname.slice(1);
  const fullPath = path.resolve(FRONTEND_DIST, relativePath);
  if (fullPath !== FRONTEND_DIST && !fullPath.startsWith(`${FRONTEND_DIST}${path.sep}`)) {
    throw new HttpError(400, "静态资源路径不合法");
  }

  let stat = null;
  try {
    stat = fs.statSync(fullPath);
  } catch {
    stat = null;
  }

  const targetPath = stat && stat.isFile() ? fullPath : path.join(FRONTEND_DIST, "index.html");
  const targetStat = fs.statSync(targetPath);
  res.writeHead(200, {
    "Content-Type": mimeType(targetPath),
    "Content-Length": targetStat.size
  });
  fs.readFile(targetPath, (error, content) => {
    if (error) {
      res.destroy(error);
      return;
    }
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  try {
    const handled = await handleApi(req, res, requestUrl);
    if (!handled) {
      if (req.method === "GET" && isLegacyLinkCode(requestUrl)) {
        redirectLegacyLink(res, requestUrl);
        return;
      }
      await serveStatic(req, res, requestUrl);
    }
  } catch (error) {
    sendError(res, error);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SecureShare backend listening on http://${HOST}:${PORT}`);
});

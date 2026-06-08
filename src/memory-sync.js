"use strict";

const fsDefault = require("fs");
const pathDefault = require("path");
const { pruneMemory } = require("./memory-pruner");

const SYNC_SCHEMA_VERSION = 1;
const DEFAULT_GIST_FILENAME = "clawd-memory.json";
const TOKEN_LINE_RE = /^\s*CLAWD_GITHUB_GIST_TOKEN\s*=\s*(.+?)\s*$/m;

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeMemorySyncConfig(value = {}) {
  const raw = isPlainObject(value) ? value : {};
  const gistId = typeof raw.gistId === "string" ? raw.gistId.trim().slice(0, 128) : "";
  return {
    enabled: raw.enabled === true,
    gistId: /^[A-Za-z0-9_-]+$/.test(gistId) ? gistId : "",
    autoPullOnStartup: raw.autoPullOnStartup !== false,
    autoPushOnSave: raw.autoPushOnSave !== false,
  };
}

function normalizeToken(value) {
  return typeof value === "string" ? value.trim() : "";
}

function isValidGitHubToken(value) {
  const token = normalizeToken(value);
  if (token.length < 20 || token.length > 260) return false;
  return /^[A-Za-z0-9_:-]+$/.test(token);
}

function maskToken(token) {
  const value = normalizeToken(token);
  if (!value) return "";
  if (value.length <= 10) return `${value.slice(0, 2)}...${value.slice(-2)}`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

function parseTokenFromEnvFileText(text) {
  if (typeof text !== "string" || !text) return null;
  const match = text.match(TOKEN_LINE_RE);
  if (!match) return null;
  const token = normalizeToken(match[1]);
  return isValidGitHubToken(token) ? token : null;
}

function writeAtomic(fs, path, filePath, text, platform = process.platform) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, "utf8");
  try {
    if (platform !== "win32" && typeof fs.chmodSync === "function") fs.chmodSync(tmp, 0o600);
  } catch {}
  fs.renameSync(tmp, filePath);
  try {
    if (platform !== "win32" && typeof fs.chmodSync === "function") fs.chmodSync(filePath, 0o600);
  } catch {}
}

function createGitHubGistTokenStore({
  filePath,
  fs = fsDefault,
  path = pathDefault,
  platform = process.platform,
} = {}) {
  if (typeof filePath !== "string" || !filePath) {
    throw new TypeError("createGitHubGistTokenStore: filePath is required");
  }

  function readText() {
    try { return String(fs.readFileSync(filePath, "utf8") || ""); }
    catch { return ""; }
  }

  return {
    filePath,
    async getToken() {
      return parseTokenFromEnvFileText(readText());
    },
    async hasToken() {
      return parseTokenFromEnvFileText(readText()) !== null;
    },
    async getStatus() {
      const token = parseTokenFromEnvFileText(readText());
      return { tokenStored: !!token, masked: token ? maskToken(token) : "" };
    },
    async writeToken(token) {
      const normalized = normalizeToken(token);
      if (!isValidGitHubToken(normalized)) {
        throw new Error("invalid GitHub token");
      }
      writeAtomic(fs, path, filePath, `CLAWD_GITHUB_GIST_TOKEN=${normalized}\n`, platform);
    },
    async deleteToken() {
      try { fs.unlinkSync(filePath); } catch {}
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value || null));
}

function normalizeRemoteMemoryPayload(raw) {
  if (!raw) return null;
  if (isPlainObject(raw) && isPlainObject(raw.memory)) return raw.memory;
  if (isPlainObject(raw) && (Array.isArray(raw.snapshots) || isPlainObject(raw.index))) return raw;
  return null;
}

function parseGistMemoryContent(text) {
  if (typeof text !== "string" || !text.trim()) return null;
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return null; }
  return normalizeRemoteMemoryPayload(parsed);
}

function mergeArrayByKey(items, keyFn) {
  const map = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    if (!item || typeof item !== "object") continue;
    const key = keyFn(item);
    if (!key) continue;
    const existing = map.get(key);
    if (!existing || Number(item.updatedAt || item.createdAt || 0) >= Number(existing.updatedAt || existing.createdAt || 0)) {
      map.set(key, item);
    }
  }
  return [...map.values()];
}

function mergeMemory(localMemory, remoteMemory, options = {}) {
  const local = clone(localMemory) || {};
  const remote = clone(remoteMemory) || {};
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const deviceId = local.deviceId || remote.deviceId || "";
  const localIndex = isPlainObject(local.index) ? local.index : {};
  const remoteIndex = isPlainObject(remote.index) ? remote.index : {};
  const mergedRaw = {
    deviceId,
    snapshots: [
      ...(Array.isArray(remote.snapshots) ? remote.snapshots : []),
      ...(Array.isArray(local.snapshots) ? local.snapshots : []),
    ],
    weeks: [
      ...(Array.isArray(remote.weeks) ? remote.weeks : []),
      ...(Array.isArray(local.weeks) ? local.weeks : []),
    ],
    months: [
      ...(Array.isArray(remote.months) ? remote.months : []),
      ...(Array.isArray(local.months) ? local.months : []),
    ],
    index: {
      ...localIndex,
      milestones: mergeArrayByKey(
        [
          ...(Array.isArray(remoteIndex.milestones) ? remoteIndex.milestones : []),
          ...(Array.isArray(localIndex.milestones) ? localIndex.milestones : []),
        ],
        (item) => item.sourceId || `${item.type || ""}:${item.value || ""}`,
      ),
      badges: mergeArrayByKey(
        [
          ...(Array.isArray(remoteIndex.badges) ? remoteIndex.badges : []),
          ...(Array.isArray(localIndex.badges) ? localIndex.badges : []),
        ],
        (item) => item.id,
      ),
    },
  };
  return pruneMemory(mergedRaw, { now });
}

function buildGistDocument(memory, options = {}) {
  return {
    schemaVersion: SYNC_SCHEMA_VERSION,
    kind: "clawd-memory",
    updatedAt: Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now(),
    memory: clone(memory),
  };
}

function resolveGistMemoryFile(gist, filename = DEFAULT_GIST_FILENAME) {
  const files = gist && gist.files && typeof gist.files === "object" ? gist.files : {};
  return files[filename] || files[Object.keys(files).find((key) => /clawd-memory.*\.json$/i.test(key))] || null;
}

function createGitHubClient({ fetchImpl = globalThis.fetch, tokenStore, filename = DEFAULT_GIST_FILENAME } = {}) {
  if (typeof fetchImpl !== "function") throw new TypeError("createGitHubClient requires fetch");
  if (!tokenStore || typeof tokenStore.getToken !== "function") throw new TypeError("createGitHubClient requires tokenStore");

  async function request(method, apiPath, body) {
    const token = await tokenStore.getToken();
    if (!token) return { status: "error", code: "missing_token", message: "GitHub token is not configured" };
    const response = await fetchImpl(`https://api.github.com${apiPath}`, {
      method,
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let text = "";
    try { text = await response.text(); } catch {}
    let json = null;
    if (text) {
      try { json = JSON.parse(text); } catch {}
    }
    if (!response.ok) {
      return {
        status: "error",
        code: `http_${response.status}`,
        message: (json && json.message) || `GitHub request failed (${response.status})`,
      };
    }
    return { status: "ok", json };
  }

  async function readRaw(rawUrl) {
    if (typeof rawUrl !== "string" || !rawUrl) return { status: "error", message: "raw_url missing" };
    const token = await tokenStore.getToken();
    if (!token) return { status: "error", code: "missing_token", message: "GitHub token is not configured" };
    const response = await fetchImpl(rawUrl, {
      headers: {
        "Authorization": `Bearer ${token}`,
        "Accept": "application/vnd.github.raw",
      },
    });
    const text = await response.text();
    if (!response.ok) {
      return { status: "error", code: `http_${response.status}`, message: `GitHub raw file request failed (${response.status})` };
    }
    return { status: "ok", text };
  }

  async function readGist(gistId) {
    const id = typeof gistId === "string" ? gistId.trim() : "";
    if (!id) return { status: "error", code: "missing_gist", message: "Gist ID is not configured" };
    const result = await request("GET", `/gists/${encodeURIComponent(id)}`);
    if (result.status !== "ok") return result;
    const file = resolveGistMemoryFile(result.json, filename);
    if (!file) return { status: "ok", gist: result.json, memory: null };
    let content = typeof file.content === "string" ? file.content : "";
    if ((!content || file.truncated) && file.raw_url) {
      const raw = await readRaw(file.raw_url);
      if (raw.status !== "ok") return raw;
      content = raw.text;
    }
    return { status: "ok", gist: result.json, memory: parseGistMemoryContent(content) };
  }

  async function createGist(memory) {
    return request("POST", "/gists", {
      description: "Clawd local memory sync",
      public: false,
      files: {
        [filename]: { content: `${JSON.stringify(buildGistDocument(memory), null, 2)}\n` },
      },
    });
  }

  async function updateGist(gistId, memory) {
    const id = typeof gistId === "string" ? gistId.trim() : "";
    if (!id) return createGist(memory);
    return request("PATCH", `/gists/${encodeURIComponent(id)}`, {
      files: {
        [filename]: { content: `${JSON.stringify(buildGistDocument(memory), null, 2)}\n` },
      },
    });
  }

  return { createGist, readGist, updateGist };
}

function createMemorySync(options = {}) {
  const memoryEngine = options.memoryEngine || null;
  const settingsController = options.settingsController || null;
  const tokenStore = options.tokenStore;
  const now = typeof options.now === "function" ? options.now : Date.now;
  const client = options.client || createGitHubClient({
    fetchImpl: options.fetch,
    tokenStore,
    filename: options.filename || DEFAULT_GIST_FILENAME,
  });
  const log = typeof options.log === "function" ? options.log : (() => {});
  let inFlight = null;
  let pushTimer = null;
  let lastSyncAt = 0;
  let lastSyncStatus = "idle";
  let lastSyncError = "";

  function getConfig() {
    const raw = settingsController && typeof settingsController.get === "function"
      ? settingsController.get("memorySync")
      : options.config;
    return normalizeMemorySyncConfig(raw);
  }

  function updateConfig(partial) {
    const next = normalizeMemorySyncConfig({ ...getConfig(), ...(partial || {}) });
    if (!settingsController || typeof settingsController.applyUpdate !== "function") {
      options.config = next;
      return { status: "ok" };
    }
    return settingsController.applyUpdate("memorySync", next);
  }

  function getLocalMemory() {
    if (!memoryEngine || typeof memoryEngine.getMemorySnapshot !== "function") return null;
    if (typeof memoryEngine.flush === "function") memoryEngine.flush();
    return memoryEngine.getMemorySnapshot();
  }

  function replaceLocalMemory(memory) {
    if (!memoryEngine || typeof memoryEngine.replaceMemory !== "function") {
      return { status: "error", message: "memory engine cannot replace memory" };
    }
    memoryEngine.replaceMemory(memory, { notify: false });
    return { status: "ok" };
  }

  function rememberResult(result, label) {
    lastSyncAt = now();
    lastSyncStatus = result && (result.status === "ok" || result.status === "skip") ? result.status : "error";
    lastSyncError = lastSyncStatus === "error" ? ((result && result.message) || `${label} failed`) : "";
    if (lastSyncStatus === "error") log(`memory sync ${label} failed: ${lastSyncError}`);
    return result;
  }

  function runExclusive(label, fn) {
    if (inFlight) {
      return inFlight.then(() => runExclusive(label, fn), () => runExclusive(label, fn));
    }
    inFlight = Promise.resolve()
      .then(fn)
      .then((result) => rememberResult(result, label), (err) => rememberResult({ status: "error", message: err && err.message ? err.message : String(err) }, label))
      .finally(() => {
        inFlight = null;
      });
    return inFlight;
  }

  async function configure(payload = {}) {
    try {
      const token = normalizeToken(payload.token);
      if (payload.clearToken === true && tokenStore && typeof tokenStore.deleteToken === "function") {
        await tokenStore.deleteToken();
      }
      if (token) {
        await tokenStore.writeToken(token);
      }
      const partial = {};
      for (const key of ["enabled", "gistId", "autoPullOnStartup", "autoPushOnSave"]) {
        if (Object.prototype.hasOwnProperty.call(payload, key)) partial[key] = payload[key];
      }
      const saved = await Promise.resolve(updateConfig(partial));
      if (!saved || saved.status !== "ok") return saved || { status: "error", message: "failed to save memory sync settings" };
      return getStatus();
    } catch (err) {
      return { status: "error", message: (err && err.message) || String(err) };
    }
  }

  async function getStatus() {
    const token = tokenStore && typeof tokenStore.getStatus === "function"
      ? await tokenStore.getStatus()
      : { tokenStored: false, masked: "" };
    return {
      status: "ok",
      config: getConfig(),
      token,
      inFlight: !!inFlight,
      lastSyncAt,
      lastSyncStatus,
      lastSyncError,
    };
  }

  async function pull(options = {}) {
    return runExclusive("pull", async () => {
      const config = getConfig();
      if (options.auto === true && (!config.enabled || !config.autoPullOnStartup)) return { status: "skip", reason: "disabled" };
      if (!config.enabled && options.force !== true) return { status: "error", message: "GitHub sync is disabled" };
      if (!config.gistId) return { status: "error", message: "Gist ID is not configured" };
      const local = getLocalMemory();
      if (!local) return { status: "error", message: "local memory unavailable" };
      const remote = await client.readGist(config.gistId);
      if (remote.status !== "ok") return remote;
      if (!remote.memory) return { status: "ok", pulled: false, merged: false };
      const merged = mergeMemory(local, remote.memory, { now: now() });
      const replaced = replaceLocalMemory(merged);
      if (replaced.status !== "ok") return replaced;
      return { status: "ok", pulled: true, merged: true, memory: merged };
    });
  }

  async function push(options = {}) {
    return runExclusive("push", async () => {
      const config = getConfig();
      if (options.auto === true && (!config.enabled || !config.autoPushOnSave)) return { status: "skip", reason: "disabled" };
      if (!config.enabled && options.force !== true) return { status: "error", message: "GitHub sync is disabled" };
      const local = options.memory || getLocalMemory();
      if (!local) return { status: "error", message: "local memory unavailable" };
      let gistId = config.gistId;
      if (gistId) {
        const remote = await client.readGist(gistId);
        if (remote.status !== "ok") return remote;
        if (remote.memory) {
          const merged = mergeMemory(local, remote.memory, { now: now() });
          replaceLocalMemory(merged);
        }
      }
      const latest = getLocalMemory() || local;
      const pushed = gistId
        ? await client.updateGist(gistId, latest)
        : await client.createGist(latest);
      if (pushed.status !== "ok") return pushed;
      if (!gistId && pushed.json && pushed.json.id) {
        gistId = pushed.json.id;
        await Promise.resolve(updateConfig({ gistId }));
      }
      return { status: "ok", pushed: true, gistId };
    });
  }

  function schedulePush(memory) {
    const config = getConfig();
    if (!config.enabled || !config.autoPushOnSave) return { status: "skip", reason: "disabled" };
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushTimer = null;
      push({ auto: true, memory }).catch(() => {});
    }, 1500);
    if (pushTimer && typeof pushTimer.unref === "function") pushTimer.unref();
    return { status: "ok", scheduled: true };
  }

  function pullOnStartup() {
    const config = getConfig();
    if (!config.enabled || !config.autoPullOnStartup) return { status: "skip", reason: "disabled" };
    pull({ auto: true }).catch(() => {});
    return { status: "ok", scheduled: true };
  }

  function dispose() {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = null;
  }

  return {
    configure,
    dispose,
    getStatus,
    pull,
    pullOnStartup,
    push,
    schedulePush,
  };
}

module.exports = {
  DEFAULT_GIST_FILENAME,
  SYNC_SCHEMA_VERSION,
  buildGistDocument,
  createGitHubClient,
  createGitHubGistTokenStore,
  createMemorySync,
  isValidGitHubToken,
  mergeMemory,
  normalizeMemorySyncConfig,
  parseGistMemoryContent,
  parseTokenFromEnvFileText,
};

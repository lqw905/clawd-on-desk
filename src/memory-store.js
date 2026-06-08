"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const MEMORY_SCHEMA_VERSION = 1;
const DEFAULT_DEVICE_FILE = "device.json";
const DEFAULT_INDEX_FILE = "index.json";
const DEFAULT_SNAPSHOTS_FILE = "snapshots.json";
const DEFAULT_WEEKS_FILE = "weeks.json";
const DEFAULT_MONTHS_FILE = "months.json";

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createDefaultIndex(deviceId) {
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    deviceId: deviceId || "",
    streak: { current: 0, longest: 0, lastActiveDate: "" },
    totals: { activeMs: 0, sessions: 0, agentEvents: 0 },
    records: {
      longestActiveMs: 0,
      highestDailyActiveMs: 0,
      highestDailyAgentEvents: 0,
      date: "",
    },
    profile: { chronotype: "", peakDay: "", topAgent: "" },
    level: "first_meet",
    milestones: [],
    updatedAt: 0,
  };
}

function normalizeNumber(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function normalizeString(value, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function normalizeStringMap(value) {
  const out = {};
  if (!isPlainObject(value)) return out;
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = normalizeString(key).trim();
    if (!normalizedKey) continue;
    out[normalizedKey] = normalizeNumber(raw);
  }
  return out;
}

function normalizeMilestones(value) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const item of value) {
    if (!isPlainObject(item)) continue;
    const type = normalizeString(item.type).trim();
    const date = normalizeString(item.date).trim();
    const sourceId = normalizeString(item.sourceId).trim();
    if (!type || !date) continue;
    const key = `${type}:${date}:${sourceId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      type,
      date,
      sourceId,
      value: normalizeNumber(item.value),
      createdAt: normalizeNumber(item.createdAt),
    });
  }
  return out;
}

function normalizeIndex(raw, deviceId) {
  const base = createDefaultIndex(deviceId);
  if (!isPlainObject(raw)) return base;
  const streak = isPlainObject(raw.streak) ? raw.streak : {};
  const totals = isPlainObject(raw.totals) ? raw.totals : {};
  const records = isPlainObject(raw.records) ? raw.records : {};
  const profile = isPlainObject(raw.profile) ? raw.profile : {};
  return {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    deviceId: normalizeString(raw.deviceId, deviceId || "") || deviceId || "",
    streak: {
      current: normalizeNumber(streak.current),
      longest: normalizeNumber(streak.longest),
      lastActiveDate: normalizeString(streak.lastActiveDate),
    },
    totals: {
      activeMs: normalizeNumber(totals.activeMs),
      sessions: normalizeNumber(totals.sessions),
      agentEvents: normalizeNumber(totals.agentEvents),
    },
    records: {
      longestActiveMs: normalizeNumber(records.longestActiveMs),
      highestDailyActiveMs: normalizeNumber(records.highestDailyActiveMs),
      highestDailyAgentEvents: normalizeNumber(records.highestDailyAgentEvents),
      date: normalizeString(records.date),
    },
    profile: {
      chronotype: normalizeString(profile.chronotype),
      peakDay: normalizeString(profile.peakDay),
      topAgent: normalizeString(profile.topAgent),
    },
    level: normalizeString(raw.level, base.level) || base.level,
    milestones: normalizeMilestones(raw.milestones),
    updatedAt: normalizeNumber(raw.updatedAt),
  };
}

function normalizeSnapshot(raw, deviceId) {
  if (!isPlainObject(raw)) return null;
  const date = normalizeString(raw.date).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const rawDeviceId = normalizeString(raw.deviceId).trim() || deviceId || "";
  const snapshotId = normalizeString(raw.snapshotId).trim() || `${date}:${rawDeviceId}`;
  return {
    snapshotId,
    deviceId: rawDeviceId,
    date,
    activeMs: normalizeNumber(raw.activeMs),
    sessions: normalizeNumber(raw.sessions),
    agentEvents: normalizeNumber(raw.agentEvents),
    agents: normalizeStringMap(raw.agents),
    projects: normalizeStringMap(raw.projects),
    sessionKeys: Array.isArray(raw.sessionKeys)
      ? raw.sessionKeys.filter((value) => typeof value === "string" && value)
      : [],
    updatedAt: normalizeNumber(raw.updatedAt),
  };
}

function normalizeSnapshotList(value, deviceId) {
  if (!Array.isArray(value)) return [];
  const byId = new Map();
  for (const item of value) {
    const snapshot = normalizeSnapshot(item, deviceId);
    if (!snapshot) continue;
    const existing = byId.get(snapshot.snapshotId);
    if (!existing || snapshot.updatedAt >= existing.updatedAt) {
      byId.set(snapshot.snapshotId, snapshot);
    }
  }
  return [...byId.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function readJsonFile(fsApi, filePath, fallback) {
  try {
    return JSON.parse(fsApi.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function writeJsonAtomic(fsApi, filePath, data) {
  fsApi.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fsApi.writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  fsApi.renameSync(tmp, filePath);
}

function createDeviceId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return crypto.randomBytes(16).toString("hex");
}

function normalizeDevice(raw) {
  const deviceId = isPlainObject(raw) && typeof raw.deviceId === "string"
    ? raw.deviceId.trim()
    : "";
  return deviceId || createDeviceId();
}

function createMemoryStore(options = {}) {
  const fsApi = options.fs || fs;
  const memoryDir = options.memoryDir
    || (options.userDataDir ? path.join(options.userDataDir, "memory") : null);
  if (!memoryDir) throw new Error("createMemoryStore requires memoryDir or userDataDir");

  const paths = {
    dir: memoryDir,
    device: path.join(memoryDir, DEFAULT_DEVICE_FILE),
    index: path.join(memoryDir, DEFAULT_INDEX_FILE),
    snapshots: path.join(memoryDir, DEFAULT_SNAPSHOTS_FILE),
    weeks: path.join(memoryDir, DEFAULT_WEEKS_FILE),
    months: path.join(memoryDir, DEFAULT_MONTHS_FILE),
  };

  function getOrCreateDeviceId() {
    fsApi.mkdirSync(memoryDir, { recursive: true });
    const deviceId = normalizeDevice(readJsonFile(fsApi, paths.device, null));
    writeJsonAtomic(fsApi, paths.device, { schemaVersion: MEMORY_SCHEMA_VERSION, deviceId });
    return deviceId;
  }

  function loadMemory() {
    const deviceId = getOrCreateDeviceId();
    return {
      deviceId,
      index: normalizeIndex(readJsonFile(fsApi, paths.index, null), deviceId),
      snapshots: normalizeSnapshotList(readJsonFile(fsApi, paths.snapshots, []), deviceId),
      weeks: normalizeSnapshotList(readJsonFile(fsApi, paths.weeks, []), deviceId),
      months: normalizeSnapshotList(readJsonFile(fsApi, paths.months, []), deviceId),
    };
  }

  function saveMemory(memory) {
    const deviceId = normalizeString(memory && memory.deviceId) || getOrCreateDeviceId();
    const index = normalizeIndex(memory && memory.index, deviceId);
    const snapshots = normalizeSnapshotList(memory && memory.snapshots, deviceId);
    const weeks = normalizeSnapshotList(memory && memory.weeks, deviceId);
    const months = normalizeSnapshotList(memory && memory.months, deviceId);
    writeJsonAtomic(fsApi, paths.device, { schemaVersion: MEMORY_SCHEMA_VERSION, deviceId });
    writeJsonAtomic(fsApi, paths.index, index);
    writeJsonAtomic(fsApi, paths.snapshots, snapshots);
    writeJsonAtomic(fsApi, paths.weeks, weeks);
    writeJsonAtomic(fsApi, paths.months, months);
    return { deviceId, index, snapshots, weeks, months };
  }

  return {
    paths,
    loadMemory,
    saveMemory,
  };
}

module.exports = {
  MEMORY_SCHEMA_VERSION,
  createDefaultIndex,
  createMemoryStore,
  normalizeIndex,
  normalizeSnapshot,
  normalizeSnapshotList,
};

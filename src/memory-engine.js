"use strict";

const crypto = require("crypto");
const { dateToLocalTimestamp, formatLocalDate, pruneMemory } = require("./memory-pruner");

const ACTIVE_STATES = new Set(["working", "thinking", "carrying", "juggling"]);
const DEFAULT_FLUSH_DELAY_MS = 1000;
const MAX_ACTIVE_INTERVAL_MS = 4 * 60 * 60 * 1000;

function normalizeString(value) {
  return typeof value === "string" ? value.trim() : "";
}

function stableHash(value) {
  return crypto.createHash("sha1").update(String(value)).digest("hex").slice(0, 16);
}

function isActiveState(state) {
  return ACTIVE_STATES.has(state);
}

function addCount(map, key, by = 1) {
  const normalizedKey = normalizeString(key);
  if (!normalizedKey) return;
  map[normalizedKey] = (map[normalizedKey] || 0) + by;
}

function createSnapshot(deviceId, date, nowMs) {
  return {
    snapshotId: `${date}:${deviceId}`,
    deviceId,
    date,
    activeMs: 0,
    sessions: 0,
    agentEvents: 0,
    agents: {},
    projects: {},
    sessionKeys: [],
    updatedAt: nowMs,
  };
}

function getSnapshot(memory, date, nowMs) {
  let snapshot = memory.snapshots.find((item) => item.date === date && item.deviceId === memory.deviceId);
  if (!snapshot) {
    snapshot = createSnapshot(memory.deviceId, date, nowMs);
    memory.snapshots.push(snapshot);
  }
  return snapshot;
}

function splitActiveMs(memory, startMs, endMs, meta) {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return;
  let cursor = startMs;
  while (cursor < endMs) {
    const date = formatLocalDate(cursor);
    const nextDay = new Date(dateToLocalTimestamp(date));
    nextDay.setDate(nextDay.getDate() + 1);
    const boundary = Math.min(endMs, nextDay.getTime());
    const snapshot = getSnapshot(memory, date, endMs);
    snapshot.activeMs += Math.max(0, boundary - cursor);
    if (meta.agentId) addCount(snapshot.agents, meta.agentId, 0);
    if (meta.cwd) addCount(snapshot.projects, meta.cwd, 0);
    snapshot.updatedAt = endMs;
    cursor = boundary;
  }
}

function createMemoryEngine(options = {}) {
  const store = options.store;
  if (!store || typeof store.loadMemory !== "function" || typeof store.saveMemory !== "function") {
    throw new Error("createMemoryEngine requires a memory store");
  }
  const now = typeof options.now === "function" ? options.now : Date.now;
  const setTimer = typeof options.setTimeout === "function" ? options.setTimeout : setTimeout;
  const clearTimer = typeof options.clearTimeout === "function" ? options.clearTimeout : clearTimeout;
  const flushDelayMs = Number.isFinite(Number(options.flushDelayMs))
    ? Math.max(0, Number(options.flushDelayMs))
    : DEFAULT_FLUSH_DELAY_MS;

  let memory = store.loadMemory();
  let activeSessions = new Map();
  let flushTimer = null;
  let dirty = false;

  function scheduleFlush() {
    if (!dirty || flushTimer) return;
    flushTimer = setTimer(() => {
      flushTimer = null;
      flush();
    }, flushDelayMs);
    if (flushTimer && typeof flushTimer.unref === "function") flushTimer.unref();
  }

  function markDirty() {
    dirty = true;
    scheduleFlush();
  }

  function touchSessionCount(snapshot, sessionId, meta) {
    const rawKey = `${snapshot.date}:${meta.agentId || ""}:${meta.host || ""}:${sessionId || ""}`;
    const key = stableHash(rawKey);
    if (snapshot.sessionKeys.includes(key)) return;
    snapshot.sessionKeys.push(key);
    snapshot.sessions += 1;
  }

  function recordStateEvent(sessionId, state, event, opts = {}) {
    const id = normalizeString(sessionId);
    if (!id) return false;
    const at = now();
    const date = formatLocalDate(at);
    const meta = {
      agentId: normalizeString(opts.agentId) || "unknown",
      cwd: normalizeString(opts.cwd),
      model: normalizeString(opts.model),
      provider: normalizeString(opts.provider),
      host: normalizeString(opts.host),
    };
    const previous = activeSessions.get(id);
    if (previous && isActiveState(previous.state)) {
      const elapsed = Math.min(Math.max(0, at - previous.at), MAX_ACTIVE_INTERVAL_MS);
      splitActiveMs(memory, previous.at, previous.at + elapsed, previous.meta || meta);
    }

    const snapshot = getSnapshot(memory, date, at);
    touchSessionCount(snapshot, id, meta);
    if (event) {
      snapshot.agentEvents += 1;
      addCount(snapshot.agents, meta.agentId);
      if (meta.cwd) addCount(snapshot.projects, meta.cwd);
    }
    snapshot.updatedAt = at;

    if (event === "SessionEnd") {
      activeSessions.delete(id);
    } else {
      activeSessions.set(id, {
        at,
        state,
        meta,
      });
    }
    markDirty();
    return true;
  }

  function flush() {
    if (flushTimer) {
      clearTimer(flushTimer);
      flushTimer = null;
    }
    if (!dirty) return memory;
    memory = pruneMemory(memory, { now: now() });
    memory = store.saveMemory(memory);
    dirty = false;
    return memory;
  }

  function getMemorySnapshot() {
    return JSON.parse(JSON.stringify(memory));
  }

  function cleanup() {
    flush();
    activeSessions = new Map();
  }

  return {
    recordStateEvent,
    flush,
    cleanup,
    getMemorySnapshot,
  };
}

module.exports = {
  ACTIVE_STATES,
  MAX_ACTIVE_INTERVAL_MS,
  createMemoryEngine,
  isActiveState,
};

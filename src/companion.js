"use strict";

const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const COMPANION_STATES = Object.freeze({
  reunion: "companion-reunion",
  workReminder: "companion-work-reminder",
  record: "companion-record",
  unlock: "companion-unlock",
});

const MINI_COMPANION_STATE_MAP = Object.freeze({
  "companion-reunion": "mini-companion-reunion",
  "companion-work-reminder": "mini-companion-work-reminder",
  "companion-record": "mini-companion-record",
  "companion-unlock": "mini-companion-unlock",
});

const ACTIVE_STATES = new Set(["working", "thinking", "carrying", "juggling"]);
const DEFAULTS = Object.freeze({
  reunionAfterDays: 3,
  workReminderAfterMs: 90 * 60 * 1000,
  workReminderCooldownMs: 4 * HOUR_MS,
  recordCooldownMs: HOUR_MS,
  globalCueCooldownMs: 10 * 60 * 1000,
});

function formatLocalDate(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateToLocalTimestamp(date) {
  const parts = String(date || "").split("-").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) return NaN;
  return new Date(parts[0], parts[1] - 1, parts[2]).getTime();
}

function dayGap(fromDate, toDate) {
  const from = dateToLocalTimestamp(fromDate);
  const to = dateToLocalTimestamp(toDate);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return 0;
  return Math.floor((to - from) / DAY_MS);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeMilestoneSourceId(item) {
  if (!isPlainObject(item)) return "";
  if (typeof item.sourceId === "string" && item.sourceId.trim()) return item.sourceId.trim();
  const type = typeof item.type === "string" ? item.type.trim() : "";
  const value = Number.isFinite(Number(item.value)) ? Number(item.value) : "";
  return type ? `${type}:${value}` : "";
}

function getMilestoneIds(memory) {
  const milestones = memory && memory.index && Array.isArray(memory.index.milestones)
    ? memory.index.milestones
    : [];
  return new Set(milestones.map(normalizeMilestoneSourceId).filter(Boolean));
}

function getBadgeIds(memory) {
  const badges = memory && memory.index && Array.isArray(memory.index.badges)
    ? memory.index.badges
    : [];
  return new Set(badges.map((badge) => badge && badge.id).filter((id) => typeof id === "string" && id));
}

function getGrowthLevelId(memory) {
  const growthLevel = memory && memory.index && memory.index.growth && memory.index.growth.levelId;
  if (typeof growthLevel === "string" && growthLevel) return growthLevel;
  const legacyLevel = memory && memory.index && memory.index.level;
  return typeof legacyLevel === "string" && legacyLevel ? legacyLevel : "first_meet";
}

function getLastActiveDate(memory) {
  const date = memory && memory.index && memory.index.streak && memory.index.streak.lastActiveDate;
  return typeof date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : "";
}

function canUseCue(cue, displayState) {
  if (!cue) return false;
  if (cue.type === "reunion") return displayState === "idle";
  if (cue.type === "workReminder") return ACTIVE_STATES.has(displayState);
  if (cue.type === "record") return displayState === "idle" || ACTIVE_STATES.has(displayState);
  if (cue.type === "unlock") return displayState === "idle" || ACTIVE_STATES.has(displayState);
  return false;
}

function createCompanion(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const config = { ...DEFAULTS, ...(options.config || {}) };
  const getMemorySnapshot = typeof options.getMemorySnapshot === "function"
    ? options.getMemorySnapshot
    : () => null;
  const debugLog = typeof options.debugLog === "function" ? options.debugLog : null;

  let initialized = false;
  let lastKnownActiveDate = "";
  let seenMilestoneIds = new Set();
  let seenBadgeIds = new Set();
  let currentLevelId = "first_meet";
  let pendingCue = null;
  let lastCueAt = 0;
  let lastRecordCueAt = 0;
  let lastReunionCueDate = "";
  const activeSessions = new Map();

  function readMemory() {
    try {
      const memory = getMemorySnapshot();
      return memory && typeof memory === "object" ? memory : null;
    } catch (err) {
      if (debugLog) debugLog(`companion memory read failed: ${err && err.message ? err.message : err}`);
      return null;
    }
  }

  function ensureInitialized() {
    if (initialized) return;
    const memory = readMemory();
    lastKnownActiveDate = getLastActiveDate(memory);
    seenMilestoneIds = getMilestoneIds(memory);
    seenBadgeIds = getBadgeIds(memory);
    currentLevelId = getGrowthLevelId(memory);
    initialized = true;
  }

  function enqueue(type, state, reason, at) {
    if (!type || !state) return false;
    if (pendingCue) return false;
    if (at - lastCueAt < config.globalCueCooldownMs) return false;
    pendingCue = { type, state, reason: reason || "", createdAt: at };
    return true;
  }

  function observeReunion(today, at) {
    if (!lastKnownActiveDate || lastKnownActiveDate === today) return;
    if (lastReunionCueDate === today) return;
    if (dayGap(lastKnownActiveDate, today) < config.reunionAfterDays) return;
    if (enqueue("reunion", COMPANION_STATES.reunion, "long_absence", at)) {
      lastReunionCueDate = today;
    }
  }

  function observeWorkReminder(sessionId, state, at) {
    const id = typeof sessionId === "string" ? sessionId : "";
    if (!id) return;
    if (!ACTIVE_STATES.has(state)) {
      activeSessions.delete(id);
      return;
    }
    const existing = activeSessions.get(id);
    if (!existing) {
      activeSessions.set(id, { startedAt: at, lastReminderAt: 0 });
      return;
    }
    const elapsed = at - existing.startedAt;
    const sinceReminder = at - (existing.lastReminderAt || 0);
    if (elapsed >= config.workReminderAfterMs && sinceReminder >= config.workReminderCooldownMs) {
      if (enqueue("workReminder", COMPANION_STATES.workReminder, "continuous_work", at)) {
        existing.lastReminderAt = at;
      }
    }
  }

  function observeRecords(at) {
    const memory = readMemory();
    const ids = getMilestoneIds(memory);
    let hasNew = false;
    for (const id of ids) {
      if (!seenMilestoneIds.has(id)) {
        hasNew = true;
        break;
      }
    }
    seenMilestoneIds = ids;
    if (!hasNew || at - lastRecordCueAt < config.recordCooldownMs) return;
    if (enqueue("record", COMPANION_STATES.record, "milestone", at)) {
      lastRecordCueAt = at;
    }
  }

  function observeUnlocks(at) {
    const memory = readMemory();
    const badgeIds = getBadgeIds(memory);
    const nextLevelId = getGrowthLevelId(memory);
    let hasNewBadge = false;
    for (const id of badgeIds) {
      if (!seenBadgeIds.has(id)) {
        hasNewBadge = true;
        break;
      }
    }
    const leveledUp = nextLevelId && nextLevelId !== currentLevelId;
    seenBadgeIds = badgeIds;
    currentLevelId = nextLevelId || currentLevelId;
    if (!hasNewBadge && !leveledUp) return;
    enqueue("unlock", COMPANION_STATES.unlock, leveledUp ? "level_unlock" : "badge_unlock", at);
  }

  function observeSessionEvent(payload = {}) {
    ensureInitialized();
    const at = Number.isFinite(Number(payload.now)) ? Number(payload.now) : now();
    const opts = isPlainObject(payload.opts) ? payload.opts : {};
    if (opts.headless === true) return null;

    const state = typeof payload.state === "string" ? payload.state : "";
    const event = typeof payload.event === "string" ? payload.event : "";
    const today = formatLocalDate(at);

    if (event && event !== "SessionEnd") {
      observeReunion(today, at);
      lastKnownActiveDate = today;
    }
    observeWorkReminder(payload.sessionId, state, at);
    observeUnlocks(at);
    observeRecords(at);
    return pendingCue;
  }

  function resolveDisplayState(displayState, options = {}) {
    ensureInitialized();
    if (options.doNotDisturb === true) return displayState;
    if (options.presentationLocked === true) return displayState;
    const cue = pendingCue;
    if (!canUseCue(cue, displayState)) return displayState;
    pendingCue = null;
    lastCueAt = now();
    if (options.miniMode === true) return MINI_COMPANION_STATE_MAP[cue.state] || displayState;
    return cue.state;
  }

  function getPendingCue() {
    return pendingCue ? { ...pendingCue } : null;
  }

  function reset() {
    initialized = false;
    lastKnownActiveDate = "";
    seenMilestoneIds = new Set();
    seenBadgeIds = new Set();
    currentLevelId = "first_meet";
    pendingCue = null;
    lastCueAt = 0;
    lastRecordCueAt = 0;
    lastReunionCueDate = "";
    activeSessions.clear();
  }

  ensureInitialized();

  return {
    observeSessionEvent,
    resolveDisplayState,
    getPendingCue,
    reset,
  };
}

module.exports = {
  COMPANION_STATES,
  MINI_COMPANION_STATE_MAP,
  createCompanion,
  formatLocalDate,
};

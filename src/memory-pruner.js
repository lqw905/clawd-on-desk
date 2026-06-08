"use strict";

const { createDefaultIndex, normalizeSnapshotList } = require("./memory-store");

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION = Object.freeze({
  daily: 30,
  weekly: 90,
  monthly: 365,
});

function formatLocalDate(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function dateToLocalTimestamp(date) {
  const [y, m, d] = String(date || "").split("-").map((part) => Number.parseInt(part, 10));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return NaN;
  return new Date(y, m - 1, d).getTime();
}

function getWeekKey(date) {
  const ts = dateToLocalTimestamp(date);
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const day = d.getDay() || 7;
  d.setDate(d.getDate() - day + 1);
  return formatLocalDate(d.getTime());
}

function getMonthKey(date) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""))
    ? `${String(date).slice(0, 7)}-01`
    : "";
}

function addMapCounts(target, source) {
  if (!source || typeof source !== "object") return;
  for (const [key, value] of Object.entries(source)) {
    const n = Number(value);
    if (!key || !Number.isFinite(n) || n <= 0) continue;
    target[key] = (target[key] || 0) + n;
  }
}

function aggregateSnapshots(snapshots, period) {
  const groups = new Map();
  for (const snapshot of snapshots) {
    const key = period === "month" ? getMonthKey(snapshot.date) : getWeekKey(snapshot.date);
    if (!key) continue;
    const id = `${period}:${snapshot.deviceId || ""}:${key}`;
    if (!groups.has(id)) {
      groups.set(id, {
        snapshotId: id,
        deviceId: snapshot.deviceId || "",
        date: key,
        activeMs: 0,
        sessions: 0,
        agentEvents: 0,
        agents: {},
        projects: {},
        sessionKeys: [],
        updatedAt: 0,
      });
    }
    const group = groups.get(id);
    group.activeMs += snapshot.activeMs || 0;
    group.sessions += snapshot.sessions || 0;
    group.agentEvents += snapshot.agentEvents || 0;
    group.updatedAt = Math.max(group.updatedAt || 0, snapshot.updatedAt || 0);
    addMapCounts(group.agents, snapshot.agents);
    addMapCounts(group.projects, snapshot.projects);
  }
  return [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function isActiveSnapshot(snapshot) {
  return !!snapshot && ((snapshot.activeMs || 0) > 0 || (snapshot.agentEvents || 0) > 0 || (snapshot.sessions || 0) > 0);
}

function computeStreak(snapshots, nowMs) {
  const activeDates = new Set(snapshots.filter(isActiveSnapshot).map((snapshot) => snapshot.date));
  const today = formatLocalDate(nowMs);
  const yesterday = formatLocalDate(nowMs - DAY_MS);
  let cursor = activeDates.has(today) ? today : (activeDates.has(yesterday) ? yesterday : "");
  let current = 0;
  while (cursor && activeDates.has(cursor)) {
    current += 1;
    cursor = formatLocalDate(dateToLocalTimestamp(cursor) - DAY_MS);
  }

  let longest = 0;
  let run = 0;
  let prevTs = null;
  const sorted = [...activeDates].sort();
  for (const date of sorted) {
    const ts = dateToLocalTimestamp(date);
    if (prevTs !== null && ts === prevTs + DAY_MS) run += 1;
    else run = 1;
    longest = Math.max(longest, run);
    prevTs = ts;
  }
  return {
    current,
    longest,
    lastActiveDate: sorted.length ? sorted[sorted.length - 1] : "",
  };
}

function topKey(counts) {
  let best = "";
  let bestCount = 0;
  for (const [key, value] of Object.entries(counts || {})) {
    const n = Number(value);
    if (Number.isFinite(n) && n > bestCount) {
      best = key;
      bestCount = n;
    }
  }
  return best;
}

function computeIndex(memory, nowMs) {
  const deviceId = memory.deviceId || "";
  const index = createDefaultIndex(deviceId);
  const all = [
    ...(memory.snapshots || []),
    ...(memory.weeks || []),
    ...(memory.months || []),
  ].filter(Boolean);
  const agentCounts = {};
  let highestDailyActiveMs = 0;
  let highestDailyAgentEvents = 0;
  let highestDate = "";
  for (const snapshot of all) {
    index.totals.activeMs += snapshot.activeMs || 0;
    index.totals.sessions += snapshot.sessions || 0;
    index.totals.agentEvents += snapshot.agentEvents || 0;
    addMapCounts(agentCounts, snapshot.agents);
    if ((snapshot.activeMs || 0) > highestDailyActiveMs) {
      highestDailyActiveMs = snapshot.activeMs || 0;
      highestDate = snapshot.date;
    }
    if ((snapshot.agentEvents || 0) > highestDailyAgentEvents) {
      highestDailyAgentEvents = snapshot.agentEvents || 0;
      if (!highestDate) highestDate = snapshot.date;
    }
  }
  index.streak = computeStreak(memory.snapshots || [], nowMs);
  index.records.highestDailyActiveMs = highestDailyActiveMs;
  index.records.longestActiveMs = highestDailyActiveMs;
  index.records.highestDailyAgentEvents = highestDailyAgentEvents;
  index.records.date = highestDate;
  index.profile.topAgent = topKey(agentCounts);
  index.level = resolveLevel(index.totals.activeMs, index.streak.longest);
  index.milestones = mergeMilestones(memory.index && memory.index.milestones, detectMilestones(index, nowMs));
  index.updatedAt = nowMs;
  return index;
}

function resolveLevel(activeMs, longestStreak) {
  const hours = activeMs / (60 * 60 * 1000);
  if (hours >= 200 && longestStreak >= 100) return "best_friend";
  if (hours >= 50 && longestStreak >= 30) return "partner";
  if (hours >= 10) return "familiar";
  return "first_meet";
}

function milestone(type, value, nowMs) {
  return {
    type,
    value,
    sourceId: `${type}:${value}`,
    date: formatLocalDate(nowMs),
    createdAt: nowMs,
  };
}

function detectMilestones(index, nowMs) {
  const out = [];
  for (const value of [1, 10, 100, 1000]) {
    if ((index.totals.sessions || 0) >= value) out.push(milestone("sessions", value, nowMs));
    if ((index.totals.agentEvents || 0) >= value) out.push(milestone("agent_events", value, nowMs));
  }
  const activeHours = Math.floor((index.totals.activeMs || 0) / (60 * 60 * 1000));
  for (const value of [10, 50, 100, 200]) {
    if (activeHours >= value) out.push(milestone("active_hours", value, nowMs));
  }
  return out;
}

function mergeMilestones(existing, detected) {
  const bySource = new Map();
  for (const item of [...(Array.isArray(existing) ? existing : []), ...(Array.isArray(detected) ? detected : [])]) {
    if (!item || typeof item !== "object") continue;
    const type = typeof item.type === "string" ? item.type : "";
    const sourceId = typeof item.sourceId === "string" ? item.sourceId : `${type}:${item.value || ""}`;
    if (!type || !sourceId || bySource.has(sourceId)) continue;
    bySource.set(sourceId, {
      type,
      value: Number.isFinite(Number(item.value)) ? Number(item.value) : 0,
      sourceId,
      date: typeof item.date === "string" ? item.date : "",
      createdAt: Number.isFinite(Number(item.createdAt)) ? Number(item.createdAt) : 0,
    });
  }
  return [...bySource.values()].sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
}

function pruneMemory(rawMemory, options = {}) {
  const nowMs = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const deviceId = rawMemory && rawMemory.deviceId ? rawMemory.deviceId : "";
  const snapshots = normalizeSnapshotList(rawMemory && rawMemory.snapshots, deviceId);
  const existingWeeks = normalizeSnapshotList(rawMemory && rawMemory.weeks, deviceId);
  const existingMonths = normalizeSnapshotList(rawMemory && rawMemory.months, deviceId);
  const daily = [];
  const weeklyCandidates = existingWeeks.slice();
  const monthlyCandidates = existingMonths.slice();
  for (const snapshot of snapshots) {
    const age = (nowMs - dateToLocalTimestamp(snapshot.date)) / DAY_MS;
    if (!Number.isFinite(age) || age <= RETENTION.daily) daily.push(snapshot);
    else if (age <= RETENTION.weekly) weeklyCandidates.push(snapshot);
    else if (age <= RETENTION.monthly) monthlyCandidates.push(snapshot);
  }
  const next = {
    deviceId,
    snapshots: daily.sort((a, b) => a.date.localeCompare(b.date)),
    weeks: aggregateSnapshots(weeklyCandidates, "week"),
    months: aggregateSnapshots(monthlyCandidates, "month"),
    index: rawMemory && rawMemory.index ? rawMemory.index : createDefaultIndex(deviceId),
  };
  next.index = computeIndex(next, nowMs);
  return next;
}

module.exports = {
  RETENTION,
  aggregateSnapshots,
  computeIndex,
  dateToLocalTimestamp,
  formatLocalDate,
  pruneMemory,
};

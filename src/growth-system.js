"use strict";

const HOUR_MS = 60 * 60 * 1000;

const LEVELS = Object.freeze([
  { id: "first_meet", name: "First meet", minScore: 0 },
  { id: "familiar", name: "Familiar", minScore: 600 },
  { id: "partner", name: "Partner", minScore: 4000 },
  { id: "best_friend", name: "Best friend", minScore: 14000 },
]);

const BADGES = Object.freeze([
  {
    id: "first_session",
    name: "First Session",
    description: "Started the first recorded local session.",
    category: "sessions",
    test: ({ totals }) => (totals.sessions || 0) >= 1,
  },
  {
    id: "ten_sessions",
    name: "Ten Sessions",
    description: "Reached 10 recorded sessions.",
    category: "sessions",
    test: ({ totals }) => (totals.sessions || 0) >= 10,
  },
  {
    id: "hundred_sessions",
    name: "Hundred Sessions",
    description: "Reached 100 recorded sessions.",
    category: "sessions",
    test: ({ totals }) => (totals.sessions || 0) >= 100,
  },
  {
    id: "three_day_streak",
    name: "Three-Day Streak",
    description: "Worked with Clawd on 3 consecutive active days.",
    category: "streak",
    test: ({ streak }) => (streak.longest || 0) >= 3,
  },
  {
    id: "seven_day_streak",
    name: "Seven-Day Streak",
    description: "Worked with Clawd on 7 consecutive active days.",
    category: "streak",
    test: ({ streak }) => (streak.longest || 0) >= 7,
  },
  {
    id: "thirty_day_streak",
    name: "Thirty-Day Streak",
    description: "Worked with Clawd on 30 consecutive active days.",
    category: "streak",
    test: ({ streak }) => (streak.longest || 0) >= 30,
  },
  {
    id: "ten_active_hours",
    name: "Ten Active Hours",
    description: "Recorded 10 active coding hours.",
    category: "active_time",
    test: ({ activeHours }) => activeHours >= 10,
  },
  {
    id: "fifty_active_hours",
    name: "Fifty Active Hours",
    description: "Recorded 50 active coding hours.",
    category: "active_time",
    test: ({ activeHours }) => activeHours >= 50,
  },
  {
    id: "hundred_active_hours",
    name: "Hundred Active Hours",
    description: "Recorded 100 active coding hours.",
    category: "active_time",
    test: ({ activeHours }) => activeHours >= 100,
  },
  {
    id: "busy_day",
    name: "Busy Day",
    description: "Reached 100 agent events in a single day.",
    category: "records",
    test: ({ records }) => (records.highestDailyAgentEvents || 0) >= 100,
  },
  {
    id: "agent_variety",
    name: "Agent Variety",
    description: "Used 3 different agents.",
    category: "agents",
    test: ({ uniqueAgents }) => uniqueAgents >= 3,
  },
  {
    id: "project_explorer",
    name: "Project Explorer",
    description: "Worked in 5 different project folders.",
    category: "projects",
    test: ({ uniqueProjects }) => uniqueProjects >= 5,
  },
]);

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function computeScore(index) {
  const totals = index && index.totals ? index.totals : {};
  const streak = index && index.streak ? index.streak : {};
  const activeMinutes = Math.floor(normalizeNumber(totals.activeMs) / 60000);
  return activeMinutes
    + Math.floor(normalizeNumber(totals.sessions) * 10)
    + Math.floor(normalizeNumber(totals.agentEvents) * 2)
    + Math.floor(normalizeNumber(streak.longest) * 60);
}

function resolveLevelByScore(score) {
  let current = LEVELS[0];
  for (const level of LEVELS) {
    if (score >= level.minScore) current = level;
  }
  return current;
}

function computeGrowth(index) {
  const score = computeScore(index);
  const level = resolveLevelByScore(score);
  const levelIndex = LEVELS.findIndex((item) => item.id === level.id);
  const nextLevel = LEVELS[levelIndex + 1] || null;
  const prevScore = level.minScore;
  const nextScore = nextLevel ? nextLevel.minScore : level.minScore;
  const span = Math.max(1, nextScore - prevScore);
  const progress = nextLevel ? Math.max(0, Math.min(1, (score - prevScore) / span)) : 1;
  return {
    levelId: level.id,
    levelName: level.name,
    score,
    nextLevelId: nextLevel ? nextLevel.id : "",
    nextLevelName: nextLevel ? nextLevel.name : "",
    nextLevelScore: nextLevel ? nextLevel.minScore : score,
    progress,
  };
}

function buildMetricContext(index, agentCounts, projectCounts) {
  const totals = index && index.totals ? index.totals : {};
  const streak = index && index.streak ? index.streak : {};
  const records = index && index.records ? index.records : {};
  return {
    totals,
    streak,
    records,
    activeHours: Math.floor(normalizeNumber(totals.activeMs) / HOUR_MS),
    uniqueAgents: Object.keys(agentCounts || {}).filter(Boolean).length,
    uniqueProjects: Object.keys(projectCounts || {}).filter(Boolean).length,
  };
}

function mergeBadges(existing, detected, nowMs) {
  const existingById = new Map();
  for (const item of Array.isArray(existing) ? existing : []) {
    if (!item || typeof item !== "object" || typeof item.id !== "string" || !item.id) continue;
    existingById.set(item.id, item);
  }
  const out = [];
  for (const badge of detected) {
    const previous = existingById.get(badge.id);
    out.push({
      id: badge.id,
      name: badge.name,
      description: badge.description,
      category: badge.category,
      unlockedAt: normalizeNumber(previous && previous.unlockedAt) || nowMs,
      date: typeof (previous && previous.date) === "string" ? previous.date : "",
    });
  }
  return out.sort((a, b) => (a.unlockedAt || 0) - (b.unlockedAt || 0) || a.id.localeCompare(b.id));
}

function computeBadges(index, agentCounts, projectCounts, existingBadges, nowMs) {
  const context = buildMetricContext(index, agentCounts, projectCounts);
  const detected = BADGES.filter((badge) => {
    try { return badge.test(context) === true; }
    catch { return false; }
  });
  return mergeBadges(existingBadges, detected, nowMs);
}

module.exports = {
  BADGES,
  LEVELS,
  computeBadges,
  computeGrowth,
  computeScore,
  resolveLevelByScore,
};

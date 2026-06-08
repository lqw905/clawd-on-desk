"use strict";

const contentEl = document.getElementById("content");
const updatedAtEl = document.getElementById("updatedAt");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function todayParts() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

function formatMonthDate(year, month, day) {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

function formatHours(ms) {
  const hours = Math.max(0, Number(ms || 0)) / 3600000;
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 10) return `${hours.toFixed(1)}h`;
  return `${Math.round(hours)}h`;
}

function formatNumber(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatUpdatedAt(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "No data yet";
  return `Updated ${new Date(n).toLocaleString()}`;
}

function levelLabel(level) {
  return {
    first_meet: "First meet",
    familiar: "Familiar",
    partner: "Partner",
    best_friend: "Best friend",
  }[level] || level || "First meet";
}

function growthLevelLabel(growth, legacyLevel) {
  if (growth && growth.levelName) return growth.levelName;
  return levelLabel(legacyLevel);
}

function milestoneLabel(item) {
  const value = formatNumber(item && item.value);
  const type = item && item.type;
  if (type === "sessions") return `${value} sessions`;
  if (type === "agent_events") return `${value} agent events`;
  if (type === "active_hours") return `${value} active hours`;
  return type ? `${type} ${value}` : "Milestone";
}

function classForActiveMs(activeMs, maxActiveMs) {
  if (!activeMs || !maxActiveMs) return "";
  const ratio = activeMs / maxActiveMs;
  if (ratio >= 0.8) return "level-4";
  if (ratio >= 0.55) return "level-3";
  if (ratio >= 0.3) return "level-2";
  return "level-1";
}

function createText(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  el.textContent = text || "";
  return el;
}

function createMetric(label, value, sub) {
  const node = document.createElement("section");
  node.className = "metric";
  node.appendChild(createText("div", "metric-label", label));
  node.appendChild(createText("div", "metric-value", value));
  node.appendChild(createText("div", "metric-sub", sub));
  return node;
}

function snapshotMapForMonth(snapshots, year, month) {
  const prefix = `${year}-${pad2(month)}-`;
  const map = new Map();
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    if (!snapshot || typeof snapshot.date !== "string" || !snapshot.date.startsWith(prefix)) continue;
    map.set(snapshot.date, snapshot);
  }
  return map;
}

function renderCalendar(parent, snapshots) {
  const { year, month } = todayParts();
  const first = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const offset = first.getDay();
  const monthMap = snapshotMapForMonth(snapshots, year, month);
  const maxActiveMs = Math.max(1, ...[...monthMap.values()].map((snapshot) => Number(snapshot.activeMs || 0)));

  const section = document.createElement("section");
  section.className = "section";
  const header = document.createElement("div");
  header.className = "section-header";
  header.appendChild(createText("div", "section-title", `${year}-${pad2(month)}`));
  header.appendChild(createText("div", "section-note", "Daily active time"));
  section.appendChild(header);

  const calendar = document.createElement("div");
  calendar.className = "calendar";
  for (let i = 0; i < offset; i++) {
    const empty = document.createElement("div");
    empty.className = "day empty";
    calendar.appendChild(empty);
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = formatMonthDate(year, month, day);
    const snapshot = monthMap.get(date);
    const activeMs = snapshot ? Number(snapshot.activeMs || 0) : 0;
    const cell = document.createElement("div");
    cell.className = `day ${classForActiveMs(activeMs, maxActiveMs)}`.trim();
    cell.title = `${date} · ${formatHours(activeMs)}`;
    cell.appendChild(createText("div", "day-date", String(day)));
    cell.appendChild(document.createElement("div")).className = "day-bar";
    cell.appendChild(createText("div", "day-meta", activeMs ? formatHours(activeMs) : "0m"));
    calendar.appendChild(cell);
  }
  section.appendChild(calendar);
  parent.appendChild(section);
}

function renderGrowth(parent, index) {
  const growth = index && index.growth ? index.growth : null;
  const badges = Array.isArray(index && index.badges) ? index.badges : [];
  const score = growth && Number.isFinite(Number(growth.score)) ? Number(growth.score) : 0;
  const progress = growth && Number.isFinite(Number(growth.progress)) ? Math.max(0, Math.min(1, Number(growth.progress))) : 0;
  const nextName = growth && growth.nextLevelName ? growth.nextLevelName : "";

  const section = document.createElement("section");
  section.className = "section";
  const header = document.createElement("div");
  header.className = "section-header";
  header.appendChild(createText("div", "section-title", "Growth"));
  header.appendChild(createText("div", "section-note", `${formatNumber(score)} score`));
  section.appendChild(header);

  const panel = document.createElement("div");
  panel.className = "growth-panel";
  const body = document.createElement("div");
  body.appendChild(createText("div", "growth-title", growthLevelLabel(growth, index && index.level)));
  body.appendChild(createText("div", "growth-sub", nextName ? `Next: ${nextName}` : "Highest level unlocked"));
  const track = document.createElement("div");
  track.className = "progress-track";
  const fill = document.createElement("div");
  fill.className = "progress-fill";
  fill.style.width = `${Math.round(progress * 100)}%`;
  track.appendChild(fill);
  body.appendChild(track);
  panel.appendChild(body);

  const count = document.createElement("div");
  count.className = "badge-count";
  count.appendChild(createText("div", "badge-count-value", formatNumber(badges.length)));
  count.appendChild(createText("div", "badge-count-label", "badges unlocked"));
  panel.appendChild(count);
  section.appendChild(panel);

  parent.appendChild(section);
}

function renderBadges(parent, badges) {
  const section = document.createElement("section");
  section.className = "section";
  const header = document.createElement("div");
  header.className = "section-header";
  header.appendChild(createText("div", "section-title", "Badges"));
  header.appendChild(createText("div", "section-note", `${Array.isArray(badges) ? badges.length : 0} unlocked`));
  section.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "badges";
  const items = Array.isArray(badges) ? badges.slice().sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0)) : [];
  if (!items.length) {
    grid.appendChild(createText("div", "empty-state", "Badges will unlock as local activity grows."));
  } else {
    for (const item of items) {
      const card = document.createElement("div");
      card.className = "badge";
      card.appendChild(createText("div", "badge-name", item.name || item.id || "Badge"));
      card.appendChild(createText("div", "badge-desc", item.description || item.category || ""));
      const unlockedAt = Number(item.unlockedAt || 0);
      card.appendChild(createText("div", "badge-date", unlockedAt ? new Date(unlockedAt).toLocaleString() : "Unlocked"));
      grid.appendChild(card);
    }
  }
  section.appendChild(grid);
  parent.appendChild(section);
}

function renderMilestones(parent, milestones) {
  const section = document.createElement("section");
  section.className = "section";
  const header = document.createElement("div");
  header.className = "section-header";
  header.appendChild(createText("div", "section-title", "Milestones"));
  header.appendChild(createText("div", "section-note", `${Array.isArray(milestones) ? milestones.length : 0} total`));
  section.appendChild(header);

  const list = document.createElement("div");
  list.className = "timeline";
  const items = Array.isArray(milestones) ? milestones.slice(-8).reverse() : [];
  if (!items.length) {
    list.appendChild(createText("div", "empty-state", "Milestones will appear after Clawd has enough local activity."));
  } else {
    for (const item of items) {
      const row = document.createElement("div");
      row.className = "milestone";
      row.appendChild(createText("div", "milestone-date", item.date || "-"));
      row.appendChild(createText("div", "milestone-text", milestoneLabel(item)));
      list.appendChild(row);
    }
  }
  section.appendChild(list);
  parent.appendChild(section);
}

function renderJournal(payload) {
  const result = payload || {};
  const memory = result.memory || null;
  contentEl.innerHTML = "";
  if (!memory || result.status !== "ok") {
    contentEl.appendChild(createText("div", "error-state", result.message || "Journal data is unavailable."));
    updatedAtEl.textContent = "Unavailable";
    return;
  }
  const index = memory.index || {};
  const totals = index.totals || {};
  const streak = index.streak || {};
  const records = index.records || {};
  updatedAtEl.textContent = formatUpdatedAt(index.updatedAt);

  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.appendChild(createMetric("Current streak", `${formatNumber(streak.current)}d`, `Longest ${formatNumber(streak.longest)}d`));
  metrics.appendChild(createMetric("Active time", formatHours(totals.activeMs), `Record ${formatHours(records.highestDailyActiveMs)}`));
  metrics.appendChild(createMetric("Sessions", formatNumber(totals.sessions), `${formatNumber(totals.agentEvents)} agent events`));
  metrics.appendChild(createMetric("Growth", levelLabel(index.level), index.profile && index.profile.topAgent ? index.profile.topAgent : "No top agent yet"));
  contentEl.appendChild(metrics);

  renderGrowth(contentEl, index);
  renderBadges(contentEl, index.badges || []);
  renderCalendar(contentEl, memory.snapshots || []);
  renderMilestones(contentEl, index.milestones || []);
}

async function bootstrap() {
  try {
    if (window.journalAPI && typeof window.journalAPI.onMemorySnapshot === "function") {
      window.journalAPI.onMemorySnapshot(renderJournal);
    }
    const payload = window.journalAPI && typeof window.journalAPI.getMemorySnapshot === "function"
      ? await window.journalAPI.getMemorySnapshot()
      : { status: "disabled", memory: null };
    renderJournal(payload);
  } catch (err) {
    renderJournal({ status: "error", message: err && err.message ? err.message : String(err) });
  }
}

bootstrap();

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
  if (hours < 1) return `${Math.round(hours * 60)} 分钟`;
  if (hours < 10) return `${hours.toFixed(1)} 小时`;
  return `${Math.round(hours)} 小时`;
}

function formatNumber(value) {
  const n = Number(value || 0);
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(Math.round(n));
}

function formatUpdatedAt(ts) {
  const n = Number(ts || 0);
  if (!Number.isFinite(n) || n <= 0) return "暂无数据";
  return `更新于 ${new Date(n).toLocaleString("zh-CN")}`;
}

function levelLabel(level) {
  return {
    first_meet: "初次见面",
    familiar: "熟悉伙伴",
    partner: "协作搭档",
    best_friend: "最佳伙伴",
  }[level] || level || "初次见面";
}

function growthLevelLabel(growth, legacyLevel) {
  if (growth && growth.levelId) return levelLabel(growth.levelId);
  return levelLabel(legacyLevel);
}

function milestoneLabel(item) {
  const value = formatNumber(item && item.value);
  const type = item && item.type;
  if (type === "sessions") return `${value} 次会话`;
  if (type === "agent_events") return `${value} 次代理事件`;
  if (type === "active_hours") return `${value} 小时活跃时间`;
  return type ? `${type} ${value}` : "里程碑";
}

function badgeName(item) {
  const id = item && item.id;
  return {
    first_session: "第一次会话",
    ten_sessions: "十次会话",
    hundred_sessions: "百次会话",
    three_day_streak: "三天连续打卡",
    seven_day_streak: "七天连续打卡",
    thirty_day_streak: "三十天连续打卡",
    ten_active_hours: "十小时活跃",
    fifty_active_hours: "五十小时活跃",
    hundred_active_hours: "百小时活跃",
    busy_day: "忙碌的一天",
    agent_variety: "多代理协作",
    project_explorer: "项目探索者",
  }[id] || (item && item.name) || id || "徽章";
}

function badgeDescription(item) {
  const id = item && item.id;
  return {
    first_session: "记录到第一次本地会话。",
    ten_sessions: "累计达到 10 次记录会话。",
    hundred_sessions: "累计达到 100 次记录会话。",
    three_day_streak: "连续 3 天与 Clawd 一起工作。",
    seven_day_streak: "连续 7 天与 Clawd 一起工作。",
    thirty_day_streak: "连续 30 天与 Clawd 一起工作。",
    ten_active_hours: "累计记录 10 小时活跃编程时间。",
    fifty_active_hours: "累计记录 50 小时活跃编程时间。",
    hundred_active_hours: "累计记录 100 小时活跃编程时间。",
    busy_day: "单日代理事件达到 100 次。",
    agent_variety: "使用过 3 个不同的代理。",
    project_explorer: "在 5 个不同项目目录中工作过。",
  }[id] || (item && (item.description || item.category)) || "";
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
  header.appendChild(createText("div", "section-note", "每日活跃时间"));
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
  const nextId = growth && growth.nextLevelId ? growth.nextLevelId : "";

  const section = document.createElement("section");
  section.className = "section";
  const header = document.createElement("div");
  header.className = "section-header";
  header.appendChild(createText("div", "section-title", "成长"));
  header.appendChild(createText("div", "section-note", `${formatNumber(score)} 分`));
  section.appendChild(header);

  const panel = document.createElement("div");
  panel.className = "growth-panel";
  const body = document.createElement("div");
  body.appendChild(createText("div", "growth-title", growthLevelLabel(growth, index && index.level)));
  body.appendChild(createText("div", "growth-sub", nextId ? `下一级：${levelLabel(nextId)}` : "已解锁最高等级"));
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
  count.appendChild(createText("div", "badge-count-label", "枚徽章已解锁"));
  panel.appendChild(count);
  section.appendChild(panel);

  parent.appendChild(section);
}

function renderBadges(parent, badges) {
  const section = document.createElement("section");
  section.className = "section";
  const header = document.createElement("div");
  header.className = "section-header";
  header.appendChild(createText("div", "section-title", "徽章"));
  header.appendChild(createText("div", "section-note", `已解锁 ${Array.isArray(badges) ? badges.length : 0} 枚`));
  section.appendChild(header);

  const grid = document.createElement("div");
  grid.className = "badges";
  const items = Array.isArray(badges) ? badges.slice().sort((a, b) => (b.unlockedAt || 0) - (a.unlockedAt || 0)) : [];
  if (!items.length) {
    grid.appendChild(createText("div", "empty-state", "本地活动增长后会解锁徽章。"));
  } else {
    for (const item of items) {
      const card = document.createElement("div");
      card.className = "badge";
      card.appendChild(createText("div", "badge-name", badgeName(item)));
      card.appendChild(createText("div", "badge-desc", badgeDescription(item)));
      const unlockedAt = Number(item.unlockedAt || 0);
      card.appendChild(createText("div", "badge-date", unlockedAt ? new Date(unlockedAt).toLocaleString("zh-CN") : "已解锁"));
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
  header.appendChild(createText("div", "section-title", "里程碑"));
  header.appendChild(createText("div", "section-note", `共 ${Array.isArray(milestones) ? milestones.length : 0} 条`));
  section.appendChild(header);

  const list = document.createElement("div");
  list.className = "timeline";
  const items = Array.isArray(milestones) ? milestones.slice(-8).reverse() : [];
  if (!items.length) {
    list.appendChild(createText("div", "empty-state", "Clawd 收集到足够本地活动后会显示里程碑。"));
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
    contentEl.appendChild(createText("div", "error-state", result.message || "日志数据不可用。"));
    updatedAtEl.textContent = "不可用";
    return;
  }
  const index = memory.index || {};
  const totals = index.totals || {};
  const streak = index.streak || {};
  const records = index.records || {};
  updatedAtEl.textContent = formatUpdatedAt(index.updatedAt);

  const metrics = document.createElement("div");
  metrics.className = "metrics";
  metrics.appendChild(createMetric("当前连续", `${formatNumber(streak.current)} 天`, `最长 ${formatNumber(streak.longest)} 天`));
  metrics.appendChild(createMetric("活跃时间", formatHours(totals.activeMs), `纪录 ${formatHours(records.highestDailyActiveMs)}`));
  metrics.appendChild(createMetric("会话", formatNumber(totals.sessions), `${formatNumber(totals.agentEvents)} 次代理事件`));
  metrics.appendChild(createMetric("成长", growthLevelLabel(index.growth, index.level), index.profile && index.profile.topAgent ? index.profile.topAgent : "暂无常用代理"));
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

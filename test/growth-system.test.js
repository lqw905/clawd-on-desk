"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");
const { computeBadges, computeGrowth, computeScore, resolveLevelByScore } = require("../src/growth-system");

describe("growth system", () => {
  it("computes deterministic score and level progress from memory index stats", () => {
    const index = {
      totals: {
        activeMs: 10 * 60 * 60 * 1000,
        sessions: 4,
        agentEvents: 30,
      },
      streak: { longest: 3 },
    };

    const score = computeScore(index);
    const growth = computeGrowth(index);

    assert.strictEqual(score, 880);
    assert.strictEqual(growth.levelId, "familiar");
    assert.strictEqual(growth.nextLevelId, "partner");
    assert.ok(growth.progress > 0 && growth.progress < 1);
  });

  it("resolves max level once score reaches the final threshold", () => {
    const level = resolveLevelByScore(20000);
    const growth = computeGrowth({
      totals: { activeMs: 20000 * 60000, sessions: 0, agentEvents: 0 },
      streak: { longest: 0 },
    });

    assert.strictEqual(level.id, "best_friend");
    assert.strictEqual(growth.levelId, "best_friend");
    assert.strictEqual(growth.progress, 1);
    assert.strictEqual(growth.nextLevelId, "");
  });

  it("detects badges and preserves previous unlock timestamps", () => {
    const index = {
      totals: {
        activeMs: 50 * 60 * 60 * 1000,
        sessions: 10,
        agentEvents: 120,
      },
      streak: { longest: 7 },
      records: { highestDailyAgentEvents: 100 },
    };
    const badges = computeBadges(
      index,
      { codex: 80, "claude-code": 20, kimi: 20 },
      { "/a": 1, "/b": 1, "/c": 1, "/d": 1, "/e": 1 },
      [{ id: "first_session", unlockedAt: 123 }],
      999,
    );
    const ids = badges.map((badge) => badge.id);

    assert.ok(ids.includes("first_session"));
    assert.ok(ids.includes("ten_sessions"));
    assert.ok(ids.includes("seven_day_streak"));
    assert.ok(ids.includes("fifty_active_hours"));
    assert.ok(ids.includes("busy_day"));
    assert.ok(ids.includes("agent_variety"));
    assert.ok(ids.includes("project_explorer"));
    assert.strictEqual(badges.find((badge) => badge.id === "first_session").unlockedAt, 123);
  });
});

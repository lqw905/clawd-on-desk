const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createMemoryEngine } = require("../src/memory-engine");
const { createMemoryStore } = require("../src/memory-store");
const { pruneMemory } = require("../src/memory-pruner");

function at(iso) {
  return new Date(iso).getTime();
}

describe("memory engine", () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clawd-memory-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records agent events, sessions, projects, and active time", () => {
    let now = at("2026-06-08T10:00:00+08:00");
    const engine = createMemoryEngine({
      store: createMemoryStore({ memoryDir: tmpDir }),
      now: () => now,
      flushDelayMs: 60_000,
    });

    engine.recordStateEvent("s1", "working", "SessionStart", {
      agentId: "codex",
      cwd: "/repo/a",
      model: "gpt",
      provider: "openai",
    });
    now += 5 * 60 * 1000;
    engine.recordStateEvent("s1", "working", "PreToolUse", {
      agentId: "codex",
      cwd: "/repo/a",
    });
    now += 2 * 60 * 1000;
    engine.recordStateEvent("s1", "idle", "SessionEnd", {
      agentId: "codex",
      cwd: "/repo/a",
    });
    engine.flush();

    const snapshot = JSON.parse(fs.readFileSync(path.join(tmpDir, "snapshots.json"), "utf8"))[0];
    assert.strictEqual(snapshot.date, "2026-06-08");
    assert.strictEqual(snapshot.sessions, 1);
    assert.strictEqual(snapshot.agentEvents, 3);
    assert.strictEqual(snapshot.agents.codex, 3);
    assert.strictEqual(snapshot.projects["/repo/a"], 3);
    assert.strictEqual(snapshot.activeMs, 7 * 60 * 1000);

    const index = JSON.parse(fs.readFileSync(path.join(tmpDir, "index.json"), "utf8"));
    assert.strictEqual(index.totals.sessions, 1);
    assert.strictEqual(index.totals.agentEvents, 3);
    assert.strictEqual(index.totals.activeMs, 7 * 60 * 1000);
    assert.strictEqual(index.profile.topAgent, "codex");
    assert.strictEqual(index.growth.levelId, "first_meet");
    assert.ok(Array.isArray(index.badges));
    assert.ok(index.badges.some((badge) => badge.id === "first_session"));
  });

  it("does not double-count the same session on repeated events", () => {
    let now = at("2026-06-08T11:00:00+08:00");
    const engine = createMemoryEngine({
      store: createMemoryStore({ memoryDir: tmpDir }),
      now: () => now,
      flushDelayMs: 60_000,
    });
    for (const event of ["SessionStart", "UserPromptSubmit", "PreToolUse", "PostToolUse"]) {
      engine.recordStateEvent("same-session", "working", event, { agentId: "claude-code", cwd: "/repo" });
      now += 1000;
    }
    engine.flush();
    const snapshot = JSON.parse(fs.readFileSync(path.join(tmpDir, "snapshots.json"), "utf8"))[0];
    assert.strictEqual(snapshot.sessions, 1);
    assert.strictEqual(snapshot.agentEvents, 4);
    assert.strictEqual(snapshot.sessionKeys.length, 1);
  });

  it("notifies after flush and can replace persisted memory without re-notifying", () => {
    let now = at("2026-06-08T11:00:00+08:00");
    const saves = [];
    const engine = createMemoryEngine({
      store: createMemoryStore({ memoryDir: tmpDir }),
      now: () => now,
      flushDelayMs: 60_000,
      onAfterSave: (snapshot) => saves.push(snapshot),
    });
    engine.recordStateEvent("s1", "working", "SessionStart", { agentId: "codex", cwd: "/repo" });
    engine.flush();
    assert.strictEqual(saves.length, 1);

    const replacement = {
      deviceId: "replacement",
      snapshots: [],
      weeks: [],
      months: [],
      index: { milestones: [], badges: [], totals: {}, profile: {}, updatedAt: now },
    };
    const next = engine.replaceMemory(replacement, { notify: false });
    assert.strictEqual(next.deviceId, "replacement");
    assert.strictEqual(saves.length, 1);

    const index = JSON.parse(fs.readFileSync(path.join(tmpDir, "index.json"), "utf8"));
    assert.strictEqual(index.updatedAt, now);
  });
});

describe("memory pruner", () => {
  it("moves old daily snapshots into weekly aggregates and recomputes totals", () => {
    const memory = {
      deviceId: "device-a",
      index: { milestones: [] },
      snapshots: [
        {
          snapshotId: "2026-04-01:device-a",
          deviceId: "device-a",
          date: "2026-04-01",
          activeMs: 60_000,
          sessions: 1,
          agentEvents: 2,
          agents: { codex: 2 },
          projects: { "/repo": 2 },
          sessionKeys: ["a"],
          updatedAt: at("2026-04-01T12:00:00+08:00"),
        },
        {
          snapshotId: "2026-06-08:device-a",
          deviceId: "device-a",
          date: "2026-06-08",
          activeMs: 120_000,
          sessions: 2,
          agentEvents: 3,
          agents: { codex: 3 },
          projects: { "/repo": 3 },
          sessionKeys: ["b", "c"],
          updatedAt: at("2026-06-08T12:00:00+08:00"),
        },
      ],
      weeks: [],
      months: [],
    };
    const pruned = pruneMemory(memory, { now: at("2026-06-08T12:00:00+08:00") });
    assert.deepStrictEqual(pruned.snapshots.map((s) => s.date), ["2026-06-08"]);
    assert.strictEqual(pruned.weeks.length, 1);
    assert.strictEqual(pruned.weeks[0].activeMs, 60_000);
    assert.strictEqual(pruned.index.totals.activeMs, 180_000);
    assert.strictEqual(pruned.index.totals.sessions, 3);
    assert.strictEqual(pruned.index.totals.agentEvents, 5);
    assert.strictEqual(pruned.index.growth.levelId, "first_meet");
    assert.ok(pruned.index.badges.some((badge) => badge.id === "first_session"));
  });
});

const { describe, it } = require("node:test");
const assert = require("node:assert");

const {
  DEFAULT_GIST_FILENAME,
  buildGistDocument,
  createGitHubClient,
  createMemorySync,
  isValidGitHubToken,
  mergeMemory,
  normalizeMemorySyncConfig,
  parseGistMemoryContent,
  parseTokenFromEnvFileText,
} = require("../src/memory-sync");

function tokenStore(token = "ghp_123456789012345678901234567890123456") {
  return {
    getToken: async () => token,
    getStatus: async () => ({ tokenStored: !!token, masked: token ? "ghp_12...3456" : "" }),
    writeToken: async () => {},
    deleteToken: async () => {},
  };
}

function memory(deviceId, date, extras = {}) {
  return {
    deviceId,
    snapshots: [{
      snapshotId: `${date}:${deviceId}`,
      deviceId,
      date,
      activeMs: extras.activeMs || 60_000,
      sessions: extras.sessions || 1,
      agentEvents: extras.agentEvents || 1,
      agents: extras.agents || { codex: 1 },
      projects: extras.projects || { "/repo": 1 },
      sessionKeys: extras.sessionKeys || [`${deviceId}-s1`],
      updatedAt: extras.updatedAt || Date.parse(`${date}T12:00:00+08:00`),
    }],
    weeks: [],
    months: [],
    index: {
      totals: {},
      milestones: extras.milestones || [],
      badges: extras.badges || [],
      updatedAt: extras.updatedAt || Date.parse(`${date}T12:00:00+08:00`),
    },
  };
}

describe("memory sync config and token parsing", () => {
  it("defaults to opt-in disabled sync", () => {
    assert.deepStrictEqual(normalizeMemorySyncConfig({}), {
      enabled: false,
      gistId: "",
      autoPullOnStartup: true,
      autoPushOnSave: true,
    });
  });

  it("drops invalid gist ids and parses valid GitHub tokens from env text", () => {
    assert.strictEqual(normalizeMemorySyncConfig({ gistId: "bad id" }).gistId, "");
    const token = "ghp_123456789012345678901234567890123456";
    assert.strictEqual(isValidGitHubToken(token), true);
    assert.strictEqual(parseTokenFromEnvFileText(`CLAWD_GITHUB_GIST_TOKEN=${token}\n`), token);
    assert.strictEqual(parseTokenFromEnvFileText("CLAWD_GITHUB_GIST_TOKEN=short\n"), null);
  });
});

describe("memory sync merge and gist document parsing", () => {
  it("merges remote and local records while preserving the local device id", () => {
    const local = memory("local-device", "2026-06-08", {
      milestones: [{ sourceId: "m-local", type: "sessions", value: 1, createdAt: 1 }],
      badges: [{ id: "first_session", unlockedAt: 1 }],
    });
    const remote = memory("remote-device", "2026-06-07", {
      sessions: 10,
      milestones: [{ sourceId: "m-remote", type: "streak", value: 2, createdAt: 2 }],
      badges: [{ id: "ten_sessions", unlockedAt: 2 }],
    });

    const merged = mergeMemory(local, remote, { now: Date.parse("2026-06-08T12:00:00+08:00") });
    assert.strictEqual(merged.deviceId, "local-device");
    assert.deepStrictEqual(merged.snapshots.map((s) => s.date).sort(), ["2026-06-07", "2026-06-08"]);
    const milestoneIds = merged.index.milestones.map((m) => m.sourceId);
    assert.ok(milestoneIds.includes("m-local"));
    assert.ok(milestoneIds.includes("m-remote"));
    assert.deepStrictEqual(merged.index.badges.map((b) => b.id).sort(), ["first_session", "ten_sessions"]);
  });

  it("builds and parses the private gist memory document shape", () => {
    const local = memory("local-device", "2026-06-08");
    const doc = buildGistDocument(local, { now: 123 });
    assert.strictEqual(doc.kind, "clawd-memory");
    assert.strictEqual(doc.updatedAt, 123);
    assert.deepStrictEqual(parseGistMemoryContent(JSON.stringify(doc)), local);
    assert.strictEqual(parseGistMemoryContent("{bad"), null);
  });
});

describe("GitHub gist client", () => {
  it("creates private gists and patches existing gists with the memory file", async () => {
    const calls = [];
    const fetchImpl = async (url, options = {}) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({ id: "gist123", files: {} }),
      };
    };
    const client = createGitHubClient({ fetchImpl, tokenStore: tokenStore() });
    await client.createGist(memory("local", "2026-06-08"));
    await client.updateGist("gist123", memory("local", "2026-06-08"));

    assert.strictEqual(calls[0].options.method, "POST");
    assert.strictEqual(JSON.parse(calls[0].options.body).public, false);
    assert.ok(JSON.parse(calls[0].options.body).files[DEFAULT_GIST_FILENAME]);
    assert.strictEqual(calls[1].options.method, "PATCH");
    assert.match(calls[1].url, /\/gists\/gist123$/);
  });
});

describe("memory sync runtime", () => {
  it("does not auto-push unless sync is enabled", () => {
    const runtime = createMemorySync({
      config: { enabled: false },
      memoryEngine: { getMemorySnapshot: () => memory("local", "2026-06-08") },
      tokenStore: tokenStore(),
      client: {},
    });
    assert.deepStrictEqual(runtime.schedulePush(memory("local", "2026-06-08")), {
      status: "skip",
      reason: "disabled",
    });
  });

  it("push creates a private gist and stores the returned gist id", async () => {
    let config = { enabled: true, gistId: "", autoPushOnSave: true, autoPullOnStartup: true };
    const saved = [];
    const runtime = createMemorySync({
      settingsController: {
        get: () => config,
        applyUpdate: (_key, value) => {
          config = value;
          saved.push(value);
          return { status: "ok" };
        },
      },
      memoryEngine: {
        flush: () => {},
        getMemorySnapshot: () => memory("local", "2026-06-08"),
        replaceMemory: () => {},
      },
      tokenStore: tokenStore(),
      client: {
        createGist: async () => ({ status: "ok", json: { id: "new-gist" } }),
      },
    });

    const result = await runtime.push();
    assert.strictEqual(result.status, "ok");
    assert.strictEqual(result.gistId, "new-gist");
    assert.strictEqual(saved.at(-1).gistId, "new-gist");
  });
});

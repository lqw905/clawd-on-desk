"use strict";

const assert = require("node:assert");
const { describe, it } = require("node:test");
const { createCompanion } = require("../src/companion");

function ts(date) {
  return new Date(`${date}T12:00:00`).getTime();
}

function memory(lastActiveDate, milestones = []) {
  return {
    index: {
      streak: { lastActiveDate },
      milestones,
    },
  };
}

describe("companion behavior engine", () => {
  it("queues a reunion cue after a long absence and only plays it on idle", () => {
    let now = ts("2026-06-08");
    const companion = createCompanion({
      now: () => now,
      getMemorySnapshot: () => memory("2026-06-01"),
      config: { globalCueCooldownMs: 0 },
    });

    companion.observeSessionEvent({
      sessionId: "s1",
      state: "idle",
      event: "SessionStart",
      opts: { headless: false },
    });

    assert.strictEqual(companion.resolveDisplayState("working"), "working");
    assert.strictEqual(companion.resolveDisplayState("idle"), "companion-reunion");
    assert.strictEqual(companion.resolveDisplayState("idle"), "idle");
  });

  it("queues a continuous work reminder after the active threshold", () => {
    let now = ts("2026-06-08");
    const companion = createCompanion({
      now: () => now,
      getMemorySnapshot: () => memory("2026-06-08"),
      config: {
        workReminderAfterMs: 1000,
        workReminderCooldownMs: 1000,
        globalCueCooldownMs: 0,
      },
    });

    companion.observeSessionEvent({ sessionId: "s1", state: "working", event: "PreToolUse", opts: {} });
    now += 1100;
    companion.observeSessionEvent({ sessionId: "s1", state: "working", event: "PostToolUse", opts: {} });

    assert.strictEqual(companion.resolveDisplayState("idle"), "idle");
    assert.strictEqual(companion.resolveDisplayState("working"), "companion-work-reminder");
  });

  it("queues a record cue when memory gains a new milestone", () => {
    let now = ts("2026-06-08");
    let milestones = [];
    const companion = createCompanion({
      now: () => now,
      getMemorySnapshot: () => memory("2026-06-08", milestones),
      config: { recordCooldownMs: 0, globalCueCooldownMs: 0 },
    });

    milestones = [{ type: "sessions", value: 10, sourceId: "sessions:10", date: "2026-06-08" }];
    companion.observeSessionEvent({ sessionId: "s1", state: "idle", event: "Stop", opts: {} });

    assert.strictEqual(companion.resolveDisplayState("idle"), "companion-record");
  });

  it("does not play pending cues while do-not-disturb is active", () => {
    let now = ts("2026-06-08");
    const companion = createCompanion({
      now: () => now,
      getMemorySnapshot: () => memory("2026-06-01"),
      config: { globalCueCooldownMs: 0 },
    });

    companion.observeSessionEvent({ sessionId: "s1", state: "idle", event: "SessionStart", opts: {} });

    assert.strictEqual(companion.resolveDisplayState("idle", { doNotDisturb: true }), "idle");
    assert.strictEqual(companion.resolveDisplayState("idle"), "companion-reunion");
  });

  it("does not play pending cues while another presentation layer is locked", () => {
    let now = ts("2026-06-08");
    const companion = createCompanion({
      now: () => now,
      getMemorySnapshot: () => memory("2026-06-01"),
      config: { globalCueCooldownMs: 0 },
    });

    companion.observeSessionEvent({ sessionId: "s1", state: "idle", event: "SessionStart", opts: {} });

    assert.strictEqual(companion.resolveDisplayState("idle", { presentationLocked: true }), "idle");
    assert.strictEqual(companion.resolveDisplayState("idle"), "companion-reunion");
  });

  it("maps companion cues to mini companion states in mini mode", () => {
    let now = ts("2026-06-08");
    const companion = createCompanion({
      now: () => now,
      getMemorySnapshot: () => memory("2026-06-01"),
      config: { globalCueCooldownMs: 0 },
    });

    companion.observeSessionEvent({ sessionId: "s1", state: "idle", event: "SessionStart", opts: {} });

    assert.strictEqual(
      companion.resolveDisplayState("idle", { miniMode: true }),
      "mini-companion-reunion",
    );
  });
});

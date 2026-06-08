"use strict";

const assert = require("node:assert");
const EventEmitter = require("node:events");
const Module = require("node:module");
const path = require("node:path");
const { describe, it } = require("node:test");

const JOURNAL_MODULE_PATH = require.resolve("../src/journal-dashboard");

function loadJournalWithElectron(fakeElectron) {
  delete require.cache[JOURNAL_MODULE_PATH];
  const originalLoad = Module._load;
  Module._load = function patchedLoad(request, parent, isMain) {
    if (request === "electron") return fakeElectron;
    return originalLoad.apply(this, arguments);
  };
  try {
    return require("../src/journal-dashboard");
  } finally {
    Module._load = originalLoad;
  }
}

describe("journal dashboard window", () => {
  function createWindowHarness(options = {}) {
    let createdWindow = null;
    const nativeTheme = new EventEmitter();
    nativeTheme.shouldUseDarkColors = false;
    const sends = [];

    class FakeBrowserWindow {
      constructor(opts) {
        this.opts = opts;
        this.bounds = { x: opts.x, y: opts.y, width: opts.width, height: opts.height };
        this.backgroundColors = [opts.backgroundColor];
        this.onceCallbacks = new Map();
        this.webContents = {
          isDestroyed: () => false,
          once: (eventName, callback) => {
            if (eventName === "did-finish-load") callback();
          },
          send: (...args) => sends.push(args),
        };
        createdWindow = this;
      }
      isDestroyed() { return false; }
      isMinimized() { return false; }
      restore() {}
      show() {}
      focus() {}
      setMenuBarVisibility() {}
      loadFile(filePath) { this.loadedFile = filePath; }
      once(eventName, callback) { this.onceCallbacks.set(eventName, callback); }
      on() {}
      setBackgroundColor(color) { this.backgroundColors.push(color); }
      setBounds(bounds) { this.bounds = { ...bounds }; }
    }

    const initJournal = loadJournalWithElectron({
      BrowserWindow: FakeBrowserWindow,
      nativeTheme,
    });
    const journal = initJournal({
      getPetWindowBounds: () => ({ x: 100, y: 100, width: 120, height: 120 }),
      getNearestWorkArea: options.getNearestWorkArea || (() => ({ x: 0, y: 0, width: 1280, height: 800 })),
      getSettingsWindow: options.getSettingsWindow,
      getMemorySnapshot: () => ({ status: "ok", memory: { index: {}, snapshots: [] } }),
      t: (key) => key === "journalWindowTitle" ? "Clawd Journal" : key,
    });

    return {
      journal,
      nativeTheme,
      sends,
      getCreatedWindow: () => createdWindow,
    };
  }

  it("creates a titled journal BrowserWindow and loads journal.html", () => {
    const { journal, getCreatedWindow, sends } = createWindowHarness();

    journal.showJournal();
    const win = getCreatedWindow();

    assert.strictEqual(win.opts.title, "Clawd Journal");
    assert.strictEqual(win.opts.minWidth, 520);
    assert.strictEqual(path.basename(win.loadedFile), "journal.html");
    assert.strictEqual(path.basename(win.opts.webPreferences.preload), "preload-journal.js");
    assert.deepStrictEqual(sends[0][0], "journal:memory-snapshot");
  });

  it("updates its background color when native theme changes", () => {
    const { journal, nativeTheme, getCreatedWindow } = createWindowHarness();

    journal.showJournal();
    const win = getCreatedWindow();
    assert.strictEqual(win.opts.backgroundColor, "#f7f7f4");

    nativeTheme.shouldUseDarkColors = true;
    nativeTheme.emit("updated");

    assert.deepStrictEqual(win.backgroundColors, ["#f7f7f4", "#191a1c"]);
  });

  it("anchors settings-opened journal windows next to Settings", () => {
    const settingsWindow = {
      isDestroyed: () => false,
      isMinimized: () => false,
      getBounds: () => ({ x: 100, y: 80, width: 600, height: 640 }),
    };
    const { journal, getCreatedWindow } = createWindowHarness({
      getSettingsWindow: () => settingsWindow,
      getNearestWorkArea: () => ({ x: 0, y: 0, width: 1440, height: 900 }),
    });

    journal.showJournal({ source: "settings" });

    assert.deepStrictEqual(getCreatedWindow().bounds, {
      x: 680,
      y: 80,
      width: 760,
      height: 680,
    });
  });
});

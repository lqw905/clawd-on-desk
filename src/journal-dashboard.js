"use strict";

const { BrowserWindow, nativeTheme } = require("electron");
const path = require("path");

const DEFAULT_WIDTH = 760;
const DEFAULT_HEIGHT = 680;
const MIN_WIDTH = 520;
const MIN_HEIGHT = 480;
const LIGHT_BACKGROUND = "#f7f7f4";
const DARK_BACKGROUND = "#191a1c";

function getJournalBackgroundColor() {
  return nativeTheme.shouldUseDarkColors ? DARK_BACKGROUND : LIGHT_BACKGROUND;
}

function isUsableBounds(bounds) {
  return !!bounds
    && Number.isFinite(bounds.x)
    && Number.isFinite(bounds.y)
    && Number.isFinite(bounds.width)
    && Number.isFinite(bounds.height)
    && bounds.width > 0
    && bounds.height > 0;
}

function clampBoundsToWorkArea(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  return {
    x: Math.round(Math.min(Math.max(bounds.x, workArea.x), workArea.x + workArea.width - width)),
    y: Math.round(Math.min(Math.max(bounds.y, workArea.y), workArea.y + workArea.height - height)),
    width: Math.round(width),
    height: Math.round(height),
  };
}

module.exports = function initJournalDashboard(ctx) {
  let journalWindow = null;
  const scheduleLater = typeof ctx.setTimeout === "function" ? ctx.setTimeout : setTimeout;

  function computeInitialBounds() {
    const petBounds = typeof ctx.getPetWindowBounds === "function" ? ctx.getPetWindowBounds() : null;
    const cx = petBounds ? petBounds.x + petBounds.width / 2 : 0;
    const cy = petBounds ? petBounds.y + petBounds.height / 2 : 0;
    const workArea = typeof ctx.getNearestWorkArea === "function"
      ? ctx.getNearestWorkArea(cx, cy)
      : { x: 0, y: 0, width: 1280, height: 800 };
    const width = Math.min(DEFAULT_WIDTH, Math.max(MIN_WIDTH, workArea.width));
    const height = Math.min(DEFAULT_HEIGHT, Math.max(MIN_HEIGHT, workArea.height));
    return {
      x: Math.round(workArea.x + (workArea.width - width) / 2),
      y: Math.round(workArea.y + (workArea.height - height) / 2),
      width,
      height,
    };
  }

  function getSettingsWindow() {
    return typeof ctx.getSettingsWindow === "function" ? ctx.getSettingsWindow() : null;
  }

  function getSettingsBounds(settingsWindow) {
    if (!settingsWindow || typeof settingsWindow.isDestroyed !== "function") return null;
    if (settingsWindow.isDestroyed()) return null;
    if (typeof settingsWindow.isMinimized === "function" && settingsWindow.isMinimized()) return null;
    if (typeof settingsWindow.getBounds !== "function") return null;
    const bounds = settingsWindow.getBounds();
    return isUsableBounds(bounds) ? bounds : null;
  }

  function getPlacement(options = {}) {
    if (options.source !== "settings") return { bounds: computeInitialBounds() };
    const settingsBounds = getSettingsBounds(getSettingsWindow());
    if (!settingsBounds) return { bounds: computeInitialBounds() };
    const cx = settingsBounds.x + settingsBounds.width / 2;
    const cy = settingsBounds.y + settingsBounds.height / 2;
    const workArea = typeof ctx.getNearestWorkArea === "function"
      ? ctx.getNearestWorkArea(cx, cy)
      : { x: 0, y: 0, width: 1280, height: 800 };
    return {
      bounds: clampBoundsToWorkArea({
        x: settingsBounds.x + settingsBounds.width + 12,
        y: settingsBounds.y,
        width: Math.min(DEFAULT_WIDTH, workArea.width),
        height: Math.min(DEFAULT_HEIGHT, workArea.height),
      }, workArea),
    };
  }

  function applyPlacement(options = {}) {
    if (!journalWindow || journalWindow.isDestroyed()) return;
    const placement = getPlacement(options);
    if (isUsableBounds(placement.bounds) && typeof journalWindow.setBounds === "function") {
      journalWindow.setBounds(placement.bounds);
    }
  }

  function schedulePlacementSync(options = {}) {
    if (options.source !== "settings") return;
    for (const delay of [0, 80]) {
      scheduleLater(() => applyPlacement(options), delay);
    }
  }

  function sendMemorySnapshot() {
    if (!journalWindow || journalWindow.isDestroyed()) return;
    if (!journalWindow.webContents || journalWindow.webContents.isDestroyed()) return;
    const payload = typeof ctx.getMemorySnapshot === "function"
      ? ctx.getMemorySnapshot()
      : { status: "disabled", memory: null };
    journalWindow.webContents.send("journal:memory-snapshot", payload);
  }

  function createJournalWindow(options = {}) {
    const placement = getPlacement(options);
    const opts = {
      ...placement.bounds,
      minWidth: MIN_WIDTH,
      minHeight: MIN_HEIGHT,
      show: false,
      frame: true,
      transparent: false,
      resizable: true,
      minimizable: true,
      maximizable: true,
      skipTaskbar: false,
      alwaysOnTop: false,
      title: typeof ctx.t === "function" ? ctx.t("journalWindowTitle") : "Journal",
      backgroundColor: getJournalBackgroundColor(),
      webPreferences: {
        preload: path.join(__dirname, "preload-journal.js"),
        nodeIntegration: false,
        contextIsolation: true,
      },
    };
    if (ctx.iconPath) opts.icon = ctx.iconPath;

    journalWindow = new BrowserWindow(opts);
    journalWindow.setMenuBarVisibility(false);
    journalWindow.loadFile(path.join(__dirname, "journal.html"));
    journalWindow.webContents.once("did-finish-load", () => {
      sendMemorySnapshot();
    });
    journalWindow.once("ready-to-show", () => {
      if (!journalWindow || journalWindow.isDestroyed()) return;
      applyPlacement(options);
      journalWindow.show();
      schedulePlacementSync(options);
      journalWindow.focus();
    });
    journalWindow.on("closed", () => {
      journalWindow = null;
    });
    return journalWindow;
  }

  function syncThemeBackground() {
    if (!journalWindow || journalWindow.isDestroyed()) return;
    journalWindow.setBackgroundColor(getJournalBackgroundColor());
  }

  if (nativeTheme && typeof nativeTheme.on === "function") {
    nativeTheme.on("updated", syncThemeBackground);
  }

  function showJournal(options = {}) {
    if (journalWindow && !journalWindow.isDestroyed()) {
      if (journalWindow.isMinimized()) journalWindow.restore();
      applyPlacement(options);
      journalWindow.show();
      schedulePlacementSync(options);
      journalWindow.focus();
      sendMemorySnapshot();
      return journalWindow;
    }
    return createJournalWindow(options);
  }

  return {
    showJournal,
    sendMemorySnapshot,
    getWindow: () => journalWindow,
  };
};

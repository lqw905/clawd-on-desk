"use strict";

(function initSettingsTabMemory(root) {
  let helpers = null;
  let ops = null;
  let statusNode = null;

  function t(key) {
    return helpers.t(key);
  }

  function formatBytes(bytes) {
    const n = Number(bytes || 0);
    if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    if (n >= 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${Math.round(n)} B`;
  }

  function formatUpdatedAt(ts) {
    const n = Number(ts || 0);
    if (!Number.isFinite(n) || n <= 0) return t("memoryNoData");
    return new Date(n).toLocaleString();
  }

  function createStatusItem(label, value) {
    const item = document.createElement("div");
    item.className = "memory-status-item";
    const labelEl = document.createElement("div");
    labelEl.className = "memory-status-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("div");
    valueEl.className = "memory-status-value";
    valueEl.textContent = value;
    item.appendChild(labelEl);
    item.appendChild(valueEl);
    return item;
  }

  function renderStatus(status) {
    if (!statusNode) return;
    statusNode.innerHTML = "";
    if (!status || status.status !== "ok") {
      statusNode.appendChild(createStatusItem(t("memoryStatus"), status && status.message ? status.message : t("memoryUnavailable")));
      return;
    }
    statusNode.appendChild(createStatusItem(t("memoryStorage"), formatBytes(status.storageBytes)));
    statusNode.appendChild(createStatusItem(t("memoryDailySnapshots"), String(status.dailySnapshots || 0)));
    statusNode.appendChild(createStatusItem(t("memoryWeeklyAggregates"), String(status.weeklyAggregates || 0)));
    statusNode.appendChild(createStatusItem(t("memoryMonthlyAggregates"), String(status.monthlyAggregates || 0)));
    statusNode.appendChild(createStatusItem(t("memoryPermanentRecords"), String(status.permanentRecords || 0)));
    statusNode.appendChild(createStatusItem(t("memoryLastUpdated"), formatUpdatedAt(status.updatedAt)));
  }

  function refreshStatus() {
    if (!window.settingsAPI || typeof window.settingsAPI.getMemoryStatus !== "function") {
      renderStatus({ status: "error", message: "settings API unavailable" });
      return;
    }
    window.settingsAPI.getMemoryStatus()
      .then(renderStatus)
      .catch((err) => renderStatus({ status: "error", message: err && err.message ? err.message : String(err) }));
  }

  function buildActionRow() {
    const row = document.createElement("div");
    row.className = "memory-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "soft-btn accent";
    openButton.textContent = t("memoryOpenJournal");
    openButton.addEventListener("click", () => {
      if (!window.settingsAPI || typeof window.settingsAPI.openJournal !== "function") return;
      window.settingsAPI.openJournal().then((result) => {
        if (result && result.status === "error") {
          ops.showToast(t("toastSaveFailed") + result.message, { error: true });
        }
      }).catch((err) => {
        ops.showToast(t("toastSaveFailed") + (err && err.message), { error: true });
      });
    });
    row.appendChild(openButton);

    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "soft-btn";
    exportButton.textContent = t("memoryExportJson");
    exportButton.addEventListener("click", () => {
      if (!window.settingsAPI || typeof window.settingsAPI.exportMemoryJson !== "function") return;
      exportButton.disabled = true;
      window.settingsAPI.exportMemoryJson()
        .then((result) => {
          if (!result || result.status === "cancel") return;
          if (result.status !== "ok") {
            throw new Error((result && result.message) || "export failed");
          }
          ops.showToast(t("memoryExported"));
        })
        .catch((err) => {
          ops.showToast(t("toastSaveFailed") + (err && err.message ? err.message : String(err)), { error: true });
        })
        .finally(() => {
          exportButton.disabled = false;
        });
    });
    row.appendChild(exportButton);

    return row;
  }

  function render(parent, core) {
    helpers = core.helpers;
    ops = core.ops;

    const section = document.createElement("div");
    section.className = "settings-tab-section";

    const title = document.createElement("h3");
    title.textContent = t("memoryTitle");
    section.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "settings-tab-desc";
    desc.textContent = t("memoryDesc");
    section.appendChild(desc);

    statusNode = document.createElement("div");
    statusNode.className = "memory-status-grid";
    section.appendChild(statusNode);
    section.appendChild(buildActionRow());

    const note = document.createElement("p");
    note.className = "settings-tab-desc memory-note";
    note.textContent = t("memoryDangerDeferred");
    section.appendChild(note);

    parent.appendChild(section);
    refreshStatus();
  }

  function init(core) {
    helpers = core.helpers;
    ops = core.ops;
    core.tabs.memory = { render };
  }

  root.ClawdSettingsTabMemory = { init };
})(globalThis);

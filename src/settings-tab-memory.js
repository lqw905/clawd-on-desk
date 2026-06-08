"use strict";

(function initSettingsTabMemory(root) {
  let helpers = null;
  let ops = null;
  let statusNode = null;
  let syncStatusNode = null;
  let syncControls = null;

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
    statusNode.appendChild(createStatusItem(t("memoryUnlockedBadges"), String(status.unlockedBadges || 0)));
    statusNode.appendChild(createStatusItem(t("memoryLastUpdated"), formatUpdatedAt(status.updatedAt)));
  }

  function renderSyncStatus(status) {
    if (!syncStatusNode) return;
    syncStatusNode.innerHTML = "";
    if (!status || status.status !== "ok") {
      syncStatusNode.appendChild(createStatusItem(t("memorySyncStatus"), status && status.message ? status.message : t("memoryUnavailable")));
      return;
    }
    const config = status.config || {};
    const token = status.token || {};
    syncStatusNode.appendChild(createStatusItem(t("memorySyncStatus"), config.enabled ? t("memorySyncEnabledState") : t("memorySyncDisabled")));
    syncStatusNode.appendChild(createStatusItem(t("memorySyncToken"), token.tokenStored ? (token.masked || t("memorySyncTokenConfigured")) : t("memoryNoData")));
    syncStatusNode.appendChild(createStatusItem(t("memorySyncGistId"), config.gistId || t("memoryNoData")));
    syncStatusNode.appendChild(createStatusItem(t("memorySyncLastResult"), status.lastSyncStatus || "idle"));

    if (syncControls) {
      syncControls.enabled.checked = config.enabled === true;
      syncControls.gistId.value = config.gistId || "";
      syncControls.autoPull.checked = config.autoPullOnStartup !== false;
      syncControls.autoPush.checked = config.autoPushOnSave !== false;
      syncControls.pull.disabled = !config.enabled || !config.gistId || status.inFlight;
      syncControls.push.disabled = !config.enabled || status.inFlight;
      syncControls.save.disabled = status.inFlight;
      syncControls.clearToken.disabled = status.inFlight || !token.tokenStored;
    }
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

  function refreshSyncStatus() {
    if (!window.settingsAPI || typeof window.settingsAPI.getMemorySyncStatus !== "function") {
      renderSyncStatus({ status: "error", message: "settings API unavailable" });
      return;
    }
    window.settingsAPI.getMemorySyncStatus()
      .then(renderSyncStatus)
      .catch((err) => renderSyncStatus({ status: "error", message: err && err.message ? err.message : String(err) }));
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = !!busy;
    button.classList.toggle("pending", !!busy);
  }

  function showResultToast(result, okMessage) {
    if (!result || result.status !== "ok") {
      ops.showToast(t("toastSaveFailed") + ((result && result.message) || "failed"), { error: true });
      return false;
    }
    ops.showToast(okMessage);
    return true;
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

  function buildSyncField(labelKey, input) {
    const field = document.createElement("label");
    field.className = "memory-sync-field";
    const label = document.createElement("span");
    label.textContent = t(labelKey);
    field.appendChild(label);
    field.appendChild(input);
    return field;
  }

  function buildSyncCheckbox(labelKey, input) {
    const label = document.createElement("label");
    label.className = "memory-sync-checkbox";
    label.appendChild(input);
    const text = document.createElement("span");
    text.textContent = t(labelKey);
    label.appendChild(text);
    return label;
  }

  function buildSyncSection() {
    const section = document.createElement("div");
    section.className = "memory-sync-section";

    const title = document.createElement("h3");
    title.textContent = t("memorySyncTitle");
    section.appendChild(title);

    const desc = document.createElement("p");
    desc.className = "settings-tab-desc";
    desc.textContent = t("memorySyncDesc");
    section.appendChild(desc);

    syncStatusNode = document.createElement("div");
    syncStatusNode.className = "memory-status-grid";
    section.appendChild(syncStatusNode);

    const form = document.createElement("div");
    form.className = "memory-sync-form";

    const enabled = document.createElement("input");
    enabled.type = "checkbox";

    const gistId = document.createElement("input");
    gistId.type = "text";
    gistId.className = "text-input";
    gistId.placeholder = t("memorySyncGistPlaceholder");
    gistId.autocomplete = "off";

    const token = document.createElement("input");
    token.type = "password";
    token.className = "text-input";
    token.placeholder = t("memorySyncTokenPlaceholder");
    token.autocomplete = "off";

    const autoPull = document.createElement("input");
    autoPull.type = "checkbox";
    const autoPush = document.createElement("input");
    autoPush.type = "checkbox";

    form.appendChild(buildSyncCheckbox("memorySyncEnabled", enabled));
    form.appendChild(buildSyncField("memorySyncGistId", gistId));
    form.appendChild(buildSyncField("memorySyncToken", token));
    form.appendChild(buildSyncCheckbox("memorySyncAutoPull", autoPull));
    form.appendChild(buildSyncCheckbox("memorySyncAutoPush", autoPush));
    section.appendChild(form);

    const actions = document.createElement("div");
    actions.className = "memory-actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "soft-btn accent";
    save.textContent = t("memorySyncSave");

    const pull = document.createElement("button");
    pull.type = "button";
    pull.className = "soft-btn";
    pull.textContent = t("memorySyncPull");

    const push = document.createElement("button");
    push.type = "button";
    push.className = "soft-btn";
    push.textContent = t("memorySyncPush");

    const clearToken = document.createElement("button");
    clearToken.type = "button";
    clearToken.className = "soft-btn";
    clearToken.textContent = t("memorySyncClearToken");

    syncControls = { enabled, gistId, token, autoPull, autoPush, save, pull, push, clearToken };

    save.addEventListener("click", () => {
      if (!window.settingsAPI || typeof window.settingsAPI.configureMemorySync !== "function") return;
      setBusy(save, true);
      window.settingsAPI.configureMemorySync({
        enabled: enabled.checked,
        gistId: gistId.value,
        token: token.value,
        autoPullOnStartup: autoPull.checked,
        autoPushOnSave: autoPush.checked,
      }).then((result) => {
        if (showResultToast(result, t("memorySyncSaved"))) {
          token.value = "";
          renderSyncStatus(result);
        }
      }).catch((err) => {
        ops.showToast(t("toastSaveFailed") + (err && err.message ? err.message : String(err)), { error: true });
      }).finally(() => {
        setBusy(save, false);
        refreshSyncStatus();
      });
    });

    pull.addEventListener("click", () => {
      if (!window.settingsAPI || typeof window.settingsAPI.pullMemorySync !== "function") return;
      setBusy(pull, true);
      window.settingsAPI.pullMemorySync()
        .then((result) => {
          if (showResultToast(result, t("memorySyncPulled"))) refreshStatus();
        })
        .catch((err) => ops.showToast(t("toastSaveFailed") + (err && err.message ? err.message : String(err)), { error: true }))
        .finally(() => {
          setBusy(pull, false);
          refreshSyncStatus();
        });
    });

    push.addEventListener("click", () => {
      if (!window.settingsAPI || typeof window.settingsAPI.pushMemorySync !== "function") return;
      setBusy(push, true);
      window.settingsAPI.pushMemorySync()
        .then((result) => showResultToast(result, t("memorySyncPushed")))
        .catch((err) => ops.showToast(t("toastSaveFailed") + (err && err.message ? err.message : String(err)), { error: true }))
        .finally(() => {
          setBusy(push, false);
          refreshSyncStatus();
        });
    });

    clearToken.addEventListener("click", () => {
      if (!window.settingsAPI || typeof window.settingsAPI.configureMemorySync !== "function") return;
      setBusy(clearToken, true);
      window.settingsAPI.configureMemorySync({
        enabled: enabled.checked,
        gistId: gistId.value,
        autoPullOnStartup: autoPull.checked,
        autoPushOnSave: autoPush.checked,
        clearToken: true,
      }).then((result) => {
        if (showResultToast(result, t("memorySyncSaved"))) token.value = "";
      }).catch((err) => {
        ops.showToast(t("toastSaveFailed") + (err && err.message ? err.message : String(err)), { error: true });
      }).finally(() => {
        setBusy(clearToken, false);
        refreshSyncStatus();
      });
    });

    actions.appendChild(save);
    actions.appendChild(pull);
    actions.appendChild(push);
    actions.appendChild(clearToken);
    section.appendChild(actions);

    return section;
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
    section.appendChild(buildSyncSection());

    const note = document.createElement("p");
    note.className = "settings-tab-desc memory-note";
    note.textContent = t("memoryDangerDeferred");
    section.appendChild(note);

    parent.appendChild(section);
    refreshStatus();
    refreshSyncStatus();
  }

  function init(core) {
    helpers = core.helpers;
    ops = core.ops;
    core.tabs.memory = { render };
  }

  root.ClawdSettingsTabMemory = { init };
})(globalThis);

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

const snapshotListeners = new Set();

ipcRenderer.on("journal:memory-snapshot", (_event, payload) => {
  for (const cb of snapshotListeners) {
    try { cb(payload); } catch (err) { console.warn("journal snapshot listener threw:", err); }
  }
});

contextBridge.exposeInMainWorld("journalAPI", {
  getMemorySnapshot: () => ipcRenderer.invoke("journal:get-memory-snapshot"),
  onMemorySnapshot: (cb) => {
    if (typeof cb !== "function") return () => {};
    snapshotListeners.add(cb);
    return () => snapshotListeners.delete(cb);
  },
});

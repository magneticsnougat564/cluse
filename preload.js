const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('cluse', {
  // Subscribe to usage payloads pushed from the main process.
  onUsage: (cb) => ipcRenderer.on('usage', (_e, payload) => cb(payload)),
});

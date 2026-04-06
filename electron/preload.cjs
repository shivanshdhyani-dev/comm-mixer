const { contextBridge } = require("electron");

// Expose minimal Electron APIs to the renderer
contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
});

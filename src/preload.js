const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("deepseekMonitor", {
  openExternal: (url) => ipcRenderer.invoke("open-external", url),
  copyText: (text) => ipcRenderer.invoke("copy-text", text),
  hideWindow: () => ipcRenderer.invoke("hide-window"),
});

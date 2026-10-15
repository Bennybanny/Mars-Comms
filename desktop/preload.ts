import { contextBridge, ipcRenderer } from "electron";
import type { LauncherAPI } from "../shared/launcher.js";
const api: LauncherAPI = {
  snapshot: () => ipcRenderer.invoke("mars:snapshot"),
  configure: (config) => ipcRenderer.invoke("mars:configure", config),
  generate: () => ipcRenderer.invoke("mars:generate"),
  start: () => ipcRenderer.invoke("mars:start"),
  stop: () => ipcRenderer.invoke("mars:stop"),
  exportCA: () => ipcRenderer.invoke("mars:export"),
  openIntercom: () => ipcRenderer.invoke("mars:open"),
  setupQR: () => ipcRenderer.invoke("mars:qr"),
  importDatabase: () => ipcRenderer.invoke("mars:import"),
  onChange: (callback) => {
    const listener = (
      _event: Electron.IpcRendererEvent,
      state: Parameters<typeof callback>[0],
    ) => callback(state);
    ipcRenderer.on("mars:changed", listener);
    return () => ipcRenderer.removeListener("mars:changed", listener);
  },
};
contextBridge.exposeInMainWorld("marsLauncher", api);

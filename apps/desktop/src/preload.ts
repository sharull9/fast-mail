import { contextBridge, ipcRenderer } from "electron";

// The only native capability the UI needs: open sign-in / Gmail links in the system browser.
contextBridge.exposeInMainWorld("mailfast", {
  openExternal: (url: string) => ipcRenderer.send("open-external", url),
});

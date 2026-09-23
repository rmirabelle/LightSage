const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('lightSageDesktop', {
  status: () => ipcRenderer.invoke('desktop:status'),
  setStartup: enabled => ipcRenderer.invoke('desktop:startup', enabled),
  logs: () => ipcRenderer.invoke('desktop:logs'),
  showLog: () => ipcRenderer.invoke('desktop:show-log'),
  restart: () => ipcRenderer.invoke('desktop:restart'),
  start: () => ipcRenderer.invoke('desktop:start'),
  stop: () => ipcRenderer.invoke('desktop:stop'),
});

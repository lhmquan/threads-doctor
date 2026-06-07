const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  restartApp: () => ipcRenderer.invoke('restart-app'),
  getAutoLaunch: () => ipcRenderer.invoke('get-auto-launch'),
  setAutoLaunch: (enabled) => ipcRenderer.invoke('set-auto-launch', enabled),
})

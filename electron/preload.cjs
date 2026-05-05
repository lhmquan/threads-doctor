const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronAPI', {
  openReleaseFolder: () => ipcRenderer.invoke('open-release-folder'),
})

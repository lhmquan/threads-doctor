const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })
  win.loadFile(path.join(__dirname, '../dist/index.html'))
  win.setMenuBarVisibility(false)
}

ipcMain.handle('open-release-folder', () => {
  const releasePath = path.join(app.getAppPath(), '..', '..', '..', '..', 'release')
  shell.openPath(path.resolve(releasePath))
})

ipcMain.handle('get-app-path', () => app.getAppPath())

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

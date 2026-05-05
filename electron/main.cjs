const { app, BrowserWindow, ipcMain } = require('electron')
const path = require('path')
const fs = require('fs')

const SOURCE_DIR = 'E:\\Antigravity\\threads-doctor'
const DIST_INDEX = path.join(SOURCE_DIR, 'dist', 'index.html')

function getIndexPath() {
  if (fs.existsSync(DIST_INDEX)) return DIST_INDEX
  return path.join(__dirname, '../dist/index.html')
}

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
  win.loadFile(getIndexPath())
  win.setMenuBarVisibility(false)
}

ipcMain.handle('restart-app', () => {
  app.relaunch()
  app.exit(0)
})

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

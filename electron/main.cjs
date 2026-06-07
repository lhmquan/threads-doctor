const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')

const SOURCE_DIR = 'E:\\Antigravity\\threads-doctor'
const DIST_INDEX = path.join(SOURCE_DIR, 'dist', 'index.html')

let mainWindow = null
let tray = null
let isQuitting = false

function getIndexPath() {
  if (fs.existsSync(DIST_INDEX)) return DIST_INDEX
  return path.join(__dirname, '../dist/index.html')
}

function getAutoLaunchEnabled() {
  const item = app.getLoginItemSettings()
  return !!item.openAtLogin
}

function setAutoLaunchEnabled(enabled) {
  app.setLoginItemSettings({ openAtLogin: !!enabled })
  return getAutoLaunchEnabled()
}

function showMainWindow() {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'Mở Threads Doctor',
      click: () => showMainWindow(),
    },
    {
      type: 'separator',
    },
    {
      label: 'Khởi động cùng Windows',
      type: 'checkbox',
      checked: getAutoLaunchEnabled(),
      click: (menuItem) => setAutoLaunchEnabled(menuItem.checked),
    },
    {
      type: 'separator',
    },
    {
      label: 'Thoát',
      click: () => {
        isQuitting = true
        app.quit()
      },
    },
  ])
}

function createTrayIcon() {
  const trayIconCandidates = [
    path.join(__dirname, 'app.ico'),
    path.join(__dirname, 'tray.png'),
    path.join(__dirname, 'icon.png'),
    path.join(__dirname, '../assets/tray.png'),
    path.join(__dirname, '../assets/icon.png'),
  ]

  for (const candidate of trayIconCandidates) {
    if (fs.existsSync(candidate)) {
      const img = nativeImage.createFromPath(candidate)
      if (!img.isEmpty()) {
        return img
      }
    }
  }

  const exeIcon = nativeImage.createFromPath(process.execPath)
  if (!exeIcon.isEmpty()) {
    return exeIcon
  }

  return nativeImage.createEmpty()
}

function createTray() {
  if (tray) return

  const icon = createTrayIcon()

  tray = new Tray(icon)
  tray.setToolTip('Threads Doctor')
  tray.on('double-click', showMainWindow)
  tray.on('right-click', () => tray.popUpContextMenu(buildTrayMenu()))
}

function createContextMenu(params, win) {
  const webContents = win.webContents
  if (params.isEditable) {
    return Menu.buildFromTemplate([
      { role: 'undo' },
      { role: 'redo' },
      { type: 'separator' },
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      { role: 'selectAll' },
    ])
  }

  return Menu.buildFromTemplate([
    {
      label: 'Back',
      enabled: webContents.canGoBack(),
      click: () => webContents.goBack(),
    },
    {
      label: 'Forward',
      enabled: webContents.canGoForward(),
      click: () => webContents.goForward(),
    },
    {
      label: 'Refresh',
      click: () => win.loadFile(getIndexPath()),
    },
    { type: 'separator' },
    { role: 'copy' },
    { role: 'selectAll' },
  ])
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: false,
      preload: path.join(__dirname, 'preload.cjs'),
    },
  })

  mainWindow.loadFile(getIndexPath())
  mainWindow.webContents.on('context-menu', (_event, params) => {
    const menu = createContextMenu(params, mainWindow)
    menu.popup({ window: mainWindow })
  })
  mainWindow.setMenuBarVisibility(false)

  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    mainWindow.hide()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  createTray()
}

ipcMain.handle('restart-app', () => {
  isQuitting = true
  app.relaunch()
  app.exit(0)
})

ipcMain.handle('get-auto-launch', () => getAutoLaunchEnabled())
ipcMain.handle('set-auto-launch', (_event, enabled) => setAutoLaunchEnabled(enabled))

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (mainWindow === null) createWindow()
    else showMainWindow()
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})

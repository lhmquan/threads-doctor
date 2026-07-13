const { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } = require('electron')
const path = require('path')
const fs = require('fs')
const { autoUpdater } = require('electron-updater')

const SOURCE_DIR = 'E:\\Antigravity\\threads-doctor'
const DIST_INDEX = path.join(SOURCE_DIR, 'dist', 'index.html')

let mainWindow = null
let tray = null
let isQuitting = false

function getIndexPath() {
  // App đã đóng gói: luôn load dist nội bộ (đảm bảo auto-update nạp đúng bản mới),
  // không dùng đường dẫn source hardcode.
  if (app.isPackaged) {
    return path.join(__dirname, '../dist/index.html')
  }
  // Dev/local: ưu tiên dist từ thư mục source để hot-reload qua nút "Cập nhật".
  if (fs.existsSync(DIST_INDEX)) return DIST_INDEX
  return path.join(__dirname, '../dist/index.html')
}

// When the app is NOT packaged (running via `electron .`), process.execPath
// points at electron.exe and the app entry path is lost. We must pass the
// project path explicitly via args, otherwise Windows launches a bare
// electron.exe that shows the default Electron welcome screen instead of
// our app. `--hidden` lets the app start minimized to tray at login.
function getLoginItemOptions() {
  if (app.isPackaged) {
    return {
      path: process.execPath,
      args: ['--hidden'],
    }
  }
  return {
    path: process.execPath,
    args: [path.resolve(__dirname, '..'), '--hidden'],
  }
}

function getAutoLaunchEnabled() {
  const opts = app.isPackaged ? undefined : getLoginItemOptions()
  const item = opts ? app.getLoginItemSettings(opts) : app.getLoginItemSettings()
  return !!item.openAtLogin
}

function setAutoLaunchEnabled(enabled) {
  const base = getLoginItemOptions()
  app.setLoginItemSettings({
    openAtLogin: !!enabled,
    path: base.path,
    args: base.args,
  })
  return getAutoLaunchEnabled()
}

function wasLaunchedAtLogin() {
  if (process.argv.includes('--hidden')) return true
  const item = app.getLoginItemSettings()
  return !!(item.wasOpenedAtLogin || (item.launchedAtLogin))
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
  const startHidden = wasLaunchedAtLogin()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    show: !startHidden,
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

// ---------- Auto-update (kéo bản mới từ GitHub Release) ----------
let updaterWired = false

// Gửi trạng thái update về tất cả cửa sổ renderer.
function broadcastUpdate(payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('update-status', payload)
  }
}

// Gắn listener cho autoUpdater. Chỉ chạy thật khi app đã đóng gói (có app-update.yml).
function initUpdater() {
  if (updaterWired) return
  updaterWired = true

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => broadcastUpdate({ state: 'checking' }))
  autoUpdater.on('update-available', (info) =>
    broadcastUpdate({ state: 'available', version: info.version })
  )
  autoUpdater.on('update-not-available', () => broadcastUpdate({ state: 'none' }))
  autoUpdater.on('download-progress', (p) =>
    broadcastUpdate({ state: 'downloading', percent: Math.round(p.percent) })
  )
  autoUpdater.on('update-downloaded', (info) =>
    broadcastUpdate({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (err) =>
    broadcastUpdate({ state: 'error', error: err == null ? 'unknown' : (err.message || String(err)) })
  )
}

async function checkForUpdates() {
  if (!app.isPackaged) {
    // Dev mode không có app-update.yml; báo "none" để UI không treo.
    broadcastUpdate({ state: 'none' })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    broadcastUpdate({ state: 'error', error: (e && e.message) || String(e) })
  }
}

function installUpdate() {
  // Đánh dấu đang thoát thật (không thu xuống tray) trước khi cài + khởi động lại.
  isQuitting = true
  autoUpdater.quitAndInstall()
}

ipcMain.handle('update-check', () => checkForUpdates())
ipcMain.handle('update-install', () => installUpdate())

// Single-instance lock: chỉ cho phép 1 tiến trình chạy. Electron lưu localStorage
// (LevelDB) chỉ mở được bởi 1 process — mở nhiều bản sẽ khiến bản thứ 2 trở đi
// không đọc được DB đang bị khoá và hiện app rỗng (mất tài khoản). Nếu đã có
// bản chạy, focus lại cửa sổ cũ thay vì bật thêm tiến trình mới.
const gotSingleInstanceLock = app.requestSingleInstanceLock()

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    showMainWindow()
  })

  app.whenReady().then(() => {
    createWindow()
    // Gắn listener autoUpdater sau khi window đã tạo để broadcast về renderer.
    initUpdater()
    app.on('activate', () => {
      if (mainWindow === null) createWindow()
      else showMainWindow()
    })
  })
}

app.on('before-quit', () => {
  isQuitting = true
})

app.on('window-all-closed', (event) => {
  event.preventDefault()
})

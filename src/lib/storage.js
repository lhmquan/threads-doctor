const ACCOUNTS_KEY = 'td.accounts.v1'
const SETTINGS_KEY = 'td.settings.v1'
const SCHEDULES_KEY = 'td.schedules.v1'
const SCHEDULE_LOGS_KEY = 'td.schedule_logs.v1'
const APP_LOGS_KEY = 'td.app_logs.v1'

export function loadAccounts() {
  try { return JSON.parse(localStorage.getItem(ACCOUNTS_KEY)) || [] }
  catch { return [] }
}
export function saveAccounts(list) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(list))
}

export function loadSettings() {
  try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {} }
  catch { return {} }
}
export function saveSettings(s) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

export function loadSchedules() {
  try {
    const data = JSON.parse(localStorage.getItem(SCHEDULES_KEY) || '[]')
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
export function saveSchedules(list) {
  localStorage.setItem(SCHEDULES_KEY, JSON.stringify(Array.isArray(list) ? list : []))
}

export function loadScheduleLogs() {
  try {
    const data = JSON.parse(localStorage.getItem(SCHEDULE_LOGS_KEY) || '[]')
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
export function saveScheduleLogs(list) {
  localStorage.setItem(SCHEDULE_LOGS_KEY, JSON.stringify(Array.isArray(list) ? list : []))
}

export function loadAppLogs() {
  try {
    const data = JSON.parse(localStorage.getItem(APP_LOGS_KEY) || '[]')
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}
export function saveAppLogs(list) {
  localStorage.setItem(APP_LOGS_KEY, JSON.stringify(Array.isArray(list) ? list : []))
}

const FOLLOWERS_KEY = 'td.followers_baseline'
const BUFF_SCHEDULES_KEY = 'td.buff_schedules.v1'
const BUFF_LOGS_KEY = 'td.buff_logs.v1'

export function loadFollowersBaseline() {
  try { return JSON.parse(localStorage.getItem(FOLLOWERS_KEY) || '{}') } catch { return {} }
}
export function saveFollowersBaseline(data) {
  localStorage.setItem(FOLLOWERS_KEY, JSON.stringify(data))
}

export function loadBuffSchedules() {
  try {
    const data = JSON.parse(localStorage.getItem(BUFF_SCHEDULES_KEY) || '[]')
    return Array.isArray(data) ? data : []
  } catch { return [] }
}
export function saveBuffSchedules(list) {
  localStorage.setItem(BUFF_SCHEDULES_KEY, JSON.stringify(Array.isArray(list) ? list : []))
}

export function loadBuffLogs() {
  try {
    const data = JSON.parse(localStorage.getItem(BUFF_LOGS_KEY) || '[]')
    return Array.isArray(data) ? data : []
  } catch { return [] }
}
export function saveBuffLogs(list) {
  localStorage.setItem(BUFF_LOGS_KEY, JSON.stringify(Array.isArray(list) ? list : []))
}

const BUFF_FAVOURITE_WORKERS_KEY = 'td.buff_fav_workers.v1'

export function loadBuffFavouriteWorkers() {
  try {
    const data = JSON.parse(localStorage.getItem(BUFF_FAVOURITE_WORKERS_KEY) || '[]')
    return Array.isArray(data) ? data : []
  } catch { return [] }
}
export function saveBuffFavouriteWorkers(list) {
  localStorage.setItem(BUFF_FAVOURITE_WORKERS_KEY, JSON.stringify(Array.isArray(list) ? list : []))
}

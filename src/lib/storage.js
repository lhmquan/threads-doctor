const ACCOUNTS_KEY = 'td.accounts.v1'
const SETTINGS_KEY = 'td.settings.v1'

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

const FOLLOWERS_KEY = 'td.followers_baseline'

export function loadFollowersBaseline() {
  try { return JSON.parse(localStorage.getItem(FOLLOWERS_KEY) || '{}') } catch { return {} }
}
export function saveFollowersBaseline(data) {
  localStorage.setItem(FOLLOWERS_KEY, JSON.stringify(data))
}

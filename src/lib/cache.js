const PREFIX = 'td.cache.v1.'

export function cacheGet(key, ttl) {
  try {
    const raw = localStorage.getItem(PREFIX + key)
    if (!raw) return null
    const { t, v } = JSON.parse(raw)
    if (ttl > 0 && Date.now() - t > ttl) {
      localStorage.removeItem(PREFIX + key)
      return null
    }
    return v
  } catch { return null }
}

export function cacheSet(key, value) {
  try {
    localStorage.setItem(PREFIX + key, JSON.stringify({ t: Date.now(), v: value }))
  } catch {}
}

export function cacheDelete(key) {
  try { localStorage.removeItem(PREFIX + key) } catch {}
}

export function cacheClear(prefix = '') {
  try {
    const full = PREFIX + prefix
    const keys = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(full)) keys.push(k)
    }
    keys.forEach(k => localStorage.removeItem(k))
    return keys.length
  } catch { return 0 }
}

export function cacheStats() {
  let count = 0, bytes = 0
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) {
        count++
        const val = localStorage.getItem(k) || ''
        bytes += k.length * 2 + val.length * 2
      }
    }
  } catch {}
  return { count, bytes }
}

export function cacheEntries() {
  const entries = []
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(PREFIX)) {
        const raw = localStorage.getItem(k)
        const size = (k.length + (raw || '').length) * 2
        let age = 0
        try { age = Date.now() - JSON.parse(raw).t } catch {}
        entries.push({
          key: k.slice(PREFIX.length),
          size,
          age,
        })
      }
    }
  } catch {}
  return entries.sort((a, b) => a.age - b.age)
}

export function formatBytes(b) {
  if (b < 1024) return b + ' B'
  if (b < 1024 * 1024) return (b / 1024).toFixed(1) + ' KB'
  return (b / (1024 * 1024)).toFixed(1) + ' MB'
}

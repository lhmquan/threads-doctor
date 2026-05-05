import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, BarChart2, CheckCircle2, CheckSquare, Clock, ClipboardCopy, Database,
  Download, ExternalLink, Image as ImageIcon, KeyRound, List, Lock, MessageSquare, Moon, Plus,
  RefreshCw, Search, Send, Settings, Sparkles, Square, Stethoscope, Sun, Trash2, TrendingDown, TrendingUp, User, X,
} from 'lucide-react'
import { fetchMe, fetchPost, fetchPosts, fetchInsights, fetchPostInsights, fetchReplies, fetchRepliesPage, postReply, resolveThreadsUrl, searchKeyword, maskToken } from './lib/threads.js'
import { generateReply } from './lib/ai.js'
import { parseThreadsUrl } from './lib/threads-url.js'
import { loadAccounts, saveAccounts, loadSettings, saveSettings, loadFollowersBaseline, saveFollowersBaseline } from './lib/storage.js'
import { cacheClear, cacheGet, cacheStats, cacheEntries, formatBytes } from './lib/cache.js'

function useTheme() {
  const [dark, setDark] = useState(() => {
    const saved = localStorage.getItem('td.theme')
    if (saved) return saved === 'dark'
    return window.matchMedia('(prefers-color-scheme: dark)').matches
  })
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('td.theme', dark ? 'dark' : 'light')
  }, [dark])
  return [dark, () => setDark(v => !v)]
}

function useRoute() {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const navigate = (to) => {
    window.history.pushState({}, '', to)
    setPath(to)
  }
  return [path, navigate]
}

export default function Root() {
  const [path, navigate] = useRoute()
  const [dark, toggleTheme] = useTheme()
  const settings = loadSettings()
  const accounts = loadAccounts()
  const [followersBaseline, setFollowersBaseline] = useState(() => loadFollowersBaseline())

  useEffect(() => { saveFollowersBaseline(followersBaseline) }, [followersBaseline])

  if (path === '/interact') {
    return <InteractView accounts={accounts} settings={settings} navigate={navigate} dark={dark} toggleTheme={toggleTheme} />
  }

  const m = path.match(/^\/([^/]+)(?:\/post\/([^/]+))?\/?$/)
  if (m && m[1] && m[1] !== '') {
    const userId = m[1]
    const postId = m[2]
    const account = accounts.find(a => a.id === userId)
    if (account) {
      return postId
        ? <PostDetailView account={account} postId={postId} settings={settings} navigate={navigate} />
        : <ProfileView account={account} settings={settings} navigate={navigate} followersBaseline={followersBaseline} setFollowersBaseline={setFollowersBaseline} />
    }
  }
  return <App navigate={navigate} dark={dark} toggleTheme={toggleTheme} followersBaseline={followersBaseline} setFollowersBaseline={setFollowersBaseline} />
}

function App({ navigate, dark, toggleTheme, followersBaseline = {}, setFollowersBaseline }) {
  const [accounts, setAccounts] = useState(() => loadAccounts())
  const [settings, setSettings] = useState(() => loadSettings())
  const [showSettings, setShowSettings] = useState(false)
  const [query, setQuery] = useState('')
  const [urlMsg, setUrlMsg] = useState('')
  const [resolvingUrl, setResolvingUrl] = useState(false)

  const handleQueryChange = async (e) => {
    const val = e.target.value
    setQuery(val)
    setUrlMsg('')
    const parsed = parseThreadsUrl(val)
    if (!parsed) return
    const account = accounts.find(a => a.username === parsed.username)
    if (!account) {
      setUrlMsg(`Không tìm thấy tài khoản @${parsed.username} trong hệ thống`)
      return
    }
    setResolvingUrl(true)
    setUrlMsg('Đang resolve post ID...')
    try {
      const { postId } = await resolveThreadsUrl(val, { settings })
      setQuery('')
      setUrlMsg('')
      navigate(`/${account.id}/post/${postId}`)
    } catch (err) {
      setUrlMsg('Lỗi: ' + err.message)
    } finally { setResolvingUrl(false) }
  }

  const [token, setToken] = useState('')
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const [showBulk, setShowBulk] = useState(false)
  const [bulkText, setBulkText] = useState('')
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkLog, setBulkLog] = useState([])
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })
  const bulkAbort = useRef(false)

  const [selectedIds, setSelectedIds] = useState(new Set())
  const toggleSelect = (id) => setSelectedIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const selectAll = () => setSelectedIds(new Set(filtered.map(a => a.id)))
  const selectNone = () => setSelectedIds(new Set())

  const [fetchingAllPosts, setFetchingAllPosts] = useState(false)
  const [fetchPostsProgress, setFetchPostsProgress] = useState({ done: 0, total: 0 })
  const fetchPostsAbort = useRef(false)

  const [postsFetchTick, setPostsFetchTick] = useState(0)

  const fetchAllPosts = useCallback(async () => {
    const targets = accounts.filter(a => selectedIds.has(a.id))
    if (targets.length === 0) return
    setFetchingAllPosts(true)
    setFetchPostsProgress({ done: 0, total: targets.length })
    fetchPostsAbort.current = false
    const DELAY = (settings?.bulkDelay ?? 5) * 1000
    for (let i = 0; i < targets.length; i++) {
      if (fetchPostsAbort.current) break
      try {
        await fetchPosts(targets[i].id, targets[i].token, { settings, limit: 10, skipCache: true })
      } catch {}
      setFetchPostsProgress({ done: i + 1, total: targets.length })
      if (i < targets.length - 1 && !fetchPostsAbort.current) {
        await new Promise(r => setTimeout(r, DELAY))
      }
    }
    setFetchingAllPosts(false)
    setPostsFetchTick(t => t + 1)
  }, [accounts, selectedIds, settings])

  const [fetchingAllInsights, setFetchingAllInsights] = useState(false)
  const [fetchInsightsProgress, setFetchInsightsProgress] = useState({ done: 0, total: 0 })
  const fetchInsightsAbort = useRef(false)

  const fetchAllInsights = useCallback(async () => {
    const targets = accounts.filter(a => selectedIds.has(a.id))
    if (targets.length === 0) return
    setFetchingAllInsights(true)
    setFetchInsightsProgress({ done: 0, total: targets.length })
    fetchInsightsAbort.current = false
    const DELAY = (settings?.bulkDelay ?? 5) * 1000
    for (let i = 0; i < targets.length; i++) {
      if (fetchInsightsAbort.current) break
      try {
        await fetchInsights(targets[i].id, targets[i].token, { settings })
      } catch {}
      setFetchInsightsProgress({ done: i + 1, total: targets.length })
      if (i < targets.length - 1 && !fetchInsightsAbort.current) {
        await new Promise(r => setTimeout(r, DELAY))
      }
    }
    setFetchingAllInsights(false)
  }, [accounts, selectedIds, settings])

  const [confirmDelete, setConfirmDelete] = useState(null)

  const removeSelected = () => {
    const names = accounts.filter(a => selectedIds.has(a.id)).map(a => `@${a.username}`).join(', ')
    setConfirmDelete({ type: 'bulk', ids: [...selectedIds], label: names, count: selectedIds.size })
  }

  useEffect(() => { saveAccounts(accounts) }, [accounts])
  useEffect(() => { saveSettings(settings) }, [settings])

  const [statusFilter, setStatusFilter] = useState('all')

  const getDuplicateCaptions = (accountId) => {
    const posts = cacheGet(`posts:${accountId}:10`, (settings?.cacheTTLPosts ?? 30) * 60 * 1000 || 30 * 60 * 1000)
    if (!posts || posts.length < 2) return []
    const seen = new Map()
    const dupes = []
    for (const p of posts) {
      const text = (p.text || '').trim()
      if (!text) continue
      if (seen.has(text)) {
        if (!dupes.includes(text)) dupes.push(text)
      } else {
        seen.set(text, p.id)
      }
    }
    return dupes
  }

  const getLastPostAge = (accountId) => {
    const posts = cacheGet(`posts:${accountId}:10`, (settings?.cacheTTLPosts ?? 30) * 60 * 1000 || 30 * 60 * 1000)
    if (!posts || posts.length === 0) return null
    const ts = posts[0].timestamp
    if (!ts) return null
    return Date.now() - new Date(ts).getTime()
  }

  const isAccountLocked = (account) => {
    const url = account.avatar || ''
    if (!url) return false
    return url.includes('573323465_1219825463302212_7278921664109726296_n')
  }

  const isTokenDead = (account) => {
    return (account.error || '').toLowerCase().includes('access deactivated')
  }

  const isTokenBlocked = (account) => {
    return (account.error || '').toLowerCase().includes('access blocked')
  }

  const accountsWithTokenCheck = useMemo(() => {
    return accounts.map(a => {
      if (isAccountLocked(a) && a.status !== 'locked') {
        return { ...a, status: 'locked', error: 'Tài khoản bị khoá (avatar trắng)' }
      }
      if (isTokenDead(a) && a.status !== 'error') {
        return { ...a, status: 'error', error: a.error || 'Token die' }
      }
      if (isTokenBlocked(a) && a.status !== 'blocked') {
        return { ...a, status: 'blocked', error: a.error || 'Token bị block tạm thời' }
      }
      return a
    })
  }, [accounts])

  const accountHealthMap = useMemo(() => {
    const map = {}
    for (const a of accountsWithTokenCheck) {
      const dupes = getDuplicateCaptions(a.id)
      const age = getLastPostAge(a.id)
      const stale = age !== null && age > 24 * 60 * 60 * 1000
      map[a.id] = (dupes.length > 0 || stale) ? 'abnormal' : 'normal'
    }
    return map
  }, [accounts, settings])

  const stats = useMemo(() => ({
    total: accountsWithTokenCheck.length,
    ok: accountsWithTokenCheck.filter(a => a.status === 'ok').length,
    err: accountsWithTokenCheck.filter(a => a.status === 'error').length,
    locked: accountsWithTokenCheck.filter(a => a.status === 'locked').length,
    blocked: accountsWithTokenCheck.filter(a => a.status === 'blocked').length,
    abnormal: accountsWithTokenCheck.filter(a => accountHealthMap[a.id] === 'abnormal').length,
    normal: accountsWithTokenCheck.filter(a => accountHealthMap[a.id] === 'normal' && a.status !== 'error' && a.status !== 'locked' && a.status !== 'blocked').length,
  }), [accountsWithTokenCheck, accountHealthMap])

  const filtered = accountsWithTokenCheck.filter(a => {
    const q = query.toLowerCase()
    const matchQuery = !q || (a.username || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q)
    if (!matchQuery) return false
    if (statusFilter === 'abnormal') return accountHealthMap[a.id] === 'abnormal'
    if (statusFilter === 'normal') return accountHealthMap[a.id] === 'normal' && a.status !== 'error' && a.status !== 'locked' && a.status !== 'blocked'
    if (statusFilter === 'ok') return a.status === 'ok'
    if (statusFilter === 'error') return a.status === 'error'
    if (statusFilter === 'locked') return a.status === 'locked'
    if (statusFilter === 'blocked') return a.status === 'blocked'
    return true
  })

  const handleAdd = async (e) => {
    e?.preventDefault?.()
    setAddError('')
    if (!token.trim()) { setAddError('Vui lòng nhập access token'); return }
    setAdding(true)
    try {
      const info = await fetchMe(token.trim(), { settings })
      const next = {
        id: info.id,
        username: info.username,
        name: info.name,
        avatar: info.threads_profile_picture_url,
        bio: info.threads_biography,
        token: token.trim(),
        status: 'ok',
        lastCheck: Date.now(),
        error: '',
      }
      setAccounts(prev => {
        const exists = prev.some(a => a.username === info.username)
        if (exists) return prev.map(a => a.username === info.username ? next : a)
        return [next, ...prev]
      })
      setToken('')
    } catch (err) {
      setAddError(err.message || 'Không lấy được thông tin tài khoản')
    } finally {
      setAdding(false)
    }
  }

  const refreshOne = async (id) => {
    const acc = accounts.find(a => a.id === id)
    if (!acc) return
    setAccounts(prev => prev.map(a => a.id === id ? { ...a, status: 'loading' } : a))
    try {
      const info = await fetchMe(acc.token, { settings, skipCache: true })
      setAccounts(prev => prev.map(a => a.id === id ? {
        ...a,
        username: info.username,
        name: info.name,
        avatar: info.threads_profile_picture_url,
        bio: info.threads_biography,
        status: 'ok',
        error: '',
        lastCheck: Date.now(),
      } : a))
    } catch (err) {
      setAccounts(prev => prev.map(a => a.id === id ? {
        ...a, status: 'error', error: err.message, lastCheck: Date.now(),
      } : a))
    }
  }

  const remove = (id) => {
    const acc = accounts.find(a => a.id === id)
    setConfirmDelete({ type: 'single', id, label: acc ? `@${acc.username}` : id })
  }

  const confirmRemove = () => {
    if (!confirmDelete) return
    if (confirmDelete.type === 'single') {
      setAccounts(prev => prev.filter(a => a.id !== confirmDelete.id))
    } else {
      const idsSet = new Set(confirmDelete.ids)
      setAccounts(prev => prev.filter(a => !idsSet.has(a.id)))
      setSelectedIds(new Set())
    }
    setConfirmDelete(null)
  }

  const [refreshingAll, setRefreshingAll] = useState(false)
  const refreshAll = useCallback(async () => {
    setRefreshingAll(true)
    const DELAY = (settings?.bulkDelay ?? 5) * 1000
    for (let i = 0; i < accounts.length; i++) {
      const acc = accounts[i]
      setAccounts(prev => prev.map(a => a.id === acc.id ? { ...a, status: 'loading' } : a))
      try {
        const info = await fetchMe(acc.token, { settings, skipCache: true })
        setAccounts(prev => prev.map(a => a.id === acc.id ? {
          ...a,
          username: info.username,
          name: info.name,
          avatar: info.threads_profile_picture_url,
          bio: info.threads_biography,
          status: 'ok',
          error: '',
          lastCheck: Date.now(),
        } : a))
      } catch (err) {
        setAccounts(prev => prev.map(a => a.id === acc.id ? {
          ...a, status: 'error', error: err.message, lastCheck: Date.now(),
        } : a))
      }
      if (i < accounts.length - 1) await new Promise(r => setTimeout(r, DELAY))
    }
    setRefreshingAll(false)
  }, [accounts, settings])

  const handleBulkImport = useCallback(async () => {
    const tokens = bulkText
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
    if (tokens.length === 0) return
    setBulkRunning(true)
    setBulkLog([])
    setBulkProgress({ done: 0, total: tokens.length })
    bulkAbort.current = false

    const DELAY = (settings?.bulkDelay ?? 5) * 1000

    for (let i = 0; i < tokens.length; i++) {
      if (bulkAbort.current) {
        setBulkLog(prev => [...prev, { token: tokens[i], ok: false, msg: 'Đã dừng bởi người dùng' }])
        break
      }
      const t = tokens[i]
      try {
        const info = await fetchMe(t, { settings })
        const updated = {
          id: info.id,
          username: info.username,
          name: info.name,
          avatar: info.threads_profile_picture_url,
          bio: info.threads_biography,
          token: t,
          status: 'ok',
          lastCheck: Date.now(),
          error: '',
        }
        setAccounts(prev => {
          const exists = prev.some(a => a.username === info.username)
          if (exists) {
            setBulkLog(p => [...p, { token: t, ok: true, msg: `Cập nhật: @${info.username}` }])
            return prev.map(a => a.username === info.username ? updated : a)
          }
          setBulkLog(p => [...p, { token: t, ok: true, msg: `@${info.username}` }])
          return [updated, ...prev]
        })
      } catch (err) {
        setBulkLog(prev => [...prev, { token: t, ok: false, msg: err.message }])
      }
      setBulkProgress({ done: i + 1, total: tokens.length })
      if (i < tokens.length - 1 && !bulkAbort.current) {
        await new Promise(r => setTimeout(r, DELAY))
      }
    }
    setBulkRunning(false)
  }, [bulkText, settings])

  return (
    <div className="min-h-screen text-neutral-900 dark:text-neutral-100 bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 grid place-items-center">
              <Stethoscope className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Threads Doctor</h1>
              <p className="text-xs text-neutral-400 dark:text-neutral-400">Quản lý tài khoản Threads bằng access token</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-sm"
              title={dark ? 'Light mode' : 'Dark mode'}
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => navigate('/interact')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium"
            >
              <Search className="w-4 h-4" /> Tương tác
            </button>
            <button
              onClick={() => setShowSettings(v => !v)}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-sm"
            >
              <Settings className="w-4 h-4" /> Cài đặt
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {showSettings && (
          <SettingsPanel settings={settings} setSettings={setSettings} />
        )}

        <section className="grid grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-4">
          <button onClick={() => setStatusFilter('all')} className="text-left">
            <StatCard label="Tổng" value={stats.total} tone="text-neutral-700 dark:text-neutral-200" icon={<User className="w-4 h-4" />} />
          </button>
          <button onClick={() => setStatusFilter(f => f === 'ok' ? 'all' : 'ok')} className="text-left">
            <StatCard label="Hoạt động" value={stats.ok} tone={`text-emerald-400 ${statusFilter === 'ok' ? 'ring-2 ring-emerald-500 rounded-2xl' : ''}`} icon={<CheckCircle2 className="w-4 h-4" />} />
          </button>
          <button onClick={() => setStatusFilter(f => f === 'error' ? 'all' : 'error')} className="text-left">
            <StatCard label="Token die" value={stats.err} tone={`text-rose-400 ${statusFilter === 'error' ? 'ring-2 ring-rose-500 rounded-2xl' : ''}`} icon={<AlertTriangle className="w-4 h-4" />} />
          </button>
          <button onClick={() => setStatusFilter(f => f === 'locked' ? 'all' : 'locked')} className="text-left">
            <StatCard label="Bị khoá" value={stats.locked} tone={`text-orange-400 ${statusFilter === 'locked' ? 'ring-2 ring-orange-500 rounded-2xl' : ''}`} icon={<Lock className="w-4 h-4" />} />
          </button>
          <button onClick={() => setStatusFilter(f => f === 'blocked' ? 'all' : 'blocked')} className="text-left">
            <StatCard label="Bị block" value={stats.blocked} tone={`text-amber-400 ${statusFilter === 'blocked' ? 'ring-2 ring-amber-500 rounded-2xl' : ''}`} icon={<AlertTriangle className="w-4 h-4" />} />
          </button>
          <button onClick={() => setStatusFilter(f => f === 'normal' ? 'all' : 'normal')} className="text-left">
            <StatCard label="Bình thường" value={stats.normal} tone={`text-emerald-500 ${statusFilter === 'normal' ? 'ring-2 ring-emerald-500 rounded-2xl' : ''}`} icon={<CheckCircle2 className="w-4 h-4" />} />
          </button>
          <button onClick={() => setStatusFilter(f => f === 'abnormal' ? 'all' : 'abnormal')} className="text-left">
            <StatCard label="Bất thường" value={stats.abnormal} tone={`text-rose-500 ${statusFilter === 'abnormal' ? 'ring-2 ring-rose-500 rounded-2xl' : ''}`} icon={<AlertTriangle className="w-4 h-4" />} />
          </button>
        </section>

        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-400" />
              <h2 className="font-medium">Thêm tài khoản</h2>
            </div>
            <button
              onClick={() => setShowBulk(v => !v)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 text-xs"
            >
              <List className="w-3.5 h-3.5" />
              {showBulk ? 'Thêm đơn' : 'Nạp hàng loạt'}
            </button>
          </div>

          {!showBulk ? (
            <form onSubmit={handleAdd} className="space-y-3">
              <label className="block">
                <span className="text-xs text-neutral-400 dark:text-neutral-400 flex items-center gap-1 mb-1">
                  <KeyRound className="w-3 h-3" /> Access token
                </span>
                <input
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  placeholder="THAAA..."
                  className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm font-mono"
                />
              </label>
              {addError && (
                <div className="text-xs text-rose-400 flex items-center gap-2">
                  <AlertTriangle className="w-3 h-3" /> {addError}
                </div>
              )}
              <div className="flex items-center justify-end">
                <button
                  type="submit"
                  disabled={adding}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-sm font-medium"
                >
                  {adding ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                  {adding ? 'Đang kiểm tra...' : 'Thêm tài khoản'}
                </button>
              </div>
            </form>
          ) : (
            <BulkImportPanel
              bulkText={bulkText}
              setBulkText={setBulkText}
              bulkRunning={bulkRunning}
              bulkLog={bulkLog}
              bulkProgress={bulkProgress}
              onStart={handleBulkImport}
              onStop={() => { bulkAbort.current = true }}
            />
          )}
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">Tài khoản ({filtered.length})</h2>
              {statusFilter !== 'all' && (
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    statusFilter === 'abnormal' || statusFilter === 'error' || statusFilter === 'locked' || statusFilter === 'blocked' ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400'
                    : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {{ all: 'Tổng', ok: 'Hoạt động', error: 'Token die', locked: 'Bị khoá', blocked: 'Bị block', normal: 'Bình thường', abnormal: 'Bất thường' }[statusFilter]}
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={selectedIds.size === filtered.length && filtered.length > 0 ? selectNone : selectAll}
                disabled={filtered.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 disabled:opacity-50 text-xs"
              >
                {selectedIds.size === filtered.length && filtered.length > 0
                  ? <><CheckSquare className="w-3.5 h-3.5" /> Bỏ chọn</>
                  : <><Square className="w-3.5 h-3.5" /> Chọn tất cả</>}
              </button>
              <button
                onClick={refreshAll}
                disabled={refreshingAll || accounts.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 disabled:opacity-50 text-xs"
                title="Làm mới toàn bộ (tuần tự)"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${refreshingAll ? 'animate-spin' : ''}`} />
                {refreshingAll ? 'Đang refresh...' : 'Refresh All'}
              </button>
              <div className="relative">
                {resolvingUrl ? <RefreshCw className="w-4 h-4 text-indigo-400 animate-spin absolute left-3 top-1/2 -translate-y-1/2" /> : <Search className="w-4 h-4 text-neutral-400 dark:text-neutral-500 absolute left-3 top-1/2 -translate-y-1/2" />}
                <input
                  value={query}
                  onChange={handleQueryChange}
                  disabled={resolvingUrl}
                  placeholder="Tìm username / tên / paste URL Threads..."
                  className="pl-9 pr-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm disabled:opacity-50"
                />
              </div>
              {urlMsg && <span className="text-xs text-amber-400">{urlMsg}</span>}
            </div>
          </div>

          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 rounded-xl border border-indigo-500/30 bg-indigo-500/5">
              <span className="text-sm text-indigo-300">{selectedIds.size} đã chọn</span>
              <div className="flex-1" />
              <button
                onClick={fetchAllPosts}
                disabled={fetchingAllPosts}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-xs font-medium"
              >
                {fetchingAllPosts
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {fetchPostsProgress.done}/{fetchPostsProgress.total}</>
                  : <><Download className="w-3.5 h-3.5" /> Lấy posts</>}
              </button>
              {fetchingAllPosts && (
                <button
                  onClick={() => { fetchPostsAbort.current = true }}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-rose-800 text-rose-400 hover:bg-rose-500/10 text-xs"
                >
                  <X className="w-3.5 h-3.5" /> Dừng
                </button>
              )}
              <button
                onClick={fetchAllInsights}
                disabled={fetchingAllInsights || fetchingAllPosts}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-xs font-medium text-white"
              >
                {fetchingAllInsights
                  ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {fetchInsightsProgress.done}/{fetchInsightsProgress.total}</>
                  : <><Download className="w-3.5 h-3.5" /> Lấy insights</>}
              </button>
              {fetchingAllInsights && (
                <button
                  onClick={() => { fetchInsightsAbort.current = true }}
                  className="inline-flex items-center gap-1 px-2 py-1.5 rounded-lg border border-rose-800 text-rose-400 hover:bg-rose-500/10 text-xs"
                >
                  <X className="w-3.5 h-3.5" /> Dừng
                </button>
              )}
              <button
                onClick={removeSelected}
                disabled={fetchingAllPosts}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-rose-800 text-rose-400 hover:bg-rose-500/10 disabled:opacity-50 text-xs"
              >
                <Trash2 className="w-3.5 h-3.5" /> Xóa đã chọn
              </button>
            </div>
          )}

          <div className="grid md:grid-cols-2 gap-3">
            {filtered.map(a => (
              <AccountCard
                key={a.id}
                account={a}
                settings={settings}
                selected={selectedIds.has(a.id)}
                onToggleSelect={() => toggleSelect(a.id)}
                onRefresh={refreshOne}
                onRemove={remove}
                onOpen={(id) => navigate('/' + id)}
                duplicateCaptions={getDuplicateCaptions(a.id)}
                fetchTick={postsFetchTick}
                followersBaseline={followersBaseline}
                setFollowersBaseline={setFollowersBaseline}
              />
            ))}
            {filtered.length === 0 && (
              <div className="md:col-span-2 text-center text-sm text-neutral-400 dark:text-neutral-500 py-10 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-xl">
                Chưa có tài khoản nào. Thêm token ở trên để bắt đầu.
              </div>
            )}
          </div>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-6 text-xs text-neutral-400 dark:text-neutral-600">
        Threads Doctor · {new Date().getFullYear()}
      </footer>

      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmDelete(null)}>
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-rose-400 dark:text-rose-400 mb-3">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-semibold">Xác nhận xóa</h3>
            </div>
            <p className="text-sm text-neutral-300 mb-1">
              {confirmDelete.type === 'single'
                ? <>Bạn có chắc muốn xóa tài khoản <strong>{confirmDelete.label}</strong>?</>
                : <>Bạn có chắc muốn xóa <strong>{confirmDelete.count} tài khoản</strong>?</>}
            </p>
            {confirmDelete.type === 'bulk' && (
              <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-4 line-clamp-2">{confirmDelete.label}</p>
            )}
            <p className="text-xs text-neutral-400 dark:text-neutral-500 mb-4">
              Token sẽ bị xóa khỏi tool. Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmDelete(null)}
                className="px-4 py-2 rounded-lg border border-neutral-700 hover:bg-neutral-200 dark:bg-neutral-800 text-sm"
              >
                Hủy
              </button>
              <button
                onClick={confirmRemove}
                className="px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm font-medium"
              >
                Xóa
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function StatCard({ icon, label, value, tone }) {
  return (
    <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-4">
      <div className={`flex items-center gap-2 ${tone}`}>{icon}<span className="text-xs">{label}</span></div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  )
}

function SettingsPanel({ settings, setSettings }) {
  const [webhookUrl, setWebhookUrl] = useState(settings.webhookUrl || '')
  const [apiKey, setApiKey] = useState(settings.apiKey || '')
  const [bulkDelay, setBulkDelay] = useState(settings.bulkDelay ?? 5)
  const [openaiApiKey, setOpenaiApiKey] = useState(settings.openaiApiKey || '')
  const [openaiModel, setOpenaiModel] = useState(settings.openaiModel || 'gpt-4o-mini')
  const [aiLanguage, setAiLanguage] = useState(settings.aiLanguage || 'vi')
  const [aiTone, setAiTone] = useState(settings.aiTone || 'friendly')
  const [savedAt, setSavedAt] = useState(0)
  const [testing, setTesting] = useState(false)
  const [testMsg, setTestMsg] = useState('')

  const isTestUrl = /\/webhook-test\//.test(webhookUrl)

  const handleSave = () => {
    setSettings(prev => ({ ...prev, webhookUrl: webhookUrl.trim(), apiKey: apiKey.trim(), bulkDelay: Math.max(1, Number(bulkDelay) || 5), openaiApiKey: openaiApiKey.trim(), openaiModel: openaiModel || 'gpt-4o-mini', aiLanguage: aiLanguage || 'vi', aiTone: aiTone || 'friendly' }))
    setSavedAt(Date.now())
    setTimeout(() => setSavedAt(0), 2000)
  }

  const handleTest = async () => {
    setTesting(true); setTestMsg('')
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (apiKey.trim()) headers['X-API-Key'] = apiKey.trim()
      const res = await fetch(webhookUrl.trim(), {
        method: 'POST', headers,
        body: JSON.stringify({ action: 'ping' }),
      })
      setTestMsg(`HTTP ${res.status} ${res.ok ? '✓' : '✗'}`)
    } catch (e) {
      setTestMsg('Lỗi: ' + e.message)
    } finally { setTesting(false) }
  }

  return (
    <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-5">
      <div className="flex items-center gap-2 mb-3">
        <Settings className="w-4 h-4 text-indigo-400" />
        <h2 className="font-medium">Cài đặt n8n Backend</h2>
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">Webhook URL</span>
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://.../webhook/<id>"
            className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm font-mono"
          />
          {isTestUrl && (
            <p className="text-xs text-amber-400 mt-1 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" />
              URL chứa <code className="px-1 bg-neutral-200 dark:bg-neutral-800 rounded">/webhook-test/</code> — chỉ sống 1 request sau khi bấm "Listen for test event". Hãy Activate workflow và dùng URL <code className="px-1 bg-neutral-200 dark:bg-neutral-800 rounded">/webhook/</code>.
            </p>
          )}
        </label>
        <label className="block">
          <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">API Key (tùy chọn, header X-API-Key)</span>
          <input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm font-mono"
          />
        </label>
        <label className="block">
          <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">Delay giữa các request hàng loạt (giây)</span>
          <input
            type="number" min="1" max="60" step="1"
            value={bulkDelay}
            onChange={(e) => setBulkDelay(e.target.value)}
            className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm"
          />
          <p className="text-[11px] text-neutral-400 dark:text-neutral-500 mt-1">
            Áp dụng cho: Nạp hàng loạt, Refresh All, Lấy posts, Lấy insights. Tối thiểu 1 giây.
          </p>
        </label>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <p className="text-xs text-neutral-400 dark:text-neutral-500">
            Hiện tại: <code className="px-1 rounded bg-neutral-200 dark:bg-neutral-800">{settings.webhookUrl || '(chưa đặt)'}</code>
          </p>
          <div className="flex items-center gap-2">
            {testMsg && <span className="text-xs text-neutral-400 dark:text-neutral-400">{testMsg}</span>}
            <button
              onClick={handleTest}
              disabled={testing || !webhookUrl.trim()}
              className="px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 disabled:opacity-50 text-sm"
            >
              {testing ? 'Đang test...' : 'Test'}
            </button>
          </div>
        </div>
        <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 space-y-3">
          <div className="flex items-center gap-2 mb-1">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span className="text-sm font-medium">AI (OpenAI / ChatGPT)</span>
          </div>
          <label className="block">
            <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">OpenAI API Key</span>
            <input
              type="password"
              value={openaiApiKey}
              onChange={(e) => setOpenaiApiKey(e.target.value)}
              placeholder="sk-..."
              className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm font-mono"
            />
          </label>
          <label className="block">
            <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">Model</span>
            <select
              value={openaiModel}
              onChange={(e) => setOpenaiModel(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm"
            >
              <option value="gpt-4o-mini">gpt-4o-mini</option>
              <option value="gpt-4o">gpt-4o</option>
              <option value="gpt-4-turbo">gpt-4-turbo</option>
              <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">Ngôn ngữ reply</span>
            <select
              value={aiLanguage}
              onChange={(e) => setAiLanguage(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm"
            >
              <option value="vi">Tiếng Việt</option>
              <option value="en">English</option>
              <option value="auto">Tự động (theo ngôn ngữ reply gốc)</option>
            </select>
          </label>
          <label className="block">
            <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">Giọng điệu</span>
            <select
              value={aiTone}
              onChange={(e) => setAiTone(e.target.value)}
              className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm"
            >
              <option value="friendly">Thân thiện</option>
              <option value="youthful">Trẻ trung</option>
              <option value="serious">Nghiêm túc</option>
              <option value="humorous">Hài hước</option>
              <option value="professional">Chuyên nghiệp</option>
            </select>
          </label>
        </div>
        <div className="border-t border-neutral-200 dark:border-neutral-800 pt-3 space-y-3">
          <CacheSettingsPanel settings={settings} setSettings={setSettings} />
        </div>
        <div className="flex justify-end items-center gap-2 pt-2 border-t border-neutral-200 dark:border-neutral-800">
          {savedAt > 0 && <span className="text-xs text-emerald-400">Đã lưu ✓</span>}
          <button
            onClick={handleSave}
            className="px-4 py-2 rounded-lg bg-neutral-800 dark:bg-neutral-100 text-white dark:text-neutral-900 hover:bg-neutral-700 dark:hover:bg-white text-sm font-medium"
          >
            Lưu tất cả
          </button>
        </div>
      </div>
    </section>
  )
}

function CacheSettingsPanel({ settings, setSettings }) {
  const [ttlProfile, setTtlProfile] = useState(settings.cacheTTLProfile ?? 30)
  const [ttlPosts, setTtlPosts] = useState(settings.cacheTTLPosts ?? 30)
  const [ttlPost, setTtlPost] = useState(settings.cacheTTLPost ?? 30)
  const [ttlInsights, setTtlInsights] = useState(settings.cacheTTLInsights ?? 30)
  const [ttlSearch, setTtlSearch] = useState(settings.cacheTTLSearch ?? 30)
  const [showEntries, setShowEntries] = useState(false)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    setSettings(prev => ({
      ...prev,
      cacheTTLProfile: Math.max(0, Number(ttlProfile) || 0),
      cacheTTLPosts: Math.max(0, Number(ttlPosts) || 0),
      cacheTTLPost: Math.max(0, Number(ttlPost) || 0),
      cacheTTLInsights: Math.max(0, Number(ttlInsights) || 0),
      cacheTTLSearch: Math.max(0, Number(ttlSearch) || 0),
    }))
  }, [ttlProfile, ttlPosts, ttlPost, ttlInsights, ttlSearch])

  const stats = cacheStats()
  const entries = showEntries ? cacheEntries() : []

  const handleClearAll = () => {
    cacheClear()
    setTick(t => t + 1)
  }

  const handleClearType = (prefix) => {
    cacheClear(prefix)
    setTick(t => t + 1)
  }

  const formatAge = (ms) => {
    if (ms < 60_000) return Math.round(ms / 1000) + 's'
    if (ms < 3600_000) return Math.round(ms / 60_000) + 'm'
    return Math.round(ms / 3600_000) + 'h'
  }

  return (
    <div className="space-y-3" key={tick}>
      <div className="flex items-center gap-2">
        <Database className="w-4 h-4 text-indigo-400" />
        <h3 className="text-sm font-medium">Cache</h3>
      </div>

      <div className="rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="text-xs text-neutral-300">
            {stats.count} mục · {formatBytes(stats.bytes)}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowEntries(v => !v)}
              className="text-[11px] text-neutral-400 dark:text-neutral-400 hover:text-neutral-200"
            >
              {showEntries ? 'Ẩn chi tiết' : 'Xem chi tiết'}
            </button>
            <button
              onClick={handleClearAll}
              disabled={stats.count === 0}
              className="px-2 py-1 rounded text-[11px] border border-rose-800/50 text-rose-400 hover:bg-rose-500/10 disabled:opacity-30"
            >
              Xóa tất cả
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          <CacheSizeChip
            label="Profile"
            prefix="me:"
            onClear={() => handleClearType('me:')}
          />
          <CacheSizeChip
            label="Posts"
            prefix="posts:"
            onClear={() => handleClearType('posts:')}
          />
          <CacheSizeChip
            label="Post"
            prefix="post:"
            onClear={() => handleClearType('post:')}
          />
          <CacheSizeChip
            label="Insights"
            prefix="insights:"
            onClear={() => handleClearType('insights:')}
          />
          <CacheSizeChip
            label="Search"
            prefix="search:"
            onClear={() => handleClearType('search:')}
          />
        </div>

        {showEntries && entries.length > 0 && (
          <div className="mt-3 max-h-32 overflow-y-auto space-y-1 border-t border-neutral-200 dark:border-neutral-800 pt-2">
            {entries.map(e => (
              <div key={e.key} className="flex items-center justify-between text-[11px] font-mono">
                <span className="text-neutral-400 dark:text-neutral-400 truncate max-w-[60%]">{e.key}</span>
                <span className="text-neutral-400 dark:text-neutral-500">{formatBytes(e.size)} · {formatAge(e.age)} ago</span>
              </div>
            ))}
          </div>
        )}
        {showEntries && entries.length === 0 && (
          <div className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500 text-center">Cache trống</div>
        )}
      </div>

      <div>
        <div className="text-xs text-neutral-400 dark:text-neutral-400 mb-2">Thời gian lưu cache (phút) — đặt 0 để tắt</div>
        <div className="grid grid-cols-3 md:grid-cols-5 gap-2">
          <label className="block">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Profile</span>
            <input
              type="number" min="0" step="1"
              value={ttlProfile}
              onChange={(e) => setTtlProfile(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm text-center"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">DS posts</span>
            <input
              type="number" min="0" step="1"
              value={ttlPosts}
              onChange={(e) => setTtlPosts(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm text-center"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Chi tiết post</span>
            <input
              type="number" min="0" step="1"
              value={ttlPost}
              onChange={(e) => setTtlPost(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm text-center"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Insights</span>
            <input
              type="number" min="0" step="1"
              value={ttlInsights}
              onChange={(e) => setTtlInsights(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm text-center"
            />
          </label>
          <label className="block">
            <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Tìm kiếm</span>
            <input
              type="number" min="0" step="1"
              value={ttlSearch}
              onChange={(e) => setTtlSearch(e.target.value)}
              className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm text-center"
            />
          </label>
        </div>
      </div>
    </div>
  )
}

function CacheSizeChip({ label, prefix, onClear }) {
  const stats = cacheStats()
  let count = 0, bytes = 0
  try {
    const full = 'td.cache.v1.' + prefix
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (k && k.startsWith(full)) {
        count++
        bytes += (k.length + (localStorage.getItem(k) || '').length) * 2
      }
    }
  } catch {}
  return (
    <div className="rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 px-2 py-1.5 flex items-center justify-between">
      <div>
        <div className="text-[11px] text-neutral-300">{label}</div>
        <div className="text-[10px] text-neutral-400 dark:text-neutral-500">{count} · {formatBytes(bytes)}</div>
      </div>
      {count > 0 && (
        <button onClick={onClear} className="text-[10px] text-rose-400 hover:text-rose-300 ml-1">xóa</button>
      )}
    </div>
  )
}

function BulkImportPanel({ bulkText, setBulkText, bulkRunning, bulkLog, bulkProgress, onStart, onStop }) {
  const logRef = useRef(null)
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [bulkLog])

  const lines = bulkText.split('\n').filter(l => l.trim()).length

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">Dán danh sách token (mỗi dòng 1 token)</span>
        <textarea
          value={bulkText}
          onChange={(e) => setBulkText(e.target.value)}
          disabled={bulkRunning}
          rows={5}
          placeholder={"THAAxxxxxxx1\nTHAAxxxxxxx2\nTHAAxxxxxxx3"}
          className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm font-mono resize-y disabled:opacity-50"
        />
      </label>
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">
          {lines} token{lines !== 1 ? 's' : ''} · xử lý tuần tự, delay 1.5s/token
        </span>
        <div className="flex items-center gap-2">
          {bulkRunning && (
            <button
              onClick={onStop}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-rose-800 text-rose-400 hover:bg-rose-500/10 text-sm"
            >
              <X className="w-4 h-4" /> Dừng
            </button>
          )}
          <button
            onClick={onStart}
            disabled={bulkRunning || lines === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-sm font-medium"
          >
            {bulkRunning
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> {bulkProgress.done}/{bulkProgress.total}</>
              : <><Plus className="w-4 h-4" /> Bắt đầu nạp</>}
          </button>
        </div>
      </div>
      {bulkLog.length > 0 && (
        <div ref={logRef} className="max-h-40 overflow-y-auto rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 p-3 space-y-1">
          {bulkLog.map((l, i) => (
            <div key={i} className={`text-xs font-mono ${l.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
              {l.ok ? '✓' : '✗'} {maskToken(l.token)} — {l.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function CopyBtn({ text, label }) {
  const [copied, setCopied] = useState(false)
  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }
  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-neutral-400 dark:text-neutral-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition"
      title={`Copy ${label}`}
    >
      <ClipboardCopy className="w-3 h-3" />
      {copied ? 'Copied!' : label}
    </button>
  )
}

function formatNum(n) {
  if (n == null) return '—'
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function AccountCard({ account, settings, selected, onToggleSelect, onRefresh, onRemove, onOpen, duplicateCaptions = [], fetchTick = 0, followersBaseline = {}, setFollowersBaseline }) {
  const a = account
  const loading = a.status === 'loading'
  const isErr = a.status === 'error' || a.status === 'locked' || a.status === 'blocked'

  const cached = cacheGet(`posts:${a.id}:10`, (settings?.cacheTTLPosts ?? 30) * 60 * 1000 || 30 * 60 * 1000)
  const [lastPostTime, setLastPostTime] = useState(() => {
    if (cached && cached.length > 0) return cached[0].timestamp || null
    return undefined
  })
  const [fetching, setFetching] = useState(false)

  useEffect(() => {
    if (fetchTick === 0) return
    const fresh = cacheGet(`posts:${a.id}:10`, (settings?.cacheTTLPosts ?? 30) * 60 * 1000 || 30 * 60 * 1000)
    if (fresh && fresh.length > 0) setLastPostTime(fresh[0].timestamp || null)
    else if (fresh) setLastPostTime(null)
  }, [fetchTick])

  const cachedInsights = cacheGet(`insights:${a.id}`, (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || 30 * 60 * 1000)
  const [insights, setInsights] = useState(cachedInsights || undefined)
  const [fetchingInsights, setFetchingInsights] = useState(false)

  const handleGetInsights = async () => {
    setFetchingInsights(true)
    try {
      const data = await fetchInsights(a.id, a.token, { settings })
      setInsights(data)
      if (data?.followers_count != null && setFollowersBaseline) {
        setFollowersBaseline(prev => ({ ...prev, [a.id]: { count: data.followers_count, timestamp: Date.now() } }))
      }
    } catch {
      setInsights(null)
    } finally { setFetchingInsights(false) }
  }

  const handleGetRecent = async () => {
    setFetching(true)
    try {
      const posts = await fetchPosts(a.id, a.token, { settings, limit: 10, skipCache: true })
      setLastPostTime(posts.length > 0 ? posts[0].timestamp : null)
    } catch {
      setLastPostTime(null)
    } finally { setFetching(false) }
  }

  const [fetchingPosts, setFetchingPosts] = useState(false)
  const handleFetchPosts = async () => {
    setFetchingPosts(true)
    try {
      const posts = await fetchPosts(a.id, a.token, { settings, limit: 10, skipCache: true })
      setLastPostTime(posts.length > 0 ? posts[0].timestamp : null)
    } catch {}
    finally { setFetchingPosts(false) }
  }

  const renderLastPost = () => {
    if (lastPostTime === undefined) {
      return (
        <div className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">
          Chưa lấy bài post gần nhất
        </div>
      )
    }
    if (lastPostTime === null) {
      return (
        <div className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500 flex items-center gap-1">
          <Clock className="w-3 h-3" /> Không có bài post nào
        </div>
      )
    }
    const postDate = new Date(lastPostTime)
    const diffMs = Date.now() - postDate.getTime()
    const within24h = diffMs < 24 * 60 * 60 * 1000
    const hours = Math.floor(diffMs / (60 * 60 * 1000))
    const days = Math.floor(hours / 24)
    const timeAgo = days > 0 ? `${days} ngày ${hours % 24} giờ trước` : `${hours} giờ trước`
    return (
      <div className={`mt-2 text-[11px] flex items-center gap-1 ${within24h ? 'text-emerald-400' : 'text-rose-400'}`}>
        <Clock className="w-3 h-3" />
        Post gần nhất: {postDate.toLocaleString()} ({timeAgo})
      </div>
    )
  }

  return (
    <div className={`rounded-xl border p-4 transition ${selected ? 'border-indigo-500 bg-indigo-500/5' : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40'}`}>
      <div className="flex items-start gap-3">
        <button
          onClick={onToggleSelect}
          className="mt-1 shrink-0 text-neutral-400 dark:text-neutral-500 hover:text-indigo-400 transition"
          title={selected ? 'Bỏ chọn' : 'Chọn'}
        >
          {selected
            ? <CheckSquare className="w-5 h-5 text-indigo-400" />
            : <Square className="w-5 h-5" />}
        </button>
        <button onClick={() => onOpen(a.id)} className="w-12 h-12 rounded-full bg-neutral-200 dark:bg-neutral-800 grid place-items-center overflow-hidden shrink-0 hover:ring-2 hover:ring-indigo-500 transition">
          {a.avatar
            ? <img src={a.avatar} alt="" className="w-full h-full object-cover" />
            : <User className="w-5 h-5 text-neutral-400 dark:text-neutral-400" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <button onClick={() => onOpen(a.id)} className="font-medium truncate hover:text-indigo-400 transition text-left">
              @{a.username || '—'}
            </button>
            {isErr
              ? <span className="text-xs text-rose-400 inline-flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> lỗi</span>
              : <span className="text-xs text-emerald-400 inline-flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> ok</span>}
          </div>
          {a.name && <div className="text-xs text-neutral-400 dark:text-neutral-400 truncate">{a.name}</div>}
          {a.bio && <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-1 line-clamp-2">{a.bio}</div>}

          {renderLastPost()}

          {insights === undefined ? (
            <div className="mt-2 text-[11px] text-neutral-400 dark:text-neutral-500">Chưa lấy insights</div>
          ) : insights === null ? (
            <div className="mt-2 text-[11px] text-amber-500 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3" /> Không lấy được insights (có thể thiếu quyền threads_manage_insights)
            </div>
          ) : (
            <div className="mt-2 flex items-center gap-3 flex-wrap text-[11px]">
              {insights.followers_count != null && (
                <span className="text-indigo-400 font-medium inline-flex items-center gap-1">
                  {formatNum(insights.followers_count)} followers
                  {(() => {
                    const bl = followersBaseline[a.id]
                    if (!bl || bl.count === insights.followers_count) return null
                    const d = insights.followers_count - bl.count
                    return (
                      <span className={`inline-flex items-center gap-0.5 ${d > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {d > 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                        {d > 0 ? '+' : ''}{formatNum(d)}
                      </span>
                    )
                  })()}
                </span>
              )}
              {insights.views != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.views)} views</span>}
              {insights.likes != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.likes)} likes</span>}
              {insights.replies != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.replies)} replies</span>}
              {insights.reposts != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.reposts)} reposts</span>}
              {insights.quotes != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.quotes)} quotes</span>}
            </div>
          )}

          <div className="mt-2 flex items-center gap-2 flex-wrap">
            <CopyBtn text={a.id} label="ID" />
            <CopyBtn text={a.token} label="Token" />
            {a.username && <CopyBtn text={a.username} label="Username" />}
            {a.username && (
              <a
                href={`https://www.threads.net/@${a.username}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[11px] text-neutral-400 dark:text-neutral-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition"
                title="Mở profile trên Threads"
              >
                <ExternalLink className="w-3 h-3" /> Profile
              </a>
            )}
          </div>

          {a.status === 'error' && <div className="mt-1 text-[11px] text-rose-400 font-mono">Token die: {a.error}</div>}

          {duplicateCaptions.length > 0 && (
            <div className="mt-2 text-[12px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Phát hiện {duplicateCaptions.length} nội dung trùng lặp 100%
            </div>
          )}
          {a.status === 'locked' && (
            <div className="mt-2 text-[12px] text-orange-600 dark:text-orange-400 font-semibold flex items-center gap-1">
              <Lock className="w-3.5 h-3.5" />
              Tài khoản bị khoá
            </div>
          )}
          {a.status === 'blocked' && (
            <div className="mt-2 text-[12px] text-amber-600 dark:text-amber-400 font-semibold flex items-center gap-1">
              <AlertTriangle className="w-3.5 h-3.5" />
              Token bị block tạm thời
            </div>
          )}
        </div>
        <div className="flex flex-col gap-1">
          <button
            onClick={handleGetInsights}
            disabled={fetchingInsights}
            className="p-2 rounded-lg text-neutral-400 dark:text-neutral-400 hover:text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50"
            title="Lấy insights tài khoản"
          >
            {fetchingInsights ? <RefreshCw className="w-4 h-4 animate-spin" /> : <BarChart2 className="w-4 h-4" />}
          </button>
          <button
            onClick={handleFetchPosts}
            disabled={fetchingPosts}
            className="p-2 rounded-lg text-neutral-400 dark:text-neutral-400 hover:text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50"
            title="Lấy posts"
          >
            {fetchingPosts ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
          </button>
          <button
            onClick={() => onRefresh(a.id)}
            disabled={loading}
            className="p-2 rounded-lg text-neutral-400 dark:text-neutral-400 hover:text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50"
            title="Làm mới"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => onRemove(a.id)}
            className="p-2 rounded-lg text-neutral-400 dark:text-neutral-400 hover:text-rose-400 hover:bg-rose-500/10"
            title="Xóa"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  )
}

function PageShell({ navigate, children, title, subtitle, backTo = '/' }) {
  return (
    <div className="min-h-screen text-neutral-900 dark:text-neutral-100 bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-neutral-200 dark:border-neutral-800 bg-white/80 dark:bg-neutral-950/80 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center gap-3">
          <button
            onClick={() => navigate(backTo)}
            className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>
          <div>
            <h1 className="text-lg font-semibold">{title}</h1>
            {subtitle && <p className="text-xs text-neutral-400 dark:text-neutral-400">{subtitle}</p>}
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}

function ProfileView({ account, settings, navigate, followersBaseline = {}, setFollowersBaseline }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [insights, setInsights] = useState(null)
  const [fetchingInsights, setFetchingInsights] = useState(false)

  const handleFetchInsights = async () => {
    setFetchingInsights(true)
    try {
      const data = await fetchInsights(account.id, account.token, { settings, skipCache: true })
      setInsights(data)
      if (data?.followers_count != null && setFollowersBaseline) {
        setFollowersBaseline(prev => ({ ...prev, [account.id]: { count: data.followers_count, timestamp: Date.now() } }))
      }
    } catch {}
    finally { setFetchingInsights(false) }
  }

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    fetchPosts(account.id, account.token, { settings, limit: 10 })
      .then(list => { if (alive) setPosts(list) })
      .catch(err => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    fetchInsights(account.id, account.token, { settings })
      .then(data => {
        if (alive) {
          setInsights(data)
          if (data?.followers_count != null && setFollowersBaseline) {
            setFollowersBaseline(prev => ({ ...prev, [account.id]: { count: data.followers_count, timestamp: Date.now() } }))
          }
        }
      })
      .catch(() => {})
    return () => { alive = false }
  }, [account.id])

  const [fetchingPosts, setFetchingPosts] = useState(false)

  const handleFetchPosts = async () => {
    setFetchingPosts(true)
    setError('')
    try {
      const list = await fetchPosts(account.id, account.token, { settings, limit: 10, skipCache: true })
      setPosts(list)
    } catch (err) { setError(err.message) }
    finally { setFetchingPosts(false) }
  }

  const [fetchingAllPI, setFetchingAllPI] = useState(false)
  const [allPIProgress, setAllPIProgress] = useState({ done: 0, total: 0 })
  const [allPITick, setAllPITick] = useState(0)

  const handleFetchAllPostInsights = async () => {
    if (posts.length === 0) return
    setFetchingAllPI(true)
    setAllPIProgress({ done: 0, total: posts.length })
    const DELAY = (settings?.bulkDelay ?? 5) * 1000
    for (let i = 0; i < posts.length; i++) {
      try {
        await fetchPostInsights(posts[i].id, account.token, { settings, skipCache: true })
      } catch {}
      setAllPIProgress({ done: i + 1, total: posts.length })
      if (i < posts.length - 1) await new Promise(r => setTimeout(r, DELAY))
    }
    setFetchingAllPI(false)
    setAllPITick(t => t + 1)
  }

  const duplicateTexts = useMemo(() => {
    if (posts.length < 2) return new Set()
    const counts = new Map()
    for (const p of posts) {
      const t = (p.text || '').trim()
      if (!t) continue
      counts.set(t, (counts.get(t) || 0) + 1)
    }
    const dupes = new Set()
    for (const [t, c] of counts) { if (c > 1) dupes.add(t) }
    return dupes
  }, [posts])

  const issues = useMemo(() => {
    const list = []
    if (account.status === 'locked') list.push('Tài khoản bị khoá')
    if (account.status === 'error') list.push('Token die')
    if (account.status === 'blocked') list.push('Token bị block tạm thời')
    if (duplicateTexts.size > 0) list.push(`${duplicateTexts.size} nội dung trùng lặp 100%`)
    if (posts.length > 0) {
      const latest = new Date(posts[0].timestamp)
      if (Date.now() - latest.getTime() > 24 * 60 * 60 * 1000) {
        const days = Math.floor((Date.now() - latest.getTime()) / (24 * 60 * 60 * 1000))
        list.push(`Post gần nhất cách đây ${days} ngày (quá 24h)`)
      }
    }
    return list
  }, [posts, duplicateTexts, account.status])

  const isAbnormal = issues.length > 0

  return (
    <PageShell navigate={navigate} title={`@${account.username}`} subtitle="Chi tiết tài khoản">
      <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-5 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden shrink-0">
            {account.avatar && <img src={account.avatar} alt="" className="w-full h-full object-cover" />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-semibold text-lg">{account.name || account.username}</span>
              <span className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${
                isAbnormal
                  ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400'
                  : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
              }`}>
                {isAbnormal ? <><AlertTriangle className="w-3 h-3" /> Bất thường</> : <><CheckCircle2 className="w-3 h-3" /> Bình thường</>}
              </span>
            </div>
            <a
              href={`https://www.threads.net/@${account.username}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-indigo-500 hover:text-indigo-400 hover:underline"
            >
              @{account.username}
            </a>
            {account.bio && <div className="text-xs text-neutral-400 dark:text-neutral-500 mt-1">{account.bio}</div>}

            {insights && (
              <div className="flex items-center gap-3 flex-wrap mt-2 text-xs">
                {insights.followers_count != null && (
                  <span className="text-indigo-500 font-semibold inline-flex items-center gap-1">
                    {formatNum(insights.followers_count)} followers
                    {(() => {
                      const bl = followersBaseline[account.id]
                      if (!bl || bl.count === insights.followers_count) return null
                      const d = insights.followers_count - bl.count
                      return (
                        <span className={`inline-flex items-center gap-0.5 text-sm font-normal ${d > 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {d > 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                          {d > 0 ? '+' : ''}{formatNum(d)}
                        </span>
                      )
                    })()}
                  </span>
                )}
                {insights.views != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.views)} views</span>}
                {insights.likes != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.likes)} likes</span>}
                {insights.replies != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.replies)} replies</span>}
                {insights.reposts != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.reposts)} reposts</span>}
                {insights.quotes != null && <span className="text-neutral-400 dark:text-neutral-500">{formatNum(insights.quotes)} quotes</span>}
              </div>
            )}
            <button
              onClick={handleFetchInsights}
              disabled={fetchingInsights}
              className="mt-2 inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
            >
              {fetchingInsights ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              {fetchingInsights ? 'Đang lấy...' : 'Lấy insights tài khoản'}
            </button>

            <div className="mt-3 flex items-center gap-2 flex-wrap text-[11px] font-mono text-neutral-400 dark:text-neutral-500">
              <span>id: {account.id}</span>
              <span>·</span>
              <span>token: {maskToken(account.token)}</span>
            </div>
            <div className="mt-1.5 flex items-center gap-2 flex-wrap">
              <CopyBtn text={account.id} label="Copy ID" />
              <CopyBtn text={account.token} label="Copy Token" />
              <CopyBtn text={account.username} label="Copy Username" />
            </div>

            {isAbnormal && (
              <div className="mt-3 rounded-lg border border-rose-300 dark:border-rose-800 bg-rose-50 dark:bg-rose-500/10 p-3">
                <div className="text-xs text-rose-600 dark:text-rose-400 font-semibold mb-1 flex items-center gap-1">
                  <AlertTriangle className="w-3.5 h-3.5" /> Lý do bất thường:
                </div>
                <ul className="list-disc list-inside text-xs text-rose-500 dark:text-rose-300 space-y-0.5">
                  {issues.map((issue, i) => <li key={i}>{issue}</li>)}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
        <h3 className="font-medium">Bài post gần nhất ({posts.length})</h3>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFetchPosts}
            disabled={fetchingPosts}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 text-xs"
          >
            {fetchingPosts ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            {fetchingPosts ? 'Đang lấy...' : 'Lấy posts'}
          </button>
          {posts.length > 0 && (
            <button
              onClick={handleFetchAllPostInsights}
              disabled={fetchingAllPI}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-xs font-medium text-white"
            >
              {fetchingAllPI
                ? <><RefreshCw className="w-3.5 h-3.5 animate-spin" /> {allPIProgress.done}/{allPIProgress.total}</>
                : <><Download className="w-3.5 h-3.5" /> Lấy insights all posts</>}
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-10">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Đang tải...
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-500/10 p-4 text-sm text-rose-400">
          <AlertTriangle className="w-4 h-4 inline mr-2" />{error}
        </div>
      )}
      {!loading && !error && posts.length === 0 && (
        <div className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-10 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-xl">
          Không có bài post nào.
        </div>
      )}
      <div className="grid md:grid-cols-2 gap-3">
        {posts.map(p => {
          const isDupe = duplicateTexts.has((p.text || '').trim())
          const isStale = p.timestamp && (Date.now() - new Date(p.timestamp).getTime() > 24 * 60 * 60 * 1000)
          return (
            <PostCard
              key={p.id}
              post={p}
              account={account}
              settings={settings}
              onClick={() => navigate(`/${account.id}/post/${p.id}`)}
              highlight={isDupe ? 'duplicate' : isStale ? 'stale' : null}
              insightsTick={allPITick}
            />
          )
        })}
      </div>
    </PageShell>
  )
}

function PostCard({ post, onClick, highlight, account, settings, insightsTick = 0 }) {
  const time = post.timestamp ? new Date(post.timestamp).toLocaleString() : ''
  const img = post.thumbnail_url || (post.media_type === 'IMAGE' ? post.media_url : null)
  const borderClass = highlight === 'duplicate'
    ? 'border-rose-400 dark:border-rose-600 bg-rose-50 dark:bg-rose-500/10'
    : highlight === 'stale'
    ? 'border-amber-400 dark:border-amber-600 bg-amber-50 dark:bg-amber-500/10'
    : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40'

  const cachedPI = account ? cacheGet(`post_insights:${post.id}`, (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || 30 * 60 * 1000) : null
  const [pi, setPi] = useState(cachedPI || null)
  const [fetchingPI, setFetchingPI] = useState(false)

  useEffect(() => {
    if (insightsTick === 0) return
    const fresh = cacheGet(`post_insights:${post.id}`, (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || 30 * 60 * 1000)
    if (fresh) setPi(fresh)
  }, [insightsTick])

  const handleFetchPI = async (e) => {
    e.stopPropagation()
    if (!account) return
    setFetchingPI(true)
    try {
      const data = await fetchPostInsights(post.id, account.token, { settings, skipCache: true })
      setPi(data)
    } catch {}
    finally { setFetchingPI(false) }
  }

  return (
    <div className={`rounded-xl border ${borderClass} transition`}>
      <button
        onClick={onClick}
        className="text-left w-full p-4 hover:bg-neutral-200/50 dark:hover:bg-neutral-900/50 rounded-t-xl transition"
      >
        <div className="flex items-start gap-3">
          {img ? (
            <img src={img} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0" />
          ) : (
            <div className="w-20 h-20 rounded-lg bg-neutral-200 dark:bg-neutral-800 grid place-items-center shrink-0">
              {post.media_type === 'VIDEO' ? <ImageIcon className="w-6 h-6 text-neutral-400 dark:text-neutral-500" /> : <MessageSquare className="w-6 h-6 text-neutral-400 dark:text-neutral-500" />}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-xs text-neutral-400 dark:text-neutral-500 mb-1 flex items-center gap-2">
              <span>{post.media_type}</span>
              <span>·</span>
              <span className={highlight === 'stale' ? 'text-rose-500 font-semibold' : ''}>{time}</span>
              {highlight === 'duplicate' && <span className="text-rose-500 dark:text-rose-400 font-semibold">· Trùng lặp</span>}
              {highlight === 'stale' && <span className="text-amber-500 dark:text-amber-400 font-semibold">· Quá 24h</span>}
            </div>
            <div className={`text-sm line-clamp-3 ${highlight === 'duplicate' ? 'text-rose-600 dark:text-rose-300' : ''}`}>{post.text || <em className="text-neutral-400 dark:text-neutral-500">(không có text)</em>}</div>
          </div>
        </div>
      </button>
      {account && (
        <div className="px-4 pb-3 pt-2 border-t border-neutral-100 dark:border-neutral-800/50">
          {pi ? (
            <div className="flex items-center gap-3 flex-wrap text-[11px]">
              {pi.views != null && <span className="text-neutral-500 dark:text-neutral-400">{formatNum(pi.views)} views</span>}
              {pi.likes != null && <span className="text-neutral-500 dark:text-neutral-400">{formatNum(pi.likes)} likes</span>}
              {pi.replies != null && <span className="text-neutral-500 dark:text-neutral-400">{formatNum(pi.replies)} replies</span>}
              {pi.reposts != null && <span className="text-neutral-500 dark:text-neutral-400">{formatNum(pi.reposts)} reposts</span>}
              {pi.quotes != null && <span className="text-neutral-500 dark:text-neutral-400">{formatNum(pi.quotes)} quotes</span>}
              <button onClick={handleFetchPI} disabled={fetchingPI} className="ml-auto text-indigo-400 hover:text-indigo-300 disabled:opacity-50">
                <RefreshCw className={`w-3 h-3 ${fetchingPI ? 'animate-spin' : ''}`} />
              </button>
            </div>
          ) : (
            <button onClick={handleFetchPI} disabled={fetchingPI} className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50">
              {fetchingPI ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Download className="w-3 h-3" />}
              {fetchingPI ? 'Đang lấy...' : 'Lấy insights'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function PostDetailView({ account, postId, settings, navigate }) {
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pi, setPi] = useState(() => cacheGet(`post_insights:${postId}`, (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || 30 * 60 * 1000) || null)
  const [fetchingPI, setFetchingPI] = useState(false)
  const [replies, setReplies] = useState(() => cacheGet(`replies:${postId}`, (settings?.cacheTTLReplies ?? 10) * 60 * 1000 || 10 * 60 * 1000) || [])
  const [loadingReplies, setLoadingReplies] = useState(false)
  const [nextCursor, setNextCursor] = useState(null)
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [replyingTo, setReplyingTo] = useState(null)
  const [replyText, setReplyText] = useState('')
  const [generatingAI, setGeneratingAI] = useState(false)
  const [sendingReply, setSendingReply] = useState(false)
  const [replyStatus, setReplyStatus] = useState('')

  const handleGenerateAI = async (originalReplyText) => {
    if (!settings.openaiApiKey) { setReplyStatus('Chưa cấu hình OpenAI API key trong Settings'); return }
    setGeneratingAI(true); setReplyStatus('')
    try {
      const text = await generateReply({
        apiKey: settings.openaiApiKey,
        model: settings.openaiModel,
        postText: post?.text || '',
        replyText: originalReplyText,
        language: settings.aiLanguage || 'vi',
        tone: settings.aiTone || 'friendly',
      })
      setReplyText(text)
    } catch (err) {
      setReplyStatus('AI lỗi: ' + err.message)
    } finally { setGeneratingAI(false) }
  }

  const handleSendReply = async (replyToId) => {
    if (!replyText.trim()) return
    setSendingReply(true); setReplyStatus('')
    try {
      await postReply(account.id, account.token, { settings, text: replyText.trim(), replyToId })
      setReplyStatus('Đã gửi reply! (đợi 30s để publish)')
      setReplyText('')
      setReplyingTo(null)
      const { replies: fresh, nextCursor: cursor, hasMore: more } = await fetchRepliesPage(postId, account.token, { settings })
      setReplies(fresh); setNextCursor(cursor); setHasMore(more)
    } catch (err) {
      setReplyStatus('Lỗi: ' + err.message)
    } finally { setSendingReply(false) }
  }

  useEffect(() => {
    let alive = true
    setLoading(true); setError('')
    fetchPost(postId, account.token, { settings })
      .then(p => { if (alive) setPost(p) })
      .catch(err => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoading(false) })
    if (!pi) {
      fetchPostInsights(postId, account.token, { settings })
        .then(data => { if (alive) setPi(data) })
        .catch(() => {})
    }
    if (replies.length === 0) {
      setLoadingReplies(true)
      fetchRepliesPage(postId, account.token, { settings })
        .then(({ replies: data, nextCursor: cursor, hasMore: more }) => {
          if (alive) { setReplies(data); setNextCursor(cursor); setHasMore(more) }
        })
        .catch(() => {})
        .finally(() => { if (alive) setLoadingReplies(false) })
    }
    return () => { alive = false }
  }, [postId])

  const handleRefreshPI = async () => {
    setFetchingPI(true)
    try {
      const data = await fetchPostInsights(postId, account.token, { settings, skipCache: true })
      setPi(data)
    } catch {}
    finally { setFetchingPI(false) }
  }

  return (
    <PageShell navigate={navigate} title="Chi tiết bài post" subtitle={`@${account.username}`} backTo={`/${account.id}`}>
      {loading && (
        <div className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-10">
          <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Đang tải...
        </div>
      )}
      {error && (
        <div className="rounded-lg border border-rose-800 bg-rose-500/10 p-4 text-sm text-rose-400">
          <AlertTriangle className="w-4 h-4 inline mr-2" />{error}
        </div>
      )}
      {post && (
        <div className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-6 space-y-4">
          <div className="flex items-center justify-between">
            <div className="text-xs text-neutral-400 dark:text-neutral-500">
              {post.media_type} · {post.timestamp ? new Date(post.timestamp).toLocaleString() : ''}
            </div>
            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
                <ExternalLink className="w-3 h-3" /> Mở trên Threads
              </a>
            )}
          </div>

          {post.text && (
            <div className="whitespace-pre-wrap text-[15px] leading-relaxed">{post.text}</div>
          )}

          {post.media_url && post.media_type === 'IMAGE' && (
            <img src={post.media_url} alt="" className="w-full rounded-xl" />
          )}
          {post.media_url && post.media_type === 'VIDEO' && (
            <video src={post.media_url} controls className="w-full rounded-xl" />
          )}
          {post.thumbnail_url && !post.media_url && (
            <img src={post.thumbnail_url} alt="" className="w-full rounded-xl" />
          )}

          {post.children?.data?.length > 0 && (
            <div>
              <div className="text-xs text-neutral-400 dark:text-neutral-400 mb-2">Media con:</div>
              <div className="grid grid-cols-3 gap-2">
                {post.children.data.map(c => (
                  <div key={c.id} className="rounded-lg bg-neutral-200 dark:bg-neutral-800 aspect-square overflow-hidden">
                    {c.media_url && <img src={c.media_url} alt="" className="w-full h-full object-cover" />}
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center gap-4 flex-wrap py-3 border-t border-neutral-200 dark:border-neutral-800">
            <span className="text-xs font-medium text-neutral-500 dark:text-neutral-400">Insights:</span>
            {pi ? (
              <>
                {pi.views != null && <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatNum(pi.views)} views</span>}
                {pi.likes != null && <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatNum(pi.likes)} likes</span>}
                {pi.replies != null && <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatNum(pi.replies)} replies</span>}
                {pi.reposts != null && <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatNum(pi.reposts)} reposts</span>}
                {pi.quotes != null && <span className="text-xs text-neutral-500 dark:text-neutral-400">{formatNum(pi.quotes)} quotes</span>}
                <button onClick={handleRefreshPI} disabled={fetchingPI} className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50">
                  <RefreshCw className={`w-3.5 h-3.5 ${fetchingPI ? 'animate-spin' : ''}`} />
                </button>
              </>
            ) : (
              <button onClick={handleRefreshPI} disabled={fetchingPI} className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50">
                {fetchingPI ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {fetchingPI ? 'Đang lấy...' : 'Lấy insights'}
              </button>
            )}
          </div>

          <dl className="grid grid-cols-2 gap-2 text-xs font-mono pt-4 border-t border-neutral-200 dark:border-neutral-800">
            <dt className="text-neutral-400 dark:text-neutral-500">ID</dt><dd className="truncate">{post.id}</dd>
            {post.shortcode && (<><dt className="text-neutral-400 dark:text-neutral-500">Shortcode</dt><dd>{post.shortcode}</dd></>)}
            {post.is_quote_post != null && (<><dt className="text-neutral-400 dark:text-neutral-500">Quote</dt><dd>{String(post.is_quote_post)}</dd></>)}
            {post.link_attachment_url && (<><dt className="text-neutral-400 dark:text-neutral-500">Link</dt><dd className="truncate"><a href={post.link_attachment_url} target="_blank" rel="noreferrer" className="text-indigo-400">{post.link_attachment_url}</a></dd></>)}
            {post.topic_tag && (<><dt className="text-neutral-400 dark:text-neutral-500">Topic</dt><dd>{post.topic_tag}</dd></>)}
          </dl>
        </div>
      )}

      {post && (
        <div className="mt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-medium">Replies ({replies.length})</h3>
            <button
              onClick={async () => {
                setLoadingReplies(true)
                try {
                  const { replies: data, nextCursor: cursor, hasMore: more } = await fetchRepliesPage(postId, account.token, { settings })
                  setReplies(data); setNextCursor(cursor); setHasMore(more)
                } catch {}
                finally { setLoadingReplies(false) }
              }}
              disabled={loadingReplies}
              className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingReplies ? 'animate-spin' : ''}`} />
              {loadingReplies ? 'Đang tải...' : 'Làm mới'}
            </button>
          </div>

          {loadingReplies && replies.length === 0 && (
            <div className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-6">
              <RefreshCw className="w-4 h-4 animate-spin mx-auto mb-2" /> Đang tải replies...
            </div>
          )}
          {!loadingReplies && replies.length === 0 && (
            <div className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-6 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-xl">
              Không có replies.
            </div>
          )}
          <div className="space-y-2">
            {replies.map(r => (
              <div key={r.id} className={`rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 ${r._parentUsername ? 'ml-6 border-l-2 border-l-indigo-500/30' : ''}`}>
                <div className="p-3">
                  {r._parentUsername && (
                    <div className="text-[10px] text-neutral-400 dark:text-neutral-500 mb-1">trả lời @{r._parentUsername}</div>
                  )}
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-semibold text-indigo-400">@{r.username || 'unknown'}</span>
                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500">·</span>
                    <span className="text-[11px] text-neutral-400 dark:text-neutral-500">{r.timestamp ? new Date(r.timestamp).toLocaleString() : ''}</span>
                    <div className="ml-auto flex items-center gap-1">
                      {r.permalink && (
                        <a href={r.permalink} target="_blank" rel="noopener noreferrer" className="text-neutral-400 hover:text-indigo-400">
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      <button
                        onClick={() => { setReplyingTo(replyingTo === r.id ? null : r.id); setReplyText(''); setReplyStatus('') }}
                        className={`p-1 rounded text-neutral-400 hover:text-indigo-400 hover:bg-indigo-500/10 transition ${replyingTo === r.id ? 'text-indigo-400 bg-indigo-500/10' : ''}`}
                        title="Reply"
                      >
                        <MessageSquare className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                  <div className="text-sm">{r.text || <em className="text-neutral-400 dark:text-neutral-500">(không có text)</em>}</div>
                  {r.media_url && r.media_type === 'IMAGE' && (
                    <img src={r.media_url} alt="" className="mt-2 rounded-lg max-h-40 object-cover" />
                  )}
                </div>
                {replyingTo === r.id && (
                  <div className="px-3 pb-3 pt-1 border-t border-neutral-100 dark:border-neutral-800/50 space-y-2">
                    <textarea
                      value={replyText}
                      onChange={(e) => setReplyText(e.target.value)}
                      placeholder="Viết reply..."
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleGenerateAI(r.text || '')}
                        disabled={generatingAI}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-indigo-500/30 text-indigo-400 hover:bg-indigo-500/10 disabled:opacity-50 text-xs"
                      >
                        {generatingAI ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
                        {generatingAI ? 'Đang tạo...' : 'AI'}
                      </button>
                      <div className="flex-1" />
                      {replyStatus && <span className="text-[11px] text-neutral-400">{replyStatus}</span>}
                      <button
                        onClick={() => { setReplyingTo(null); setReplyText(''); setReplyStatus('') }}
                        className="px-2.5 py-1.5 rounded-lg text-xs text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-800"
                      >
                        Hủy
                      </button>
                      <button
                        onClick={() => handleSendReply(r.id)}
                        disabled={sendingReply || !replyText.trim()}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-50 text-xs font-medium text-white"
                      >
                        {sendingReply ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                        {sendingReply ? 'Đang gửi...' : 'Gửi'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
          {hasMore && (
            <div className="mt-3 text-center">
              <button
                onClick={async () => {
                  setLoadingMore(true)
                  try {
                    const { replies: more, nextCursor: cursor, hasMore: moreLeft } = await fetchRepliesPage(postId, account.token, { settings, after: nextCursor })
                    setReplies(prev => [...prev, ...more])
                    setNextCursor(cursor)
                    setHasMore(moreLeft)
                  } catch {}
                  finally { setLoadingMore(false) }
                }}
                disabled={loadingMore}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50 text-sm"
              >
                {loadingMore ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {loadingMore ? 'Đang tải...' : 'Tải thêm replies'}
              </button>
            </div>
          )}
        </div>
      )}
    </PageShell>
  )
}

function InteractView({ accounts, settings, navigate }) {
  const [selectedAccountId, setSelectedAccountId] = useState(accounts[0]?.id || '')
  const [q, setQ] = useState('')
  const [searchType, setSearchType] = useState('')
  const [searchMode, setSearchMode] = useState('')
  const [mediaType, setMediaType] = useState('')
  const [authorUsername, setAuthorUsername] = useState('')
  const [sinceDate, setSinceDate] = useState('')
  const [untilDate, setUntilDate] = useState('')
  const [limit, setLimit] = useState(25)
  const [showFilters, setShowFilters] = useState(false)

  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [searched, setSearched] = useState(false)

  const selectedAccount = accounts.find(a => a.id === selectedAccountId)

  const handleSearch = async (e) => {
    e?.preventDefault?.()
    if (!q.trim()) return
    if (!selectedAccount) { setError('Chọn tài khoản trước'); return }
    setSearching(true); setError(''); setResults([]); setSearched(true)
    try {
      const params = {
        settings,
        q: q.trim(),
      }
      if (searchType) params.searchType = searchType
      if (searchMode) params.searchMode = searchMode
      if (mediaType) params.mediaType = mediaType
      if (authorUsername.trim()) params.authorUsername = authorUsername.trim()
      if (sinceDate) params.since = Math.floor(new Date(sinceDate).getTime() / 1000)
      if (untilDate) params.until = Math.floor(new Date(untilDate).getTime() / 1000)
      if (limit && limit !== 25) params.limit = limit

      const data = await searchKeyword(selectedAccount.token, params)
      setResults(data)
    } catch (err) {
      setError(err.message)
    } finally { setSearching(false) }
  }

  return (
    <PageShell navigate={navigate} title="Tương tác" subtitle="Tìm kiếm bài viết trên Threads">
      <div className="space-y-6">
        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-5 space-y-4">
          <div className="flex items-center gap-2 mb-1">
            <Search className="w-4 h-4 text-indigo-400" />
            <h2 className="font-medium">Tìm kiếm</h2>
          </div>

          <div>
            <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">Tài khoản tương tác</span>
            <div className="flex gap-2 flex-wrap">
              {accounts.map(a => (
                <button
                  key={a.id}
                  onClick={() => setSelectedAccountId(a.id)}
                  className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition ${
                    selectedAccountId === a.id
                      ? 'border-indigo-500 bg-indigo-500/10 text-indigo-300'
                      : 'border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-400'
                  }`}
                >
                  <div className="w-6 h-6 rounded-full bg-neutral-200 dark:bg-neutral-800 overflow-hidden shrink-0">
                    {a.avatar && <img src={a.avatar} alt="" className="w-full h-full object-cover" />}
                  </div>
                  @{a.username}
                </button>
              ))}
              {accounts.length === 0 && (
                <span className="text-xs text-neutral-400 dark:text-neutral-500">Chưa có tài khoản — thêm token ở trang chủ trước.</span>
              )}
            </div>
          </div>

          <form onSubmit={handleSearch} className="space-y-3">
            <div className="flex gap-2">
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Nhập từ khóa hoặc tag..."
                className="flex-1 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm"
              />
              <button
                type="submit"
                disabled={searching || !q.trim() || !selectedAccount}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-sm font-medium"
              >
                {searching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                Tìm
              </button>
            </div>

            <button
              type="button"
              onClick={() => setShowFilters(v => !v)}
              className="text-xs text-neutral-400 dark:text-neutral-400 hover:text-neutral-200"
            >
              {showFilters ? '▾ Ẩn bộ lọc' : '▸ Hiện bộ lọc'}
            </button>

            {showFilters && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-3 p-3 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800">
                <label className="block">
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Loại tìm kiếm</span>
                  <select value={searchType} onChange={(e) => setSearchType(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm outline-none">
                    <option value="">Mặc định (TOP)</option>
                    <option value="TOP">TOP</option>
                    <option value="RECENT">RECENT</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Chế độ</span>
                  <select value={searchMode} onChange={(e) => setSearchMode(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm outline-none">
                    <option value="">Mặc định (KEYWORD)</option>
                    <option value="KEYWORD">KEYWORD</option>
                    <option value="TAG">TAG</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Loại media</span>
                  <select value={mediaType} onChange={(e) => setMediaType(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm outline-none">
                    <option value="">Tất cả</option>
                    <option value="TEXT">TEXT</option>
                    <option value="IMAGE">IMAGE</option>
                    <option value="VIDEO">VIDEO</option>
                  </select>
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Tác giả (username)</span>
                  <input value={authorUsername} onChange={(e) => setAuthorUsername(e.target.value)}
                    placeholder="vd: creator.vn"
                    className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm outline-none" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Từ ngày</span>
                  <input type="date" value={sinceDate} onChange={(e) => setSinceDate(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm outline-none" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Đến ngày</span>
                  <input type="date" value={untilDate} onChange={(e) => setUntilDate(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm outline-none" />
                </label>
                <label className="block">
                  <span className="text-[11px] text-neutral-400 dark:text-neutral-500 mb-1 block">Số lượng (max 100)</span>
                  <input type="number" min="1" max="100" value={limit} onChange={(e) => setLimit(e.target.value)}
                    className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-sm outline-none text-center" />
                </label>
              </div>
            )}
          </form>
        </section>

        {error && (
          <div className="rounded-lg border border-rose-800 bg-rose-500/10 p-4 text-sm text-rose-400">
            <AlertTriangle className="w-4 h-4 inline mr-2" />{error}
          </div>
        )}

        {searching && (
          <div className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-10">
            <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2" /> Đang tìm kiếm...
          </div>
        )}

        {!searching && searched && results.length === 0 && !error && (
          <div className="text-center text-sm text-neutral-400 dark:text-neutral-500 py-10 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-xl">
            Không tìm thấy kết quả.
          </div>
        )}

        {results.length > 0 && (
          <section>
            <div className="text-sm text-neutral-400 dark:text-neutral-400 mb-3">Tìm thấy {results.length} kết quả</div>
            <div className="space-y-3">
              {results.map(post => (
                <SearchResultCard key={post.id} post={post} />
              ))}
            </div>
          </section>
        )}
      </div>
    </PageShell>
  )
}

function SearchResultCard({ post }) {
  const time = post.timestamp ? new Date(post.timestamp).toLocaleString() : ''
  const img = post.thumbnail_url || (post.media_type === 'IMAGE' ? post.media_url : null)
  return (
    <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 p-4">
      <div className="flex items-start gap-3">
        {img && (
          <img src={img} alt="" className="w-20 h-20 rounded-lg object-cover shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap text-xs text-neutral-400 dark:text-neutral-500 mb-1">
            <span className="text-neutral-300 font-medium">@{post.username}</span>
            <span>·</span>
            <span>{post.media_type}</span>
            <span>·</span>
            <span>{time}</span>
            {post.is_reply && <span className="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-400">reply</span>}
            {post.is_quote_post && <span className="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-400">quote</span>}
            {post.has_replies && <span className="px-1.5 py-0.5 rounded bg-neutral-200 dark:bg-neutral-800 text-neutral-400 dark:text-neutral-400">has replies</span>}
          </div>
          <div className="text-sm whitespace-pre-wrap line-clamp-4">{post.text || <em className="text-neutral-400 dark:text-neutral-500">(không có text)</em>}</div>
          <div className="mt-2 flex items-center gap-2">
            {post.permalink && (
              <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] text-indigo-400 hover:text-indigo-300">
                <ExternalLink className="w-3 h-3" /> Mở trên Threads
              </a>
            )}
            <CopyBtn text={post.id} label="ID" />
            {post.permalink && <CopyBtn text={post.permalink} label="Link" />}
          </div>
        </div>
      </div>
    </div>
  )
}

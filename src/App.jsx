import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, ArrowDownUp, BarChart2, CheckCircle2, CheckSquare, ChevronLeft, ChevronRight, Clock, ClipboardCopy, Database,
  Download, ExternalLink, Filter, Home, Image as ImageIcon, KeyRound, List, Lock, MessageSquare, Moon, Plus,
  RefreshCw, Search, Send, Settings, Sparkles, Square, Stethoscope, Sun, Trash2, TrendingDown, TrendingUp, User, X,
} from 'lucide-react'
import { fetchMe, fetchPost, fetchPosts, fetchInsights, fetchPostInsights, fetchReplies, fetchRepliesPage, postReply, repostPost, createQuotePost, publishThreadsPost, resolveThreadsUrl, searchKeyword, maskToken, tokenFingerprint } from './lib/threads.js'
import { generateReply } from './lib/ai.js'
import { parseThreadsUrl } from './lib/threads-url.js'
import { loadAccounts, saveAccounts, loadSettings, saveSettings, loadFollowersBaseline, saveFollowersBaseline, loadSchedules, saveSchedules, loadScheduleLogs, saveScheduleLogs, loadAppLogs, saveAppLogs, loadBuffSchedules, saveBuffSchedules, loadBuffLogs, saveBuffLogs, loadBuffFavouriteWorkers, saveBuffFavouriteWorkers } from './lib/storage.js'
import { cacheClear, cacheGet, cacheSet, cacheStats, cacheEntries, formatBytes } from './lib/cache.js'

const APP_VERSION = '0.13.2'
const MAX_SCHEDULE_LOGS = 200
const MAX_APP_LOGS = 1500
const MAX_SCHEDULE_FAILURE_DETAILS = 12
const SCHEDULE_FAILURE_PREVIEW = 3
const LOCKED_AVATAR_SIGNATURE = '573323465_1219825463302212_7278921664109726296_n'

function compactErrorMessage(message, max = 120) {
  const text = String(message || 'Lỗi không xác định').replace(/\s+/g, ' ').trim()
  if (text.length <= max) return text
  return text.slice(0, max - 1) + '…'
}

function bucketScheduleFailureError(message) {
  const text = String(message || '').toLowerCase()
  if (!text) return 'Lỗi khác'
  if (text.includes('404') || text.includes('webhook không tồn tại')) return '404 webhook'
  if (text.includes('access deactivated')) return 'Token deactivated'
  if (text.includes('access blocked')) return 'Token blocked'
  if (text.includes('timeout') || text.includes('timed out')) return 'Timeout'
  if (text.includes('429') || text.includes('rate limit')) return 'Rate limit'
  if (text.includes('network') || text.includes('failed to fetch')) return 'Network'
  if (text.includes('500') || text.includes('502') || text.includes('503') || text.includes('504')) return 'Server error'
  return 'Lỗi khác'
}

function summarizeScheduleFailures(failures = []) {
  const grouped = new Map()
  for (const item of failures || []) {
    const reason = bucketScheduleFailureError(item?.error || item?.message || '')
    grouped.set(reason, (grouped.get(reason) || 0) + 1)
  }
  return Array.from(grouped.entries())
    .map(([reason, count]) => ({ reason, count }))
    .sort((a, b) => b.count - a.count || a.reason.localeCompare(b.reason))
}

function normalizeUsername(raw) {
  const text = String(raw || '').trim().toLowerCase()
  if (!text) return ''

  const profileMatch = text.match(/threads\.(?:net|com)\/@([^/?#]+)/i)
  if (profileMatch?.[1]) return profileMatch[1].replace(/^@+/, '')

  return text.replace(/^@+/, '')
}

function parseBulkUsernames(text) {
  return String(text || '')
    .split(/[\n,;\t ]+/)
    .map((v) => normalizeUsername(v))
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
}

function isAccountLocked(account) {
  const url = account?.avatar || ''
  if (!url) return false
  return url.includes(LOCKED_AVATAR_SIGNATURE)
}

function isTokenDead(account) {
  return (account?.error || '').toLowerCase().includes('access deactivated')
}

function isTokenBlocked(account) {
  return (account?.error || '').toLowerCase().includes('access blocked')
}

function normalizeAccountStatus(account) {
  if (!account) return account
  if (isAccountLocked(account) && account.status !== 'locked') {
    return { ...account, status: 'locked', error: 'Tài khoản bị khoá (avatar trắng)' }
  }
  if (isTokenDead(account) && account.status !== 'error') {
    return { ...account, status: 'error', error: account.error || 'Token die' }
  }
  if (isTokenBlocked(account) && account.status !== 'blocked') {
    return { ...account, status: 'blocked', error: account.error || 'Token bị block tạm thời' }
  }
  return account
}

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
  const [buffFavWorkers, setBuffFavWorkers] = useState(() => loadBuffFavouriteWorkers())
  const buffMeTarget = useRef(null)

  const [buffSchedules, setBuffSchedules] = useState(() => loadBuffSchedules())
  const [buffLogs, setBuffLogs] = useState(() => loadBuffLogs().slice(0, MAX_BUFF_LOGS))
  const [buffRunning, setBuffRunning] = useState(false)
  const [buffProgress, setBuffProgress] = useState(null)
  const buffTimersRef = useRef(new Map())
  const buffRunLockRef = useRef(new Set())
  const runBuffTaskRef = useRef(null)
  const buffAbortRef = useRef(false)

  useEffect(() => { saveFollowersBaseline(followersBaseline) }, [followersBaseline])
  useEffect(() => { saveBuffSchedules(buffSchedules) }, [buffSchedules])
  useEffect(() => { saveBuffLogs(buffLogs) }, [buffLogs])

  const appendRootAppLog = useCallback((entry) => {
    const now = Date.now()
    const id = `app_log_${now}_${Math.random().toString(36).slice(2, 7)}`
    const current = loadAppLogs().slice(0, MAX_APP_LOGS)
    const next = [{
      id,
      at: entry?.at || now,
      level: entry?.level || 'info',
      source: entry?.source || 'system',
      action: entry?.action || 'event',
      message: entry?.message || '',
      meta: entry?.meta || null,
    }, ...current].slice(0, MAX_APP_LOGS)
    saveAppLogs(next)
  }, [])

  const appendBuffLog = useCallback((entry) => {
    setBuffLogs(prev => [{ id: `buff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ...entry }, ...prev].slice(0, MAX_BUFF_LOGS))
  }, [])

  const clearBuffTimer = useCallback((taskId) => {
    const timer = buffTimersRef.current.get(taskId)
    if (timer) { clearTimeout(timer); buffTimersRef.current.delete(taskId) }
  }, [])

  const armBuffTask = useCallback((task) => {
    if (!task || task.status !== 'active' || !task.nextRunAt) return
    clearBuffTimer(task.id)
    const delay = Math.max(0, task.nextRunAt - Date.now())
    const timer = setTimeout(() => { runBuffTaskRef.current?.(task.id) }, delay)
    buffTimersRef.current.set(task.id, timer)
  }, [clearBuffTimer])

  const runBuffTask = useCallback(async (taskId) => {
    if (buffRunLockRef.current.has(taskId)) return
    const task = buffSchedules.find(t => t.id === taskId)
    if (!task || task.status !== 'active') return

    buffRunLockRef.current.add(taskId)
    setBuffSchedules(prev => prev.map(t => t.id === taskId ? { ...t, status: 'running', updatedAt: Date.now() } : t))
    appendRootAppLog({ level: 'info', source: 'buff', action: 'run_start', message: `Buff task bắt đầu: ${taskId}`, meta: { taskId } })
    setBuffRunning(true)
    setBuffProgress({ taskId, done: 0, total: 0, status: 'fetching post' })

    const startedAt = Date.now()
    const bossAcc = accounts.find(a => a.id === task.bossAccountId)
    let chosenPostId = null
    let chosenPermalink = null

    try {
      if (task.postMode === 'random') {
        const posts = await fetchPosts(task.bossAccountId, bossAcc?.token, { settings, limit: 10, skipCache: true })
        if (posts && posts.length > 0) {
          const chosen = posts[Math.floor(Math.random() * posts.length)]
          chosenPostId = chosen.id
          chosenPermalink = chosen.permalink || null
        }
      } else {
        const pool = task.selectedPostIds || []
        if (pool.length > 0) {
          chosenPostId = pool[Math.floor(Math.random() * pool.length)]
          try {
            const detail = await fetchPost(chosenPostId, bossAcc?.token, { settings })
            chosenPermalink = detail?.permalink || null
          } catch {}
        }
      }
      if (task.buffMode === 'quote_post' && chosenPostId && !chosenPermalink) {
        try {
          const detail = await fetchPost(chosenPostId, bossAcc?.token, { settings })
          chosenPermalink = detail?.permalink || null
        } catch {}
      }
    } catch {}

    if (!chosenPostId) {
      appendBuffLog({ at: Date.now(), taskId, type: 'run', success: 0, fail: 0, durationSec: 0, status: 'fail', message: 'Không tìm được post để buff', failures: [], postId: null, permalink: null })
      appendRootAppLog({ level: 'warn', source: 'buff', action: 'run_fail_no_post', message: 'Buff thất bại: không tìm được post để buff', meta: { taskId, mode: task.buffMode || 'repost' } })
      setBuffSchedules(prev => prev.map(t => t.id === taskId ? { ...t, status: task.mode === 'once' ? 'completed' : 'active', updatedAt: Date.now(), lastResult: { ok: 0, fail: 0, durationSec: 0, postId: null } } : t))
      buffRunLockRef.current.delete(taskId)
      setBuffRunning(false)
      setBuffProgress(null)
      return
    }

    const workers = accounts.filter(a => task.workerIds.includes(a.id))
    let ok = 0, fail = 0
    const failureDetails = []
    setBuffProgress({ taskId, done: 0, total: workers.length, status: 'reposting' })
    buffAbortRef.current = false

    for (let i = 0; i < workers.length; i++) {
      if (buffAbortRef.current) break
      const w = workers[i]
      try {
        if (task.buffMode === 'quote_post') {
          const create = await createQuotePost(w.id, w.token, {
            settings,
            text: String(task.linkCaption || '').trim() || '🔁',
            quotePostId: chosenPostId,
          })

          const publishDelaySec = Math.max(1, Number(task.publishDelaySec) || 5)
          const publishRetryCount = Math.max(1, Number(task.publishRetryCount) || 5)
          const publishRetryIntervalSec = Math.max(1, Number(task.publishRetryIntervalSec) || 2)

          await new Promise(r => setTimeout(r, publishDelaySec * 1000))

          let published = null
          let lastPublishError = null
          for (let attempt = 1; attempt <= publishRetryCount; attempt++) {
            try {
              published = await publishThreadsPost(w.id, w.token, { settings, creationId: create.creationId })
              lastPublishError = null
              break
            } catch (err) {
              lastPublishError = err
              if (attempt < publishRetryCount) {
                await new Promise(r => setTimeout(r, publishRetryIntervalSec * 1000))
              }
            }
          }
          if (!published?.id) {
            throw new Error(lastPublishError?.message || 'Publish quote-post thất bại')
          }
        } else {
          await repostPost(chosenPostId, w.token, { settings })
        }
        ok++
      } catch (err) {
        fail++
        if (failureDetails.length < MAX_BUFF_FAILURE_DETAILS) {
          failureDetails.push({
            accountId: w.id,
            username: w.username || null,
            token: w.token ? maskToken(w.token) : null,
            error: compactErrorMessage(err?.message),
          })
        }
      }
      setBuffProgress({ taskId, done: i + 1, total: workers.length, status: 'reposting' })
      if (i < workers.length - 1 && !buffAbortRef.current) {
        const dMin = Math.max(1, Number(task.delayMin) || 3)
        const dMax = Math.max(dMin, Number(task.delayMax) || 8)
        const randomDelay = (dMin + Math.random() * (dMax - dMin)) * 1000
        await new Promise(r => setTimeout(r, randomDelay))
      }
    }

    const endedAt = Date.now()
    const durationSec = Math.round((endedAt - startedAt) / 1000)
    const runStatus = fail > 0 ? (ok > 0 ? 'partial' : 'fail') : 'ok'

    appendBuffLog({
      at: endedAt,
      taskId,
      type: 'run',
      postId: chosenPostId,
      permalink: chosenPermalink,
      buffMode: task.buffMode || 'repost',
      workerCount: workers.length,
      success: ok,
      fail,
      durationSec,
      status: runStatus,
      failures: failureDetails,
      failHidden: Math.max(0, fail - failureDetails.length),
    })
    appendRootAppLog({
      at: endedAt,
      level: fail > 0 ? 'warn' : 'info',
      source: 'buff',
      action: 'run_finish',
      message: `Buff run ${runStatus}: ok ${ok} / fail ${fail}`,
      meta: { taskId, mode: task.buffMode || 'repost', postId: chosenPostId, permalink: chosenPermalink, workerCount: workers.length, durationSec, fail },
    })

    let taskAfter = null
    setBuffSchedules(prev => prev.map(t => {
      if (t.id !== taskId) return t
      const base = { ...t, updatedAt: endedAt, lastRunAt: endedAt, runCount: (t.runCount || 0) + 1, lastResult: { ok, fail, durationSec, postId: chosenPostId, permalink: chosenPermalink, mode: task.buffMode || 'repost' } }
      if (t.mode === 'once') { taskAfter = { ...base, status: 'completed', nextRunAt: null }; return taskAfter }
      const intervalMs = t.intervalMs || 60000
      const nextRunAt = endedAt + intervalMs
      taskAfter = { ...base, status: 'active', nextRunAt }
      return taskAfter
    }))

    if (taskAfter?.mode === 'repeat' && taskAfter.status === 'active' && taskAfter.nextRunAt) {
      armBuffTask(taskAfter)
    } else {
      clearBuffTimer(taskId)
    }

    buffRunLockRef.current.delete(taskId)
    setBuffRunning(false)
    setBuffProgress(null)
  }, [accounts, appendBuffLog, appendRootAppLog, armBuffTask, buffSchedules, clearBuffTimer, settings])

  useEffect(() => { runBuffTaskRef.current = runBuffTask }, [runBuffTask])

  useEffect(() => {
    const now = Date.now()
    buffSchedules.forEach(task => {
      if (task.status === 'active' && task.nextRunAt) {
        if (task.nextRunAt <= now && task.mode === 'once') {
          setBuffSchedules(prev => prev.map(t => t.id === task.id ? { ...t, status: 'completed' } : t))
        } else {
          armBuffTask(task)
        }
      }
    })
    return () => { for (const timer of buffTimersRef.current.values()) clearTimeout(timer) }
  }, [])

  const createBuffTask = useCallback((taskData) => {
    setBuffSchedules(prev => [taskData, ...prev])
    if (taskData.mode === 'once') {
      setTimeout(() => runBuffTaskRef.current?.(taskData.id), 100)
    } else {
      armBuffTask(taskData)
    }
  }, [armBuffTask])

  const cancelBuffTask = useCallback((taskId) => {
    buffAbortRef.current = true
    clearBuffTimer(taskId)
    setBuffSchedules(prev => prev.map(t => t.id === taskId ? { ...t, status: 'cancelled', updatedAt: Date.now() } : t))
    appendRootAppLog({ level: 'warn', source: 'buff', action: 'cancel', message: `Đã hủy buff task ${taskId}`, meta: { taskId } })
  }, [appendRootAppLog, clearBuffTimer])

  const deleteBuffTask = useCallback((taskId) => {
    clearBuffTimer(taskId)
    setBuffSchedules(prev => prev.filter(t => t.id !== taskId))
  }, [clearBuffTimer])

  const addBuffFavWorker = useCallback((id) => {
    setBuffFavWorkers(prev => {
      const next = prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
      saveBuffFavouriteWorkers(next)
      return next
    })
  }, [])

  const handleBuffMe = useCallback((id) => {
    buffMeTarget.current = id
    navigate('/buff')
  }, [navigate])

  const buffNoti = buffRunning && buffProgress ? (
    <div className="fixed bottom-4 right-4 z-50 px-4 py-2.5 rounded-xl border border-amber-500/40 bg-amber-500/10 backdrop-blur-sm shadow-lg flex items-center gap-2 text-xs text-amber-300">
      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
      <span>Buff đang chạy: {buffProgress.done}/{buffProgress.total} workers</span>
    </div>
  ) : null

  if (path === '/interact') {
    return <>{buffNoti}<InteractView accounts={accounts} settings={settings} navigate={navigate} dark={dark} toggleTheme={toggleTheme} /></>
  }

  if (path === '/buff') {
    return <>{buffNoti}<BuffView accounts={accounts} settings={settings} navigate={navigate} dark={dark} toggleTheme={toggleTheme} initialBossId={buffMeTarget.current} buffFavWorkers={buffFavWorkers} setBuffFavWorkers={setBuffFavWorkers} buffSchedules={buffSchedules} buffLogs={buffLogs} buffRunning={buffRunning} createBuffTask={createBuffTask} cancelBuffTask={cancelBuffTask} deleteBuffTask={deleteBuffTask} /></>
  }

  const m = path.match(/^\/([^/]+)(?:\/post\/([^/]+))?\/?$/)
  if (m && m[1] && m[1] !== '') {
    const userId = m[1]
    const postId = m[2]
    const accountRaw = accounts.find(a => a.id === userId)
    const account = accountRaw ? normalizeAccountStatus(accountRaw) : null
    if (account) {
      return <>{buffNoti}{postId
        ? <PostDetailView account={account} postId={postId} settings={settings} navigate={navigate} onActionLog={appendRootAppLog} />
        : <ProfileView account={account} settings={settings} navigate={navigate} followersBaseline={followersBaseline} setFollowersBaseline={setFollowersBaseline} onActionLog={appendRootAppLog} />}</>
    }
  }
  return <>{buffNoti}<App path={path} navigate={navigate} dark={dark} toggleTheme={toggleTheme} followersBaseline={followersBaseline} setFollowersBaseline={setFollowersBaseline} addBuffFavWorker={addBuffFavWorker} handleBuffMe={handleBuffMe} buffFavWorkers={buffFavWorkers} /></>
}

function App({ path, navigate, dark, toggleTheme, followersBaseline = {}, setFollowersBaseline, addBuffFavWorker, handleBuffMe, buffFavWorkers = [] }) {
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

  const [addPanelMode, setAddPanelMode] = useState('single')
  const [bulkText, setBulkText] = useState('')
  const [bulkLookupText, setBulkLookupText] = useState('')
  const [bulkLookupResult, setBulkLookupResult] = useState(null)
  const [bulkRunning, setBulkRunning] = useState(false)
  const [bulkLog, setBulkLog] = useState([])
  const [bulkFailed, setBulkFailed] = useState([])
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0 })
  const bulkAbort = useRef(false)

  const [selectedIds, setSelectedIds] = useState(new Set())
  const [selectedBySelectAll, setSelectedBySelectAll] = useState(false)
  const toggleSelect = (id) => {
    setSelectedBySelectAll(false)
    setSelectedIds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  const selectAll = () => {
    setSelectedBySelectAll(true)
    setSelectedIds(new Set(filtered.map(a => a.id)))
  }
  const selectNone = () => {
    setSelectedBySelectAll(false)
    setSelectedIds(new Set())
  }

  const [fetchingAllPosts, setFetchingAllPosts] = useState(false)
  const [fetchPostsProgress, setFetchPostsProgress] = useState({ done: 0, total: 0 })
  const fetchPostsAbort = useRef(false)

  const [scheduleMode, setScheduleMode] = useState('once')
  const [scheduleAt, setScheduleAt] = useState('')
  const [scheduleEveryValue, setScheduleEveryValue] = useState(settings?.scheduleDefaultRepeatValue ?? 10)
  const [scheduleRepeatUnit, setScheduleRepeatUnit] = useState(settings?.scheduleDefaultRepeatUnit ?? 'minute')
  const [scheduleDailyHour, setScheduleDailyHour] = useState(settings?.scheduleDefaultDailyHour ?? 9)
  const [scheduleDailyMinute, setScheduleDailyMinute] = useState(settings?.scheduleDefaultDailyMinute ?? 0)
  const [scheduleDailySecond, setScheduleDailySecond] = useState(settings?.scheduleDefaultDailySecond ?? 0)
  const [scheduleTargetType, setScheduleTargetType] = useState('selected')
  const [scheduleDelaySec, setScheduleDelaySec] = useState(settings?.scheduleDelaySec ?? 5)
  const [scheduleMsg, setScheduleMsg] = useState('')
  const [editingScheduleId, setEditingScheduleId] = useState(null)
  const [scheduledTasks, setScheduledTasks] = useState(() => loadSchedules())
  const [scheduleLogs, setScheduleLogs] = useState(() => loadScheduleLogs().slice(0, MAX_SCHEDULE_LOGS))
  const [appLogs, setAppLogs] = useState(() => loadAppLogs().slice(0, MAX_APP_LOGS))
  const [expandedScheduleFailures, setExpandedScheduleFailures] = useState(() => new Set())
  const [expandedAppLogFailures, setExpandedAppLogFailures] = useState(() => new Set())
  const timersRef = useRef(new Map())
  const taskRunLockRef = useRef(new Set())
  const runTaskRef = useRef(null)

  const [postsFetchTick, setPostsFetchTick] = useState(0)
  const [cacheTick, setCacheTick] = useState(0)
  const schedulerTargetCount = scheduleTargetType === 'all' ? accounts.length : selectedIds.size
  const showScheduleDelay = schedulerTargetCount >= 2
  const scheduleRunning = scheduledTasks.some(t => t.status === 'running')

  const clampNumber = (v, min, max, fallback = min) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return fallback
    return Math.min(max, Math.max(min, Math.floor(n)))
  }

  const calcNextDailyRunAt = (fromTs, everyDays, hour, minute, second) => {
    const base = new Date(fromTs)
    base.setMilliseconds(0)
    base.setHours(hour, minute, second, 0)
    if (base.getTime() > fromTs) return base.getTime()
    base.setDate(base.getDate() + Math.max(1, everyDays))
    return base.getTime()
  }

  const formatDateTimeLocal = (ts) => {
    if (!ts) return ''
    const d = new Date(ts)
    if (!Number.isFinite(d.getTime())) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const toggleScheduleFailureExpand = useCallback((logId) => {
    setExpandedScheduleFailures((prev) => {
      const next = new Set(prev)
      if (next.has(logId)) next.delete(logId)
      else next.add(logId)
      return next
    })
  }, [])

  const toggleAppLogFailureExpand = useCallback((logId) => {
    setExpandedAppLogFailures((prev) => {
      const next = new Set(prev)
      if (next.has(logId)) next.delete(logId)
      else next.add(logId)
      return next
    })
  }, [])

  const clearTaskTimer = useCallback((taskId) => {
    const timer = timersRef.current.get(taskId)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(taskId)
    }
  }, [])

  const clearAllTaskTimers = useCallback(() => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
  }, [])

  const appendScheduleLog = useCallback((entry) => {
    setScheduleLogs(prev => [{ id: `log_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`, ...entry }, ...prev].slice(0, MAX_SCHEDULE_LOGS))
  }, [])

  const appendAppLog = useCallback((entry) => {
    const now = Date.now()
    const id = `app_log_${now}_${Math.random().toString(36).slice(2, 7)}`
    setAppLogs(prev => [{
      id,
      at: entry?.at || now,
      level: entry?.level || 'info',
      source: entry?.source || 'system',
      action: entry?.action || 'event',
      message: entry?.message || '',
      meta: entry?.meta || null,
    }, ...prev].slice(0, MAX_APP_LOGS))
  }, [])

  const armTask = useCallback((task) => {
    if (!task || task.status !== 'active' || !task.nextRunAt) return
    clearTaskTimer(task.id)
    const delay = Math.max(0, task.nextRunAt - Date.now())
    const timer = setTimeout(() => {
      runTaskRef.current?.(task.id)
    }, delay)
    timersRef.current.set(task.id, timer)
  }, [clearTaskTimer])

  const runTask = useCallback(async (taskId) => {
    if (taskRunLockRef.current.has(taskId)) return

    const taskSnapshot = scheduledTasks.find(t => t.id === taskId)
    if (!taskSnapshot || taskSnapshot.status !== 'active') return

    taskRunLockRef.current.add(taskId)
    setScheduledTasks(prev => prev.map(t => t.id === taskId ? { ...t, status: 'running', updatedAt: Date.now() } : t))

    const startedAt = Date.now()
    const targets = accounts.filter(a => taskSnapshot.snapshotIds.includes(a.id))
    const DELAY = Math.max(1, Number(taskSnapshot.delaySec) || 5) * 1000
    let ok = 0
    let fail = 0
    const failureDetails = []

    for (let i = 0; i < targets.length; i++) {
      const target = targets[i]
      try {
        await fetchPosts(target.id, target.token, { settings, limit: 10, skipCache: true })
        ok++
      } catch (err) {
        fail++
        if (failureDetails.length < MAX_SCHEDULE_FAILURE_DETAILS) {
          failureDetails.push({
            accountId: target.id,
            username: target.username || null,
            token: target.token ? maskToken(target.token) : null,
            error: compactErrorMessage(err?.message || 'Lỗi không xác định'),
          })
        }
      }
      if (i < targets.length - 1) await new Promise(r => setTimeout(r, DELAY))
    }

    const endedAt = Date.now()
    const durationSec = Math.round((endedAt - startedAt) / 1000)
    const runStatus = fail > 0 ? (ok > 0 ? 'partial' : 'fail') : 'ok'

    let taskAfter = null
    setScheduledTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t
      const nextBase = {
        ...t,
        updatedAt: endedAt,
        lastRunAt: endedAt,
        runCount: (t.runCount || 0) + 1,
        lastResult: { ok, fail, durationSec, status: runStatus },
      }
      if (t.status === 'cancelled') {
        taskAfter = nextBase
        return nextBase
      }
      if (t.mode === 'once') {
        taskAfter = { ...nextBase, status: 'completed', nextRunAt: null }
        return taskAfter
      }
      const intervalMs = t.intervalMs || 60 * 1000
      let nextRunAt = endedAt + intervalMs
      if (t.repeatUnit === 'day' && Number.isFinite(t.dailyHour) && Number.isFinite(t.dailyMinute) && Number.isFinite(t.dailySecond)) {
        nextRunAt = t.nextRunAt || calcNextDailyRunAt(endedAt, t.everyValue || 1, t.dailyHour, t.dailyMinute, t.dailySecond)
        while (nextRunAt <= endedAt) nextRunAt += intervalMs
      }
      taskAfter = { ...nextBase, status: 'active', nextRunAt }
      return taskAfter
    }))

    appendScheduleLog({
      at: endedAt,
      taskId,
      type: 'run',
      mode: taskSnapshot.mode === 'repeat' ? `repeat-${taskSnapshot.repeatUnit || 'minute'}` : 'once',
      targetCount: targets.length,
      success: ok,
      fail,
      durationSec,
      status: runStatus,
      failures: failureDetails,
      failHidden: Math.max(0, fail - failureDetails.length),
    })
    appendAppLog({
      at: endedAt,
      level: fail > 0 ? 'warn' : 'info',
      source: 'scheduler',
      action: 'run',
      message: `Scheduler run ${runStatus}: ok ${ok} / fail ${fail}`,
      meta: {
        taskId,
        targetCount: targets.length,
        durationSec,
        mode: taskSnapshot.mode,
        fail,
        failures: failureDetails,
        failHidden: Math.max(0, fail - failureDetails.length),
      },
    })

    setPostsFetchTick(t => t + 1)
    setCacheTick(t => t + 1)

    if (taskAfter?.mode === 'repeat' && taskAfter.status === 'active' && taskAfter.nextRunAt) {
      armTask(taskAfter)
    } else {
      clearTaskTimer(taskId)
    }

    taskRunLockRef.current.delete(taskId)
  }, [accounts, appendAppLog, appendScheduleLog, armTask, clearTaskTimer, scheduledTasks, settings, calcNextDailyRunAt])

  useEffect(() => {
    runTaskRef.current = runTask
  }, [runTask])

  const cancelScheduleTask = useCallback((taskId) => {
    clearTaskTimer(taskId)
    setScheduledTasks(prev => prev.map(t => t.id === taskId
      ? { ...t, status: 'cancelled', cancelReason: 'user', updatedAt: Date.now() }
      : t
    ))
    appendScheduleLog({ at: Date.now(), taskId, type: 'cancel', message: 'Đã hủy lịch bởi người dùng' })
    appendAppLog({
      level: 'warn',
      source: 'scheduler',
      action: 'cancel',
      message: 'Đã hủy lịch chạy',
      meta: { taskId },
    })
    setScheduleMsg('Đã hủy 1 lịch')
  }, [appendAppLog, appendScheduleLog, clearTaskTimer])

  const deleteCancelledScheduleTask = useCallback((taskId) => {
    const target = scheduledTasks.find(t => t.id === taskId)
    if (!target || target.status !== 'cancelled') {
      setScheduleMsg('Chỉ có thể xóa lịch đã hủy')
      return
    }
    setScheduledTasks(prev => prev.filter(t => t.id !== taskId))
    appendScheduleLog({ at: Date.now(), taskId, type: 'delete', message: 'Đã xóa lịch đã hủy' })
    appendAppLog({
      level: 'info',
      source: 'scheduler',
      action: 'delete_cancelled',
      message: 'Đã xóa lịch cancelled',
      meta: { taskId },
    })
    if (editingScheduleId === taskId) setEditingScheduleId(null)
    setScheduleMsg('Đã xóa 1 lịch đã hủy')
  }, [appendAppLog, appendScheduleLog, editingScheduleId, scheduledTasks])

  const resetScheduleForm = useCallback(() => {
    setEditingScheduleId(null)
    setScheduleMode('once')
    setScheduleAt('')
    setScheduleEveryValue(settings?.scheduleDefaultRepeatValue ?? 10)
    setScheduleRepeatUnit(settings?.scheduleDefaultRepeatUnit ?? 'minute')
    setScheduleDailyHour(settings?.scheduleDefaultDailyHour ?? 9)
    setScheduleDailyMinute(settings?.scheduleDefaultDailyMinute ?? 0)
    setScheduleDailySecond(settings?.scheduleDefaultDailySecond ?? 0)
    setScheduleTargetType('selected')
    setScheduleDelaySec(settings?.scheduleDelaySec ?? 5)
    setScheduleMsg('')
  }, [settings])

  const startEditSchedule = useCallback((task) => {
    if (!task || task.status === 'running') return
    setEditingScheduleId(task.id)
    const mode = task.mode === 'repeat' ? 'repeat' : 'once'
    setScheduleMode(mode)
    if (mode === 'once') {
      setScheduleAt(formatDateTimeLocal(task.nextRunAt))
      setScheduleEveryValue(1)
      setScheduleRepeatUnit('minute')
    } else {
      const unit = ['minute', 'hour', 'day'].includes(task.repeatUnit) ? task.repeatUnit : 'minute'
      setScheduleRepeatUnit(unit)
      setScheduleEveryValue(task.everyValue ?? 1)
      setScheduleAt('')
      setScheduleDailyHour(task.dailyHour ?? (settings?.scheduleDefaultDailyHour ?? 9))
      setScheduleDailyMinute(task.dailyMinute ?? (settings?.scheduleDefaultDailyMinute ?? 0))
      setScheduleDailySecond(task.dailySecond ?? (settings?.scheduleDefaultDailySecond ?? 0))
    }
    setScheduleTargetType(task.targetType === 'all' ? 'all' : 'selected')
    setScheduleDelaySec(task.delaySec ?? (settings?.scheduleDelaySec ?? 5))
    if (task.targetType === 'selected') {
      const accountSet = new Set(accounts.map(a => a.id))
      setSelectedIds(new Set((task.snapshotIds || []).filter(id => accountSet.has(id))))
    }
    setScheduleMsg(`Đang sửa lịch ${task.id}`)
  }, [accounts, settings])

  const createSchedule = useCallback(() => {
    setScheduleMsg('')

    const snapshotIds = scheduleTargetType === 'all'
      ? accounts.map(a => a.id)
      : [...selectedIds]

    if (snapshotIds.length === 0) {
      setScheduleMsg('Không có tài khoản để lên lịch')
      return
    }

    const now = Date.now()
    const delaySec = Math.max(1, Number(scheduleDelaySec) || 5)
    const repeatValue = Math.max(1, Number(scheduleEveryValue) || 1)
    const repeatUnit = ['minute', 'hour', 'day'].includes(scheduleRepeatUnit) ? scheduleRepeatUnit : 'minute'
    const dailyHour = clampNumber(scheduleDailyHour, 0, 23, 9)
    const dailyMinute = clampNumber(scheduleDailyMinute, 0, 59, 0)
    const dailySecond = clampNumber(scheduleDailySecond, 0, 59, 0)

    const editingTask = editingScheduleId ? scheduledTasks.find(t => t.id === editingScheduleId) : null
    if (editingScheduleId && !editingTask) {
      setEditingScheduleId(null)
      setScheduleMsg('Không tìm thấy lịch cần sửa')
      return
    }

    setSettings(prev => ({
      ...prev,
      scheduleDelaySec: delaySec,
      scheduleDefaultRepeatValue: repeatValue,
      scheduleDefaultRepeatUnit: repeatUnit,
      scheduleDefaultDailyHour: dailyHour,
      scheduleDefaultDailyMinute: dailyMinute,
      scheduleDefaultDailySecond: dailySecond,
    }))

    const taskId = editingTask?.id || `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    const createdAt = editingTask?.createdAt || now
    const runCount = editingTask?.runCount || 0
    const lastRunAt = editingTask?.lastRunAt || null
    const lastResult = editingTask?.lastResult || null

    let task = null
    if (scheduleMode === 'once') {
      const runAt = new Date(scheduleAt).getTime()
      if (!runAt || runAt <= now) {
        setScheduleMsg('Thời điểm chạy không hợp lệ')
        return
      }
      task = {
        id: taskId,
        mode: 'once',
        status: 'active',
        createdAt,
        updatedAt: now,
        targetType: scheduleTargetType,
        snapshotIds,
        delaySec,
        nextRunAt: runAt,
        lastRunAt,
        everyValue: null,
        repeatUnit: null,
        intervalMs: null,
        dailyHour: null,
        dailyMinute: null,
        dailySecond: null,
        runCount,
        lastResult,
        cancelReason: null,
      }
      setScheduleMsg(editingTask
        ? `Đã cập nhật lịch 1 lần cho ${snapshotIds.length} tài khoản`
        : `Đã tạo lịch 1 lần cho ${snapshotIds.length} tài khoản`)
    } else {
      const unitMs = repeatUnit === 'day' ? 24 * 60 * 60 * 1000 : repeatUnit === 'hour' ? 60 * 60 * 1000 : 60 * 1000
      const intervalMs = repeatValue * unitMs
      const nextRunAt = repeatUnit === 'day'
        ? calcNextDailyRunAt(now, repeatValue, dailyHour, dailyMinute, dailySecond)
        : now + intervalMs
      task = {
        id: taskId,
        mode: 'repeat',
        status: 'active',
        createdAt,
        updatedAt: now,
        targetType: scheduleTargetType,
        snapshotIds,
        delaySec,
        nextRunAt,
        lastRunAt,
        everyValue: repeatValue,
        repeatUnit,
        intervalMs,
        dailyHour: repeatUnit === 'day' ? dailyHour : null,
        dailyMinute: repeatUnit === 'day' ? dailyMinute : null,
        dailySecond: repeatUnit === 'day' ? dailySecond : null,
        runCount,
        lastResult,
        cancelReason: null,
      }
      const label = repeatUnit === 'day' ? 'ngày' : repeatUnit === 'hour' ? 'giờ' : 'phút'
      const timeLabel = repeatUnit === 'day'
        ? ` lúc ${String(dailyHour).padStart(2, '0')}:${String(dailyMinute).padStart(2, '0')}:${String(dailySecond).padStart(2, '0')}`
        : ''
      setScheduleMsg(editingTask
        ? `Đã cập nhật lịch lặp mỗi ${repeatValue} ${label}${timeLabel} cho ${snapshotIds.length} tài khoản`
        : `Đã tạo lịch lặp mỗi ${repeatValue} ${label}${timeLabel} cho ${snapshotIds.length} tài khoản`)
    }

    if (editingTask) {
      setScheduledTasks(prev => prev.map(t => t.id === task.id ? task : t))
      appendScheduleLog({ at: Date.now(), taskId: task.id, type: 'update', message: 'Cập nhật lịch thành công' })
      appendAppLog({
        level: 'info',
        source: 'scheduler',
        action: 'update',
        message: 'Đã cập nhật lịch chạy',
        meta: { taskId: task.id, mode: task.mode, targetCount: snapshotIds.length },
      })
      clearTaskTimer(task.id)
      armTask(task)
      setEditingScheduleId(null)
      return
    }

    setScheduledTasks(prev => [task, ...prev].slice(0, 100))
    appendScheduleLog({ at: Date.now(), taskId: task.id, type: 'create', message: 'Tạo lịch mới thành công' })
    appendAppLog({
      level: 'info',
      source: 'scheduler',
      action: 'create',
      message: 'Đã tạo lịch chạy mới',
      meta: { taskId: task.id, mode: task.mode, targetCount: snapshotIds.length },
    })
    armTask(task)
  }, [accounts, appendAppLog, appendScheduleLog, armTask, clearTaskTimer, editingScheduleId, scheduleAt, scheduleDailyHour, scheduleDailyMinute, scheduleDailySecond, scheduleDelaySec, scheduleEveryValue, scheduleMode, scheduleRepeatUnit, scheduleTargetType, scheduledTasks, selectedIds, setSettings])

  useEffect(() => {
    saveSchedules(scheduledTasks)
  }, [scheduledTasks])

  useEffect(() => {
    saveScheduleLogs(scheduleLogs)
  }, [scheduleLogs])

  useEffect(() => {
    saveAppLogs(appLogs)
  }, [appLogs])

  useEffect(() => {
    const now = Date.now()
    const overdueGraceMs = 10 * 60 * 1000

    let normalized = scheduledTasks.map(task => {
      const next = { ...task }
      if (!next.id) next.id = `sch_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
      if (next.status === 'running') next.status = 'active'

      if (next.status !== 'active') return next

      if (next.mode === 'once') {
        if (!next.nextRunAt) {
          next.status = 'completed'
          next.cancelReason = 'invalid_next_run'
          next.updatedAt = now
          return next
        }
        if (next.nextRunAt < now && now - next.nextRunAt > overdueGraceMs) {
          next.status = 'completed'
          next.cancelReason = 'past_due_dropped'
          next.updatedAt = now
        }
        return next
      }

      const intervalMs = next.intervalMs || ((next.repeatUnit === 'day' ? 24 : next.repeatUnit === 'hour' ? 1 : 1) * (next.repeatUnit === 'day' ? 60 * 60 * 1000 : next.repeatUnit === 'hour' ? 60 * 60 * 1000 : 60 * 1000) * (next.everyValue || 1))
      next.intervalMs = Math.max(60 * 1000, intervalMs)
      if (!next.nextRunAt) {
        if (next.repeatUnit === 'day' && Number.isFinite(next.dailyHour) && Number.isFinite(next.dailyMinute) && Number.isFinite(next.dailySecond)) {
          next.nextRunAt = calcNextDailyRunAt(now, next.everyValue || 1, next.dailyHour, next.dailyMinute, next.dailySecond)
        } else {
          next.nextRunAt = now + next.intervalMs
        }
      }
      while (next.nextRunAt <= now) next.nextRunAt += next.intervalMs
      return next
    })

    setScheduledTasks(normalized)

    for (const task of normalized) {
      if (task.status !== 'active') continue
      if (task.mode === 'once' && task.nextRunAt < now && now - task.nextRunAt <= overdueGraceMs) {
        runTaskRef.current?.(task.id)
        continue
      }
      if (task.nextRunAt && task.nextRunAt > now) armTask(task)
    }

    return () => {
      clearAllTaskTimers()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fetchAllPosts = useCallback(async () => {
    const targets = accounts.filter(a => selectedIds.has(a.id))
    if (targets.length === 0) return
    appendAppLog({
      level: 'info',
      source: 'posts',
      action: 'bulk_fetch_start',
      message: `Bắt đầu lấy posts cho ${targets.length} tài khoản`,
      meta: { total: targets.length },
    })
    setFetchingAllPosts(true)
    setFetchPostsProgress({ done: 0, total: targets.length })
    fetchPostsAbort.current = false
    const DELAY = (settings?.bulkDelay ?? 5) * 1000
    let ok = 0
    let fail = 0
    for (let i = 0; i < targets.length; i++) {
      if (fetchPostsAbort.current) break
      try {
        await fetchPosts(targets[i].id, targets[i].token, { settings, limit: 10, skipCache: true })
        ok++
      } catch {
        fail++
      }
      setFetchPostsProgress({ done: i + 1, total: targets.length })
      if (i < targets.length - 1 && !fetchPostsAbort.current) {
        await new Promise(r => setTimeout(r, DELAY))
      }
    }
    appendAppLog({
      level: fail > 0 ? 'warn' : 'info',
      source: 'posts',
      action: fetchPostsAbort.current ? 'bulk_fetch_stopped' : 'bulk_fetch_finish',
      message: `Lấy posts hàng loạt xong: ok ${ok} / fail ${fail}`,
      meta: { total: targets.length },
    })
    setFetchingAllPosts(false)
    setSelectedBySelectAll(false)
    setSelectedIds(new Set())
    setPostsFetchTick(t => t + 1)
    setCacheTick(t => t + 1)
  }, [accounts, appendAppLog, selectedIds, settings])

  const [fetchingAllInsights, setFetchingAllInsights] = useState(false)
  const [fetchInsightsProgress, setFetchInsightsProgress] = useState({ done: 0, total: 0 })
  const fetchInsightsAbort = useRef(false)

  const fetchAllInsights = useCallback(async () => {
    const targets = accounts.filter(a => selectedIds.has(a.id))
    if (targets.length === 0) return
    appendAppLog({
      level: 'info',
      source: 'insights',
      action: 'bulk_fetch_start',
      message: `Bắt đầu lấy insights cho ${targets.length} tài khoản`,
      meta: { total: targets.length },
    })
    setFetchingAllInsights(true)
    setFetchInsightsProgress({ done: 0, total: targets.length })
    fetchInsightsAbort.current = false
    const DELAY = (settings?.bulkDelay ?? 5) * 1000
    let ok = 0
    let fail = 0
    for (let i = 0; i < targets.length; i++) {
      if (fetchInsightsAbort.current) break
      try {
        await fetchInsights(targets[i].id, targets[i].token, { settings })
        ok++
      } catch {
        fail++
      }
      setFetchInsightsProgress({ done: i + 1, total: targets.length })
      if (i < targets.length - 1 && !fetchInsightsAbort.current) {
        await new Promise(r => setTimeout(r, DELAY))
      }
    }
    appendAppLog({
      level: fail > 0 ? 'warn' : 'info',
      source: 'insights',
      action: fetchInsightsAbort.current ? 'bulk_fetch_stopped' : 'bulk_fetch_finish',
      message: `Lấy insights hàng loạt xong: ok ${ok} / fail ${fail}`,
      meta: { total: targets.length },
    })
    setFetchingAllInsights(false)
    setSelectedBySelectAll(false)
    setSelectedIds(new Set())
    setCacheTick(t => t + 1)
  }, [accounts, appendAppLog, selectedIds, settings])

  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmBulkAction, setConfirmBulkAction] = useState(null)

  const removeSelected = () => {
    const names = accounts.filter(a => selectedIds.has(a.id)).map(a => `@${a.username}`).join(', ')
    setConfirmDelete({ type: 'bulk', ids: [...selectedIds], label: names, count: selectedIds.size })
  }

  useEffect(() => { saveAccounts(accounts) }, [accounts])
  useEffect(() => { saveSettings(settings) }, [settings])

  const [statusFilter, setStatusFilter] = useState('all')
  const [sortBy, setSortBy] = useState('default')
  const [followersMin, setFollowersMin] = useState('')
  const [followersMax, setFollowersMax] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(() => Number(localStorage.getItem('td.perPage')) || 20)

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

  const accountsWithTokenCheck = useMemo(() => {
    return accounts.map(a => normalizeAccountStatus(a))
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
  }, [accounts, settings, cacheTick])

  const stats = useMemo(() => ({
    total: accountsWithTokenCheck.length,
    ok: accountsWithTokenCheck.filter(a => a.status === 'ok').length,
    err: accountsWithTokenCheck.filter(a => a.status === 'error').length,
    locked: accountsWithTokenCheck.filter(a => a.status === 'locked').length,
    blocked: accountsWithTokenCheck.filter(a => a.status === 'blocked').length,
    abnormal: accountsWithTokenCheck.filter(a => accountHealthMap[a.id] === 'abnormal').length,
    normal: accountsWithTokenCheck.filter(a => accountHealthMap[a.id] === 'normal' && a.status !== 'error' && a.status !== 'locked' && a.status !== 'blocked').length,
    noPosts: accountsWithTokenCheck.filter(a => a.status === 'ok' && !cacheGet(`posts:${a.id}:10`, (settings?.cacheTTLPosts ?? 30) * 60 * 1000 || 30 * 60 * 1000)).length,
    noInsights: accountsWithTokenCheck.filter(a => a.status === 'ok' && !cacheGet(`insights:${a.id}`, (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || 30 * 60 * 1000)).length,
  }), [accountsWithTokenCheck, accountHealthMap, settings, cacheTick])

  const getFollowers = (a) => {
    const ins = cacheGet(`insights:${a.id}`, (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || 30 * 60 * 1000)
    if (ins?.followers_count != null) return ins.followers_count
    const bl = followersBaseline[a.id]
    if (bl?.count != null) return bl.count
    return -1
  }

  const postsTTL = (settings?.cacheTTLPosts ?? 30) * 60 * 1000 || 30 * 60 * 1000
  const insightsTTL = (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || 30 * 60 * 1000

  const filtered = useMemo(() => {
    let result = accountsWithTokenCheck.filter(a => {
      const q = query.toLowerCase()
      const matchQuery = !q || (a.username || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q)
      if (!matchQuery) return false
      if (statusFilter === 'abnormal') return accountHealthMap[a.id] === 'abnormal'
      if (statusFilter === 'normal') return accountHealthMap[a.id] === 'normal' && a.status !== 'error' && a.status !== 'locked' && a.status !== 'blocked'
      if (statusFilter === 'ok') return a.status === 'ok'
      if (statusFilter === 'error') return a.status === 'error'
      if (statusFilter === 'locked') return a.status === 'locked'
      if (statusFilter === 'blocked') return a.status === 'blocked'
      if (statusFilter === 'no_posts') return a.status === 'ok' && !cacheGet(`posts:${a.id}:10`, postsTTL)
      if (statusFilter === 'no_insights') return a.status === 'ok' && !cacheGet(`insights:${a.id}`, insightsTTL)
      return true
    })

    if (followersMin) result = result.filter(a => getFollowers(a) >= Number(followersMin))
    if (followersMax) result = result.filter(a => { const f = getFollowers(a); return f >= 0 && f <= Number(followersMax) })

    if (sortBy === 'newest') result.sort((a, b) => (b.addedAt || b.lastCheck || 0) - (a.addedAt || a.lastCheck || 0))
    else if (sortBy === 'oldest') result.sort((a, b) => (a.addedAt || a.lastCheck || 0) - (b.addedAt || b.lastCheck || 0))
    else if (sortBy === 'followers_desc') result.sort((a, b) => getFollowers(b) - getFollowers(a))
    else if (sortBy === 'followers_asc') result.sort((a, b) => getFollowers(a) - getFollowers(b))

    return result
  }, [accountsWithTokenCheck, accountHealthMap, query, statusFilter, sortBy, followersMin, followersMax, settings, followersBaseline, cacheTick])

  const totalPages = Math.max(1, Math.ceil(filtered.length / perPage))
  const safeP = Math.min(page, totalPages)
  const paged = filtered.slice((safeP - 1) * perPage, safeP * perPage)

  useEffect(() => {
    setSelectedIds(new Set())
    setPage(1)
  }, [statusFilter, query, sortBy, followersMin, followersMax])

  const appLogsBytes = useMemo(() => {
    try {
      return new Blob([JSON.stringify(appLogs)]).size
    } catch {
      return 0
    }
  }, [appLogs])

  const clearAppLogs = useCallback(() => {
    setAppLogs([])
    setExpandedAppLogFailures(new Set())
    setScheduleMsg('Đã xóa toàn bộ app logs')
  }, [])

  useEffect(() => {
    setAddError('')
    setUrlMsg('')
  }, [path])

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
        addedAt: Date.now(),
        error: '',
      }
      setAccounts(prev => {
        const exists = prev.some(a => a.username === info.username)
        if (exists) return prev.map(a => a.username === info.username ? { ...next, addedAt: a.addedAt || next.addedAt } : a)
        const tokenDup = prev.find(a => a.token === token.trim() && a.id !== info.id)
        if (tokenDup) return [next, ...prev.filter(a => a.id !== tokenDup.id)]
        return [next, ...prev]
      })
      appendAppLog({
        level: 'info',
        source: 'account',
        action: 'add',
        message: `Đã thêm/cập nhật tài khoản @${info.username}`,
        meta: { id: info.id },
      })
      setToken('')
    } catch (err) {
      appendAppLog({
        level: 'error',
        source: 'account',
        action: 'add_fail',
        message: err.message || 'Không thêm được tài khoản',
      })
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
      appendAppLog({
        level: 'info',
        source: 'account',
        action: 'refresh',
        message: `Đã refresh tài khoản @${info.username}`,
        meta: { id },
      })
    } catch (err) {
      appendAppLog({
        level: 'warn',
        source: 'account',
        action: 'refresh_fail',
        message: err.message || 'Refresh tài khoản thất bại',
        meta: { id },
      })
      setAccounts(prev => prev.map(a => a.id === id ? {
        ...a, status: 'error', error: err.message, lastCheck: Date.now(),
      } : a))
    }
  }

  const remove = (id) => {
    const acc = accounts.find(a => a.id === id)
    setConfirmDelete({ type: 'single', id, label: acc ? `@${acc.username}` : id })
  }

  const clearAccountCache = (acc) => {
    if (!acc?.id) return
    const cachePrefix = 'td.cache.v1.'
    const postIds = new Set()
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const fullKey = localStorage.key(i)
        if (!fullKey || !fullKey.startsWith(`${cachePrefix}posts:${acc.id}:`)) continue
        const raw = localStorage.getItem(fullKey)
        if (!raw) continue
        try {
          const parsed = JSON.parse(raw)
          const posts = parsed?.v
          if (!Array.isArray(posts)) continue
          posts.forEach(p => {
            if (p?.id) postIds.add(String(p.id))
          })
        } catch {}
      }
    } catch {}

    cacheClear(`posts:${acc.id}:`)
    cacheClear(`insights:${acc.id}`)
    if (acc.token) {
      cacheClear(`me:${tokenFingerprint(acc.token)}`)
      cacheClear(`me:${acc.token.slice(-8)}`)
    }

    postIds.forEach((postId) => {
      cacheClear(`post:${postId}`)
      cacheClear(`post_insights:${postId}`)
      cacheClear(`replies:${postId}`)
    })
  }

  const confirmRemove = () => {
    if (!confirmDelete) return

    let removedAccounts = []
    if (confirmDelete.type === 'single') {
      removedAccounts = accounts.filter(a => a.id === confirmDelete.id)
      setAccounts(prev => prev.filter(a => a.id !== confirmDelete.id))
    } else {
      const idsSet = new Set(confirmDelete.ids)
      removedAccounts = accounts.filter(a => idsSet.has(a.id))
      setAccounts(prev => prev.filter(a => !idsSet.has(a.id)))
      setSelectedIds(new Set())
    }

    removedAccounts.forEach(clearAccountCache)
    if (removedAccounts.length > 0) {
      appendAppLog({
        level: 'warn',
        source: 'account',
        action: 'remove',
        message: `Đã xóa ${removedAccounts.length} tài khoản`,
        meta: { ids: removedAccounts.map(a => a.id) },
      })
      setFollowersBaseline(prev => {
        const next = { ...prev }
        let changed = false
        removedAccounts.forEach((acc) => {
          if (acc?.id && next[acc.id]) {
            delete next[acc.id]
            changed = true
          }
        })
        return changed ? next : prev
      })
      setPostsFetchTick(t => t + 1)
      setCacheTick(t => t + 1)
    }

    setConfirmDelete(null)
  }

  const [refreshingAll, setRefreshingAll] = useState(false)
  const refreshAll = useCallback(async () => {
    appendAppLog({
      level: 'info',
      source: 'account',
      action: 'refresh_all_start',
      message: `Bắt đầu refresh ${accounts.length} tài khoản`,
      meta: { total: accounts.length },
    })
    setRefreshingAll(true)
    const DELAY = (settings?.bulkDelay ?? 5) * 1000
    let ok = 0
    let fail = 0
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
        ok++
      } catch (err) {
        setAccounts(prev => prev.map(a => a.id === acc.id ? {
          ...a, status: 'error', error: err.message, lastCheck: Date.now(),
        } : a))
        fail++
      }
      if (i < accounts.length - 1) await new Promise(r => setTimeout(r, DELAY))
    }
    appendAppLog({
      level: fail > 0 ? 'warn' : 'info',
      source: 'account',
      action: 'refresh_all_finish',
      message: `Refresh all xong: ok ${ok} / fail ${fail}`,
      meta: { total: accounts.length },
    })
    setRefreshingAll(false)
  }, [accounts, appendAppLog, settings])

  const parseBulkTokens = useCallback((text) => {
    return text
      .split('\n')
      .map(l => l.trim())
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i)
  }, [])

  const handleBulkLookup = useCallback(() => {
    const inputUsernames = parseBulkUsernames(bulkLookupText)
    const existingSet = new Set(
      accounts
        .map((a) => normalizeUsername(a?.username))
        .filter(Boolean)
    )
    const missingUsernames = inputUsernames.filter((u) => !existingSet.has(u))
    const matchedUsernames = inputUsernames.filter((u) => existingSet.has(u))

    setBulkLookupResult({
      inputCount: inputUsernames.length,
      missingUsernames,
      matchedUsernames,
    })
  }, [accounts, bulkLookupText])

  const runBulkImportTokens = useCallback(async (tokens, { mode = 'import', clearPrevious = true } = {}) => {
    if (!Array.isArray(tokens) || tokens.length === 0) return

    appendAppLog({
      level: 'info',
      source: 'bulk_import',
      action: mode === 'retry_failed' ? 'retry_start' : 'start',
      message: mode === 'retry_failed' ? `Bắt đầu thử lại ${tokens.length} token lỗi` : `Bắt đầu nạp hàng loạt ${tokens.length} token`,
      meta: { total: tokens.length },
    })

    setBulkRunning(true)
    if (clearPrevious) setBulkLog([])
    setBulkFailed([])
    setBulkProgress({ done: 0, total: tokens.length })
    bulkAbort.current = false

    const DELAY = (settings?.bulkDelay ?? 5) * 1000
    const nextFailed = []

    for (let i = 0; i < tokens.length; i++) {
      if (bulkAbort.current) {
        setBulkLog(prev => [...prev, { token: tokens[i], ok: false, msg: 'Đã dừng bởi người dùng' }])
        appendAppLog({
          level: 'warn',
          source: 'bulk_import',
          action: 'stopped',
          message: 'Nạp hàng loạt bị dừng bởi người dùng',
          meta: { at: i, total: tokens.length, mode },
        })
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
          addedAt: Date.now(),
          error: '',
        }
        setAccounts(prev => {
          const exists = prev.some(a => a.id === info.id)
          if (exists) {
            setBulkLog(p => [...p, { token: t, ok: true, msg: `Cập nhật: @${info.username}` }])
            return prev.map(a => a.id === info.id ? { ...updated, addedAt: a.addedAt || updated.addedAt } : a)
          }
          const usernameDup = prev.find(a => a.username === info.username && a.id !== info.id)
          if (usernameDup) {
            setBulkLog(p => [...p, { token: t, ok: true, msg: `Cập nhật (username match): @${info.username}` }])
            return prev.map(a => a.id === usernameDup.id ? { ...updated, addedAt: a.addedAt || updated.addedAt } : a)
          }
          const tokenDup = prev.find(a => a.token === t && a.id !== info.id)
          if (tokenDup) {
            setBulkLog(p => [...p, { token: t, ok: true, msg: `@${info.username} (thay thế token trùng)` }])
            return [updated, ...prev.filter(a => a.id !== tokenDup.id)]
          }
          setBulkLog(p => [...p, { token: t, ok: true, msg: `@${info.username}` }])
          return [updated, ...prev]
        })
        appendAppLog({
          level: 'info',
          source: 'bulk_import',
          action: 'item_ok',
          message: `Nạp token thành công cho @${info.username}`,
          meta: { id: info.id, index: i + 1, total: tokens.length, mode },
        })
      } catch (err) {
        const errorMsg = err?.message || 'Nạp token thất bại'
        setBulkLog(prev => [...prev, { token: t, ok: false, msg: errorMsg }])
        if (!nextFailed.some(x => x.token === t)) {
          nextFailed.push({ token: t, error: errorMsg, at: Date.now() })
        }
        appendAppLog({
          level: 'warn',
          source: 'bulk_import',
          action: 'item_fail',
          message: errorMsg,
          meta: { index: i + 1, total: tokens.length, mode },
        })
      }

      setBulkProgress({ done: i + 1, total: tokens.length })
      if (i < tokens.length - 1 && !bulkAbort.current) {
        await new Promise(r => setTimeout(r, DELAY))
      }
    }

    setBulkFailed(nextFailed)
    appendAppLog({
      level: nextFailed.length > 0 ? 'warn' : 'info',
      source: 'bulk_import',
      action: mode === 'retry_failed' ? 'retry_finish' : 'finish',
      message: mode === 'retry_failed' ? 'Hoàn tất thử lại token lỗi' : 'Hoàn tất phiên nạp hàng loạt',
      meta: { total: tokens.length, failed: nextFailed.length, mode },
    })
    setBulkRunning(false)
  }, [appendAppLog, settings])

  const handleBulkImport = useCallback(async () => {
    const tokens = parseBulkTokens(bulkText)
    if (tokens.length === 0) return
    await runBulkImportTokens(tokens, { mode: 'import', clearPrevious: true })
  }, [bulkText, parseBulkTokens, runBulkImportTokens])

  const retryFailedBulkImport = useCallback(async () => {
    const tokens = bulkFailed.map(item => item.token).filter((v, i, a) => !!v && a.indexOf(v) === i)
    if (tokens.length === 0) return
    await runBulkImportTokens(tokens, { mode: 'retry_failed', clearPrevious: false })
  }, [bulkFailed, runBulkImportTokens])

  const confirmBulkImport = useCallback(() => {
    const tokens = parseBulkTokens(bulkText)
    if (tokens.length === 0) return
    setConfirmBulkAction({
      type: 'bulk_import',
      title: 'Xác nhận nạp hàng loạt',
      message: `Bạn có chắc muốn nạp hàng loạt ${tokens.length} token?`,
      dangerNote: 'Tool sẽ gọi API tuần tự cho từng token.',
      confirmLabel: 'Bắt đầu nạp',
      run: handleBulkImport,
    })
  }, [bulkText, handleBulkImport, parseBulkTokens])

  const confirmRetryFailedBulkImport = useCallback(() => {
    const tokens = bulkFailed.map(item => item.token).filter((v, i, a) => !!v && a.indexOf(v) === i)
    if (tokens.length === 0 || bulkRunning) return
    setConfirmBulkAction({
      type: 'bulk_import_retry_failed',
      title: 'Xác nhận thử lại token lỗi',
      message: `Bạn có chắc muốn thử lại ${tokens.length} token bị lỗi?`,
      dangerNote: 'Tool sẽ chỉ chạy lại nhóm token lỗi của lần chạy gần nhất.',
      confirmLabel: 'Thử lại token lỗi',
      run: retryFailedBulkImport,
    })
  }, [bulkFailed, bulkRunning, retryFailedBulkImport])

  const confirmRefreshAll = useCallback(() => {
    if (accounts.length === 0 || refreshingAll) return
    setConfirmBulkAction({
      type: 'refresh_all',
      title: 'Xác nhận refresh toàn bộ',
      message: `Bạn có chắc muốn refresh token cho toàn bộ ${accounts.length} tài khoản?`,
      dangerNote: 'Tác vụ sẽ chạy tuần tự và có delay giữa các request.',
      confirmLabel: 'Refresh all',
      run: refreshAll,
    })
  }, [accounts.length, refreshAll, refreshingAll])

  const confirmFetchAllPosts = useCallback(() => {
    if (selectedIds.size === 0 || fetchingAllPosts) return
    setConfirmBulkAction({
      type: 'fetch_posts',
      title: 'Xác nhận lấy posts hàng loạt',
      message: `Bạn có chắc muốn lấy posts cho ${selectedIds.size} tài khoản đã chọn?`,
      dangerNote: 'Tác vụ sẽ fetch tuần tự theo delay đã cấu hình.',
      confirmLabel: 'Lấy posts',
      run: fetchAllPosts,
    })
  }, [fetchAllPosts, fetchingAllPosts, selectedIds.size])

  const confirmFetchAllInsights = useCallback(() => {
    if (selectedIds.size === 0 || fetchingAllInsights || fetchingAllPosts) return
    setConfirmBulkAction({
      type: 'fetch_insights',
      title: 'Xác nhận lấy insights hàng loạt',
      message: `Bạn có chắc muốn lấy insights cho ${selectedIds.size} tài khoản đã chọn?`,
      dangerNote: 'Tác vụ sẽ fetch tuần tự theo delay đã cấu hình.',
      confirmLabel: 'Lấy insights',
      run: fetchAllInsights,
    })
  }, [fetchAllInsights, fetchingAllInsights, fetchingAllPosts, selectedIds.size])

  const runConfirmedBulkAction = () => {
    if (!confirmBulkAction?.run) return
    const action = confirmBulkAction.run
    setConfirmBulkAction(null)
    action()
  }

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
              <p className="text-xs text-neutral-400 dark:text-neutral-400">Quản lý tài khoản Threads · v{APP_VERSION}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => { navigate('/'); setStatusFilter('all'); setSortBy('default'); setFollowersMin(''); setFollowersMax(''); setQuery(''); setPage(1); setShowSettings(false); setAddPanelMode('single'); setBulkText(''); setBulkLookupText(''); setBulkLookupResult(null); setBulkLog([]); setBulkFailed([]); setExpandedScheduleFailures(new Set()); setExpandedAppLogFailures(new Set()); setAddError(''); setUrlMsg('') }}
              className="p-2 rounded-lg border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-sm"
              title="Trang chủ"
            >
              <Home className="w-4 h-4" />
            </button>
            <button
              onClick={toggleTheme}
              className="p-2 rounded-lg border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-sm"
              title={dark ? 'Light mode' : 'Dark mode'}
            >
              {dark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
            </button>
            <button
              onClick={() => navigate('/scheduler')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-sm"
            >
              <Clock className="w-4 h-4" /> Hẹn giờ
            </button>
            <button
              onClick={() => navigate('/logs')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-sm"
            >
              <List className="w-4 h-4" /> Logs
            </button>
            <button
              onClick={() => navigate('/interact')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 text-white text-sm font-medium"
            >
              <Search className="w-4 h-4" /> Tương tác
            </button>
            <button
              onClick={() => navigate('/buff')}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-300 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-sm"
            >
              <TrendingUp className="w-4 h-4" /> Buff
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

        {path !== '/logs' && (
          <>
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

        <section className="flex flex-wrap items-center gap-3 rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-4">
          <div className="flex items-center gap-1.5 text-xs text-neutral-400"><Filter className="w-3.5 h-3.5" /> Lọc:</div>
          <button
            onClick={() => setStatusFilter(f => f === 'no_posts' ? 'all' : 'no_posts')}
            className={`px-2.5 py-1 rounded-lg text-xs border ${statusFilter === 'no_posts' ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400' : 'border-neutral-200 dark:border-neutral-800 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
          >
            Chưa lấy posts ({stats.noPosts})
          </button>
          <button
            onClick={() => setStatusFilter(f => f === 'no_insights' ? 'all' : 'no_insights')}
            className={`px-2.5 py-1 rounded-lg text-xs border ${statusFilter === 'no_insights' ? 'border-indigo-500 bg-indigo-500/10 text-indigo-400' : 'border-neutral-200 dark:border-neutral-800 text-neutral-400 hover:bg-neutral-100 dark:hover:bg-neutral-800'}`}
          >
            Chưa lấy insights ({stats.noInsights})
          </button>
          <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-800" />
          <div className="flex items-center gap-1.5 text-xs text-neutral-400"><ArrowDownUp className="w-3.5 h-3.5" /> Sắp xếp:</div>
          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
            className="px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
          >
            <option value="default">Mặc định</option>
            <option value="newest">Mới nhất</option>
            <option value="oldest">Cũ nhất</option>
            <option value="followers_desc">Follow cao → thấp</option>
            <option value="followers_asc">Follow thấp → cao</option>
          </select>
          <div className="w-px h-5 bg-neutral-200 dark:bg-neutral-800" />
          <div className="flex items-center gap-1.5 text-xs text-neutral-400">Followers:</div>
          <input
            value={followersMin}
            onChange={(e) => setFollowersMin(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Từ"
            className="w-20 px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none text-center"
          />
          <span className="text-xs text-neutral-400">—</span>
          <input
            value={followersMax}
            onChange={(e) => setFollowersMax(e.target.value.replace(/[^0-9]/g, ''))}
            placeholder="Đến"
            className="w-20 px-2 py-1 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none text-center"
          />
          {(sortBy !== 'default' || followersMin || followersMax || statusFilter === 'no_posts' || statusFilter === 'no_insights') && (
            <button
              onClick={() => { setSortBy('default'); setFollowersMin(''); setFollowersMax(''); if (statusFilter === 'no_posts' || statusFilter === 'no_insights') setStatusFilter('all') }}
              className="px-2 py-1 rounded-lg text-xs text-rose-400 border border-rose-500/30 hover:bg-rose-500/10"
            >
              Xóa bộ lọc
            </button>
          )}
        </section>

        <section className="rounded-2xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Plus className="w-4 h-4 text-indigo-400" />
              <h2 className="font-medium">Thêm tài khoản</h2>
            </div>
            <div className="inline-flex items-center rounded-lg border border-neutral-200 dark:border-neutral-800 overflow-hidden">
              <button
                onClick={() => setAddPanelMode('single')}
                className={`px-2.5 py-1.5 text-xs ${addPanelMode === 'single' ? 'bg-indigo-500/20 text-indigo-300' : 'hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400'}`}
              >
                Thêm đơn
              </button>
              <button
                onClick={() => setAddPanelMode('bulk')}
                className={`px-2.5 py-1.5 text-xs border-l border-neutral-200 dark:border-neutral-800 ${addPanelMode === 'bulk' ? 'bg-indigo-500/20 text-indigo-300' : 'hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400'}`}
              >
                Nạp hàng loạt
              </button>
              <button
                onClick={() => setAddPanelMode('lookup')}
                className={`px-2.5 py-1.5 text-xs border-l border-neutral-200 dark:border-neutral-800 ${addPanelMode === 'lookup' ? 'bg-indigo-500/20 text-indigo-300' : 'hover:bg-neutral-200 dark:hover:bg-neutral-800 text-neutral-400'}`}
              >
                Đối chiếu username
              </button>
            </div>
          </div>

          {addPanelMode === 'single' && (
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
          )}

          {addPanelMode === 'bulk' && (
            <BulkImportPanel
              bulkText={bulkText}
              setBulkText={setBulkText}
              bulkRunning={bulkRunning}
              bulkLog={bulkLog}
              bulkFailed={bulkFailed}
              bulkProgress={bulkProgress}
              onStart={confirmBulkImport}
              onRetryFailed={confirmRetryFailedBulkImport}
              onStop={() => { bulkAbort.current = true }}
              bulkDelay={settings?.bulkDelay ?? 5}
            />
          )}

          {addPanelMode === 'lookup' && (
            <BulkUsernameLookupPanel
              value={bulkLookupText}
              onChange={setBulkLookupText}
              result={bulkLookupResult}
              onRun={handleBulkLookup}
              onClear={() => { setBulkLookupText(''); setBulkLookupResult(null) }}
            />
          )}
        </section>
          </>
        )}

        <section>
          {path !== '/scheduler' && path !== '/logs' && (
            <>
              <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <h2 className="font-medium">Tài khoản ({filtered.length})</h2>
              {statusFilter !== 'all' && (
                <button
                  onClick={() => setStatusFilter('all')}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                    statusFilter === 'abnormal' || statusFilter === 'error' || statusFilter === 'locked' || statusFilter === 'blocked' ? 'bg-rose-100 dark:bg-rose-500/20 text-rose-600 dark:text-rose-400'
                    : statusFilter === 'no_posts' || statusFilter === 'no_insights' ? 'bg-indigo-100 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400'
                    : 'bg-emerald-100 dark:bg-emerald-500/20 text-emerald-600 dark:text-emerald-400'
                  }`}
                >
                  {{ all: 'Tổng', ok: 'Hoạt động', error: 'Token die', locked: 'Bị khoá', blocked: 'Bị block', normal: 'Bình thường', abnormal: 'Bất thường', no_posts: 'Chưa lấy posts', no_insights: 'Chưa lấy insights' }[statusFilter]}
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={selectedIds.size > 0 ? selectNone : selectAll}
                disabled={filtered.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:bg-neutral-800 disabled:opacity-50 text-xs"
              >
                {selectedIds.size > 0
                  ? <><CheckSquare className="w-3.5 h-3.5" /> Bỏ chọn</>
                  : <><Square className="w-3.5 h-3.5" /> Chọn tất cả</>}
              </button>
              <button
                onClick={confirmRefreshAll}
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
                onClick={confirmFetchAllPosts}
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
                onClick={confirmFetchAllInsights}
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
          </>
          )}

          {path === '/logs' && (
            <div className="mb-4 p-4 rounded-xl border border-indigo-500/30 bg-indigo-500/5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-indigo-300">Logs toàn tool</h3>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => navigate('/')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-xs"
                  >
                    <Home className="w-3.5 h-3.5" /> Về trang chính
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs text-neutral-300">
                <span className="px-2 py-1 rounded border border-neutral-700">Tổng logs: {appLogs.length}</span>
                <span className="px-2 py-1 rounded border border-neutral-700">Dung lượng: {formatBytes(appLogsBytes)}</span>
                <button
                  onClick={() => clearAppLogs()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-rose-800 text-rose-400 hover:bg-rose-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Clear logs
                </button>
              </div>

              <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2">
                {appLogs.length === 0 ? (
                  <div className="text-xs text-neutral-500">Chưa có app log</div>
                ) : (
                  <div className="space-y-1 max-h-[55vh] overflow-y-auto">
                    {appLogs.map((l) => (
                      <div key={l.id} className="text-xs font-mono text-neutral-300 rounded px-2 py-1 border border-neutral-800/70">
                        <div className="flex items-center justify-between gap-2">
                          <span>{new Date(l.at).toLocaleString()} · {l.source} · {l.action}</span>
                          <span className={l.level === 'error' ? 'text-rose-400' : l.level === 'warn' ? 'text-amber-300' : 'text-emerald-300'}>{l.level}</span>
                        </div>
                        <div className="text-neutral-300 mt-0.5">{l.message?.startsWith('[API]') ? <><span className="text-sky-400 font-medium">[API]</span>{l.message.slice(5)}</> : l.message?.startsWith('[Cache]') ? <><span className="text-lime-400 font-medium">[Cache]</span>{l.message.slice(7)}</> : l.message}</div>
                        {l.source === 'scheduler' && l.action === 'run' && Array.isArray(l.meta?.failures) && l.meta.failures.length > 0 ? (
                          <div className="mt-1 pl-2 border-l border-rose-500/30 space-y-0.5 text-[11px]">
                            {summarizeScheduleFailures(l.meta.failures).length > 0 && (
                              <div className="text-amber-300">
                                Nhóm lỗi: {summarizeScheduleFailures(l.meta.failures).map(g => `${g.reason} (${g.count})`).join(' · ')}
                              </div>
                            )}
                            {(expandedAppLogFailures.has(l.id) ? l.meta.failures : l.meta.failures.slice(0, SCHEDULE_FAILURE_PREVIEW)).map((f, idx) => (
                              <div key={`${l.id}_af_${idx}`} className="text-rose-300 break-all">
                                • {f.username ? `@${f.username}` : f.accountId}{f.token ? ` · ${f.token}` : ''} · {f.error}
                              </div>
                            ))}
                            {(Number(l.meta?.failHidden || 0) > 0 || l.meta.failures.length > SCHEDULE_FAILURE_PREVIEW) && (
                              <button
                                onClick={() => toggleAppLogFailureExpand(l.id)}
                                className="text-indigo-300 hover:text-indigo-200 underline"
                              >
                                {expandedAppLogFailures.has(l.id)
                                  ? 'Thu gọn lỗi'
                                  : `+ ${Math.max(Number(l.meta?.failHidden || 0), l.meta.failures.length - SCHEDULE_FAILURE_PREVIEW)} lỗi khác... (click để xem tất cả)`}
                              </button>
                            )}
                          </div>
                        ) : l.source === 'scheduler' && l.action === 'run' && Number(l.meta?.fail || 0) > 0 ? (
                          <div className="mt-1 pl-2 border-l border-amber-500/30 text-[11px] text-amber-300">
                            Log cũ: không có chi tiết token/account cho lỗi này.
                          </div>
                        ) : (
                          l.meta && <div className="text-neutral-500 mt-0.5 break-all">{JSON.stringify(l.meta)}</div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {path === '/scheduler' && (
            <div className="mb-4 p-4 rounded-xl border border-amber-500/30 bg-amber-500/5 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium text-amber-300">Hẹn giờ fetch posts</h3>
                <div className="flex items-center gap-2">
                  {scheduleRunning && <span className="text-xs text-indigo-300 inline-flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Đang chạy lịch...</span>}
                  <button
                    onClick={() => navigate('/')}
                    className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-xs"
                  >
                    <Home className="w-3.5 h-3.5" /> Về trang chính
                  </button>
                </div>
              </div>

              <div className="grid md:grid-cols-5 gap-2">
                <label className="text-xs text-neutral-400">
                  Chế độ
                  <select
                    value={scheduleMode}
                    onChange={(e) => setScheduleMode(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
                  >
                    <option value="once">Hẹn 1 lần</option>
                    <option value="repeat">Lặp theo chu kỳ</option>
                  </select>
                </label>

                {scheduleMode === 'once' ? (
                  <label className="text-xs text-neutral-400 md:col-span-2">
                    Thời điểm chạy
                    <input
                      type="datetime-local"
                      value={scheduleAt}
                      onChange={(e) => setScheduleAt(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
                    />
                  </label>
                ) : (
                  <div className="md:col-span-2 space-y-2">
                    <div className="grid grid-cols-2 gap-2">
                      <label className="text-xs text-neutral-400">
                        Chu kỳ
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={scheduleEveryValue}
                          onChange={(e) => setScheduleEveryValue(e.target.value)}
                          className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
                        />
                      </label>
                      <label className="text-xs text-neutral-400">
                        Đơn vị
                        <select
                          value={scheduleRepeatUnit}
                          onChange={(e) => setScheduleRepeatUnit(e.target.value)}
                          className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
                        >
                          <option value="minute">Phút</option>
                          <option value="hour">Giờ</option>
                          <option value="day">Ngày</option>
                        </select>
                      </label>
                    </div>
                    {scheduleRepeatUnit === 'day' && (
                      <div className="grid grid-cols-3 gap-2">
                        <label className="text-xs text-neutral-400">
                          Giờ
                          <input
                            type="number"
                            min="0"
                            max="23"
                            step="1"
                            value={scheduleDailyHour}
                            onChange={(e) => setScheduleDailyHour(e.target.value)}
                            className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
                          />
                        </label>
                        <label className="text-xs text-neutral-400">
                          Phút
                          <input
                            type="number"
                            min="0"
                            max="59"
                            step="1"
                            value={scheduleDailyMinute}
                            onChange={(e) => setScheduleDailyMinute(e.target.value)}
                            className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
                          />
                        </label>
                        <label className="text-xs text-neutral-400">
                          Giây
                          <input
                            type="number"
                            min="0"
                            max="59"
                            step="1"
                            value={scheduleDailySecond}
                            onChange={(e) => setScheduleDailySecond(e.target.value)}
                            className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                )}

                <label className="text-xs text-neutral-400">
                  Target
                  <select
                    value={scheduleTargetType}
                    onChange={(e) => setScheduleTargetType(e.target.value)}
                    className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
                  >
                    <option value="selected">Selected</option>
                    <option value="all">All</option>
                  </select>
                </label>

                {showScheduleDelay && (
                  <label className="text-xs text-neutral-400">
                    Delay riêng (giây)
                    <input
                      type="number"
                      min="1"
                      step="1"
                      value={scheduleDelaySec}
                      onChange={(e) => setScheduleDelaySec(e.target.value)}
                      className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
                    />
                  </label>
                )}
              </div>

              {scheduleTargetType === 'selected' && (
                <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-xs text-neutral-400">Chọn tài khoản chạy lịch ({selectedIds.size}/{accounts.length})</div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setSelectedIds(new Set(accounts.map(a => a.id)))}
                        className="px-2 py-1 rounded border border-neutral-200 dark:border-neutral-800 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-900"
                      >
                        Chọn tất cả
                      </button>
                      <button
                        onClick={() => setSelectedIds(new Set())}
                        className="px-2 py-1 rounded border border-neutral-200 dark:border-neutral-800 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-900"
                      >
                        Bỏ chọn
                      </button>
                    </div>
                  </div>

                  {accounts.length === 0 ? (
                    <div className="text-xs text-neutral-500">Chưa có tài khoản nào.</div>
                  ) : (
                    <div className="max-h-40 overflow-y-auto space-y-1 pr-1">
                      {accounts.map((a) => (
                        <label
                          key={a.id}
                          className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-neutral-200/60 dark:hover:bg-neutral-900 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedIds.has(a.id)}
                            onChange={() => toggleSelect(a.id)}
                            className="w-3.5 h-3.5"
                          />
                          <span className="truncate">@{a.username || a.id}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={createSchedule}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-medium text-neutral-900"
                >
                  <Clock className="w-3.5 h-3.5" /> {editingScheduleId ? 'Lưu chỉnh sửa' : 'Tạo lịch'}
                </button>
                {editingScheduleId && (
                  <button
                    onClick={resetScheduleForm}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-900 text-xs"
                  >
                    <X className="w-3.5 h-3.5" /> Hủy sửa
                  </button>
                )}
                {scheduleMsg && <span className="text-xs text-neutral-300">{scheduleMsg}</span>}
              </div>

              <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2 space-y-2">
                <div className="text-xs text-neutral-400">Danh sách lịch</div>
                {scheduledTasks.length === 0 ? (
                  <div className="text-xs text-neutral-500">Chưa có lịch nào</div>
                ) : (
                  <div className="space-y-2 max-h-52 overflow-y-auto">
                    {scheduledTasks.map((task) => (
                      <div key={task.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-300">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate">
                            <span className="font-medium">{task.mode === 'once'
                              ? '1 lần'
                              : `Lặp mỗi ${task.everyValue} ${task.repeatUnit === 'day' ? 'ngày' : task.repeatUnit === 'hour' ? 'giờ' : 'phút'}${task.repeatUnit === 'day' && Number.isFinite(task.dailyHour) && Number.isFinite(task.dailyMinute) && Number.isFinite(task.dailySecond) ? ` lúc ${String(task.dailyHour).padStart(2, '0')}:${String(task.dailyMinute).padStart(2, '0')}:${String(task.dailySecond).padStart(2, '0')}` : ''}`}</span>
                            {' · '}target <strong>{task.targetType === 'all' ? 'All' : 'Selected'}</strong>
                            {' · '}snapshot <strong>{task.snapshotIds?.length || 0}</strong>
                          </div>
                          <div className="flex items-center gap-1">
                            {task.status !== 'running' && task.status !== 'cancelled' && (
                              <button
                                onClick={() => startEditSchedule(task)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-neutral-300 dark:border-neutral-700 text-neutral-300 hover:bg-neutral-200/20 dark:hover:bg-neutral-900"
                              >
                                <Settings className="w-3 h-3" /> Sửa
                              </button>
                            )}
                            {(task.status === 'active' || task.status === 'running') && (
                              <button
                                onClick={() => cancelScheduleTask(task.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-800 text-rose-400 hover:bg-rose-500/10"
                              >
                                <X className="w-3 h-3" /> Hủy
                              </button>
                            )}
                            {task.status === 'cancelled' && (
                              <button
                                onClick={() => deleteCancelledScheduleTask(task.id)}
                                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-800 text-rose-400 hover:bg-rose-500/10"
                              >
                                <Trash2 className="w-3 h-3" /> Xóa
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-neutral-400">
                          <span>Trạng thái: <strong>{task.status}</strong></span>
                          <span>Kế tiếp: {task.nextRunAt ? new Date(task.nextRunAt).toLocaleString() : '—'}</span>
                        </div>
                        {task.lastResult && (
                          <div className="mt-1 text-[11px] text-neutral-400">
                            Run gần nhất: ok {task.lastResult.ok} / fail {task.lastResult.fail} · {task.lastResult.durationSec}s
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-2">
                <div className="text-xs text-neutral-400 mb-1">Logs lịch chạy (mới nhất)</div>
                {scheduleLogs.length === 0 ? (
                  <div className="text-xs text-neutral-500">Chưa có log</div>
                ) : (
                  <div className="space-y-1 max-h-36 overflow-y-auto">
                    {scheduleLogs.map((l) => (
                      <div key={l.id} className="text-xs font-mono text-neutral-300">
                        <div className="flex items-center justify-between gap-2">
                          <span>{new Date(l.at).toLocaleString()} · {l.taskId} · {l.type}</span>
                          {l.type === 'run'
                            ? <span className={l.fail > 0 ? 'text-amber-300' : 'text-emerald-300'}>ok {l.success} / fail {l.fail} · {l.durationSec}s</span>
                            : <span className="text-neutral-400">{l.message || ''}</span>}
                        </div>
                        {l.type === 'run' && l.fail > 0 && Array.isArray(l.failures) && l.failures.length > 0 && (
                          <div className="mt-1 pl-2 border-l border-rose-500/30 space-y-0.5 text-[11px]">
                            {summarizeScheduleFailures(l.failures).length > 0 && (
                              <div className="text-amber-300">
                                Nhóm lỗi: {summarizeScheduleFailures(l.failures).map(g => `${g.reason} (${g.count})`).join(' · ')}
                              </div>
                            )}
                            {(expandedScheduleFailures.has(l.id) ? l.failures : l.failures.slice(0, SCHEDULE_FAILURE_PREVIEW)).map((f, idx) => (
                              <div key={`${l.id}_f_${idx}`} className="text-rose-300 break-all">
                                • {f.username ? `@${f.username}` : f.accountId}{f.token ? ` · ${f.token}` : ''} · {f.error}
                              </div>
                            ))}
                            {(l.failHidden > 0 || l.failures.length > SCHEDULE_FAILURE_PREVIEW) && (
                              <button
                                onClick={() => toggleScheduleFailureExpand(l.id)}
                                className="text-indigo-300 hover:text-indigo-200 underline"
                              >
                                {expandedScheduleFailures.has(l.id)
                                  ? 'Thu gọn lỗi'
                                  : `+ ${Math.max(l.failHidden || 0, l.failures.length - SCHEDULE_FAILURE_PREVIEW)} lỗi khác... (click để xem tất cả)`}
                              </button>
                            )}
                          </div>
                        )}
                        {l.type === 'run' && l.fail > 0 && (!Array.isArray(l.failures) || l.failures.length === 0) && (
                          <div className="mt-1 pl-2 border-l border-amber-500/30 text-[11px] text-amber-300">
                            Log cũ: không có chi tiết token/account cho lỗi này.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {path !== '/scheduler' && path !== '/logs' && (
            <div className="grid md:grid-cols-2 gap-3">
              {paged.map(a => (
                <AccountCard
                  key={a.id}
                  account={a}
                  settings={settings}
                  selected={selectedIds.has(a.id)}
                  onToggleSelect={() => toggleSelect(a.id)}
                  onRefresh={refreshOne}
                  onRemove={remove}
                  onOpen={(id) => navigate('/' + id)}
                  onAddFavWorker={addBuffFavWorker}
                  onBuffMe={handleBuffMe}
                  buffFavWorkers={buffFavWorkers}
                  onActionLog={appendAppLog}
                  duplicateCaptions={getDuplicateCaptions(a.id)}
                  fetchTick={postsFetchTick}
                  followersBaseline={followersBaseline}
                  setFollowersBaseline={setFollowersBaseline}
                  onCacheChange={() => setCacheTick(t => t + 1)}
                />
              ))}
              {filtered.length === 0 && (
                <div className="md:col-span-2 text-center text-sm text-neutral-400 dark:text-neutral-500 py-10 border border-dashed border-neutral-300 dark:border-neutral-800 rounded-xl">
                  Chưa có tài khoản nào. Thêm token ở trên để bắt đầu.
                </div>
              )}
            </div>
          )}

          {path !== '/scheduler' && path !== '/logs' && filtered.length > 0 && (
            <div className="flex items-center justify-center gap-3 mt-4">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={safeP <= 1}
                className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-30 text-sm"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-sm text-neutral-400">
                Trang {safeP}/{totalPages} · Hiển thị {(safeP - 1) * perPage + 1}–{Math.min(safeP * perPage, filtered.length)}/{filtered.length}
              </span>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={safeP >= totalPages}
                className="p-2 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-30 text-sm"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <select
                value={perPage}
                onChange={(e) => { const v = Number(e.target.value); setPerPage(v); localStorage.setItem('td.perPage', v); setPage(1) }}
                className="px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
              >
                {[10, 20, 50, 100].map(n => <option key={n} value={n}>{n}/trang</option>)}
              </select>
            </div>
          )}
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-6 py-6 text-xs text-neutral-400 dark:text-neutral-600 flex items-center justify-between">
        <span>Threads Doctor v{APP_VERSION} · {new Date().getFullYear()}</span>
        <button
          onClick={() => { if (window.electronAPI?.restartApp) { window.electronAPI.restartApp() } else { window.location.reload() } }}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-800 text-xs"
          title="Restart app để áp dụng bản cập nhật mới"
        >
          <RefreshCw className="w-3 h-3" /> Cập nhật
        </button>
      </footer>

      {confirmBulkAction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setConfirmBulkAction(null)}>
          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-2xl p-6 max-w-md w-full mx-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 text-amber-500 dark:text-amber-400 mb-3">
              <AlertTriangle className="w-5 h-5" />
              <h3 className="font-semibold">{confirmBulkAction.title}</h3>
            </div>
            <p className="text-sm text-neutral-700 dark:text-neutral-300 mb-1">{confirmBulkAction.message}</p>
            {confirmBulkAction.dangerNote && (
              <p className="text-xs text-neutral-500 dark:text-neutral-500 mb-4">{confirmBulkAction.dangerNote}</p>
            )}
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmBulkAction(null)}
                className="px-4 py-2 rounded-lg border border-neutral-300 dark:border-neutral-700 hover:bg-neutral-100 dark:hover:bg-neutral-800 text-sm"
              >
                Hủy
              </button>
              <button
                onClick={runConfirmedBulkAction}
                className="px-4 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium"
              >
                {confirmBulkAction.confirmLabel || 'Xác nhận'}
              </button>
            </div>
          </div>
        </div>
      )}

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
  const [tokenCacheInput, setTokenCacheInput] = useState('')
  const [tokenCacheMsg, setTokenCacheMsg] = useState('')

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

  const handleClearTokenCache = () => {
    const token = tokenCacheInput.trim()
    if (!token) {
      setTokenCacheMsg('Vui lòng nhập token')
      return
    }
    if (token.length < 8) {
      setTokenCacheMsg('Token quá ngắn (cần ít nhất 8 ký tự)')
      return
    }
    const fp = tokenFingerprint(token)
    const tail = token.slice(-8)
    const keyNew = `td.cache.v1.me:${fp}`
    const keyLegacy = `td.cache.v1.me:${tail}`
    const existed = localStorage.getItem(keyNew) != null || localStorage.getItem(keyLegacy) != null
    localStorage.removeItem(keyNew)
    localStorage.removeItem(keyLegacy)
    setTokenCacheMsg(existed ? `Đã xóa cache me (fp: ${fp}, legacy: ${tail})` : `Không tìm thấy cache me cho token này`)
    setTimeout(() => setTokenCacheMsg(''), 3000)
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
        <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 space-y-2">
          <div className="text-xs text-neutral-300 font-medium">Clear cache theo token</div>
          <div className="flex items-center gap-2">
            <input
              value={tokenCacheInput}
              onChange={(e) => setTokenCacheInput(e.target.value)}
              placeholder="Dán token để xóa cache me (dùng đuôi 8 ký tự)"
              className="flex-1 px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-xs font-mono"
            />
            <button
              onClick={handleClearTokenCache}
              className="px-3 py-2 rounded-lg border border-rose-800 text-rose-400 hover:bg-rose-500/10 text-xs"
            >
              Xóa cache token
            </button>
          </div>
          {tokenCacheMsg && <div className="text-xs text-neutral-400">{tokenCacheMsg}</div>}
        </div>
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

function BulkUsernameLookupPanel({ value, onChange, result, onRun, onClear }) {
  const parsedCount = parseBulkUsernames(value).length
  const previewLimit = 100
  const missingPreview = result?.missingUsernames?.slice(0, previewLimit) || []
  const hiddenMissing = Math.max(0, (result?.missingUsernames?.length || 0) - missingPreview.length)

  return (
    <div className="space-y-3">
      <label className="block">
        <span className="text-xs text-neutral-400 dark:text-neutral-400 mb-1 block">Dán danh sách username (mỗi dòng 1 username, chấp nhận @username hoặc phân tách bằng dấu phẩy)</span>
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={6}
          placeholder={'@user_a\nuser_b\nuser_c'}
          className="w-full px-3 py-2 rounded-lg bg-neutral-100 dark:bg-neutral-950 border border-neutral-200 dark:border-neutral-800 focus:border-indigo-500 outline-none text-sm font-mono resize-y"
        />
      </label>

      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-400 dark:text-neutral-500">{parsedCount} username hợp lệ (đã chuẩn hoá + bỏ trùng)</span>
        <div className="flex items-center gap-2">
          <button
            onClick={onClear}
            disabled={!value.trim() && !result}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-200 dark:border-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-800 disabled:opacity-50 text-sm"
          >
            <X className="w-4 h-4" /> Clear input
          </button>
          <button
            onClick={onRun}
            disabled={parsedCount === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-sm font-medium"
          >
            <Search className="w-4 h-4" /> Kiểm tra
          </button>
        </div>
      </div>

      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="px-2 py-1 rounded border border-neutral-200 dark:border-neutral-800">Tổng nhập: {result.inputCount}</span>
            <span className="px-2 py-1 rounded border border-emerald-500/40 text-emerald-300">Tồn tại: {result.matchedUsernames.length}</span>
            <span className="px-2 py-1 rounded border border-rose-500/40 text-rose-300">Thiếu: {result.missingUsernames.length}</span>
            {result.missingUsernames.length > 0 && (
              <CopyBtn text={result.missingUsernames.join('\n')} label="Copy thiếu" />
            )}
          </div>

          {result.missingUsernames.length === 0 ? (
            <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-xs text-emerald-300">
              Không phát hiện username nào bị thiếu trong tool.
            </div>
          ) : (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-1">
              <div className="text-xs font-medium text-rose-300">Username thiếu ({result.missingUsernames.length})</div>
              <div className="max-h-52 overflow-y-auto space-y-1">
                {missingPreview.map((u) => (
                  <div key={u} className="text-xs font-mono text-rose-300 break-all">• @{u}</div>
                ))}
                {hiddenMissing > 0 && (
                  <div className="text-xs text-neutral-500">+ {hiddenMissing} username nữa...</div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function BulkImportPanel({ bulkText, setBulkText, bulkRunning, bulkLog, bulkFailed = [], bulkProgress, onStart, onRetryFailed, onStop, bulkDelay = 5 }) {
  const logRef = useRef(null)
  const [summary, setSummary] = useState(null)
  const prevRunning = useRef(false)

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [bulkLog])

  useEffect(() => {
    if (prevRunning.current && !bulkRunning && bulkLog.length > 0) {
      const ok = bulkLog.filter(l => l.ok).length
      const fail = bulkLog.filter(l => !l.ok).length
      setSummary({ ok, fail, total: bulkLog.length })
    }
    prevRunning.current = bulkRunning
  }, [bulkRunning, bulkLog])

  const lines = bulkText.split('\n').filter(l => l.trim()).length

  return (
    <div className="space-y-3">
      {summary && !bulkRunning && (
        <div className={`flex items-center justify-between px-4 py-3 rounded-xl border ${summary.fail > 0 ? 'border-amber-500/30 bg-amber-500/5' : 'border-emerald-500/30 bg-emerald-500/5'}`}>
          <div className="flex items-center gap-2 text-sm">
            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            <span>Hoàn thành: <strong className="text-emerald-400">{summary.ok} thành công</strong>{summary.fail > 0 && <>, <strong className="text-rose-400">{summary.fail} thất bại</strong></>} / {summary.total} token</span>
          </div>
          <button onClick={() => setSummary(null)} className="text-neutral-400 hover:text-neutral-200"><X className="w-4 h-4" /></button>
        </div>
      )}
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
          {lines} token{lines !== 1 ? 's' : ''} · xử lý tuần tự, delay {bulkDelay}s/token
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
            onClick={() => { setSummary(null); onStart() }}
            disabled={bulkRunning || lines === 0}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-400 disabled:opacity-60 text-sm font-medium"
          >
            {bulkRunning
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> {bulkProgress.done}/{bulkProgress.total}</>
              : <><Plus className="w-4 h-4" /> Bắt đầu nạp</>}
          </button>
          {!bulkRunning && bulkFailed.length > 0 && (
            <button
              onClick={() => { setSummary(null); onRetryFailed?.() }}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-500/40 text-amber-300 hover:bg-amber-500/10 text-sm"
            >
              <RefreshCw className="w-4 h-4" /> Thử lại token lỗi ({bulkFailed.length})
            </button>
          )}
        </div>
      </div>
      {bulkFailed.length > 0 && !bulkRunning && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-3 space-y-1">
          <div className="text-xs font-medium text-rose-300">Token lỗi ({bulkFailed.length})</div>
          <div className="space-y-1 max-h-28 overflow-y-auto">
            {bulkFailed.map((item, i) => (
              <div key={`${item.token}_${i}`} className="text-xs font-mono text-rose-300 break-all">
                • {maskToken(item.token)} — {item.error}
              </div>
            ))}
          </div>
        </div>
      )}
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

function AccountCard({ account, settings, selected, onToggleSelect, onRefresh, onRemove, onOpen, onAddFavWorker, onBuffMe, buffFavWorkers = [], onActionLog, duplicateCaptions = [], fetchTick = 0, followersBaseline = {}, setFollowersBaseline, onCacheChange }) {
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
      onActionLog?.({ level: 'info', source: 'account', action: 'card_fetch_insights_start', message: `[API] Bắt đầu lấy insights cho @${a.username || a.id}`, meta: { id: a.id } })
      const data = await fetchInsights(a.id, a.token, { settings, skipCache: true })
      setInsights(data)
      if (data?.followers_count != null && setFollowersBaseline) {
        setFollowersBaseline(prev => ({ ...prev, [a.id]: { count: data.followers_count, timestamp: Date.now() } }))
      }
      onActionLog?.({ level: 'info', source: 'account', action: 'card_fetch_insights_ok', message: `[API] Lấy insights thành công cho @${a.username || a.id}`, meta: { id: a.id } })
    } catch (err) {
      setInsights(null)
      onActionLog?.({ level: 'warn', source: 'account', action: 'card_fetch_insights_fail', message: `[API] ${err?.message || `Lấy insights thất bại cho @${a.username || a.id}`}`, meta: { id: a.id } })
    } finally { setFetchingInsights(false); onCacheChange?.() }
  }

  const handleGetRecent = async () => {
    setFetching(true)
    try {
      const posts = await fetchPosts(a.id, a.token, { settings, limit: 10, skipCache: true })
      setLastPostTime(posts.length > 0 ? posts[0].timestamp : null)
    } catch {
      setLastPostTime(null)
    } finally { setFetching(false); onCacheChange?.() }
  }

  const [fetchingPosts, setFetchingPosts] = useState(false)
  const handleFetchPosts = async () => {
    setFetchingPosts(true)
    try {
      onActionLog?.({ level: 'info', source: 'account', action: 'card_fetch_posts_start', message: `[API] Bắt đầu lấy posts cho @${a.username || a.id}`, meta: { id: a.id } })
      const posts = await fetchPosts(a.id, a.token, { settings, limit: 10, skipCache: true })
      setLastPostTime(posts.length > 0 ? posts[0].timestamp : null)
      onActionLog?.({ level: 'info', source: 'account', action: 'card_fetch_posts_ok', message: `[API] Lấy posts thành công cho @${a.username || a.id}`, meta: { id: a.id, count: posts.length } })
    } catch (err) {
      onActionLog?.({ level: 'warn', source: 'account', action: 'card_fetch_posts_fail', message: `[API] ${err?.message || `Lấy posts thất bại cho @${a.username || a.id}`}`, meta: { id: a.id } })
    }
    finally { setFetchingPosts(false); onCacheChange?.() }
  }

  const [contextMenu, setContextMenu] = useState(null)

  useEffect(() => {
    if (!contextMenu) return
    const handleEsc = (e) => {
      if (e.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('keydown', handleEsc)
    return () => {
      window.removeEventListener('keydown', handleEsc)
    }
  }, [contextMenu])

  const openContextMenu = (e) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY })
  }

  const closeContextMenu = () => setContextMenu(null)

  const runMenuAction = async (fn) => {
    closeContextMenu()
    await fn()
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
    <div
      onContextMenu={openContextMenu}
      className={`rounded-xl border p-4 transition-shadow duration-150 hover:shadow-lg dark:hover:shadow-black/50 ${selected
        ? 'border-indigo-500 bg-indigo-500/5 dark:hover:ring-1 dark:hover:ring-indigo-500/40'
        : 'border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/40 hover:border-neutral-300 dark:hover:border-neutral-700 dark:hover:bg-neutral-900/70 dark:hover:ring-1 dark:hover:ring-neutral-700/70'}`}
    >
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
            {buffFavWorkers.includes(a.id) ? (
              <button onClick={() => onAddFavWorker?.(a.id)} className="text-amber-400 hover:text-amber-300" title="Favourite worker (click để bỏ)">
                <User className="w-3.5 h-3.5" />
              </button>
            ) : null}
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
                href={`https://www.threads.com/@${a.username}`}
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

      {contextMenu && (
        <div
          className="fixed inset-0 z-40"
          onClick={closeContextMenu}
          onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); closeContextMenu() }}
        >
          <div
            className="fixed z-50 min-w-[180px] rounded-xl border border-neutral-200 dark:border-neutral-700 bg-white dark:bg-neutral-900 shadow-xl p-1"
            style={{ left: Math.min(contextMenu.x, window.innerWidth - 200), top: Math.min(contextMenu.y, window.innerHeight - 240) }}
            onClick={(e) => e.stopPropagation()}
          >
            <button onClick={() => runMenuAction(() => onOpen(a.id))} className="w-full text-left px-3 py-1.5 rounded-lg text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">Mở chi tiết</button>
            <button disabled={!a.username} onClick={() => runMenuAction(async () => { await navigator.clipboard.writeText(`https://www.threads.com/@${a.username}`) })} className="w-full text-left px-3 py-1.5 rounded-lg text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50">Copy URL profile</button>
            <button onClick={() => runMenuAction(() => onToggleSelect())} className="w-full text-left px-3 py-1.5 rounded-lg text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">{selected ? 'Bỏ chọn' : 'Chọn tài khoản'}</button>
            <button disabled={loading} onClick={() => runMenuAction(() => onRefresh(a.id))} className="w-full text-left px-3 py-1.5 rounded-lg text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50">Refresh token</button>
            <button disabled={fetchingInsights} onClick={() => runMenuAction(handleGetInsights)} className="w-full text-left px-3 py-1.5 rounded-lg text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50">Lấy insights</button>
            <button disabled={fetchingPosts} onClick={() => runMenuAction(handleFetchPosts)} className="w-full text-left px-3 py-1.5 rounded-lg text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800 disabled:opacity-50">Lấy posts</button>
            <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" />
            <button onClick={() => runMenuAction(() => onRemove(a.id))} className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-rose-500 hover:bg-rose-500/10">Xóa tài khoản</button>
            <div className="my-1 h-px bg-neutral-200 dark:bg-neutral-700" />
            <button onClick={() => runMenuAction(() => onAddFavWorker?.(a.id))} className="w-full text-left px-3 py-1.5 rounded-lg text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800">Add to favourite workers</button>
            <button onClick={() => runMenuAction(() => onBuffMe?.(a.id))} className="w-full text-left px-3 py-1.5 rounded-lg text-xs text-amber-400 hover:bg-amber-500/10">Buff me</button>
          </div>
        </div>
      )}
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

function ProfileView({ account, settings, navigate, followersBaseline = {}, setFollowersBaseline, onActionLog }) {
  const [posts, setPosts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [insights, setInsights] = useState(null)
  const [fetchingInsights, setFetchingInsights] = useState(false)

  const handleFetchInsights = async () => {
    setFetchingInsights(true)
    onActionLog?.({ level: 'info', source: 'profile', action: 'fetch_insights_start', message: `[API] Bắt đầu lấy insights profile @${account.username}`, meta: { id: account.id } })
    try {
      const data = await fetchInsights(account.id, account.token, { settings, skipCache: true })
      setInsights(data)
      if (data?.followers_count != null && setFollowersBaseline) {
        setFollowersBaseline(prev => ({ ...prev, [account.id]: { count: data.followers_count, timestamp: Date.now() } }))
      }
      onActionLog?.({ level: 'info', source: 'profile', action: 'fetch_insights_ok', message: `[API] Lấy insights profile thành công @${account.username}`, meta: { id: account.id } })
    } catch (err) {
      onActionLog?.({ level: 'warn', source: 'profile', action: 'fetch_insights_fail', message: `[API] ${err?.message || `Lấy insights profile thất bại @${account.username}`}`, meta: { id: account.id } })
    }
    finally { setFetchingInsights(false) }
  }

  useEffect(() => {
    const postsTtl = (settings?.cacheTTLPosts ?? 30) * 60 * 1000 || 30 * 60 * 1000
    const insightsTtl = (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || 30 * 60 * 1000

    const cachedPosts = cacheGet(`posts:${account.id}:10`, postsTtl)
    if (Array.isArray(cachedPosts)) {
      setPosts(cachedPosts)
      setLoading(false)
      onActionLog?.({ level: 'info', source: 'profile', action: 'load_posts_cache', message: `[Cache] Đọc posts từ cache @${account.username}`, meta: { id: account.id, count: cachedPosts.length } })
    } else {
      setPosts([])
      setLoading(false)
    }

    const cachedInsights = cacheGet(`insights:${account.id}`, insightsTtl)
    if (cachedInsights) {
      setInsights(cachedInsights)
      if (cachedInsights.followers_count != null && setFollowersBaseline) {
        setFollowersBaseline(prev => ({ ...prev, [account.id]: { count: cachedInsights.followers_count, timestamp: Date.now() } }))
      }
      onActionLog?.({ level: 'info', source: 'profile', action: 'load_insights_cache', message: `[Cache] Đọc insights từ cache @${account.username}`, meta: { id: account.id } })
    }
  }, [account.id])

  const [fetchingPosts, setFetchingPosts] = useState(false)

  const handleFetchPosts = async () => {
    setFetchingPosts(true)
    setError('')
    onActionLog?.({ level: 'info', source: 'profile', action: 'fetch_posts_start', message: `[API] Bắt đầu lấy posts profile @${account.username}`, meta: { id: account.id } })
    try {
      const list = await fetchPosts(account.id, account.token, { settings, limit: 10, skipCache: true })
      setPosts(list)
      onActionLog?.({ level: 'info', source: 'profile', action: 'fetch_posts_ok', message: `[API] Lấy posts profile thành công @${account.username}`, meta: { id: account.id, count: list.length } })
    } catch (err) {
      setError(err.message)
      onActionLog?.({ level: 'warn', source: 'profile', action: 'fetch_posts_fail', message: `[API] ${err?.message || `Lấy posts profile thất bại @${account.username}`}`, meta: { id: account.id } })
    }
    finally { setFetchingPosts(false) }
  }

  const [fetchingAllPI, setFetchingAllPI] = useState(false)
  const [allPIProgress, setAllPIProgress] = useState({ done: 0, total: 0 })
  const [allPITick, setAllPITick] = useState(0)

  const handleFetchAllPostInsights = async () => {
    if (posts.length === 0) return
    setFetchingAllPI(true)
    onActionLog?.({ level: 'info', source: 'profile', action: 'fetch_all_post_insights_start', message: `[API] Bắt đầu lấy insights all posts @${account.username}`, meta: { id: account.id, total: posts.length } })
    setAllPIProgress({ done: 0, total: posts.length })
    const DELAY = (settings?.bulkDelay ?? 5) * 1000
    let fail = 0
    for (let i = 0; i < posts.length; i++) {
      try {
        await fetchPostInsights(posts[i].id, account.token, { settings, skipCache: true })
      } catch {
        fail++
      }
      setAllPIProgress({ done: i + 1, total: posts.length })
      if (i < posts.length - 1) await new Promise(r => setTimeout(r, DELAY))
    }
    setFetchingAllPI(false)
    setAllPITick(t => t + 1)
    onActionLog?.({ level: fail > 0 ? 'warn' : 'info', source: 'profile', action: 'fetch_all_post_insights_finish', message: `[API] Hoàn tất insights all posts @${account.username}: fail ${fail}/${posts.length}`, meta: { id: account.id, total: posts.length, fail } })
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

function PostDetailView({ account, postId, settings, navigate, onActionLog }) {
  const [post, setPost] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pi, setPi] = useState(null)
  const [fetchingPI, setFetchingPI] = useState(false)
  const [replies, setReplies] = useState([])
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
    onActionLog?.({ level: 'info', source: 'post_detail', action: 'send_reply_start', message: `[API] Bắt đầu gửi reply cho post ${postId}`, meta: { accountId: account.id, postId, replyToId } })
    try {
      await postReply(account.id, account.token, { settings, text: replyText.trim(), replyToId })
      setReplyStatus('Đã gửi reply! (đợi 30s để publish)')
      setReplyText('')
      setReplyingTo(null)
      const { replies: fresh, nextCursor: cursor, hasMore: more } = await fetchRepliesPage(postId, account.token, { settings })
      setReplies(fresh); setNextCursor(cursor); setHasMore(more)
      cacheSet(`replies:${postId}`, fresh)
      onActionLog?.({ level: 'info', source: 'post_detail', action: 'send_reply_ok', message: `[API] Gửi reply thành công cho post ${postId}`, meta: { accountId: account.id, postId, replyToId } })
    } catch (err) {
      setReplyStatus('Lỗi: ' + err.message)
      onActionLog?.({ level: 'warn', source: 'post_detail', action: 'send_reply_fail', message: `[API] ${err?.message || `Gửi reply thất bại cho post ${postId}`}`, meta: { accountId: account.id, postId, replyToId } })
    } finally { setSendingReply(false) }
  }

  useEffect(() => {
    let alive = true
    const repliesTtl = (settings?.cacheTTLReplies ?? 10) * 60 * 1000 || 10 * 60 * 1000
    const insightsTtl = (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || 30 * 60 * 1000
    const postTtl = (settings?.cacheTTLPost ?? 30) * 60 * 1000 || 30 * 60 * 1000

    setLoading(true); setError('')
    setReplies([]); setNextCursor(null); setHasMore(false); setPi(null)

    const cachedPost = cacheGet(`post:${postId}`, postTtl)
    if (cachedPost) {
      setPost(cachedPost)
      setLoading(false)
      onActionLog?.({ level: 'info', source: 'post_detail', action: 'load_post_cache', message: `[Cache] Đọc post từ cache ${postId}`, meta: { accountId: account.id, postId } })
    } else {
      fetchPost(postId, account.token, { settings })
        .then(p => { if (alive) setPost(p) })
        .catch(err => { if (alive) setError(err.message) })
        .finally(() => { if (alive) setLoading(false) })
    }

    const cachedPI = cacheGet(`post_insights:${postId}`, insightsTtl)
    if (cachedPI) {
      setPi(cachedPI)
      onActionLog?.({ level: 'info', source: 'post_detail', action: 'load_post_insights_cache', message: `[Cache] Đọc insights post từ cache ${postId}`, meta: { accountId: account.id, postId } })
    }

    const cachedReplies = cacheGet(`replies:${postId}`, repliesTtl)
    if (cachedReplies && Array.isArray(cachedReplies) && cachedReplies.length > 0) {
      setReplies(cachedReplies)
      onActionLog?.({ level: 'info', source: 'post_detail', action: 'load_replies_cache', message: `[Cache] Đọc replies từ cache ${postId}`, meta: { accountId: account.id, postId, count: cachedReplies.length } })
    }

    return () => { alive = false }
  }, [postId])

  const handleRefreshPI = async () => {
    setFetchingPI(true)
    onActionLog?.({ level: 'info', source: 'post_detail', action: 'fetch_post_insights_start', message: `[API] Bắt đầu lấy insights cho post ${postId}`, meta: { accountId: account.id, postId } })
    try {
      const data = await fetchPostInsights(postId, account.token, { settings, skipCache: true })
      setPi(data)
      onActionLog?.({ level: 'info', source: 'post_detail', action: 'fetch_post_insights_ok', message: `[API] Lấy insights post thành công ${postId}`, meta: { accountId: account.id, postId } })
    } catch (err) {
      onActionLog?.({ level: 'warn', source: 'post_detail', action: 'fetch_post_insights_fail', message: `[API] ${err?.message || `Lấy insights post thất bại ${postId}`}`, meta: { accountId: account.id, postId } })
    }
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
              <div className="flex items-center gap-1">
                <a href={post.permalink} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-xs text-indigo-400 hover:text-indigo-300">
                  <ExternalLink className="w-3 h-3" /> Mở trên Threads
                </a>
                <CopyBtn text={post.permalink} label="Link" />
              </div>
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
                onActionLog?.({ level: 'info', source: 'post_detail', action: 'refresh_replies_start', message: `[API] Bắt đầu làm mới replies cho post ${postId}`, meta: { accountId: account.id, postId } })
                try {
                  const { replies: data, nextCursor: cursor, hasMore: more } = await fetchRepliesPage(postId, account.token, { settings })
                  setReplies(data); setNextCursor(cursor); setHasMore(more)
                  cacheSet(`replies:${postId}`, data)
                  onActionLog?.({ level: 'info', source: 'post_detail', action: 'refresh_replies_ok', message: `[API] Làm mới replies thành công cho post ${postId}`, meta: { accountId: account.id, postId, count: data.length } })
                } catch (err) {
                  onActionLog?.({ level: 'warn', source: 'post_detail', action: 'refresh_replies_fail', message: `[API] ${err?.message || `Làm mới replies thất bại cho post ${postId}`}`, meta: { accountId: account.id, postId } })
                }
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
                    setReplies(prev => {
                      const merged = [...prev, ...more]
                      cacheSet(`replies:${postId}`, merged)
                      return merged
                    })
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

const MAX_BUFF_LOGS = 200
const MAX_BUFF_FAILURE_DETAILS = 12
const BUFF_FAILURE_PREVIEW = 3

function BuffView({ accounts, settings, navigate, dark, toggleTheme, initialBossId = null, buffFavWorkers = [], setBuffFavWorkers, buffSchedules, buffLogs, buffRunning, createBuffTask, cancelBuffTask, deleteBuffTask }) {
  const [expandedBuffFailures, setExpandedBuffFailures] = useState(() => new Set())

  const [bossId, setBossId] = useState(initialBossId || '')
  const [bossSearch, setBossSearch] = useState('')
  const [bossPosts, setBossPosts] = useState([])
  const [loadingPosts, setLoadingPosts] = useState(false)

  const [postMode, setPostMode] = useState('random')
  const [buffActionMode, setBuffActionMode] = useState('quote_post')
  const [linkCaption, setLinkCaption] = useState('')
  const [publishDelaySec, setPublishDelaySec] = useState(5)
  const [publishRetryCount, setPublishRetryCount] = useState(5)
  const [publishRetryIntervalSec, setPublishRetryIntervalSec] = useState(2)
  const [selectedPostIds, setSelectedPostIds] = useState(new Set())

  const [workerIds, setWorkerIds] = useState(new Set())
  const [workerSearch, setWorkerSearch] = useState('')
  const [workerSource, setWorkerSource] = useState('all')

  const [buffMode, setBuffMode] = useState('once')
  const [buffEveryValue, setBuffEveryValue] = useState(10)
  const [buffRepeatUnit, setBuffRepeatUnit] = useState('minute')
  const [delayMin, setDelayMin] = useState(3)
  const [delayMax, setDelayMax] = useState(8)

  const [buffMsg, setBuffMsg] = useState('')

  const boss = accounts.find(a => a.id === bossId)
  const availableWorkers = useMemo(() => {
    const normalAccounts = accounts.filter(a => a.id !== bossId && a.status === 'ok' && !isAccountLocked(a) && !isTokenDead(a) && !isTokenBlocked(a))
    return normalAccounts.filter(a => {
      const posts = cacheGet(`posts:${a.id}:10`, (settings?.cacheTTLPosts ?? 30) * 60 * 1000 || 30 * 60 * 1000)
      const isDuplicate = posts && posts.length > 0 && new Set(posts.map(p => (p.text || '').trim())).size < posts.length
      const noPostOver24h = posts && posts.length > 0 && (Date.now() - new Date(posts[0].timestamp).getTime() > 24 * 60 * 60 * 1000)
      return !isDuplicate && !noPostOver24h
    })
  }, [accounts, bossId, settings])

  const filteredBossOptions = useMemo(() => {
    const okAccounts = accounts.filter(a => a.status === 'ok')
    if (!bossSearch.trim()) return okAccounts
    const q = bossSearch.trim().toLowerCase()
    return okAccounts.filter(a => (a.username || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))
  }, [accounts, bossSearch])

  const filteredWorkers = useMemo(() => {
    let list = workerSource === 'favourite'
      ? availableWorkers.filter(a => buffFavWorkers.includes(a.id))
      : availableWorkers
    if (workerSearch.trim()) {
      const q = workerSearch.trim().toLowerCase()
      list = list.filter(a => (a.username || '').toLowerCase().includes(q) || (a.name || '').toLowerCase().includes(q))
    }
    return list
  }, [availableWorkers, workerSearch, workerSource, buffFavWorkers])

  useEffect(() => {
    if (!bossId) { setBossPosts([]); return }
    const bossAcc = accounts.find(a => a.id === bossId)
    if (!bossAcc) return
    let cancelled = false
    setLoadingPosts(true)
    fetchPosts(bossId, bossAcc.token, { settings, limit: 10, skipCache: true })
      .then(posts => { if (!cancelled) setBossPosts(posts || []) })
      .catch(() => { if (!cancelled) setBossPosts([]) })
      .finally(() => { if (!cancelled) setLoadingPosts(false) })
    return () => { cancelled = true }
  }, [bossId])

  const toggleWorker = (id) => setWorkerIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const selectAllWorkers = () => setWorkerIds(new Set(filteredWorkers.map(a => a.id)))
  const selectNoWorkers = () => setWorkerIds(new Set())

  const addFavWorker = (id) => {
    if (buffFavWorkers.includes(id)) return
    const next = [...buffFavWorkers, id]
    setBuffFavWorkers(next)
    saveBuffFavouriteWorkers(next)
  }
  const removeFavWorker = (id) => {
    const next = buffFavWorkers.filter(x => x !== id)
    setBuffFavWorkers(next)
    saveBuffFavouriteWorkers(next)
  }

  const togglePostSelect = (id) => setSelectedPostIds(prev => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const handleCreateBuffTask = () => {
    if (!bossId) { setBuffMsg('Chọn tài khoản boss'); return }
    if (workerIds.size === 0) { setBuffMsg('Chọn ít nhất 1 worker'); return }
    if (postMode === 'selected' && selectedPostIds.size === 0) { setBuffMsg('Chọn ít nhất 1 post'); return }

    const unitMs = { minute: 60000, hour: 3600000, day: 86400000 }
    const intervalMs = (Number(buffEveryValue) || 10) * (unitMs[buffRepeatUnit] || 60000)

    const task = {
      id: `buff_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      status: 'active',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      mode: buffMode,
      bossAccountId: bossId,
      postMode,
      buffMode: buffActionMode,
      linkCaption: linkCaption || '',
      publishDelaySec: Math.max(1, Number(publishDelaySec) || 5),
      publishRetryCount: Math.max(1, Number(publishRetryCount) || 5),
      publishRetryIntervalSec: Math.max(1, Number(publishRetryIntervalSec) || 2),
      selectedPostIds: postMode === 'selected' ? [...selectedPostIds] : [],
      workerIds: [...workerIds],
      delayMin: Math.max(1, Number(delayMin) || 3),
      delayMax: Math.max(Number(delayMin) || 3, Number(delayMax) || 8),
      everyValue: Number(buffEveryValue) || 10,
      repeatUnit: buffRepeatUnit,
      intervalMs,
      nextRunAt: buffMode === 'once' ? Date.now() : Date.now() + intervalMs,
      runCount: 0,
      lastRunAt: null,
      lastResult: null,
    }

    createBuffTask(task)
    setBuffMsg('Đã tạo buff task')
  }

  const toggleBuffFailureExpand = (logId) => {
    setExpandedBuffFailures(prev => {
      const next = new Set(prev)
      next.has(logId) ? next.delete(logId) : next.add(logId)
      return next
    })
  }

  return (
    <PageShell navigate={navigate} title="Buff Account" subtitle="Repost hàng loạt" backTo="/">
      <div className="space-y-4">
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 space-y-4">
          <h3 className="text-sm font-medium text-amber-300">Cấu hình Buff</h3>

          <div className="grid md:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs text-neutral-400">Tài khoản Boss</label>
              <input
                value={bossSearch}
                onChange={(e) => setBossSearch(e.target.value)}
                placeholder="Tìm username boss..."
                className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
              />
              <select
                value={bossId}
                onChange={(e) => { setBossId(e.target.value); setSelectedPostIds(new Set()); setWorkerIds(new Set()) }}
                className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
              >
                <option value="">-- Chọn boss --</option>
                {filteredBossOptions.map(a => (
                  <option key={a.id} value={a.id}>@{a.username || a.id}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-neutral-400">Chế độ Buff</label>
              <div className="flex items-center gap-3 rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 bg-neutral-100 dark:bg-neutral-900">
                <button
                  type="button"
                  onClick={() => setBuffActionMode('repost')}
                  className="inline-flex items-center gap-2 text-xs text-neutral-300"
                >
                  <span className={`w-3.5 h-3.5 rounded-full border ${buffActionMode === 'repost' ? 'border-indigo-400 bg-indigo-400' : 'border-neutral-500'}`} />
                  Repost
                </button>
                <button
                  type="button"
                  onClick={() => setBuffActionMode('quote_post')}
                  className="inline-flex items-center gap-2 text-xs text-neutral-300"
                >
                  <span className={`w-3.5 h-3.5 rounded-full border ${buffActionMode === 'quote_post' ? 'border-indigo-400 bg-indigo-400' : 'border-neutral-500'}`} />
                  Quote
                </button>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-xs text-neutral-400">Chế độ chọn post</label>
              <select
                value={postMode}
                onChange={(e) => setPostMode(e.target.value)}
                className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
              >
                <option value="random">Random (1 trong 10 bài gần nhất)</option>
                <option value="selected">Chỉ định post</option>
              </select>
            </div>
          </div>

          {bossId && postMode === 'selected' && (
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 space-y-2">
              <div className="text-xs text-neutral-400">Chọn post để repost ({selectedPostIds.size} đã chọn)</div>
              {loadingPosts ? (
                <div className="text-xs text-neutral-500 flex items-center gap-1"><RefreshCw className="w-3 h-3 animate-spin" /> Đang tải posts...</div>
              ) : bossPosts.length === 0 ? (
                <div className="text-xs text-neutral-500">Không có post nào</div>
              ) : (
                <div className="max-h-48 overflow-y-auto space-y-1">
                  {bossPosts.map(p => (
                    <label key={p.id} className="flex items-start gap-2 text-xs px-2 py-1.5 rounded hover:bg-neutral-200/60 dark:hover:bg-neutral-900 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={selectedPostIds.has(p.id)}
                        onChange={() => togglePostSelect(p.id)}
                        className="w-3.5 h-3.5 mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-neutral-300">{p.text || '(media only)'}</div>
                        <div className="text-[10px] text-neutral-500">{new Date(p.timestamp).toLocaleString()} · {p.media_type}</div>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {bossId && (
            <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <div className="text-xs text-neutral-400">Workers ({workerIds.size}/{filteredWorkers.length})</div>
                <div className="flex items-center gap-2">
                  <select value={workerSource} onChange={(e) => setWorkerSource(e.target.value)} className="px-2 py-1 rounded border border-neutral-200 dark:border-neutral-800 text-xs bg-neutral-100 dark:bg-neutral-900 outline-none">
                    <option value="all">Tất cả</option>
                    <option value="favourite">Favourite ({buffFavWorkers.length})</option>
                  </select>
                  <button onClick={selectAllWorkers} className="px-2 py-1 rounded border border-neutral-200 dark:border-neutral-800 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-900">Chọn tất cả</button>
                  <button onClick={selectNoWorkers} className="px-2 py-1 rounded border border-neutral-200 dark:border-neutral-800 text-xs hover:bg-neutral-200 dark:hover:bg-neutral-900">Bỏ chọn</button>
                </div>
              </div>
              <input
                value={workerSearch}
                onChange={(e) => setWorkerSearch(e.target.value)}
                placeholder="Tìm worker username..."
                className="w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none"
              />
              {filteredWorkers.length === 0 ? (
                <div className="text-xs text-neutral-500">Không có worker khả dụng</div>
              ) : (
                <div className="max-h-40 overflow-y-auto space-y-1">
                  {filteredWorkers.map(a => (
                    <label key={a.id} className="flex items-center gap-2 text-xs px-2 py-1.5 rounded hover:bg-neutral-200/60 dark:hover:bg-neutral-900 cursor-pointer">
                      <input type="checkbox" checked={workerIds.has(a.id)} onChange={() => toggleWorker(a.id)} className="w-3.5 h-3.5" />
                      <span className="truncate flex-1">@{a.username || a.id}</span>
                      {buffFavWorkers.includes(a.id) ? (
                        <button onClick={(e) => { e.preventDefault(); removeFavWorker(a.id) }} className="text-[10px] text-amber-400 hover:text-amber-300" title="Bỏ favourite">★</button>
                      ) : (
                        <button onClick={(e) => { e.preventDefault(); addFavWorker(a.id) }} className="text-[10px] text-neutral-500 hover:text-amber-400" title="Thêm favourite">☆</button>
                      )}
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="grid md:grid-cols-4 gap-2">
            <label className="text-xs text-neutral-400">
              Chế độ
              <select value={buffMode} onChange={(e) => setBuffMode(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none">
                <option value="once">Chạy 1 lần</option>
                <option value="repeat">Lặp chu kỳ</option>
              </select>
            </label>
            {buffMode === 'repeat' && (
              <>
                <label className="text-xs text-neutral-400">
                  Chu kỳ
                  <input type="number" min="1" value={buffEveryValue} onChange={(e) => setBuffEveryValue(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none" />
                </label>
                <label className="text-xs text-neutral-400">
                  Đơn vị
                  <select value={buffRepeatUnit} onChange={(e) => setBuffRepeatUnit(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none">
                    <option value="minute">Phút</option>
                    <option value="hour">Giờ</option>
                    <option value="day">Ngày</option>
                  </select>
                </label>
              </>
            )}
            <label className="text-xs text-neutral-400">
              Delay min (s)
              <input type="number" min="1" value={delayMin} onChange={(e) => setDelayMin(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none" />
            </label>
            <label className="text-xs text-neutral-400">
              Delay max (s)
              <input type="number" min="1" value={delayMax} onChange={(e) => setDelayMax(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none" />
            </label>
          </div>

          {buffActionMode === 'quote_post' && (
            <div className="grid md:grid-cols-4 gap-2">
              <label className="text-xs text-neutral-400 md:col-span-2">
                Caption quote worker (optional)
                <input value={linkCaption} onChange={(e) => setLinkCaption(e.target.value)} placeholder="Để trống sẽ dùng mặc định: 🔁" className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none" />
              </label>
              <label className="text-xs text-neutral-400">
                Delay trước publish (s)
                <input type="number" min="1" value={publishDelaySec} onChange={(e) => setPublishDelaySec(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none" />
              </label>
              <label className="text-xs text-neutral-400">
                Publish retries
                <input type="number" min="1" value={publishRetryCount} onChange={(e) => setPublishRetryCount(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none" />
              </label>
              <label className="text-xs text-neutral-400">
                Retry interval (s)
                <input type="number" min="1" value={publishRetryIntervalSec} onChange={(e) => setPublishRetryIntervalSec(e.target.value)} className="mt-1 w-full px-2 py-1.5 rounded-lg bg-neutral-100 dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-800 text-xs outline-none" />
              </label>
            </div>
          )}

          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleCreateBuffTask}
              disabled={buffRunning}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-xs font-medium text-neutral-900 disabled:opacity-60"
            >
              <TrendingUp className="w-3.5 h-3.5" /> Bắt đầu buff
            </button>
            {buffMsg && <span className="text-xs text-neutral-300">{buffMsg}</span>}
          </div>
        </div>

        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-4 space-y-2">
          <div className="text-xs text-neutral-400">Danh sách buff tasks</div>
          {buffSchedules.length === 0 ? (
            <div className="text-xs text-neutral-500">Chưa có buff task nào</div>
          ) : (
            <div className="space-y-2 max-h-52 overflow-y-auto">
              {buffSchedules.map(task => {
                const bossAcc = accounts.find(a => a.id === task.bossAccountId)
                return (
                  <div key={task.id} className="rounded-lg border border-neutral-200 dark:border-neutral-800 px-3 py-2 text-xs text-neutral-300">
                    <div className="flex items-center justify-between gap-2">
                      <div className="truncate">
                        <span className="font-medium">Boss: @{bossAcc?.username || task.bossAccountId}</span>
                        {' · '}{task.mode === 'once' ? '1 lần' : `Lặp ${task.everyValue} ${task.repeatUnit === 'day' ? 'ngày' : task.repeatUnit === 'hour' ? 'giờ' : 'phút'}`}
                        {' · '}{task.workerIds?.length || 0} workers
                        {' · '}post: {task.postMode === 'random' ? 'random' : `${task.selectedPostIds?.length || 0} chỉ định`}
                        {' · '}buff mode: {task.buffMode === 'quote_post' ? 'quote_post' : 'repost'}
                      </div>
                      <div className="flex items-center gap-1">
                        {(task.status === 'active' || task.status === 'running') && (
                          <button onClick={() => cancelBuffTask(task.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-800 text-rose-400 hover:bg-rose-500/10">
                            <X className="w-3 h-3" /> Hủy
                          </button>
                        )}
                        {(task.status === 'completed' || task.status === 'cancelled') && (
                          <button onClick={() => deleteBuffTask(task.id)} className="inline-flex items-center gap-1 px-2 py-1 rounded border border-rose-800 text-rose-400 hover:bg-rose-500/10">
                            <Trash2 className="w-3 h-3" /> Xóa
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 flex items-center justify-between gap-2 text-[11px] text-neutral-400">
                      <span>Trạng thái: <strong>{task.status}</strong></span>
                      {task.nextRunAt && <span>Kế tiếp: {new Date(task.nextRunAt).toLocaleString()}</span>}
                    </div>
                    {task.lastResult && (
                      <div className="mt-1 text-[11px] text-neutral-400">
                        Run gần nhất: ok {task.lastResult.ok} / fail {task.lastResult.fail} · {task.lastResult.durationSec}s · post: {task.lastResult.postId || '—'}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-neutral-200 dark:border-neutral-800 bg-white dark:bg-neutral-900/50 p-4 space-y-2">
          <div className="text-xs text-neutral-400">Buff Logs</div>
          {buffLogs.length === 0 ? (
            <div className="text-xs text-neutral-500">Chưa có log</div>
          ) : (
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {buffLogs.map(l => (
                <div key={l.id} className="text-xs font-mono text-neutral-300 rounded px-2 py-1 border border-neutral-800/70">
                  <div className="flex items-center justify-between gap-2">
                    <span>{new Date(l.at).toLocaleString()} · {l.taskId}</span>
                    <span className={l.fail > 0 ? 'text-amber-300' : 'text-emerald-300'}>ok {l.success} / fail {l.fail} · {l.durationSec}s</span>
                  </div>
                  <div className="text-neutral-500 mt-0.5">Mode: {l.buffMode === 'quote_post' ? 'quote_post' : 'repost'}</div>
                  {l.postId && <div className="text-neutral-500 mt-0.5 flex items-center gap-1">Post: {l.permalink ? <><a href={l.permalink} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 underline">{l.postId}</a><CopyBtn text={l.permalink} label="Link" /></> : l.postId}</div>}
                  {l.message && <div className="text-rose-300 mt-0.5">{l.message}</div>}
                  {Array.isArray(l.failures) && l.failures.length > 0 && (
                    <div className="mt-1 pl-2 border-l border-rose-500/30 space-y-0.5 text-[11px]">
                      {(expandedBuffFailures.has(l.id) ? l.failures : l.failures.slice(0, BUFF_FAILURE_PREVIEW)).map((f, idx) => (
                        <div key={`${l.id}_bf_${idx}`} className="text-rose-300 break-all">
                          • {f.username ? `@${f.username}` : f.accountId}{f.token ? ` · ${f.token}` : ''} · {f.error}
                        </div>
                      ))}
                      {(l.failHidden > 0 || l.failures.length > BUFF_FAILURE_PREVIEW) && (
                        <button
                          onClick={() => toggleBuffFailureExpand(l.id)}
                          className="text-indigo-300 hover:text-indigo-200 underline"
                        >
                          {expandedBuffFailures.has(l.id)
                            ? 'Thu gọn lỗi'
                            : `+ ${Math.max(l.failHidden || 0, l.failures.length - BUFF_FAILURE_PREVIEW)} lỗi khác... (click để xem tất cả)`}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageShell>
  )
}

import { cacheGet, cacheSet } from './cache.js'

const GRAPH_BASE = 'https://graph.threads.net/v1.0'
const ME_FIELDS = 'id,username,name,threads_profile_picture_url,threads_biography'

const DEFAULT_TTL_PROFILE  = 30 * 60 * 1000
const DEFAULT_TTL_POSTS    = 30 * 60 * 1000
const DEFAULT_TTL_POST     = 30 * 60 * 1000
const DEFAULT_TTL_INSIGHTS = 30 * 60 * 1000
const DEFAULT_TTL_SEARCH   = 30 * 60 * 1000
const DEFAULT_TTL_REPLIES  = 10 * 60 * 1000

function getTTL(settings) {
  return {
    profile:  (settings?.cacheTTLProfile ?? 30) * 60 * 1000 || DEFAULT_TTL_PROFILE,
    posts:    (settings?.cacheTTLPosts ?? 30) * 60 * 1000 || DEFAULT_TTL_POSTS,
    post:     (settings?.cacheTTLPost ?? 30) * 60 * 1000 || DEFAULT_TTL_POST,
    insights: (settings?.cacheTTLInsights ?? 30) * 60 * 1000 || DEFAULT_TTL_INSIGHTS,
    search:   (settings?.cacheTTLSearch ?? 30) * 60 * 1000 || DEFAULT_TTL_SEARCH,
    replies:  (settings?.cacheTTLReplies ?? 10) * 60 * 1000 || DEFAULT_TTL_REPLIES,
  }
}

function buildGraphUrl(path, params) {
  const qs = new URLSearchParams(params).toString()
  return `${GRAPH_BASE}${path}?${qs}`
}

export function getWebhookUrl(settings) {
  return (settings?.webhookUrl || '').trim()
}

async function callWebhook({ webhookUrl, apiKey, payload }) {
  if (!webhookUrl) {
    throw new Error('Chưa cấu hình Webhook URL trong Cài đặt')
  }
  const headers = { 'Content-Type': 'application/json' }
  if (apiKey) headers['X-API-Key'] = apiKey
  let res
  try {
    res = await fetch(webhookUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
  } catch (e) {
    throw new Error(`Không gọi được webhook: ${e.message}`)
  }
  const text = await res.text()
  let json
  try { json = text ? JSON.parse(text) : {} } catch { json = { raw: text } }

  if (!res.ok) {
    if (res.status === 404) {
      throw new Error('HTTP 404: Webhook không tồn tại. Kiểm tra URL và đảm bảo workflow đã Activate.')
    }
    if (res.status === 500) {
      throw new Error('HTTP 500: Workflow n8n bị lỗi. Kiểm tra execution log trong n8n.')
    }
    throw new Error(json?.error || `Webhook HTTP ${res.status}`)
  }
  if (Array.isArray(json)) json = json[0] || {}
  if (json && typeof json === 'object' && 'ok' in json) {
    if (!json.ok) throw new Error(json.error || 'Webhook trả về lỗi')
    return json.data ?? {}
  }
  if (json?.error) {
    const msg = typeof json.error === 'string' ? json.error : (json.error.message || 'Lỗi từ Graph API')
    throw new Error(msg)
  }
  return json
}

function tokenFingerprint(token) {
  let h = 0
  for (let i = 0; i < token.length; i++) {
    h = ((h << 5) - h + token.charCodeAt(i)) | 0
  }
  return (h >>> 0).toString(36)
}

export async function fetchMe(token, { settings, skipCache = false } = {}) {
  const key = `me:${tokenFingerprint(token)}`
  const legacyKey = `me:${token.slice(-8)}`
  const ttl = getTTL(settings)

  if (!skipCache) {
    const hit = cacheGet(key, ttl.profile)
    if (hit) return hit
    const legacyHit = cacheGet(legacyKey, ttl.profile)
    if (legacyHit && legacyHit.id) {
      cacheSet(key, legacyHit)
      return legacyHit
    }
  }

  const url = buildGraphUrl('/me', { fields: ME_FIELDS, access_token: token })
  const data = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'fetchMe', method: 'GET', url },
  })
  if (!data?.id) throw new Error('Không có id trong response — kiểm tra execution log n8n')

  cacheSet(key, data)
  return data
}

export { tokenFingerprint }

const POST_FIELDS_LIST = 'id,media_type,media_url,thumbnail_url,permalink,text,timestamp,shortcode,is_quote_post'
const POST_FIELDS_DETAIL = 'id,media_type,media_url,thumbnail_url,permalink,username,text,timestamp,shortcode,children,is_quote_post,quoted_post,reposted_post,link_attachment_url,gif_url,topic_tag'

export async function fetchPosts(userId, token, { settings, limit = 10, skipCache = false } = {}) {
  const key = `posts:${userId}:${limit}`
  const ttl = getTTL(settings)
  if (!skipCache) {
    const hit = cacheGet(key, ttl.posts)
    if (hit) return hit
  }

  const url = buildGraphUrl(`/${userId}/threads`, {
    fields: POST_FIELDS_LIST,
    limit,
    access_token: token,
  })
  const res = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'fetchPosts', method: 'GET', url },
  })
  const posts = res?.data || (Array.isArray(res) ? res : [])

  cacheSet(key, posts)
  return posts
}

export async function fetchPost(postId, token, { settings, skipCache = false } = {}) {
  const key = `post:${postId}`
  const ttl = getTTL(settings)
  if (!skipCache) {
    const hit = cacheGet(key, ttl.post)
    if (hit) return hit
  }

  const url = buildGraphUrl(`/${postId}`, {
    fields: POST_FIELDS_DETAIL,
    access_token: token,
  })
  const res = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'fetchPost', method: 'GET', url },
  })

  cacheSet(key, res)
  return res
}

const SEARCH_FIELDS = 'id,text,media_type,media_url,thumbnail_url,permalink,timestamp,username,has_replies,is_quote_post,is_reply'

const INSIGHT_METRICS = 'views,likes,replies,reposts,quotes,followers_count'

export async function fetchInsights(userId, token, { settings, skipCache = false } = {}) {
  const key = `insights:${userId}`
  const ttl = getTTL(settings)
  if (!skipCache) {
    const hit = cacheGet(key, ttl.insights)
    if (hit) return hit
  }

  const url = buildGraphUrl(`/${userId}/threads_insights`, {
    metric: INSIGHT_METRICS,
    access_token: token,
  })
  const res = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'fetchInsights', method: 'GET', url },
  })

  const arr = res?.data || (Array.isArray(res) ? res : [])
  const result = {}
  for (const m of arr) {
    if (m.total_value != null) {
      result[m.name] = m.total_value.value
    } else if (m.values?.length) {
      result[m.name] = m.values.reduce((s, v) => s + (v.value || 0), 0)
    }
  }

  cacheSet(key, result)
  return result
}

const POST_INSIGHT_METRICS = 'views,likes,replies,reposts,quotes'

export async function fetchPostInsights(postId, token, { settings, skipCache = false } = {}) {
  const key = `post_insights:${postId}`
  const ttl = getTTL(settings)
  if (!skipCache) {
    const hit = cacheGet(key, ttl.insights)
    if (hit) return hit
  }

  const url = buildGraphUrl(`/${postId}/insights`, {
    metric: POST_INSIGHT_METRICS,
    access_token: token,
  })
  const res = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'fetchPostInsights', method: 'GET', url },
  })

  const arr = res?.data || (Array.isArray(res) ? res : [])
  const result = {}
  for (const m of arr) {
    if (m.total_value != null) {
      result[m.name] = m.total_value.value
    } else if (m.values?.length) {
      result[m.name] = m.values.reduce((s, v) => s + (v.value || 0), 0)
    }
  }

  cacheSet(key, result)
  return result
}

const REPLY_FIELDS = 'id,text,timestamp,username,media_type,media_url,thumbnail_url,permalink,has_replies'

async function fetchRepliesRaw(postId, token, settings, after = null) {
  const params = { fields: REPLY_FIELDS, access_token: token }
  if (after) params.after = after
  const url = buildGraphUrl(`/${postId}/replies`, params)
  const res = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'fetchReplies', method: 'GET', url },
  })
  return { data: res?.data || (Array.isArray(res) ? res : []), paging: res?.paging || null }
}

export async function fetchRepliesPage(postId, token, { settings, after = null } = {}) {
  const { data: topLevel, paging } = await fetchRepliesRaw(postId, token, settings, after)
  const all = []
  for (const r of topLevel) {
    all.push(r)
    if (r.has_replies) {
      try {
        const { data: nested } = await fetchRepliesRaw(r.id, token, settings)
        for (const nr of nested) { nr._parentUsername = r.username; all.push(nr) }
      } catch {}
    }
  }
  return { replies: all, nextCursor: paging?.cursors?.after || null, hasMore: !!paging?.next }
}

export async function fetchReplies(postId, token, { settings, skipCache = false } = {}) {
  const key = `replies:${postId}`
  const ttl = getTTL(settings)
  if (!skipCache) {
    const hit = cacheGet(key, ttl.replies)
    if (hit) return hit
  }

  const { replies } = await fetchRepliesPage(postId, token, { settings })
  cacheSet(key, replies)
  return replies
}

export async function postReply(userId, token, { settings, text, replyToId }) {
  const createUrl = buildGraphUrl('/me/threads', {
    media_type: 'TEXT',
    text,
    reply_to_id: replyToId,
    access_token: token,
  })
  const createRes = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'postReply', method: 'POST', url: createUrl },
  })
  const creationId = createRes?.id
  if (!creationId) throw new Error('Không tạo được reply container')

  await new Promise(r => setTimeout(r, 5000))

  const publishUrl = buildGraphUrl(`/${userId}/threads_publish`, {
    creation_id: creationId,
    access_token: token,
  })
  const pubRes = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'publishReply', method: 'POST', url: publishUrl },
  })
  return pubRes
}

export async function resolveThreadsUrl(url, { settings } = {}) {
  const key = `resolve:${url}`
  const hit = cacheGet(key, 24 * 60 * 60 * 1000)
  if (hit) return hit
  const res = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'resolveThreadsUrl', url },
  })
  if (!res?.post_id) throw new Error(res?.error || 'Không nhận được post_id từ backend')
  const result = { postId: res.post_id, userId: res.user_id }
  cacheSet(key, result)
  return result
}

export async function repostPost(postId, token, { settings }) {
  const url = buildGraphUrl(`/${postId}/repost`, { access_token: token })
  const data = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'repostPost', method: 'POST', url },
  })
  if (!data?.id) throw new Error('Repost thất bại — không nhận được ID')
  return data
}

export async function createQuotePost(userId, token, { settings, text = '', quotePostId }) {
  if (!quotePostId) throw new Error('Thiếu quote_post_id để tạo quote post')
  const safeText = String(text || '').trim() || '🔁'
  const createUrl = buildGraphUrl(`/${userId}/threads`, {
    media_type: 'TEXT',
    text: safeText,
    quote_post_id: quotePostId,
    access_token: token,
  })
  const createRes = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'createQuotePost', method: 'POST', url: createUrl },
  })
  const creationId = createRes?.id
  if (!creationId) throw new Error('Không tạo được quote-post container')
  return { creationId }
}

export async function publishThreadsPost(userId, token, { settings, creationId }) {
  if (!creationId) throw new Error('Thiếu creation_id để publish')
  const publishUrl = buildGraphUrl(`/${userId}/threads_publish`, {
    creation_id: creationId,
    access_token: token,
  })
  const pubRes = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'publishThreadsPost', method: 'POST', url: publishUrl },
  })
  if (!pubRes?.id) throw new Error('Publish thất bại — không nhận được media ID')
  return pubRes
}

export async function searchKeyword(token, { settings, q, searchType, searchMode, mediaType, authorUsername, since, until, limit, skipCache = false } = {}) {
  const keyParts = [q, searchType, searchMode, mediaType, authorUsername, since, until, limit].filter(Boolean).join(':')
  const key = `search:${keyParts}`
  const ttl = getTTL(settings)
  if (!skipCache) {
    const hit = cacheGet(key, ttl.search)
    if (hit) return hit
  }

  const params = { fields: SEARCH_FIELDS, access_token: token, q }
  if (searchType) params.search_type = searchType
  if (searchMode) params.search_mode = searchMode
  if (mediaType) params.media_type = mediaType
  if (authorUsername) params.author_username = authorUsername
  if (since) params.since = since
  if (until) params.until = until
  if (limit) params.limit = limit

  const url = buildGraphUrl('/keyword_search', params)
  const res = await callWebhook({
    webhookUrl: getWebhookUrl(settings),
    apiKey: settings?.apiKey,
    payload: { action: 'searchKeyword', method: 'GET', url },
  })
  const results = res?.data || (Array.isArray(res) ? res : [])

  cacheSet(key, results)
  return results
}

export function maskToken(t) {
  if (!t) return ''
  if (t.length <= 10) return t
  return t.slice(0, 6) + '...' + t.slice(-4)
}

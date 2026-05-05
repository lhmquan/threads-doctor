export function parseThreadsUrl(url) {
  const m = url.match(/threads\.(?:net|com)\/@([^/]+)\/post\/([A-Za-z0-9_-]+)/)
  if (!m) return null
  return { username: m[1], shortcode: m[2] }
}

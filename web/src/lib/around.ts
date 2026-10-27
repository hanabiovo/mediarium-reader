// 静默兜底（0.27，2026-10-24 Hana 定：「没必要增加用户的疑惑」）：已经订了的源后来被对方拦了（拦机房 IP、人机验证……），
// 打开报刊架时在后台绕道体检一次，取得到就替它勾上「通过代理抓取」、让 Miniflux 重抓一次，病历里记一笔。不弹窗、不提示。
// 同一个源一天最多试一次；绕道也取不到的，照旧留给源医生提醒
import { api, loadShelf, type Feed } from '../api/miniflux'
import { load, save } from '../api/storage'
import { checkup, original, rsshubRoute, usable, writeNote } from './doctor'

const KEY = 'mediarium.around'
const DAY = 864e5
const BLOCKED = /\b(403|429|451|503)\b|forbidden|service unavailable|too many requests|cloudflare|challenge|captcha|connection refused|connection reset|timeout|timed out/i
let running = false

const looksBlocked = (f: Feed) =>
  f.parsing_error_count > 0 && !f.fetch_via_proxy && !f.disabled && original(f.feed_url) === f.feed_url && !rsshubRoute(f.feed_url) && BLOCKED.test(f.parsing_error_message ?? '')

export async function autoAround(feeds: Feed[]) {
  if (running) return
  const tried: Record<string, number> = (() => { try { return JSON.parse(load(KEY) ?? '{}') } catch { return {} } })()
  const todo = feeds.filter((f) => looksBlocked(f) && Date.now() - (tried[f.id] ?? 0) > DAY)
  if (!todo.length) return
  running = true
  let changed = false
  try {
    for (const f of todo) {
      tried[f.id] = Date.now()
      save(KEY, JSON.stringify(tried))
      const c = await checkup(f.feed_url, 'proxy')
      if (!usable(c)) continue
      try {
        await api.updateFeed(f.id, { fetch_via_proxy: true })
        await api.refreshFeed(f.id).catch(() => {})
        await writeNote(f.id, '改走另一条路（对方拦了服务器）')
        changed = true
      } catch { /* 下次再说 */ }
    }
  } finally {
    running = false
    if (changed) loadShelf().catch(() => {})
  }
}

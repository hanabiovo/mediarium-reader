// 源医生 · 服务器这边的巡诊（MCP 与每日巡诊用，2026-10-27）。规则照网页端 web/src/lib/doctor.ts 的 patrol：
//   报错（Miniflux 连续抓取出错）、暂停、像是摘要（最近 5 篇平均不到 300 字；视频、播客不算）、久不更新（按自己平时的间隔，慢到三倍、最少 30 天）、
//   不爱看（近 30 天划掉 ≥10 篇且占 4 成以上）。网页端还有「重复」，要拉全站 300 篇比对，这里不做。
//   只读 Miniflux 里已有的数据，不去外面取；点过「它没事」的 6 小时内不提。
// 每日巡诊：只给开了 MCP 链接的账号做（服务器手里只有这把密钥能以他的身份看）。结果存 /data/patrol/<uid>.json，
// 记下每个问题第一次出现的时间，灵媒据此在源医生入口上提醒「有新情况」。
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { mf } from './mfclient.js'
import { parseMeta } from './usermeta.js'

const ROOT = process.env.DATA_DIR || '/data'
const DIR = path.join(ROOT, 'patrol')
const DAY = 864e5
const STALE_DAYS = 30
const FINE_HOURS = 6

const textLen = (html) => String(html ?? '').replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, '').length
export function staleAfter(gaps) {
  if (gaps.length < 2) return STALE_DAYS
  const g = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  return Math.max(STALE_DAYS, Math.ceil(g * 3))
}
const isMedia = (e) => /youtube\.com\/watch|youtu\.be\//.test(e.url ?? '') || (e.enclosures ?? []).some((x) => /^(audio|video)\//.test(x.mime_type ?? ''))
const entriesOf = (key, feedId, q) => mf(key, `/feeds/${feedId}/entries?${new URLSearchParams({ order: 'published_at', direction: 'desc', status: 'unread', ...q }).toString()}&status=read`)

async function pool(items, n, f) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k]) } }))
  return out
}

// 一个源的「原始材料」+ 按规则判出的问题
export async function examineFeed(key, feed, meta) {
  const issues = []
  const facts = {
    id: feed.id, title: feed.title, category: feed.category?.title,
    errors: feed.parsing_error_count || 0, errorMessage: feed.parsing_error_message || undefined,
    checkedAt: feed.checked_at, paused: !!feed.disabled, crawler: !!feed.crawler, proxy: !!feed.fetch_via_proxy,
  }
  if (facts.errors > 0) issues.push({ kind: 'error', text: `抓取连续出错 ${facts.errors} 次`, detail: facts.errorMessage })
  if (feed.disabled) issues.push({ kind: 'paused', text: '暂停更新中' })
  let latest, gaps = []
  try {
    const page = await entriesOf(key, feed.id, { limit: '5' })
    const list = page?.entries ?? []
    latest = list[0]?.published_at
    const ts = list.map((e) => Date.parse(e.published_at)).filter((t) => !Number.isNaN(t))
    gaps = ts.slice(1).map((t, i) => (ts[i] - t) / DAY)
    facts.latest = latest
    facts.recent = list.map((e) => ({ title: e.title, published: e.published_at, chars: textLen(e.content) }))
    const media = list.filter(isMedia).length
    if (media >= list.length / 2 && list.length) facts.kind = 'media'
    if (list.length >= 3 && media < list.length / 2) {
      const avg = Math.round(list.reduce((a, e) => a + textLen(e.content), 0) / list.length)
      facts.avgChars = avg
      if (avg < 300) issues.push({ kind: 'summary', text: feed.crawler ? '开着抓取全文，正文还是很短' : `像是摘要（平均 ${avg} 字）` })
    }
    if (gaps.length) facts.typicalGapDays = Math.round([...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)] * 10) / 10
  } catch (e) { facts.entriesError = e.message }
  if (!feed.disabled && !facts.entriesError) {
    const days = latest ? Math.floor((Date.now() - Date.parse(latest)) / DAY) : Infinity
    if (days >= staleAfter(gaps)) issues.push({ kind: 'stale', text: latest ? `${days} 天没有新文章` : '一篇文章都没有' })
  }
  // 不爱看
  const since = Date.now() - 30 * DAY
  const muted = Object.values(meta.muted ?? {}).filter((v) => v?.f === feed.id && v.t >= since).length
  if (muted) {
    facts.muted30d = muted
    if (muted >= 10) {
      const total = await entriesOf(key, feed.id, { limit: '1', published_after: String(Math.floor(since / 1000)) }).then((r) => r?.total ?? 0).catch(() => 0)
      facts.entries30d = total
      if (total && muted / total >= 0.4) issues.push({ kind: 'muted', text: `近 30 天划掉了 ${Math.round((muted / total) * 10)} 成（${muted} 篇）` })
    }
  }
  const fine = meta.feeds?.[feed.id]?.fine ?? {}
  const quiet = (k) => fine[k] && Date.now() - Date.parse(fine[k]) < FINE_HOURS * 3600e3
  facts.notes = meta.feeds?.[feed.id]?.notes ?? []
  return { facts, issues: issues.filter((i) => !quiet(i.kind)) }
}

export async function patrolUser(key) {
  const [feeds, me] = await Promise.all([mf(key, '/feeds'), mf(key, '/me')])
  const meta = parseMeta(me?.stylesheet)
  const wards = await pool(feeds ?? [], 4, (f) => examineFeed(key, f, meta).catch((e) => ({ facts: { id: f.id, title: f.title, entriesError: e.message }, issues: [] })))
  return { uid: me.id, at: new Date().toISOString(), total: feeds?.length ?? 0, wards }
}

// ——— 每日巡诊的记录：问题第一次出现的时间 ———
const file = (uid) => path.join(DIR, `${Number(uid)}.json`)
export async function readReport(uid) {
  try { return JSON.parse(await readFile(file(uid), 'utf8')) } catch { return null }
}
export async function saveReport(round) {
  const old = await readReport(round.uid)
  const firstSeen = new Map((old?.issues ?? []).map((i) => [`${i.feed}|${i.kind}`, i.since]))
  const issues = []
  for (const w of round.wards) for (const i of w.issues) {
    const k = `${w.facts.id}|${i.kind}`
    issues.push({ feed: w.facts.id, title: w.facts.title, kind: i.kind, text: i.text, since: firstSeen.get(k) ?? round.at })
  }
  const report = { at: round.at, total: round.total, issues }
  await mkdir(DIR, { recursive: true })
  await writeFile(file(round.uid) + '.tmp', JSON.stringify(report))
  await rename(file(round.uid) + '.tmp', file(round.uid))
  return report
}

// 每天巡一遍所有开了链接的账号
export async function dailyPatrol(keysByUser, log = () => {}) {
  const keys = await keysByUser()
  for (const [uid, key] of keys) {
    try { const r = await saveReport(await patrolUser(key)); log('patrol', uid, `${r.issues.length} issues`) }
    catch (e) { log('patrol failed', uid, e?.message) }
  }
}

// 源医生（5b-3，2026-10-22）。分工（Hana 定）：用户只管策展，源从哪来、能不能用、全不全、坏了怎么换，都归这里。
//   接诊：加新源时找候选、逐个体检、给推荐（体检在誊写服务上跑，从服务器这边真的取一次）
//   巡诊：把现有的源过一遍，挑出要看看的（报错、久不更新、疑似摘要、重复、暂停）
//   处方：重新抓取、换 RSSHub 实例、开抓取全文、去重、换源
//   病历：每个源做过什么处方，记在灵媒设置里（手机电脑同一份）
// 全是规则，不用 AI：量得出来的东西不猜。
import { api, getToken, request, type Entry, type Feed } from '../api/miniflux'
import { mutedRecently } from './attention'
import { currentMeta, updateMeta, visible, type IgnoreRule, type Meta } from '../api/meta'
import { guessHost } from './sources'
import { HUB_LABEL, feedUrlFor, hubBase } from './hub'

// ——— 体检（誊写服务 /scribe/doctor/check） ———
export type Checkup = {
  url: string; ok: boolean; problem?: string; status?: number
  title?: string; site?: string; count?: number; titles?: string[]
  latest?: string; perWeek?: number; avgChars?: number; imageShare?: number
  sample?: { title: string; link: string; chars: number; page?: { chars?: number; problem?: string } }
  content?: 'full' | 'summary' | 'unsure'
  crawlerHelps?: boolean
  fuller?: string   // 只给摘要时，同一个网站上找到的给全文的订阅源（0.21.2）
  via?: 'proxy'     // 绕道（经代理）取的（0.26）
  kind?: 'video' | 'audio'   // 视频源 / 播客（0.27）：不按字数判全文摘要
}

// null = 誊写服务没接上（没部署 / 没登录），这时候接诊退回老办法：不体检、直接列候选
// 灵媒自建上的地址：体检 Miniflux 真正要取的那个转发地址（0.21.2），结果里的 url 仍写原地址
export async function checkup(url: string, via?: 'proxy'): Promise<Checkup | null> {
  let target = url
  if (hubBase() && url.startsWith(hubBase() + '/')) {
    if (via) return null   // 灵媒自建在内网，不用绕道
    try { target = await feedUrlFor(url) } catch (e) { return { url, ok: false, problem: (e as Error).message } }
  }
  const c = await examine(target, via)
  return c && { ...c, url }
}
// 像是被对方拦了（拦机房 IP、人机验证、拒连）：这种可以试试绕道
export const blocked = (c: Checkup | null | undefined) => !!c && !c.ok && (c.status === 403 || c.status === 429 || c.status === 451 || c.status === 503 || /人机验证|连不上|超时/.test(c.problem ?? ''))
// 一时没取到（体检不了、超时、连不上、对方 5xx / 太忙）：这种值得再试（0.29，Hana：体检准不准不太稳定，要给重试）
export const flaky = (c: Checkup | null | undefined) => c === null || (!!c && !c.ok && ((c.status ?? 0) >= 500 || c.status === 408 || c.status === 429 || /超时|连不上|没回话|网络/.test(c.problem ?? '')))
// 先直接取；像是被拦了，再绕道取一次，取得到就用绕道的结果（2026-10-24：livedoor 拦服务器所在机房，换一台取得到）
export async function checkupAround(url: string): Promise<Checkup | null> {
  const c = await checkup(url)
  if (!blocked(c)) return c
  const p = await checkup(url, 'proxy')
  return p && usable(p) ? p : c
}
async function examine(url: string, via?: 'proxy'): Promise<Checkup | null> {
  try {
    const r = await fetch(`/scribe/doctor/check?url=${encodeURIComponent(url)}${via ? '&via=proxy' : ''}`, { headers: { 'X-Auth-Token': getToken() ?? '' } })
    if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500)); return examine(url, via) }
    // 界面只说「体检不了」；具体原因写进控制台，排查时看（2026-10-22 Hana 问会不会影响排查）
    if (!r.ok) { console.warn('[源医生] 体检不了', r.status, (await r.text().catch(() => '')).slice(0, 80), url); return null }
    return (await r.json()) as Checkup
  } catch (e) { console.warn('[源医生] 体检不了', String(e), url); return null }
}

const ago = (iso: string) => {
  const d = Math.floor((Date.now() - Date.parse(iso)) / 864e5)
  return d <= 0 ? '今天' : d === 1 ? '昨天' : d < 30 ? `${d} 天前` : d < 365 ? `${Math.floor(d / 30)} 个月前` : `${Math.floor(d / 365)} 年前`
}
const rate = (w: number) => (w >= 14 ? `每天约 ${Math.round(w / 7)} 篇` : w >= 1 ? `每周约 ${Math.round(w)} 篇` : w > 0 ? `每月约 ${Math.max(1, Math.round(w * 4.3))} 篇` : '')

// 体检结果的一行话：「全文 · 有图 · 每周约 12 篇 · 最新 昨天」
export function verdictLine(c: Checkup): string {
  if (!c.ok) return c.problem ?? '取不到'
  if (c.problem) return c.problem
  const bits = [
    c.kind === 'video' ? '视频' : c.kind === 'audio' ? '播客' : c.content === 'full' ? '全文' : c.content === 'summary' ? (c.crawlerHelps ? '摘要，可补全文' : '摘要') : '不确定是否全文',
    (c.imageShare ?? 0) >= 0.4 ? '有图' : '',
    c.perWeek ? rate(c.perWeek) : '',
    c.latest ? `最新 ${ago(c.latest)}` : '',
  ]
  return bits.filter(Boolean).join(' · ')
}

// 候选打分：取得到 > 全文（或开抓取能补全）> 最近有更新 > 有图
export function score(c: Checkup | null | undefined): number {
  if (!c) return 0
  if (!c.ok || c.problem) return -1
  let s = 10
  if (c.kind || c.content === 'full') s += 6
  else if (c.crawlerHelps) s += 4
  else if (c.content === 'unsure') s += 2
  if (c.latest) { const d = (Date.now() - Date.parse(c.latest)) / 864e5; s += d < 3 ? 3 : d < 14 ? 2 : d < 60 ? 1 : -2 }
  if ((c.imageShare ?? 0) >= 0.4) s += 1
  return s
}
// 同分时依次比：篇数多的、原网页取得到的；再一样才按排位（2026-10-22 Hana 问推荐原则时补）
// urls 给了的话：灵媒自建能用就推荐它（2026-10-23 Hana 定），不能用再按分数挑
export function recommend(list: (Checkup | null | undefined)[], urls?: string[]): number {
  if (urls) { const h = urls.findIndex((u, i) => onHub(u) && usable(list[i])); if (h >= 0) return h }
  const key = (c: Checkup | null | undefined) => [score(c), c?.count ?? 0, c?.sample?.page?.chars ? 1 : 0]
  let best = -1, bestKey = [0, 0, 0]
  list.forEach((c, i) => {
    const k = key(c)
    if (k[0] <= 0) return
    const d = k.findIndex((v, j) => v !== bestKey[j])
    if (best < 0 || (d >= 0 && k[d] > bestKey[d])) { best = i; bestKey = k }
  })
  return best
}

// ——— RSSHub 多实例 ———
// 公开实例（来自 docs.rsshub.app/guide/instances，2026-10-22 取）。Hana 在用的那台永远排第一；官方 rsshub.app 有人机验证，不放
export const RSSHUB_PUBLIC = [
  'https://rsshub.rssforever.com', 'https://hub.slarker.me', 'https://rsshub.pseudoyu.com', 'https://rsshub.rss.tips',
  'https://rsshub.ktachibana.party', 'https://rss.owo.nz', 'https://rsshub.henry.wang', 'https://rsshub.cups.moe',
]
const isRsshubHost = (origin: string) => /rsshub/i.test(origin) || RSSHUB_PUBLIC.includes(origin) || (!!hubBase() && origin === hubBase())

// 地址是 RSSHub 的话，拆出路由（/nytimes/dual），否则 null
export function rsshubRoute(url: string): string | null {
  try {
    const u = new URL(original(url))
    const signed = original(url) !== url && /[?&]s=/.test(url)   // 灵媒自建的转发地址：灵媒自建的地址还没问到时也认得
    if (!signed && !isRsshubHost(u.origin)) return null
    return u.pathname + u.search
  } catch { return null }
}
// 同一条路由在几台实例上的地址：灵媒自建置顶，再是你订阅里在用的那台，再挑几台公开的，一共最多 max 个（2026-10-23 Hana 定：自建和公开的一起列）
export function routeOn(route: string, feeds: Feed[], max = 5, skip?: string): string[] {
  const hosts = [hubBase(), guessHost(feeds), ...RSSHUB_PUBLIC].filter((h, i, a) => !!h && a.indexOf(h) === i && !/^https?:\/\/rsshub\.app$/i.test(h))
  return hosts.map((h) => h + route).filter((u) => u !== skip).slice(0, max)
}
// 是不是灵媒自建那台上的地址
export const onHub = (url: string) => { const b = hubBase(); return !!b && original(url).startsWith(b + '/') }
// 实例的显示名：灵媒自建，或者主机名
export const instanceLabel = (url: string) => (onHub(url) ? HUB_LABEL : (() => { try { return new URL(original(url)).host } catch { return url } })())
// 地址的显示：灵媒自建的不露内部地址，写成「灵媒自建 · /thepaper/list/25483」
export function showUrl(url: string): string {
  const o = original(url)
  return onHub(o) ? `${HUB_LABEL} · ${o.slice(hubBase().length)}` : shortUrl(o)
}
// 能用：取得到、没毛病
export const usable = (c: Checkup | null | undefined) => !!c && c.ok && !c.problem

// 经誊写服务的订阅地址（…/scribe/feed?url=原地址&k=…）→ 原地址。显示、比对都用原地址，密钥不露出来
export function original(url: string): string {
  const m = url.match(/\/scribe\/feed\?(.*)$/)
  if (!m) return url
  return new URLSearchParams(m[1]).get('url') ?? url
}
export const shortUrl = (url: string) => original(url).replace(/^https?:\/\//, '').replace(/\/$/, '')

// ——— 巡诊 ———
export type Issue =
  | { kind: 'error'; text: string; detail?: string }
  | { kind: 'paused'; text: string }
  | { kind: 'exam'; text: string }        // 体检从服务器那边取，发现取不到 / 不是订阅源 / 空的
  | { kind: 'stale'; text: string; days: number }
  | { kind: 'summary'; text: string; crawler: boolean }
  | { kind: 'duplicate'; text: string; ids: number[] }   // ids：建议移除的那几篇（同一网址留最长的）
  | { kind: 'muted'; text: string }      // 近 30 天划掉的「不爱看」多（0.28）：只提醒，退不退订、改不改由人定
export type Ward = { feed: Feed; issues: Issue[]; latest?: string; avgChars?: number }
export type Round = { at: number; wards: Ward[]; total: number }

const STALE_DAYS = 30
// 多久没更新才算「久不更新」：按这个源自己平时的间隔，慢到三倍才算，最少 30 天（2026-10-24：低技术一个月一篇，30 天就被拦）
export function staleAfter(gaps: number[]): number {
  if (gaps.length < 2) return STALE_DAYS
  const g = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)]
  return Math.max(STALE_DAYS, Math.ceil(g * 3))
}
// 「它没事」（2026-10-24 Hana）：点一次，这个源的这几样提醒收起 6 小时，到时间自动回来重新判断。
// 只看时间：误点了，下回来看它又在（Hana：判定已经够合理，误判再出现再讨论）
// AI 判定的忽略规则（同 server/scribe/src/patrol.js 的 ignoreRule）：到期的不算；match 只对报错有用
export const IGNORE_NAME: Record<string, string> = { error: '报错', stale: '久不更新', summary: '像是摘要', muted: '不爱看' }
export function ignoreRule(meta: Meta, feedId: number, issue: Issue): IgnoreRule | null {
  const r = meta.feeds[feedId]?.ignore?.[issue.kind]
  if (!r || (r.until && Date.parse(r.until) < Date.now())) return null
  if (r.match && issue.kind === 'error' && !(issue.detail ?? '').toLowerCase().includes(r.match.toLowerCase())) return null
  return r
}
export const activeRules = (meta: Meta, feedId: number): [string, IgnoreRule][] =>
  Object.entries(meta.feeds[feedId]?.ignore ?? {}).filter(([, r]) => !r.until || Date.parse(r.until) >= Date.now())
export async function unignore(feedId: number, kind: string) {
  await updateMeta((m) => {
    const cur = { ...(m.feeds[feedId]?.ignore ?? {}) }
    delete cur[kind]
    const note = { t: new Date().toISOString(), what: `撤销 AI 的忽略：${IGNORE_NAME[kind] ?? kind}` }
    return { ...m, feeds: { ...m.feeds, [feedId]: { ...m.feeds[feedId], ignore: Object.keys(cur).length ? cur : undefined, notes: [note, ...(m.feeds[feedId]?.notes ?? [])].slice(0, 8) } } }
  })
}

export const FINE_HOURS = 6
export const stillFine = (at: string | undefined) => !!at && Date.now() - Date.parse(at) < FINE_HOURS * 3600e3
export async function markFine(feed: Feed, issues: Issue[]) {
  const at = new Date().toISOString()
  await updateMeta((m) => {
    const fine = { ...(m.feeds[feed.id]?.fine ?? {}) }
    for (const i of issues) if (i.kind !== 'paused') fine[i.kind] = at
    return { ...m, feeds: { ...m.feeds, [feed.id]: { ...m.feeds[feed.id], fine } } }
  })
}
const textLen = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, ' ').replace(/\s+/g, '').length
// 同一篇文章的网址：去掉跟踪参数、#、末尾斜杠
export function sameUrl(url: string): string {
  try {
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|spm|from|share|ref|src|mc_)/i.test(k)) u.searchParams.delete(k)
    u.hash = ''
    return (u.host.replace(/^www\./, '') + u.pathname.replace(/\/$/, '') + (u.search ? u.search : '')).toLowerCase()
  } catch { return url }
}

// 同一网址出现多次：留正文最长的一篇，其余记成建议移除
// 网址就是订阅地址或网站首页的不算（BBC 早期那批文章的网址全是订阅源地址，并不是同一篇；2026-10-22 去重时发现）
export function findDuplicates(entries: Entry[], feeds: Feed[]): Map<number, number[]> {
  const groups = new Map<string, Entry[]>()
  const home = new Map(feeds.map((f) => [f.id, new Set([sameUrl(original(f.feed_url)), sameUrl(f.site_url), sameUrl(f.feed_url)])]))
  for (const e of entries) {
    if (!e.url || home.get(e.feed_id)?.has(sameUrl(e.url))) continue
    const k = sameUrl(e.url)
    groups.set(k, [...(groups.get(k) ?? []), e])
  }
  const byFeed = new Map<number, number[]>()   // feed_id → 这个源里建议移除的文章
  for (const g of groups.values()) {
    if (g.length < 2) continue
    const keep = g.reduce((a, b) => (textLen(b.content) > textLen(a.content) ? b : a))
    for (const e of g) if (e.id !== keep.id) byFeed.set(e.feed_id, [...(byFeed.get(e.feed_id) ?? []), e.id])
  }
  return byFeed
}

async function pool<T, R>(items: T[], n: number, f: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await f(items[k]) }
  }))
  return out
}

let lastRound: Round | null = null
export const cachedRound = () => lastRound

// 巡诊一轮：只读 Miniflux 已有的数据（每个源最近 5 篇 + 全站最近 300 篇查重），不去外面取
export async function patrol(feeds: Feed[]): Promise<Round> {
  const recent = await api.entries({ limit: 300 }).catch(() => ({ entries: [] as Entry[], total: 0 }))
  const dup = findDuplicates(await visible(recent.entries), feeds)
  const wards = await pool(feeds, 4, async (feed): Promise<Ward> => {
    const issues: Issue[] = []
    if (feed.parsing_error_count > 0) issues.push({ kind: 'error', text: `抓取连续出错 ${feed.parsing_error_count} 次`, detail: feed.parsing_error_message })
    if (feed.disabled) issues.push({ kind: 'paused', text: '暂停更新中' })
    let latest: string | undefined, avgChars: number | undefined, gaps: number[] = []
    try {
      const page = await api.feedEntries(feed.id, { limit: 5 })
      latest = page.entries[0]?.published_at
      const ts = page.entries.map((e) => Date.parse(e.published_at)).filter((t) => !Number.isNaN(t))
      gaps = ts.slice(1).map((t, i) => (ts[i] - t) / 864e5)
      // 视频、播客：正文本来就是简介，不算「像是摘要」（0.27）
      // 带音视频附件、正文又短的才算（澎湃每篇长文都附朗读音频，不能当播客，2026-10-27；同 server/scribe/src/patrol.js）
      const media = page.entries.filter((e) => /youtube\.com\/watch|youtu\.be\//.test(e.url) || ((e.enclosures ?? []).some((x) => /^(audio|video)\//.test(x.mime_type)) && textLen(e.content) < 1500)).length
      if (page.entries.length >= 3 && media < page.entries.length / 2) {
        avgChars = Math.round(page.entries.reduce((a, e) => a + textLen(e.content), 0) / page.entries.length)
        if (avgChars < 300) issues.push({ kind: 'summary', text: feed.crawler ? '开着抓取全文，正文还是很短' : `像是摘要（平均 ${avgChars} 字）`, crawler: !!feed.crawler })
      }
    } catch { /* 读不到就不判 */ }
    if (!feed.disabled) {
      const days = latest ? Math.floor((Date.now() - Date.parse(latest)) / 864e5) : Infinity
      if (days >= staleAfter(gaps)) issues.push({ kind: 'stale', text: latest ? `${days} 天没有新文章` : '一篇文章都没有', days })
    }
    const ids = dup.get(feed.id)
    if (ids?.length) issues.push({ kind: 'duplicate', text: `${ids.length} 篇和别处重复`, ids })
    // 不爱看：近 30 天划掉 ≥10 篇、占这本这段时间文章的 4 成以上，提醒一句
    const muted = mutedRecently(currentMeta(), feed.id)
    if (muted >= 10) {
      const total = await api.feedEntries(feed.id, { limit: 1, published_after: Math.floor((Date.now() - 30 * 864e5) / 1000) }).then((r) => r.total).catch(() => 0)
      if (total && muted / total >= 0.4) issues.push({ kind: 'muted', text: `近 30 天划掉了 ${Math.round((muted / total) * 10)} 成（${muted} 篇）` })
    }
    // 6 小时内点过「它没事」的、AI 判定忽略的，先不提
    const m = currentMeta()
    const fine = m.feeds[feed.id]?.fine ?? {}
    return { feed, issues: issues.filter((i) => !stillFine(fine[i.kind]) && !ignoreRule(m, feed.id, i)), latest, avgChars }
  })
  lastRound = { at: Date.now(), wards, total: feeds.length }
  return lastRound
}

// ——— 处方 ———
// 去重：Miniflux 接口删不了单篇（只认已读 / 未读，2026-10-22 查过官方文档），
// 所以重复的那几篇标成已读，再记进灵媒设置的隐藏单，灵媒里不再显示。隐藏单最多留最近 500 篇
export async function hideEntries(ids: number[], feedId: number, note: string) {
  await api.setStatus(ids, 'read')
  const entry = { t: new Date().toISOString(), what: note }
  await updateMeta((m) => ({
    ...m,
    hidden: [...new Set([...ids, ...(m.hidden ?? [])])].slice(0, 500),
    feeds: { ...m.feeds, [feedId]: { ...m.feeds[feedId], notes: [entry, ...(m.feeds[feedId]?.notes ?? [])].slice(0, 8) } },
  }))
}
// 换地址：经誊写服务的源（BBC、公众号那种带 k= 的），只换里面的原地址，密钥原样留着
export function swapUrl(feedUrl: string, next: string): string {
  if (original(feedUrl) === feedUrl) return next
  const u = new URL(feedUrl)
  u.searchParams.set('url', next)
  return u.href
}
// 换实例（0.21.2）：换到灵媒自建 → 要一个新的签名地址；从灵媒自建换走 → 直接订新地址（签名只为走内网）；其余照 swapUrl
export async function retarget(feedUrl: string, next: string): Promise<string> {
  if (hubBase() && next.startsWith(hubBase() + '/')) return feedUrlFor(next)
  if (/[?&]s=/.test(feedUrl) && original(feedUrl) !== feedUrl) return next
  return swapUrl(feedUrl, next)
}
export const changeFeedUrl = (id: number, feed_url: string) => request<Feed>(`/feeds/${id}`, { method: 'PUT', body: JSON.stringify({ feed_url }) })

// ——— 病历 ———
export type Note = { t: string; what: string }
export const notesOf = (meta: Meta, id: number): Note[] => meta.feeds[id]?.notes ?? []
export function writeNote(id: number, what: string) {
  const note = { t: new Date().toISOString(), what }
  return updateMeta((m) => ({ ...m, feeds: { ...m.feeds, [id]: { ...m.feeds[id], notes: [note, ...(m.feeds[id]?.notes ?? [])].slice(0, 8) } } })).catch(() => {})
}

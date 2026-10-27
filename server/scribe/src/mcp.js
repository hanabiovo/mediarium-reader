// 灵媒的 MCP（2026-10-27 Hana 定）：让 AI 助手以某个账号的身份看订阅、找源体检、读文章、看源医生，管理档还能添加、修改、退订。
// 协议：MCP Streamable HTTP 的无状态用法——每个 POST 是一条（或一批）JSON-RPC，直接回 JSON；不开 SSE、不发会话号。
// 认人：路径里的专属链接（links.js），对上了就拿那把 Miniflux 密钥办事。权限档见 links.js。
import { checkFeed } from './doctor.js'
import { proxyOn } from './guard.js'
import { HUB, HUB_CONFIGURED, getIndex, hubOn, matchUrl, nestedIds, searchSites, siteDetail } from './hub.js'
import { htmlToMarkdown, sections } from './markdown.js'
import { mf, MfError } from './mfclient.js'
import { examineFeed, patrolUser, readReport } from './patrol.js'
import { signFeed } from './sign.js'
import { readMeta, updateMeta, withNote } from './usermeta.js'
import { RSSHUB_PUBLIC, buildPapers, categoryName, commonHead, feedTitle, isPlatformHost, isPlatformSite, paperByFeed, remember, rsshubRoute, shortColumn, shortTitle, siteOfRoute, uncategorizedId } from './papers.js'

const VERSION = '1.1.0'
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const HUB_LABEL = '灵媒自建'
const INSTRUCTIONS = `这是「灵媒」（一个自部署的 RSS 阅读器）的工具，以当前用户的身份办事，只能碰这个用户自己的订阅和文章。
- 用户提到读过的文章：先 search_articles 找，再 get_article 读。长文章会分节，按需要取某一节。
- 灵媒的订阅分两层：报刊 → 栏目。报刊是一个网站（RSSHub 的一个站点，或单独订的一个源），栏目是这个网站下的一条订阅。
  · 类别、刊名、别名只属于报刊，用 update_paper 改（多栏的整本一起改）；栏目不能单独改这三样，只能改栏目名。
  · 抓取全文、绕道、不进信息流、暂停、翻译标题每个源都能单独设（update_source）。
  · 同一个网站的新订阅会并进已有的那本报刊（类别跟着报刊）；视频、播客、社媒账号一个账号一本。拆开报刊只能在灵媒网页上做。
- 推荐新信源：先实测再推荐，只推荐能用的，告诉用户全文还是摘要、要不要开抓取全文。
  · 某个网站有哪些栏目：find_sources 带 site（站点 id）列出 RSSHub 的全部路由，标出已订的；挑出来的几条用 find_sources 的 urls 一次体检，看最近的标题合不合用户口味。
  · 用户的口味：list_subscriptions 带 stats 看某本报刊或某个类别近 30 天读了多少、收藏、划掉了多少。
- 添加、修改、退订会改用户的订阅：先把要做的事（刊名、栏目名、类别、选项）列给用户确认，再调用。退订会连同这个源的文章（包括收藏）一起删掉，unsubscribe 先不带 confirm 调一次看清楚，再请用户确认；想留着文章可以改成暂停更新或不进信息流。
- 用户的习惯（类别、是否翻译标题）可以从 list_subscriptions 里看出来，添加时照着建议默认值；抓取全文以体检结果为准。
- 源出问题：source_health 看原始材料，check_source 现场体检，refresh_source 让 Miniflux 立刻重抓一次。`

// ——— 小工具 ———
const DAY = 864e5
const ago = (iso) => {
  if (!iso) return ''
  const d = Math.floor((Date.now() - Date.parse(iso)) / DAY)
  return d <= 0 ? '今天' : d === 1 ? '昨天' : d < 30 ? `${d} 天前` : d < 365 ? `${Math.floor(d / 30)} 个月前` : `${Math.floor(d / 365)} 年前`
}
const day = (iso) => (iso ? iso.slice(0, 10) : '')
// 订阅地址 → 给人看的样子：经誊写服务转的取出原地址；灵媒自建写成「hub:/路由」
function plainUrl(feedUrl) {
  let u = feedUrl
  const m = /\/scribe\/feed\?(.*)$/.exec(u)
  if (m) u = new URLSearchParams(m[1]).get('url') ?? u
  if (HUB && u.startsWith(HUB + '/')) return 'hub:' + u.slice(HUB.length)
  return u
}
// hub:/路由 → 内部地址；别的原样
const hubInner = (u) => (u.startsWith('hub:/') ? HUB + u.slice(4) : u)
const sameFeed = (a, b) => plainUrl(a).replace(/\/$/, '').toLowerCase() === plainUrl(b).replace(/\/$/, '').toLowerCase()
const rate = (w) => (w >= 14 ? `每天约 ${Math.round(w / 7)} 篇` : w >= 1 ? `每周约 ${Math.round(w)} 篇` : w > 0 ? `每月约 ${Math.max(1, Math.round(w * 4.3))} 篇` : '')
function verdictLine(c) {
  if (!c.ok) return c.problem ?? '取不到'
  if (c.problem) return c.problem
  return [
    c.kind === 'video' ? '视频' : c.kind === 'audio' ? '播客' : c.content === 'full' ? '全文' : c.content === 'summary' ? (c.crawlerHelps ? '摘要（开抓取全文能补全）' : '摘要') : '不确定是否全文',
    (c.imageShare ?? 0) >= 0.4 ? '有图' : '',
    c.perWeek ? rate(c.perWeek) : '',
    c.latest ? `最新 ${ago(c.latest)}` : '',
    c.via ? '要绕道（经代理）才取得到' : '',
  ].filter(Boolean).join(' · ')
}
const usable = (c) => !!c && c.ok && !c.problem
const blocked = (c) => !!c && !c.ok && (c.status === 403 || c.status === 429 || c.status === 451 || c.status === 503 || /人机验证|连不上|超时/.test(c.problem ?? ''))
function score(c) {
  if (!usable(c)) return -1
  let s = 10
  if (c.kind || c.content === 'full') s += 6
  else if (c.crawlerHelps) s += 4
  else if (c.content === 'unsure') s += 2
  if (c.latest) { const d = (Date.now() - Date.parse(c.latest)) / DAY; s += d < 3 ? 3 : d < 14 ? 2 : d < 60 ? 1 : -2 }
  if ((c.imageShare ?? 0) >= 0.4) s += 1
  return s
}
async function pool(items, n, f) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k], k) } }))
  return out
}
class UserError extends Error {}
const need = (v, what) => { if (v === undefined || v === null || v === '') throw new UserError(`缺少 ${what}`); return v }
const intArg = (v, what) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new UserError(`${what} 应该是正整数`); return n }

// 体检：先直接取，像是被拦了再绕道（配了代理才有）。灵媒自建的直接取内网地址
async function examine(url) {
  const c = await checkFeed(hubInner(url)).catch((e) => ({ url, ok: false, problem: e.message }))
  if (blocked(c) && proxyOn() && !url.startsWith('hub:/')) {
    const p = await checkFeed(url, { via: 'proxy' }).catch(() => null)
    if (usable(p)) return p
  }
  return c
}
function checkupText(url, c) {
  const lines = [`${url}`, `  结论：${verdictLine(c)}`]
  if (c.title) lines.push(`  源名：${c.title}`)
  if (c.status) lines.push(`  状态码：${c.status}`)
  if (c.ok) {
    lines.push(`  篇数：${c.count ?? '?'}；最新：${day(c.latest) || '?'}；前 5 篇平均 ${c.avgChars ?? '?'} 字；有图比例 ${c.imageShare ?? 0}`)
    if (c.sample) lines.push(`  第一篇：源里 ${c.sample.chars} 字；原网页${c.sample.page?.chars ? ` ${c.sample.page.chars} 字` : `：${c.sample.page?.problem ?? '没取'}`}`)
    if (c.fuller) lines.push(`  同一网站上找到给全文的源：${c.fuller}`)
    if (c.titles?.length) lines.push(`  最近标题：${c.titles.slice(0, 4).join(' / ')}`)
  }
  return lines.join('\n')
}

async function feedsAndCats(key) {
  const [feeds, cats] = await Promise.all([mf(key, '/feeds'), mf(key, '/categories')])
  return { feeds: feeds ?? [], cats: cats ?? [] }
}
const findCat = (cats, name) => cats.find((c) => c.title.trim().toLowerCase() === String(name).trim().toLowerCase())

// ——— 报刊（papers.js）———
// RSSHub 目录（认带斜杠的站点 id 用）：取不到或太慢就不等，归刊照样能做，只是那几个站点按第一段认
async function hubIndex() {
  if (!hubOn()) return null
  let t
  const late = new Promise((ok) => { t = setTimeout(() => ok(null), 5000); t.unref?.() })
  return Promise.race([getIndex().catch(() => null), late]).finally(() => clearTimeout(t))
}
// 整个报刊架：源、类别、灵媒设置、报刊
async function shelf(key) {
  const [{ feeds, cats }, meta, idx] = await Promise.all([feedsAndCats(key), readMeta(key), hubIndex()])
  const pctx = { hub: HUB, nested: nestedIds(idx) }
  return { feeds, cats, meta, idx, pctx, papers: buildPapers(feeds, cats, meta, pctx) }
}
// 类别名 → 类别；「无类别」认成那个当无类别用的；没有就新建
async function resolveCat(key, sh, name) {
  const n = String(name).trim()
  if (!n) throw new UserError('类别名是空的')
  if (n === '无类别') { const u = uncategorizedId(sh.meta, sh.cats); if (u) return sh.cats.find((c) => c.id === u) }
  let cat = findCat(sh.cats, n)
  if (!cat) { cat = await mf(key, '/categories', { method: 'POST', body: JSON.stringify({ title: n }) }); sh.cats.push(cat) }
  return cat
}
const catTitle = (sh, c) => categoryName(sh.meta, sh.cats, sh.cats.find((x) => x.id === c?.id) ?? c)
const putFeed = (key, id, body) => mf(key, `/feeds/${id}`, { method: 'PUT', body: JSON.stringify(body) })
// 一个新地址该归哪本报刊：RSSHub 按站点、官方 RSS 按域名；平台上的账号一个一本（null）
function siteKeyOf(url, pctx) {
  const route = url.startsWith('hub:/') ? url.slice(4) : rsshubRoute(url, pctx)
  if (route) { const k = siteOfRoute(route, pctx); return k && !isPlatformSite(k) ? k : null }
  let h = ''
  try { h = new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, '') } catch { return null }
  return isPlatformHost(h) ? null : 'd:' + h
}
const columnTail = (url, pctx) => { const r = url.startsWith('hub:/') ? url.slice(4) : rsshubRoute(url, pctx); return r ? decodeURIComponent(r.split('?')[0].split('/').filter(Boolean).at(-1) ?? '') : '' }

// 改报刊的类别、刊名、别名（同网页端 web/src/lib/paperOps.ts 的 movePaper、renamePaper）。返回做了什么；note=false 时不记病历（由调用的记）
async function editPaper(key, sh, p, { category, name, alias }, note = true) {
  const did = []
  if (category !== undefined && category !== null && category !== '') {
    const cat = await resolveCat(key, sh, category)
    for (const f of p.feeds) if (f.category?.id !== cat.id) await putFeed(key, f.id, { category_id: cat.id })
    did.push(`类别改成「${catTitle(sh, cat)}」${p.feeds.length > 1 ? `（${p.feeds.length} 栏一起搬）` : ''}`)
  }
  const n = name ? String(name).trim() : p.name
  const l = alias !== undefined && alias !== null ? String(alias).trim() : p.alias
  const single = p.feeds.length === 1
  if (name && n !== p.name) {
    for (const f of p.feeds) { const t = feedTitle(n, p.columns.get(f.id), single); if (f.title !== t) await putFeed(key, f.id, { title: t }) }
    did.push(`刊名改成「${n}」`)
  }
  if (alias !== undefined && alias !== null && l !== p.alias) did.push(l ? `别名改成「${l}」` : '别名清空')
  const named = (name && n !== p.name) || (alias !== undefined && alias !== null && l !== p.alias)
  if (named || (note && did.length)) {
    await updateMeta(key, (m) => {
      let next = named ? remember(m, { ...p, name: n, alias: l }) : m
      if (named && single) next.feeds[p.lead.id] = { ...next.feeds[p.lead.id], latin: l || undefined }   // 一栏的：别名也就是这个源的别名
      if (note && did.length) next = withNote(next, p.lead.id, `AI 助手：${did.join('，')}`)
      return next
    })
  }
  return did
}

// 近 30 天的阅读情况：发了几篇、读了几篇、收藏几篇、划掉几篇
async function readingOf(key, meta, id) {
  const since = Date.now() - 30 * DAY
  const after = String(Math.floor(since / 1000))
  const count = (q) => mf(key, `/feeds/${id}/entries?limit=1&published_after=${after}&${q}`).then((r) => r?.total ?? 0).catch(() => null)
  const [all, read, starred] = await Promise.all([count('status=unread&status=read'), count('status=read'), count('starred=true&status=unread&status=read')])
  const muted = Object.values(meta.muted ?? {}).filter((v) => v?.f === id && v.t >= since).length
  if (all === null) return '近 30 天：取不到'
  return `近 30 天 ${all} 篇，读了 ${read ?? '?'}，收藏 ${starred ?? '?'}，划掉 ${muted}`
}
const addedAt = (m, id) => { const t = m.feeds?.[id]?.added; return t ? `添加于 ${t.slice(0, 16).replace('T', ' ')}` : '' }
function flagsOf(f, m) {
  return [f.crawler && '抓取全文', m.feeds?.[f.id]?.trTitle && '翻译标题', f.disabled && '暂停', f.hide_globally && '不进信息流', f.fetch_via_proxy && '绕道',
    f.parsing_error_count > 0 && `报错×${f.parsing_error_count}`].filter(Boolean)
}

// RSSHub 一个站点的路由，写成给 AI 看的样子。说明里的表格（「新闻 | 国内」下一行「news | china」）摊成「新闻=news、国内=china」
function tablesToPairs(text) {
  const lines = String(text ?? '').split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const row = (l) => l.trim().replace(/^\||\|$/g, '').split('|').map((x) => x.trim())
    if (/^\s*\|/.test(lines[i]) && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1] ?? '') && /^\s*\|/.test(lines[i + 2] ?? '')) {
      const head = row(lines[i])
      let j = i + 2
      while (j < lines.length && /^\s*\|/.test(lines[j])) {
        const vals = row(lines[j])
        out.push(head.map((h, k) => (h && vals[k] ? `${h}=${vals[k]}` : '')).filter(Boolean).join('、'))
        j++
      }
      i = j - 1
    } else if (lines[i].trim() && !/^:::/.test(lines[i].trim())) out.push(lines[i].trim())
  }
  return out.join('；').replace(/\s+/g, ' ')
}
function routeFlag(r) {
  const f = r.features
  if (!f) return ''
  const cfg = Array.isArray(f.requireConfig) ? f.requireConfig : []
  const have = new Set(HUB_CONFIGURED)
  const got = cfg.some((c) => have.has(c.name))
  if (f.requirePuppeteer && !got) return '用不了（要浏览器）'
  if (cfg.some((c) => !c.optional && !have.has(c.name))) return '用不了（要服务器配置）'
  if (f.antiCrawler || f.requirePuppeteer) return '对方有反爬，可能时好时坏'
  return ''
}
function paramText(params) {
  if (!params || typeof params !== 'object') return ''
  return Object.entries(params).map(([k, v]) => {
    if (typeof v === 'string') return `${k}：${tablesToPairs(v)}`
    const opts = Array.isArray(v?.options) ? v.options.map((o) => `${o.label}=${o.value}`).join('、') : ''
    return `${k}：${tablesToPairs(v?.description ?? '')}${opts ? `（可选：${opts}）` : ''}`
  }).join('；')
}

// 一个候选的体检结果几行（find_sources 用）
function candidateLines(url, ck) {
  const out = [`  地址：${url}`, `  ${verdictLine(ck ?? { ok: false })}`]
  if (ck?.ok && ck.titles?.length) out.push(`  最近标题：${ck.titles.slice(0, 3).join(' / ')}`)
  if (ck?.ok && ck.content === 'summary' && ck.crawlerHelps) out.push('  建议：开抓取全文（crawler）')
  if (ck?.via) out.push('  建议：开绕道（proxy）')
  return out
}
// find_sources 的 site：一个站点的全部路由，标出已订的
async function siteRoutes(key, id) {
  if (!hubOn()) return '这台灵媒没接 RSSHub，看不了站点的路由。'
  const [sh, idx] = await Promise.all([shelf(key), getIndex().catch(() => null)])
  let site
  try { site = await siteDetail(id, idx) } catch (e) { throw new UserError(e.status === 404 ? `RSSHub 目录里没有站点「${id}」。可以先用 query 按名字搜站点 id。` : `取不到站点目录：${e.message}`) }
  const mine = sh.feeds.filter((f) => { const r = rsshubRoute(f.feed_url, sh.pctx); return r && siteOfRoute(r, sh.pctx) === id })
  const out = [`${site.name}（站点 id ${id}${site.url ? '，' + site.url : ''}）共 ${site.routes.length} 条路由：`]
  if (mine.length) {
    const p = paperByFeed(sh.papers, mine[0].id)
    out.push(`已订 ${mine.length} 条${p ? `，在报刊《${p.name}》里（类别「${catTitle(sh, p.category)}」；新栏目用 add_sources 带 join_feed_id: ${p.lead.id} 并进去）` : ''}：`)
    for (const f of mine) { const q = paperByFeed(sh.papers, f.id); out.push(`  - #${f.id} ${q && q.feeds.length > 1 ? q.columns.get(f.id) : f.title}：${rsshubRoute(f.feed_url, sh.pctx)}`) }
  } else out.push('一条都还没订。')
  out.push('')
  for (const r of site.routes) {
    const path = `/${id}${r.path.startsWith('/') ? '' : '/'}${r.path}`
    const fl = routeFlag(r)
    out.push(`- ${r.name}：${path}${fl ? `【${fl}】` : ''}`)
    if (r.example) out.push(`  例：${r.example}`)
    const pt = paramText(r.parameters)
    if (pt) out.push(`  参数：${pt.slice(0, 600)}`)
    const d = tablesToPairs(r.description)
    if (d) out.push(`  说明：${d.slice(0, 600)}`)
  }
  out.push('', '用法：把参数填进路由（如 /cctv/world），挑好的几条用 find_sources 的 urls 一次体检，再交给 add_sources（地址写成 hub:/路由）。')
  return out.join('\n')
}
// find_sources 的 urls：一次体检几条
async function batchCheck(key, urls) {
  const list = urls.map((u) => String(u ?? '').trim()).filter(Boolean)
  if (!list.length || list.length > 12) throw new UserError('urls 要 1–12 条')
  const norm = list.map((u) => (u.startsWith('/') ? (HUB ? 'hub:' + u : RSSHUB_PUBLIC[0] + u) : u))
  const [{ feeds }, checks] = await Promise.all([feedsAndCats(key), pool(norm, 4, (u) => examine(u))])
  const out = [`体检了 ${norm.length} 条：`]
  norm.forEach((u, i) => {
    const had = feeds.find((f) => sameFeed(f.feed_url, u))
    out.push(`\n${checks[i]?.title || u}${usable(checks[i]) ? '' : '（不能用）'}${had ? `【已订阅：#${had.id} ${had.title}】` : ''}`)
    out.push(...candidateLines(u, checks[i]))
  })
  return out.join('\n')
}

// ——— 工具 ———
const TOOLS = [
  {
    name: 'list_subscriptions', scope: 'read',
    description: '列出用户的订阅：按类别 → 报刊 → 栏目分层，每个源带 id、订阅地址、设置（抓取全文、翻译标题、暂停、不进信息流、绕道）、最近是否报错、AI 助手添加的时间。可以只看一个类别（category）或某个源所在的那本报刊（feed_id）；带 stats: true 再附上每个源近 30 天发了几篇、用户读了几篇、收藏、划掉（「不爱看」）几篇，用来判断用户的口味（要先用 category 或 feed_id 缩小范围）。',
    inputSchema: {
      type: 'object',
      properties: {
        category: { type: 'string', description: '只看这个类别，可省' },
        feed_id: { type: 'number', description: '只看这个源所在的那本报刊，可省' },
        stats: { type: 'boolean', description: '附上近 30 天的阅读情况（要和 category 或 feed_id 一起用）' },
      },
    },
    run: async ({ key }, a) => {
      const sh = await shelf(key)
      let papers = sh.papers
      if (a.feed_id) { const p = paperByFeed(papers, intArg(a.feed_id, 'feed_id')); if (!p) throw new UserError(`没有 #${a.feed_id} 这个源`); papers = [p] }
      if (a.category) { const n = String(a.category).trim().toLowerCase(); papers = papers.filter((p) => catTitle(sh, p.category).toLowerCase() === n) }
      if (a.stats && !a.feed_id && !a.category) throw new UserError('stats 要和 category 或 feed_id 一起用（一次看全部太慢）')
      if (a.stats && papers.reduce((n, p) => n + p.feeds.length, 0) > 60) throw new UserError('这个范围里的源太多（超过 60 个），换个小一点的类别，或用 feed_id 看一本报刊')
      const stats = new Map()
      if (a.stats) {
        const ids = papers.flatMap((p) => p.feeds.map((f) => f.id))
        const got = await pool(ids, 4, (id) => readingOf(key, sh.meta, id))
        ids.forEach((id, i) => stats.set(id, got[i]))
      }
      const out = []
      if (!a.feed_id && !a.category) out.push(`共 ${sh.feeds.length} 个源，归成 ${sh.papers.length} 本报刊，${sh.cats.length} 个类别。`)
      out.push('（类别、刊名、别名属于报刊，用 update_paper 改；多栏报刊里的栏目只能改栏目名和各项选项，用 update_source。）')
      const line = (f, label) => {
        const flags = flagsOf(f, sh.meta), when = addedAt(sh.meta, f.id)
        return `#${f.id} ${label} — ${plainUrl(f.feed_url)}${flags.length ? '｜' + flags.join('、') : ''}${when ? '｜' + when : ''}${stats.has(f.id) ? '｜' + stats.get(f.id) : ''}`
      }
      let lastCat = null
      for (const p of papers) {
        if (p.category?.id !== lastCat) { lastCat = p.category?.id; out.push(`\n## ${catTitle(sh, p.category)}`) }
        const alias = p.alias ? `（别名 ${p.alias}）` : ''
        if (p.feeds.length === 1) out.push(`- ${line(p.lead, `《${p.name}》${alias}`)}`)
        else {
          out.push(`- 《${p.name}》${alias}，${p.feeds.length} 栏${p.site ? `，RSSHub 站点 ${p.site}` : ''}：`)
          for (const f of p.feeds) out.push(`  - ${line(f, `栏目「${p.columns.get(f.id)}」`)}`)
        }
      }
      if (!papers.length) out.push('没有符合的。')
      return out.join('\n')
    },
  },
  {
    name: 'find_sources', scope: 'read',
    description: '找订阅源并当场体检（从服务器真的取一次）。三种用法：① query：网站地址、订阅源地址、RSSHub 路由（/开头）或站点名；② site：RSSHub 站点 id（如 cctv、thepaper），列出这个站点的全部路由（栏目）、参数可选值，并标出用户已经订了哪几条——只列不体检；③ urls：一次体检几条地址或路由（最多 12 条，路由写成 /cctv/world 或 hub:/cctv/world），带最近的标题，方便挑栏目。返回每个候选能不能用、全文还是摘要、更新频率、要不要开抓取全文，并标出推荐的和已经订过的。添加时把「地址」原样交给 add_sources。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '网址、订阅地址、RSSHub 路由或站点名' },
        site: { type: 'string', description: 'RSSHub 站点 id：列出它的全部路由' },
        urls: { type: 'array', items: { type: 'string' }, description: '一次体检的几条地址或路由（最多 12 条）' },
      },
    },
    run: async ({ key }, a) => {
      if (a.site) return siteRoutes(key, String(a.site).trim())
      if (Array.isArray(a.urls) && a.urls.length) return batchCheck(key, a.urls)
      const q = String(need(a.query, 'query、site 或 urls')).trim()
      const { feeds } = await feedsAndCats(key)
      const idx = hubOn() ? await getIndex().catch(() => null) : null
      let cands = []   // { url, title, from }
      const notes = []
      if (q.startsWith('/') || q.startsWith('hub:/')) {
        const route = q.replace(/^hub:/, '')
        if (HUB) cands.push({ url: 'hub:' + route, from: HUB_LABEL })
        for (const h of RSSHUB_PUBLIC.slice(0, 3)) cands.push({ url: h + route, from: new URL(h).host })
      } else if (/^https?:\/\//i.test(q) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(q)) {
        const url = /^https?:\/\//i.test(q) ? q : 'https://' + q
        const found = await mf(key, '/discover', { method: 'POST', body: JSON.stringify({ url }) }).catch(() => [])
        for (const d of found ?? []) cands.push({ url: d.url, title: d.title, from: '官方' })
        if (!cands.length) cands.push({ url, from: '原地址' })
        if (idx) for (const r of matchUrl(idx, url)) {
          if (r.needsInput || !r.path) { notes.push(`RSSHub 路由 ${r.siteName} · ${r.name}（${r.route}）要填参数，没自动体检；用 site: ${r.site} 看参数说明`); continue }
          if (HUB) cands.push({ url: 'hub:' + r.path, title: `${r.siteName} · ${r.name}`, from: HUB_LABEL })
        }
      } else {
        if (!idx) return '这台灵媒没接 RSSHub，按名字找不了。请给网站地址。'
        const sites = searchSites(idx, q).slice(0, 10)
        if (!sites.length) return `RSSHub 目录里没有叫「${q}」的站点。请给网站地址，我直接去找官方订阅源。`
        return [`RSSHub 目录里和「${q}」有关的站点（还没体检）：`, ...sites.map((s) => `- ${s.name}（站点 id ${s.id}${s.url ? '，' + s.url : ''}，${s.n} 条路由）`),
          '要看某个站点有哪些栏目，用 site: 站点 id 再调一次 find_sources；挑好几条用 urls 一次体检。'].join('\n')
      }
      cands = cands.filter((c, i, arr) => arr.findIndex((x) => x.url === c.url) === i).slice(0, 8)
      const checks = await pool(cands, 3, (c) => examine(c.url))
      // 只给摘要、同一网站上找到给全文的：也列进来
      for (let i = 0; i < checks.length; i++) {
        const f = checks[i]?.fuller
        if (f && !cands.some((c) => c.url === f) && cands.length < 10) { cands.push({ url: f, from: '同网站全文版' }); checks.push(await examine(f)) }
      }
      const hubFirst = cands.findIndex((c, i) => c.url.startsWith('hub:/') && usable(checks[i]))
      let best = hubFirst
      if (best < 0) { let s = 0; checks.forEach((c, i) => { const v = score(c); if (v > s) { s = v; best = i } }) }
      const out = [`「${q}」找到 ${cands.length} 个候选：`]
      cands.forEach((c, i) => {
        const had = feeds.find((f) => sameFeed(f.feed_url, c.url))
        out.push(`\n${i === best ? '★ 推荐 ' : ''}${c.title || checks[i]?.title || ''}（${c.from}）${had ? `【已订阅：#${had.id} ${had.title}】` : ''}`)
        out.push(...candidateLines(c.url, checks[i]))
      })
      if (notes.length) out.push('', ...notes)
      return out.join('\n')
    },
  },
  {
    name: 'search_articles', scope: 'read',
    description: '找文章。可以按关键词（标题和正文）、最近几天、已读/未读、收藏、某个源来找。返回文章 id、标题、来源、时间、状态；用 get_article 读全文。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，可省' },
        days: { type: 'number', description: '只看最近几天发布的，可省' },
        status: { type: 'string', enum: ['any', 'unread', 'read'], description: '默认 any' },
        starred: { type: 'boolean', description: '只看收藏' },
        feed_id: { type: 'number', description: '只看某个源' },
        limit: { type: 'number', description: '最多几篇，默认 15，最多 50' },
      },
    },
    run: async ({ key }, a) => {
      const p = new URLSearchParams({ order: 'published_at', direction: 'desc', limit: String(Math.min(50, Math.max(1, Number(a.limit) || 15))) })
      if (a.query) p.set('search', String(a.query))
      if (a.days) p.set('published_after', String(Math.floor((Date.now() - Number(a.days) * DAY) / 1000)))
      if (a.starred) p.set('starred', 'true')
      const st = a.status === 'unread' ? ['unread'] : a.status === 'read' ? ['read'] : ['unread', 'read']
      for (const s of st) p.append('status', s)
      const path = a.feed_id ? `/feeds/${intArg(a.feed_id, 'feed_id')}/entries` : '/entries'
      const r = await mf(key, `${path}?${p}`)
      const list = r?.entries ?? []
      if (!list.length) return '没找到。'
      return [`共 ${r.total} 篇，列出 ${list.length} 篇：`,
        ...list.map((e) => `- [${e.id}] ${e.title} — ${e.feed?.title ?? ''}，${day(e.published_at)}${e.status === 'read' ? '，已读' : '，未读'}${e.starred ? '，★收藏' : ''}`)].join('\n')
    },
  },
  {
    name: 'get_article', scope: 'read',
    description: '读一篇文章的全文（灵媒整理过的 Markdown，图写成 ![图注](地址)）。很长的文章先给目录和第一节，用 section 取后面的节。',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: '文章 id（search_articles 给的）' }, section: { type: 'number', description: '第几节，从 1 开始，可省' } }, required: ['id'] },
    run: async ({ key }, a) => {
      const e = await mf(key, `/entries/${intArg(a.id, 'id')}`)
      const md = htmlToMarkdown(e.content, { title: e.title, base: e.url })
      const head = [`# ${e.title}`, `来源：${e.feed?.title ?? ''}${e.author ? '｜作者：' + e.author : ''}｜${day(e.published_at)}｜${e.status === 'read' ? '已读' : '未读'}${e.starred ? '｜★收藏' : ''}`, `原文：${e.url}`]
      const audio = (e.enclosures ?? []).filter((x) => /^audio\//.test(x.mime_type ?? ''))
      if (audio.length) head.push(`音频：${audio.map((x) => x.url).join('、')}`)
      if (!md.trim()) return head.join('\n') + '\n\n（正文是空的，内容可能只在原网页上）'
      const parts = sections(md)
      if (md.length <= 15000 && !a.section) return head.join('\n') + '\n\n' + md
      const n = a.section ? intArg(a.section, 'section') : 1
      if (n > parts.length) throw new UserError(`只有 ${parts.length} 节`)
      const toc = parts.map((p, i) => `${i + 1}. ${p.title}（${p.text.length} 字）`).join('\n')
      return `${head.join('\n')}\n\n全文 ${md.length} 字，分 ${parts.length} 节：\n${toc}\n\n——— 第 ${n} 节 ———\n\n${parts[n - 1].text}`
    },
  },
  {
    name: 'source_health', scope: 'read',
    description: '源医生：看信源健康状况的原始材料。给 feed_id 看一个源的详情（Miniflux 抓取报错原文、上次检查时间、最近 5 篇的日期和字数、平时多久更新、不爱看的比例、病历）；不给就巡一遍全部，列出有问题的源，并附上每日巡诊记下的问题从哪天开始。',
    inputSchema: { type: 'object', properties: { feed_id: { type: 'number', description: '某个源的 id，可省' } } },
    run: async ({ key, uid }, a) => {
      if (a.feed_id) {
        const id = intArg(a.feed_id, 'feed_id')
        const [feed, meta] = await Promise.all([mf(key, `/feeds/${id}`), readMeta(key)])
        const { facts, issues } = await examineFeed(key, feed, meta)
        const lines = [`#${facts.id} ${facts.title}（${facts.category ?? ''}）`, `订阅地址：${plainUrl(feed.feed_url)}`, `网站：${feed.site_url}`,
          `设置：${[facts.crawler && '抓取全文', facts.proxy && '绕道', facts.paused && '暂停'].filter(Boolean).join('、') || '默认'}`,
          `Miniflux：上次检查 ${facts.checkedAt ?? '?'}；连续出错 ${facts.errors} 次${facts.errorMessage ? `；报错原文：${facts.errorMessage}` : ''}`,
          `最新一篇：${day(facts.latest) || '无'}；平时间隔约 ${facts.typicalGapDays ?? '?'} 天${facts.avgChars !== undefined ? `；最近几篇平均 ${facts.avgChars} 字` : ''}${facts.kind === 'media' ? '；视频/播客源' : ''}`]
        if (facts.recent?.length) lines.push('最近几篇：', ...facts.recent.map((r) => `  - ${day(r.published)} ${r.title}（${r.chars} 字）`))
        if (facts.muted30d) lines.push(`近 30 天划掉「不爱看」${facts.muted30d} 篇${facts.entries30d ? `，这段时间共 ${facts.entries30d} 篇` : ''}`)
        lines.push(issues.length ? `规则判出的问题：${issues.map((i) => i.text).join('；')}` : '规则判出的问题：没有')
        if (facts.notes?.length) lines.push('病历：', ...facts.notes.map((n) => `  - ${day(n.t)} ${n.what}`))
        return lines.join('\n')
      }
      const [round, report] = await Promise.all([patrolUser(key), readReport(uid)])
      const since = new Map((report?.issues ?? []).map((i) => [`${i.feed}|${i.kind}`, i.since]))
      const sick = round.wards.filter((w) => w.issues.length)
      const out = [`巡了 ${round.total} 个源，${sick.length} 个要看看。${report ? `（每日巡诊上次在 ${report.at.slice(0, 16).replace('T', ' ')}）` : ''}`]
      for (const w of sick) {
        out.push(`- #${w.facts.id} ${w.facts.title}：${w.issues.map((i) => { const s = since.get(`${w.facts.id}|${i.kind}`); return i.text + (s ? `（${day(s)} 起）` : '') }).join('；')}`)
        if (w.facts.errorMessage) out.push(`  报错原文：${w.facts.errorMessage}`)
      }
      return out.join('\n')
    },
  },
  {
    name: 'check_source', scope: 'read',
    description: '现场体检：从服务器真的去取一次这个源（被拦时自动试绕道），量出状态码、篇数、更新时间、全文还是摘要、原网页能不能取到。给 feed_id 体检已订的源，或给 url 体检任意地址。',
    inputSchema: { type: 'object', properties: { feed_id: { type: 'number' }, url: { type: 'string' } } },
    run: async ({ key }, a) => {
      let url = a.url ? String(a.url) : ''
      if (a.feed_id) url = plainUrl((await mf(key, `/feeds/${intArg(a.feed_id, 'feed_id')}`)).feed_url)
      need(url, 'feed_id 或 url')
      return checkupText(url, await examine(url))
    },
  },
  {
    name: 'refresh_source', scope: 'read',
    description: '让 Miniflux 立刻重新抓一次这个源（不改任何设置），然后报告抓取结果。',
    inputSchema: { type: 'object', properties: { feed_id: { type: 'number' } }, required: ['feed_id'] },
    run: async ({ key }, a) => {
      const id = intArg(a.feed_id, 'feed_id')
      await mf(key, `/feeds/${id}/refresh`, { method: 'PUT', timeout: 60000 })
      const f = await mf(key, `/feeds/${id}`)
      return f.parsing_error_count > 0 ? `重抓了，还是出错（连续 ${f.parsing_error_count} 次）：${f.parsing_error_message}` : `重抓好了，没有报错。上次检查：${f.checked_at}`
    },
  },
  {
    name: 'add_sources', scope: 'manage',
    description: '批量添加订阅源（会改用户的订阅：先和用户确认要加哪些、刊名和栏目名、放哪个类别、怎么设置）。url 用 find_sources 给的地址（灵媒自建的写成 hub:/路由）。灵媒按「报刊 → 栏目」组织：同一个网站（RSSHub 同一站点、官方 RSS 同一域名）的会并成一本报刊；用户已经有这本报刊的，新的自动并进去当栏目，类别跟着报刊（category 不用填，填了也不生效）。新建报刊时：category 必填，paper 是刊名、alias 是别名（如外文刊的中文名），这一次里同一网站的几条会成为同一本的几个栏目，column 是栏目名。join_feed_id 可以指定并进哪本报刊（填那本报刊里任意一个源的 id）；separate: true 表示不并、另立一本。视频、播客、社媒账号一个账号一本。类别不存在就新建。',
    inputSchema: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              category: { type: 'string', description: '类别名（新建报刊时必填；并进已有报刊时跟着报刊）' },
              paper: { type: 'string', description: '刊名（新建报刊时用，可省：省了用源自己的名字）' },
              alias: { type: 'string', description: '报刊的别名（新建报刊时用，可省）' },
              column: { type: 'string', description: '栏目名（这本报刊有几栏时显示，可省：省了从源名里去掉刊名得来）' },
              join_feed_id: { type: 'number', description: '并进这个源所在的报刊，可省' },
              separate: { type: 'boolean', description: '不并进同网站的已有报刊，另立一本' },
              translate_title: { type: 'boolean', description: '翻译标题' },
              crawler: { type: 'boolean', description: '抓取全文' },
              proxy: { type: 'boolean', description: '绕道（经代理）抓取' },
              hide_from_stream: { type: 'boolean', description: '不进信息流' },
            },
            required: ['url'],
          },
        },
      },
      required: ['sources'],
    },
    run: async (ctx, a) => {
      const { key } = ctx
      const list = need(a.sources, 'sources')
      if (!Array.isArray(list) || !list.length || list.length > 20) throw new UserError('sources 要 1–20 个')
      const sh = await shelf(key)
      const feeds = [...sh.feeds]
      const groups = new Map()   // 归到同一本的放一组：{ target（已有报刊）, key, name, alias, cat, notes, items: [{ id, s, title, url }] }
      const results = []
      for (const s of list) {
        const url = String(s.url ?? '').trim()
        try {
          need(url, 'url')
          const had = feeds.find((f) => sameFeed(f.feed_url, url))
          if (had) { results.push(`- ${url}：已经订过了（#${had.id} ${had.title}），没重复加`); continue }
          // 归哪本
          let target = null, gk = ''
          if (s.join_feed_id) {
            target = paperByFeed(sh.papers, intArg(s.join_feed_id, 'join_feed_id'))
            if (!target) throw new UserError(`没有 #${s.join_feed_id} 这个源`)
            gk = 'p|' + target.key
          } else if (!s.separate) {
            const k = siteKeyOf(url, sh.pctx)
            if (k) {
              const same = sh.papers.filter((p) => p.key === k)
              target = same.find((p) => sh.meta.feeds?.[p.lead.id]?.paper === k) ?? same[0] ?? null
              gk = target ? 'p|' + target.key : 'n|' + k
            }
          }
          const named = String(s.paper ?? s.title ?? '').trim()
          if (!gk) gk = s.separate && named ? 'u|' + named : 'one|' + url
          let g = groups.get(gk)
          if (!g) {
            const cat = target ? target.category : await resolveCat(key, sh, need(s.category, 'category（新建报刊要放进哪个类别）'))
            g = { target, key: target ? target.key : gk.startsWith('n|') ? gk.slice(2) : null, name: '', alias: '', cat, notes: [], items: [] }
            groups.set(gk, g)
          }
          if (target) {
            if (s.category && findCat(sh.cats, s.category)?.id !== target.category?.id) g.notes.push(`类别跟着报刊，放在「${catTitle(sh, target.category)}」`)
            if (named && named !== target.name) g.notes.push('刊名、别名属于报刊，要改用 update_paper')
          } else {
            if (named && !g.name) g.name = named
            if (s.alias && !g.alias) g.alias = String(s.alias).trim()
          }
          const feedUrl = url.startsWith('hub:/') ? ctx.wrapHub(hubInner(url)) : url
          const r = await mf(key, '/feeds', { method: 'POST', timeout: 60000, body: JSON.stringify({ feed_url: feedUrl, category_id: g.cat.id, crawler: !!s.crawler, fetch_via_proxy: !!s.proxy, hide_globally: !!s.hide_from_stream }) })
          const id = r.feed_id
          const f = await mf(key, `/feeds/${id}`).catch(() => null)
          feeds.push({ id, feed_url: feedUrl, title: f?.title || url })
          g.items.push({ id, s, url, title: f?.title || url })
        } catch (e) { results.push(`- ✗ ${url}：${e.message}`) }
      }
      // 收尾：源名写成「刊名 · 栏目」，报刊、栏目、翻译标题、添加时间记进灵媒设置（同网页端 web/src/lib/subscribe.ts 的 finish、paperOps.ts 的 mergeInto）
      const now = new Date().toISOString()
      const writes = []   // (m) => m
      for (const g of groups.values()) {
        if (!g.items.length) continue
        const titles = []
        if (g.target) {
          const p = g.target
          const cols = new Map(p.columns)
          let name = p.name
          if (p.feeds.length === 1) {
            // 一栏的报刊变成多栏：刊名取几个源名共有的开头（记过别的刊名的不动）
            const savedName = sh.meta.papers?.[p.key]?.name
            const head = savedName && savedName !== p.lead.title ? '' : commonHead([p.lead.title, ...g.items.map((x) => x.title)])
            if (head) name = head
            const c = sh.meta.feeds?.[p.lead.id]?.column || shortColumn(p.lead.title, name)
            cols.set(p.lead.id, c && c !== name ? c : '综合')
          }
          for (const x of g.items) { const c = String(x.s.column ?? '').trim() || shortColumn(x.title, name); cols.set(x.id, c && c !== name ? c : x.title) }
          const all = [...p.feeds, ...g.items.map((x) => ({ id: x.id, title: x.title }))]
          for (const f of all) { const t = feedTitle(name, cols.get(f.id), false); if (f.title !== t) await putFeed(key, f.id, { title: t }).catch(() => {}) }
          const merged = { ...p, name, feeds: all, columns: cols }
          writes.push((m) => remember(m, merged))
          for (const x of g.items) titles.push([x, `《${name}》栏目「${cols.get(x.id)}」`])
          if (name !== p.name) g.notes.push(`这本刊变成多栏，刊名改成「${name}」`)
        } else {
          const single = g.items.length === 1
          const recorded = !single || g.name || g.alias || g.items.some((x) => x.s.column)
          const name = g.name || (single ? g.items[0].title : commonHead(g.items.map((x) => x.title)) || shortTitle(g.items[0].title))
          const cols = new Map()
          for (const x of g.items) {
            let c = String(x.s.column ?? '').trim()
            if (!c && !single) { c = shortColumn(x.title, name); if (!c || c === name) c = columnTail(x.url, sh.pctx) || x.title }
            cols.set(x.id, c)
          }
          for (const x of g.items) { const t = feedTitle(name, cols.get(x.id), single); if (x.title !== t) await putFeed(key, x.id, { title: t }).catch(() => {}) }
          if (recorded) {
            const pk = g.key ?? 'u:' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
            const site = g.key && !g.key.startsWith('d:') ? g.key : undefined
            const domain = g.key?.startsWith('d:') ? g.key.slice(2) : undefined
            writes.push((m) => {
              const next = { ...m, feeds: { ...m.feeds }, papers: { ...m.papers } }
              for (const x of g.items) next.feeds[x.id] = { ...next.feeds[x.id], paper: pk, column: cols.get(x.id) || undefined, ...(single && g.alias ? { latin: g.alias } : {}) }
              next.papers[pk] = { ...next.papers[pk], name, latin: g.alias || undefined, site, domain }
              return next
            })
          }
          for (const x of g.items) titles.push([x, single ? `《${name}》${g.alias ? `（别名 ${g.alias}）` : ''}` : `《${name}》栏目「${cols.get(x.id)}」`])
        }
        for (const [x, label] of titles) {
          const s = x.s
          results.push(`- ✓ #${x.id} ${label} → ${catTitle(sh, g.cat)}${[s.crawler && '抓取全文', s.translate_title && '翻译标题', s.proxy && '绕道', s.hide_from_stream && '不进信息流'].filter(Boolean).map((t) => '、' + t).join('')}`)
        }
        for (const n of [...new Set(g.notes)]) results.push(`  （${n}）`)
      }
      const added = [...groups.values()].flatMap((g) => g.items)
      if (added.length) {
        await updateMeta(key, (m) => {
          let next = writes.reduce((acc, w) => w(acc), m)
          for (const x of added) {
            next = withNote(next, x.id, 'AI 助手：添加')
            next.feeds[x.id] = { ...next.feeds[x.id], added: now, ...(x.s.translate_title ? { trTitle: true } : {}) }
          }
          return next
        }).catch((e) => results.push(`（订上了，刊名、栏目、翻译标题没写进灵媒设置：${e.message}）`))
      }
      return results.join('\n') + '\n\n用户刷新一下灵媒就能看到。'
    },
  },
  {
    name: 'update_source', scope: 'manage',
    description: '修改一个已订的源（会改用户的订阅：先和用户确认）。每个源都能改：抓取全文、绕道、不进信息流、暂停、翻译标题，或换订阅地址（比如换 RSSHub 实例、换成 hub:/路由）。多栏报刊里的一栏还能改栏目名（column），但不能改类别、刊名、别名——这三样属于整本报刊，用 update_paper。只有一栏的报刊，这里也能改类别、刊名（title）、别名。改动会记进源医生的病历。',
    inputSchema: {
      type: 'object',
      properties: {
        feed_id: { type: 'number' }, url: { type: 'string', description: '新的订阅地址' },
        column: { type: 'string', description: '栏目名（多栏报刊里的一栏）' },
        category: { type: 'string', description: '只有一栏的报刊才能改' }, title: { type: 'string', description: '刊名，只有一栏的报刊才能改' }, alias: { type: 'string', description: '别名，只有一栏的报刊才能改' },
        crawler: { type: 'boolean' }, proxy: { type: 'boolean' }, hide_from_stream: { type: 'boolean' }, paused: { type: 'boolean' }, translate_title: { type: 'boolean' },
      },
      required: ['feed_id'],
    },
    run: async (ctx, a) => {
      const { key } = ctx
      const id = intArg(a.feed_id, 'feed_id')
      const sh = await shelf(key)
      const feed = sh.feeds.find((f) => f.id === id)
      if (!feed) throw new UserError(`没有 #${id} 这个源`)
      const p = paperByFeed(sh.papers, id)
      const multi = p.feeds.length > 1
      const paperLevel = (a.category !== undefined && a.category !== '') || !!a.title || (a.alias !== undefined && a.alias !== null)
      if (multi && paperLevel) {
        throw new UserError(`#${id} 是《${p.name}》的一个栏目（这本刊共 ${p.feeds.length} 栏）。类别、刊名、别名属于整本报刊，栏目不能单独改；要改请用 update_paper（feed_id 填这本刊里任意一栏），整本一起改，先和用户确认。栏目自己能改的是栏目名（column）和抓取全文、绕道、不进信息流、暂停、翻译标题。`)
      }
      if (!multi && a.column) throw new UserError(`《${p.name}》只有这一栏，没有栏目名可改；要改名用 title（刊名）。`)
      const did = []
      if (paperLevel) did.push(...await editPaper(key, sh, p, { category: a.category, name: a.title, alias: a.alias }, false))
      const change = {}
      let column = null
      if (multi && a.column) { column = String(a.column).trim(); if (column && column !== p.columns.get(id)) { change.title = feedTitle(p.name, column, false); did.push(`栏目名改成「${column}」`) } else column = null }
      if (a.url) { const u = String(a.url).trim(); change.feed_url = u.startsWith('hub:/') ? ctx.wrapHub(hubInner(u)) : u; did.push(`地址换成 ${u}`) }
      if (a.crawler !== undefined) { change.crawler = !!a.crawler; did.push(`抓取全文${a.crawler ? '开' : '关'}`) }
      if (a.proxy !== undefined) { change.fetch_via_proxy = !!a.proxy; did.push(`绕道${a.proxy ? '开' : '关'}`) }
      if (a.hide_from_stream !== undefined) { change.hide_globally = !!a.hide_from_stream; did.push(a.hide_from_stream ? '不进信息流' : '回到信息流') }
      if (a.paused !== undefined) { change.disabled = !!a.paused; did.push(a.paused ? '暂停更新' : '恢复更新') }
      if (Object.keys(change).length) await putFeed(key, id, change)
      if (a.translate_title !== undefined) did.push(`翻译标题${a.translate_title ? '开' : '关'}`)
      if (!did.length) return '没给要改的东西（或者和现在一样）。'
      await updateMeta(key, (m) => {
        let next = column ? remember(m, p) : m
        if (column) next.feeds[id] = { ...next.feeds[id], column }
        next = withNote(next, id, `AI 助手：${did.join('，')}`)
        if (a.translate_title !== undefined) next = { ...next, feeds: { ...next.feeds, [id]: { ...next.feeds[id], trTitle: a.translate_title ? true : undefined } } }
        return next
      }).catch(() => {})
      const label = multi ? `《${p.name}》栏目「${column ?? p.columns.get(id)}」` : `《${p.name}》`
      return `#${id} ${label}：${did.join('，')}。${change.feed_url || change.crawler !== undefined || change.fetch_via_proxy !== undefined ? '可以用 refresh_source 马上重抓一次看看。' : ''}`
    },
  },
  {
    name: 'update_paper', scope: 'manage',
    description: '改一本报刊的类别、刊名、别名（会改用户的订阅：先和用户确认）。feed_id 填这本报刊里任意一个源的 id（list_subscriptions 里看得到）。多栏的整本一起改：换类别是所有栏目一起搬，改刊名时各栏的源名跟着改成「刊名 · 栏目」。别名适合写外文刊的中文名，或中文刊的外文名；传空字符串清掉。',
    inputSchema: {
      type: 'object',
      properties: { feed_id: { type: 'number' }, category: { type: 'string' }, name: { type: 'string', description: '刊名' }, alias: { type: 'string', description: '别名，空字符串清掉' } },
      required: ['feed_id'],
    },
    run: async ({ key }, a) => {
      const id = intArg(a.feed_id, 'feed_id')
      const sh = await shelf(key)
      const p = paperByFeed(sh.papers, id)
      if (!p) throw new UserError(`没有 #${id} 这个源`)
      const did = await editPaper(key, sh, p, { category: a.category, name: a.name, alias: a.alias })
      if (!did.length) return `《${p.name}》没有要改的（或者和现在一样）。`
      return `《${p.name}》${p.feeds.length > 1 ? `（${p.feeds.length} 栏）` : ''}：${did.join('，')}。`
    },
  },
  {
    name: 'unsubscribe', scope: 'manage',
    description: '退订一个源（多栏报刊里的一栏，或只有一栏的报刊）。注意：Miniflux 退订会把这个源的文章（包括收藏）一起删掉，不能恢复。不带 confirm 只试算（告诉你有多少篇、几篇收藏）；用户明确同意后再带 confirm: true 调用。想保留文章可以改用 update_source 暂停更新或不进信息流。',
    inputSchema: { type: 'object', properties: { feed_id: { type: 'number' }, confirm: { type: 'boolean' } }, required: ['feed_id'] },
    run: async ({ key }, a) => {
      const id = intArg(a.feed_id, 'feed_id')
      const sh = await shelf(key)
      const feed = sh.feeds.find((f) => f.id === id)
      if (!feed) throw new UserError(`没有 #${id} 这个源`)
      const p = paperByFeed(sh.papers, id)
      const multi = p.feeds.length > 1
      const label = multi ? `《${p.name}》的栏目「${p.columns.get(id)}」（退订后这本刊还剩 ${p.feeds.length - 1} 栏）` : `《${p.name}》（${catTitle(sh, p.category)}）`
      const any = 'status=unread&status=read'
      const [all, starred] = await Promise.all([
        mf(key, `/feeds/${id}/entries?limit=1&${any}`).then((r) => r?.total ?? 0),
        mf(key, `/feeds/${id}/entries?limit=50&starred=true&${any}`),
      ])
      const stars = starred?.entries ?? []
      if (!a.confirm) {
        return [`试算：退订 #${id} ${label}会删掉 ${all} 篇文章，其中收藏 ${starred?.total ?? 0} 篇。`,
          ...stars.slice(0, 10).map((e) => `  ★ ${e.title}`),
          '还没退。用户确认后带 confirm: true 再调用；想留着文章可以改成暂停更新。'].join('\n')
      }
      await mf(key, `/feeds/${id}`, { method: 'DELETE' })
      // 收尾同网页端 web/src/lib/paperOps.ts 的 unsubscribeColumn、unsubscribePaper
      const rest = p.feeds.filter((f) => f.id !== id)
      if (multi && rest.length === 1) await putFeed(key, rest[0].id, { title: p.name }).catch(() => {})   // 只剩一栏：源名回到刊名
      await updateMeta(key, (m) => {
        if (multi) { const next = remember(m, p, rest); delete next.feeds[id]; return next }
        const feeds = { ...m.feeds }; delete feeds[id]
        const papers = { ...m.papers }; if (feeds && !Object.values(feeds).some((v) => v?.paper === p.key)) delete papers[p.key]
        return { ...m, feeds, papers }
      }).catch(() => {})
      return `已退订 #${id} ${label}，删掉了 ${all} 篇（含收藏 ${starred?.total ?? 0} 篇）。`
    },
  },
]

// 服务器的名字和图标（图标：停着的寒鸦，2026-10-27 Hana 选；浅色背景用深色鸦，深色背景用浅色鸦）。
// 图标放在灵媒网站的 /icons/ 下（web/public/icons/mcp-crow-*）；按 MCP 规范，客户端都认 PNG，SVG 认不认看客户端
function serverInfo(origin) {
  const info = { name: 'mediarium', title: '灵媒', version: VERSION }
  if (!origin) return info
  const icon = (theme, ext, mimeType, sizes) => ({ src: `${origin}/icons/mcp-crow-${theme}.${ext}`, mimeType, sizes, theme })
  return {
    ...info, websiteUrl: origin,
    icons: [icon('light', 'png', 'image/png', ['192x192']), icon('dark', 'png', 'image/png', ['192x192']), icon('light', 'svg', 'image/svg+xml', ['any']), icon('dark', 'svg', 'image/svg+xml', ['any'])],
  }
}

// ——— JSON-RPC ———
const ok = (id, result) => ({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

export function toolsFor(scope) {
  return TOOLS.filter((t) => scope === 'manage' || t.scope === 'read').map((t) => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.scope === 'read' && t.name !== 'refresh_source', destructiveHint: t.name === 'unsubscribe', openWorldHint: ['find_sources', 'check_source', 'refresh_source'].includes(t.name) },
  }))
}

// ctx：{ key, uid, scope, origin, signKey, log }
async function one(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid Request')
  const { id, method, params = {} } = msg
  const isNote = id === undefined || id === null
  if (method.startsWith('notifications/')) return null
  if (isNote) return null
  if (method === 'initialize') {
    const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0]
    return ok(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: serverInfo(ctx.origin), instructions: INSTRUCTIONS })
  }
  if (method === 'ping') return ok(id, {})
  if (method === 'tools/list') return ok(id, { tools: toolsFor(ctx.scope) })
  if (method === 'tools/call') {
    const t = TOOLS.find((x) => x.name === params.name)
    if (!t || (t.scope === 'manage' && ctx.scope !== 'manage')) {
      return ok(id, { content: [{ type: 'text', text: t ? '这条链接是只读的，不能改订阅。要改的话，请用户在灵媒「设置 › 接入 AI 助手」里开一条「可管理订阅」的链接。' : `没有这个工具：${params.name}` }], isError: true })
    }
    try {
      const text = await t.run(ctx, params.arguments ?? {})
      return ok(id, { content: [{ type: 'text', text }] })
    } catch (e) {
      const why = e instanceof UserError ? e.message : e instanceof MfError ? (e.status === 401 ? '这条链接的密钥已经作废了（可能在「登录过的设备」里删掉了），请重新生成链接' : `Miniflux：${e.message}`) : '出错了：' + (e?.message ?? e)
      ctx.log?.('mcp tool', t.name, e?.message)
      return ok(id, { content: [{ type: 'text', text: why }], isError: true })
    }
  }
  return fail(id, -32601, `Method not found: ${method}`)
}

// 处理一个 POST 体：单条或一批。返回 { status, body }（body 为 null 时回 202）
export async function handleRpc(body, ctx) {
  ctx.wrapHub = (inner) => `${ctx.origin}/scribe/feed?url=${encodeURIComponent(inner)}&s=${signFeed(ctx.signKey, inner)}`
  if (!ctx.signKey) ctx.wrapHub = () => { throw new UserError('服务器没配签名密钥，订不了灵媒自建的源') }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => one(m, ctx)))).filter(Boolean)
    return { status: out.length ? 200 : 202, body: out.length ? out : null }
  }
  const r = await one(body, ctx)
  return { status: r ? 200 : 202, body: r }
}

export const _tools = TOOLS   // 测试用

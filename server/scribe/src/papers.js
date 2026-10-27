// 报刊与栏目：服务器这边的一份（MCP 用，2026-10-27 Hana 定）。规则照网页端，改的时候两边一起改：
//   web/src/lib/papers.ts（归刊、刊名、栏目名）、web/src/lib/catalog.ts（paperOf、siteOfRoute）、
//   web/src/lib/doctor.ts（rsshubRoute、original）、web/src/lib/subscribe.ts（shortColumn、feedTitle）。
// 灵媒的组织：报刊（RSSHub 的站点，或单独订的源）→ 栏目。
//   · 类别、刊名、别名只属于报刊；栏目跟着报刊，不能单独改。除非把栏目拆出去单独成刊（在网页端做）
//   · 抓取全文、暂停更新、不进信息流、翻译标题每个源都能单独设
// 归刊规则：
//   1. 灵媒设置里记过的（feeds[id].paper）以它为准；
//   2. RSSHub 的源按路由第一段（站点）归，官方 RSS 按网站域名归；
//   3. 例外：公众号、平台类（B 站、微博、YouTube、播客平台……）一个账号一本，不自动并；
//   4. 不跨类别自动并（记过的报刊不管各栏在哪个类别，都是一本，放在第一栏的类别里）。

export const RSSHUB_PUBLIC = [
  'https://rsshub.rssforever.com', 'https://hub.slarker.me', 'https://rsshub.pseudoyu.com', 'https://rsshub.rss.tips',
  'https://rsshub.ktachibana.party', 'https://rss.owo.nz', 'https://rsshub.henry.wang', 'https://rsshub.cups.moe',
]

const PLATFORM_NS = new Set(['bilibili', 'weibo', 'github', 'youtube', 'twitter', 'x', 'instagram', 'telegram', 'xiaohongshu', 'douyin', 'zhihu', 'douban', 'pixiv', 'mastodon', 'jike', 'wechat', 'wechat2rss', 'substack', 'medium', 'tiktok', 'threads', 'bsky', 'v2ex',
  'xiaoyuzhou', 'ximalaya', 'lizhi', 'qingting', 'apple', 'spotify'])
const PLATFORM_HOST = /(^|\.)(mp\.weixin\.qq\.com|weixin\.qq\.com|bilibili\.com|weibo\.com|weibo\.cn|github\.com|youtube\.com|twitter\.com|x\.com|medium\.com|zhihu\.com|douban\.com|xiaohongshu\.com|substack\.com|feedburner\.com|xiaoyuzhoufm\.com|xyzfm\.space|ximalaya\.com|lizhi\.fm|qingting\.fm|podcasts\.apple\.com|spotify\.com|anchor\.fm|wechat2rss\.[\w.]+|feeds\.[\w.]+)$/i
export const isPlatformSite = (id) => PLATFORM_NS.has(id)
export const isPlatformHost = (h) => !h || PLATFORM_HOST.test(h)

// 经誊写服务的订阅地址（…/scribe/feed?url=原地址&s=…）→ 原地址
export function original(url) {
  const m = /\/scribe\/feed\?(.*)$/.exec(String(url ?? ''))
  if (!m) return url
  return new URLSearchParams(m[1]).get('url') ?? url
}
const host = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^(www|m)\./, '') } catch { return '' } }

// ctx：{ hub: 灵媒自建 RSSHub 的地址, nested: 带斜杠的站点 id（gov/xxx） }
export function rsshubRoute(url, ctx = {}) {
  try {
    const o = original(url)
    const u = new URL(o)
    const signed = o !== url && /[?&]s=/.test(url)
    const hubOrigin = ctx.hub ? new URL(ctx.hub).origin : ''
    if (!signed && !(/rsshub/i.test(u.origin) || RSSHUB_PUBLIC.includes(u.origin) || (hubOrigin && u.origin === hubOrigin))) return null
    return u.pathname + u.search
  } catch { return null }
}
export function siteOfRoute(path, ctx = {}) {
  const segs = String(path).split('?')[0].split('/').filter(Boolean)
  const hit = (ctx.nested ?? []).filter((id) => segs.slice(0, id.split('/').length).join('/') === id && segs.length > id.split('/').length).sort((a, b) => b.length - a.length)[0]
  return hit ?? segs[0] ?? ''
}
export function paperOf(m, f, ctx) {
  const saved = m.feeds?.[f.id]?.paper
  if (saved) return saved
  const route = rsshubRoute(f.feed_url, ctx)
  if (route) return siteOfRoute(route, ctx)
  return 'd:' + (host(f.site_url) || host(original(f.feed_url)))
}
export function autoKey(m, f, ctx) {
  const saved = m.feeds?.[f.id]?.paper
  if (saved) return PLATFORM_NS.has(saved) ? 'f:' + f.id : saved
  const k = paperOf(m, f, ctx)
  const route = rsshubRoute(f.feed_url, ctx)
  if (route ? PLATFORM_NS.has(k) : PLATFORM_HOST.test(k.slice(2)) || k === 'd:') return 'f:' + f.id
  return k
}

const SEP = /[\s\-—–·:：|｜_/]+$/
const LAST_WORD = /[\s\-—–·:：|｜_/][^\s\-—–·:：|｜_/]*$/
export function commonHead(titles) {
  if (titles.length < 2) return ''
  let p = titles[0]
  for (const t of titles.slice(1)) { let i = 0; while (i < p.length && i < t.length && p[i] === t[i]) i++; p = p.slice(0, i) }
  if (titles.some((t) => t === p)) return p.trim()
  if (SEP.test(p)) return p.replace(SEP, '').trim()
  if (/^[㐀-鿿]{2,}$/.test(p)) return p
  const cut = p.search(LAST_WORD)
  return cut > 0 ? p.slice(0, cut).trim() : ''
}
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
const byName = (a, b) => collator.compare(a, b)
export const shortTitle = (title) => title.split(/\s+[-–—|·]\s+|\s*[|｜]\s*/)[0].replace(/^《(.+)》$/, '$1') || title

// 栏目名：去掉打头的刊名（「澎湃新闻 - 思想市场」→「思想市场」）
export function shortColumn(title, paper) {
  const t = String(title).trim()
  for (const p of [String(paper).trim(), String(paper).trim().replace(/(新闻|网|官网)$/, '')]) {
    if (p && t.startsWith(p) && t.length > p.length + 1) { const rest = t.slice(p.length).replace(/^[\s\-—–·:：|｜_]+/, ''); if (rest) return rest }
  }
  return t
}
// Miniflux 里的源名：「刊名 · 栏目」，只有一栏的就写刊名
export const feedTitle = (paper, column, single) => (single || !column?.trim() ? paper.trim() : `${paper.trim()} · ${column.trim()}`)

function columnsOf(m, feeds, name, ctx) {
  const out = new Map()
  if (feeds.length < 2) return out
  const head = commonHead(feeds.map((f) => f.title))
  for (const f of feeds) {
    const saved = m.feeds?.[f.id]?.column?.trim()
    if (saved) { out.set(f.id, saved); continue }
    let t = f.title.trim()
    for (const p of [head, name]) if (p && t.startsWith(p) && t.length > p.length) { t = t.slice(p.length).replace(/^[\s\-—–·:：|｜_/]+/, ''); break }
    out.set(f.id, t || '综合')
  }
  const seen = new Map()
  for (const v of out.values()) seen.set(v, (seen.get(v) ?? 0) + 1)
  for (const f of feeds) {
    const v = out.get(f.id)
    if ((seen.get(v) ?? 0) > 1) { const tail = rsshubRoute(f.feed_url, ctx)?.split('?')[0].split('/').filter(Boolean).at(-1); if (tail) out.set(f.id, `${v} · ${decodeURIComponent(tail)}`) }
  }
  return out
}

function accountName(m, f) {
  const site = m.feeds?.[f.id]?.paper
  const head = site && PLATFORM_NS.has(site) ? m.papers?.[site]?.name?.trim() : ''
  if (!head || !f.title.startsWith(head) || f.title.length <= head.length) return f.title
  const rest = f.title.slice(head.length)
  return /^[\s\-—–·:：|｜_/]/.test(rest) ? rest.replace(/^[\s\-—–·:：|｜_/]+/, '').trim() || f.title : f.title
}

// feeds：Miniflux /feeds 的原样（顺序不动）；返回 [{ key, category, feeds, lead, name, alias, columns, site }]
export function buildPapers(feeds, cats, m, ctx = {}) {
  const home = new Map()
  for (const f of feeds) { const k = m.feeds?.[f.id]?.paper; if (k && !home.has(k)) home.set(k, f.category?.id) }
  const groups = new Map()
  for (const f of feeds) {
    const k = autoKey(m, f, ctx)
    const g = m.feeds?.[f.id]?.paper || home.get(k) === f.category?.id ? 'p|' + k : `c${f.category?.id}|` + k
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  const out = []
  for (const [g, list] of groups) {
    const key = g.slice(g.indexOf('|') + 1)
    const lead = list[0]
    const saved = m.papers?.[key]
    const single = list.length === 1
    const name = single ? accountName(m, lead) : saved?.name || commonHead(list.map((f) => f.title)) || shortTitle(lead.title)
    const feedLatin = m.feeds?.[lead.id]?.latin ?? ''
    const alias = (single ? feedLatin : '') || saved?.latin || feedLatin
    const site = saved?.site ?? (key.startsWith('d:') || key.startsWith('f:') || key.startsWith('u:') ? undefined : key)
    const columns = columnsOf(m, list, name, ctx)
    const sorted = single ? list : [...list].sort((a, b) => byName(columns.get(a.id) ?? '', columns.get(b.id) ?? ''))
    out.push({ key, category: lead.category, feeds: sorted, lead, name, alias, columns, site })
  }
  const order = new Map(cats.map((c, i) => [c.id, i]))
  const u = uncategorizedId(m, cats)
  const rank = (p) => (p.category?.id === u ? 1e6 : order.get(p.category?.id) ?? 1e5)
  return out.sort((a, b) => rank(a) - rank(b) || byName(a.name, b.name))
}
export const paperByFeed = (papers, id) => papers.find((p) => p.feeds.some((f) => f.id === id))

export function uncategorizedId(m, cats) {
  if (m.uncategorized && cats.some((c) => c.id === m.uncategorized)) return m.uncategorized
  const c = cats.find((x) => x.title.toLowerCase() === 'all') ?? cats.find((x) => x.title === '无类别')
  return c?.id ?? null
}
export const categoryName = (m, cats, c) => (c && c.id === uncategorizedId(m, cats) ? '无类别' : c?.title ?? '')

// 把一份报刊（连同它现在的样子）记进灵媒设置（同 web/src/lib/paperOps.ts 的 remember）
export function remember(m, p, feeds = p.feeds) {
  const out = { ...m, feeds: { ...m.feeds }, papers: { ...m.papers } }
  for (const f of feeds) out.feeds[f.id] = { ...out.feeds[f.id], paper: p.key, column: p.columns.get(f.id) || out.feeds[f.id]?.column }
  out.papers[p.key] = { ...out.papers[p.key], name: p.name, latin: p.alias || undefined, site: out.papers[p.key]?.site ?? p.site }
  return out
}

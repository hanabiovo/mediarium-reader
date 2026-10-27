// 报刊与栏目（阶段 6 第 3 步，2026-10-24）：报刊架上一份报刊一张封面，杂志目录把各栏目的文章混排。
// 归档规则（计划与说明/阶段6 报刊与RSSHub.md「自动归档」）：
//   1. 灵媒设置里记过的（添加信源时存的 papers / feeds.paper）以它为准；
//   2. RSSHub 的源按路由第一段（命名空间）归，官方 RSS 按网站域名归（catalog.paperOf）；
//   3. 例外：公众号、平台类（B 站、微博、GitHub、播客平台……）一个账号一本，不自动并；
//      从站点页订的，归属记成了平台站点（youtube、xiaoyuzhou）也照样一个账号一本（0.29.10）；
//   4. 不跨分类自动并：Hana 手动分过类的，一律尊重。
// 只有一栏的报刊和原来一模一样：名字就是源名，不显示栏目这一层。
// 这里只是「怎么看」，不碰 Miniflux 的订阅；拆报刊、合报刊在报刊管理页（第 4 步）
import { useMemo } from 'react'
import type { Category, Feed, ShelfData } from '../api/miniflux'
import { feedLatin, orderedCategories, useMeta, type Meta } from '../api/meta'
import { useShelf } from '../hooks/useShelf'
import { paperOf } from './catalog'
import { rsshubRoute } from './doctor'

export type Paper = {
  key: string            // 报刊的键（站点 id / d:域名 / f:源 id）
  category: Category
  feeds: Feed[]          // 按 Miniflux 的顺序
  lead: Feed             // 第一栏：封面、编号、网址都用它
  name: string
  latin: string
  columns: Map<number, string>   // 源 id → 栏目短名（只有一栏时为空）
  site?: string          // 目录里的站点 id（能进站点页加栏目）
}

// 平台类：一个账号一本，不按站点 / 域名自动并
const PLATFORM_NS = new Set(['bilibili', 'weibo', 'github', 'youtube', 'twitter', 'x', 'instagram', 'telegram', 'xiaohongshu', 'douyin', 'zhihu', 'douban', 'pixiv', 'mastodon', 'jike', 'wechat', 'wechat2rss', 'substack', 'medium', 'tiktok', 'threads', 'bsky', 'v2ex',
  // 播客平台（0.29.10）：一档节目一本
  'xiaoyuzhou', 'ximalaya', 'lizhi', 'qingting', 'apple', 'spotify'])
const PLATFORM_HOST = /(^|\.)(mp\.weixin\.qq\.com|weixin\.qq\.com|bilibili\.com|weibo\.com|weibo\.cn|github\.com|youtube\.com|twitter\.com|x\.com|medium\.com|zhihu\.com|douban\.com|xiaohongshu\.com|substack\.com|feedburner\.com|xiaoyuzhoufm\.com|xyzfm\.space|ximalaya\.com|lizhi\.fm|qingting\.fm|podcasts\.apple\.com|spotify\.com|anchor\.fm|wechat2rss\.[\w.]+|feeds\.[\w.]+)$/i

export const isPlatformHost = (host: string) => !host || PLATFORM_HOST.test(host)
export function autoKey(m: Meta, f: Feed): string {
  const saved = m.feeds[f.id]?.paper
  if (saved) return PLATFORM_NS.has(saved) ? 'f:' + f.id : saved   // 记成平台站点的：一个账号一本
  const k = paperOf(m, f)
  const route = rsshubRoute(f.feed_url)
  if (route ? PLATFORM_NS.has(k) : PLATFORM_HOST.test(k.slice(2)) || k === 'd:') return 'f:' + f.id
  return k
}

// 几个标题共有的开头，只在分隔符处切（「联合早报 - 中国」「联合早报 - 国际」→「联合早报」）
const SEP = /[\s\-—–·:：|｜_/]+$/
const LAST_WORD = /[\s\-—–·:：|｜_/][^\s\-—–·:：|｜_/]*$/
export function commonHead(titles: string[]): string {
  if (titles.length < 2) return ''
  let p = titles[0]
  for (const t of titles.slice(1)) { let i = 0; while (i < p.length && i < t.length && p[i] === t[i]) i++; p = p.slice(0, i) }
  if (titles.some((t) => t === p)) return p.trim()                          // 有一栏的名字就是这段：它就是刊名
  if (SEP.test(p)) return p.replace(SEP, '').trim()                          // 正好停在分隔符上
  if (/^[\u3400-\u9fff]{2,}$/.test(p)) return p                              // 中文刊名后面直接接栏目名（「联合早报中国」）
  const cut = p.search(LAST_WORD)                                           // 停在一个词中间：退回上一个分隔符
  return cut > 0 ? p.slice(0, cut).trim() : ''
}
const collator = new Intl.Collator('zh-Hans-CN', { numeric: true, sensitivity: 'base' })
export const byName = (a: string, b: string) => collator.compare(a, b)
// 书脊上的刊名：长名只取第一段
export const shortTitle = (title: string) => title.split(/\s+[-–—|·]\s+|\s*[|｜]\s*/)[0].replace(/^《(.+)》$/, '$1') || title

function columnsOf(m: Meta, feeds: Feed[], name: string): Map<number, string> {
  const out = new Map<number, string>()
  if (feeds.length < 2) return out
  const head = commonHead(feeds.map((f) => f.title))
  for (const f of feeds) {
    const saved = m.feeds[f.id]?.column?.trim()
    if (saved) { out.set(f.id, saved); continue }
    let t = f.title.trim()
    for (const p of [head, name]) if (p && t.startsWith(p) && t.length > p.length) { t = t.slice(p.length).replace(/^[\s\-—–·:：|｜_/]+/, ''); break }
    out.set(f.id, t || '综合')   // 名字就是刊名的那一栏
  }
  // 撞名的（RSSHub 常给几栏起同一个名字）：后面补上路由最后一段
  const seen = new Map<string, number>()
  for (const v of out.values()) seen.set(v, (seen.get(v) ?? 0) + 1)
  for (const f of feeds) {
    const v = out.get(f.id)!
    if ((seen.get(v) ?? 0) > 1) { const tail = rsshubRoute(f.feed_url)?.split('?')[0].split('/').filter(Boolean).at(-1); if (tail) out.set(f.id, `${v} · ${decodeURIComponent(tail)}`) }
  }
  return out
}

// 类别只属于报刊（2026-10-24 Hana）：记过的报刊不管各栏在 Miniflux 里分在哪，都是一本，放在第一栏的类别里；
// 没记过的（自动认出来的）才按类别分开，免得替你把原来分好的源搬家
export function buildPapers(data: ShelfData, m: Meta): Paper[] {
  // 记过的报刊在哪个类别（第一栏的）：同站、没记过、又正好在这个类别里的源，也并进这一本
  const home = new Map<string, number>()
  for (const f of data.feeds) { const k = m.feeds[f.id]?.paper; if (k && !home.has(k)) home.set(k, f.category.id) }
  const groups = new Map<string, Feed[]>()
  for (const f of data.feeds) {
    const k = autoKey(m, f)
    const g = m.feeds[f.id]?.paper || home.get(k) === f.category.id ? 'p|' + k : `c${f.category.id}|` + k
    groups.set(g, [...(groups.get(g) ?? []), f])
  }
  const byCat = new Map<number, Paper[]>()
  for (const [g, feeds] of groups) {
    const key = g.slice(g.indexOf('|') + 1)
    const lead = feeds[0]
    const saved = m.papers?.[key]
    const single = feeds.length === 1
    const name = single ? accountName(m, lead) : saved?.name || commonHead(feeds.map((f) => f.title)) || shortTitle(lead.title)
    const latin = (single ? feedLatin(m, lead.id) : '') || saved?.latin || feedLatin(m, lead.id)
    const site = saved?.site ?? (key.startsWith('d:') || key.startsWith('f:') ? undefined : key)
    const columns = columnsOf(m, feeds, name)
    // 栏目按名字排（2026-10-24 Hana）；第一栏（定类别、封面编号用的 lead）仍取 Miniflux 里最早的那个，不随改名变
    const sorted = single ? feeds : [...feeds].sort((a, b) => byName(columns.get(a.id) ?? '', columns.get(b.id) ?? ''))
    const p: Paper = { key, category: lead.category, feeds: sorted, lead, name, latin, columns, site }
    byCat.set(lead.category.id, [...(byCat.get(lead.category.id) ?? []), p])
  }
  // 报刊在分类里按刊名排；分类照原来的顺序（无类别最后）
  return orderedCategories(m, data.categories).flatMap((c) => (byCat.get(c.id) ?? []).sort((a, b) => byName(a.name, b.name)).map((p) => ({ ...p, category: c })))
}

// 平台上的一个账号单独成本时的名字：去掉前面的平台名（「小宇宙 · 别的电波」→「别的电波」）
function accountName(m: Meta, f: Feed): string {
  const site = m.feeds[f.id]?.paper
  const head = site && PLATFORM_NS.has(site) ? m.papers?.[site]?.name?.trim() : ''
  if (!head || !f.title.startsWith(head) || f.title.length <= head.length) return f.title
  const rest = f.title.slice(head.length)
  return /^[\s\-—–·:：|｜_/]/.test(rest) ? rest.replace(/^[\s\-—–·:：|｜_/]+/, '').trim() || f.title : f.title
}

export type PaperIndex = { papers: Paper[]; byFeed: Map<number, Paper> }
export function indexPapers(data: ShelfData | null, m: Meta): PaperIndex {
  const papers = data ? buildPapers(data, m) : []
  const byFeed = new Map<number, Paper>()
  for (const p of papers) for (const f of p.feeds) byFeed.set(f.id, p)
  return { papers, byFeed }
}
export function usePapers(): PaperIndex & { data: ShelfData | null } {
  const { data } = useShelf()
  const meta = useMeta()
  const idx = useMemo(() => indexPapers(data, meta), [data, meta])
  return { ...idx, data }
}

// 一篇文章的出处：多栏报刊写「报刊 · 栏目」，一栏的照旧写源名
export function sourceOf(idx: PaperIndex, feedId: number, fallback = ''): { paper: string; column: string; label: string } {
  const p = idx.byFeed.get(feedId)
  if (!p) return { paper: fallback, column: '', label: fallback }
  const column = p.columns.get(feedId) ?? ''
  if (!column) { const t = p.feeds.length === 1 ? p.name : p.feeds.find((f) => f.id === feedId)?.title ?? fallback; return { paper: t, column: '', label: t } }
  return { paper: p.name, column, label: `${p.name} · ${column}` }
}
// 报刊在本分类里的编号（封面上的 NO.）：按报刊数，不按源数
export const paperNumber = (idx: PaperIndex, p: Paper) => idx.papers.filter((x) => x.category.id === p.category.id).indexOf(p) + 1

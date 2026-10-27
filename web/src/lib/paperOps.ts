// 报刊管理（阶段 6 第 4 步，2026-10-24 Hana 定）：报刊是从信源长出来的，不能新建空白报刊；用户只做纠错。
//   · 改刊名 / 别名、换类别（整份报刊一起搬）、改栏目名
//   · 拆开：一栏单独成一本（记住，不再被自动并回去）
//   · 并入：两边都是 RSSHub 目录里认得、又不是同一家的站点，不让并（澎湃并南方周末）；其余允许，像是同一家的排前面
//   · 动过的报刊都记进灵媒设置（feeds.paper / papers），以后不再随自动归档变
//   · Miniflux 里的源名跟着写成「刊名 · 栏目」（一栏的就写刊名），和添加信源保存时一样
import { api, loadShelf, type Feed } from '../api/miniflux'
import { currentMeta, updateMeta, type Meta } from '../api/meta'
import { siteOfRoute } from './catalog'
import { rsshubRoute } from './doctor'
import { byName, commonHead, isPlatformHost, type Paper } from './papers'
import { feedTitle, shortColumn } from './subscribe'

const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^(www|m)\./, '') } catch { return '' } }
// 拿来判断「像不像同一家」的网站：平台类（公众号转换站、B 站、微博……）和 RSSHub 实例的地址不算线索——
// 所有公众号都挂在那几个网址上，比了也分不开（2026-10-24 Hana 测出 wechat2rss 全被推荐）
function clueHost(f: Feed): string {
  const h = host(f.site_url)
  if (h && !isPlatformHost(h)) return h
  if (rsshubRoute(f.feed_url)) return ''
  const g = host(f.feed_url)
  return g && !isPlatformHost(g) && g !== h ? g : ''
}
const siteOf = (f: Feed) => { const r = rsshubRoute(f.feed_url); return r ? siteOfRoute(r) : '' }

// 把一份报刊（连同它现在的样子）记进灵媒设置
function remember(m: Meta, p: Paper, feeds = p.feeds): Meta {
  const out = { ...m, feeds: { ...m.feeds }, papers: { ...m.papers } }
  // 栏目名一栏的时候也留着：以后再并回多栏，名字还在
  for (const f of feeds) out.feeds[f.id] = { ...out.feeds[f.id], paper: p.key, column: p.columns.get(f.id) || out.feeds[f.id]?.column }
  out.papers[p.key] = { ...out.papers[p.key], name: p.name, latin: p.latin || undefined, site: out.papers[p.key]?.site ?? p.site }
  return out
}
async function retitle(list: { f: Feed; title: string }[]) {
  for (const { f, title } of list) if (title && f.title !== title) await api.updateFeed(f.id, { title }).catch(() => {})
}

// ——— 改刊名、别名 ———
export async function renamePaper(p: Paper, name: string, latin: string) {
  const n = name.trim() || p.name, l = latin.trim()
  const single = p.feeds.length === 1
  await retitle(p.feeds.map((f) => ({ f, title: feedTitle(n, p.columns.get(f.id), single) })))
  await updateMeta((m) => {
    const next = remember(m, { ...p, name: n, latin: l })
    if (single) next.feeds[p.lead.id] = { ...next.feeds[p.lead.id], latin: l || undefined }   // 一栏的：别名也就是这个源的别名
    return next
  })
  await loadShelf()
}

// ——— 改栏目名 ———
export async function renameColumn(p: Paper, f: Feed, column: string) {
  const c = column.trim()
  if (!c) return
  await retitle([{ f, title: feedTitle(p.name, c, false) }])
  await updateMeta((m) => { const next = remember(m, p); next.feeds[f.id] = { ...next.feeds[f.id], column: c }; return next })
  await loadShelf()
}

// ——— 换类别：整份报刊一起搬 ———
export async function movePaper(p: Paper, cat: number) {
  for (const f of p.feeds) if (f.category.id !== cat) await api.updateFeed(f.id, { category_id: cat })
  await loadShelf()
}

// ——— 拆开：这一栏单独成一本，名字用它在原报刊里的全名（「联合早报 · 国际」） ———
export async function splitColumn(p: Paper, f: Feed) {
  const rest = p.feeds.filter((x) => x.id !== f.id)
  const key = 'f:' + f.id
  const name = feedTitle(p.name, p.columns.get(f.id), false)
  await retitle([{ f, title: name }, ...rest.map((x) => ({ f: x, title: feedTitle(p.name, p.columns.get(x.id), rest.length === 1) }))])
  await updateMeta((m) => {
    const next = remember(m, p, rest)
    next.feeds[f.id] = { ...next.feeds[f.id], paper: key, column: undefined }
    next.papers![key] = { name }
    return next
  })
  await loadShelf()
}

// ——— 并入 ———
// 能不能并：两边都有 RSSHub 目录里的站点，又对不上 → 不能（原因写进控制台，方便排查）
export function canMerge(src: Feed[], target: Paper): boolean {
  const a = new Set(src.map(siteOf).filter(Boolean)), b = new Set(target.feeds.map(siteOf).filter(Boolean))
  if (!a.size || !b.size || [...a].some((x) => b.has(x))) return true
  console.info('[报刊管理] 不能并：', [...a].join(','), '≠', [...b].join(','))
  return false
}
// 像不像同一家：同一个网站，或者网站 / 刊名的打头对得上（zaobao.com 和 zaobao.com.sg）
const norm = (s: string) => s.toLowerCase().replace(/[\s\-—–·:：|｜_/《》「」"'.]+/g, '')
function samePrefix(a: string, b: string): boolean {
  const x = norm(a), y = norm(b)
  let i = 0
  while (i < x.length && i < y.length && x[i] === y[i]) i++
  return /[㐀-鿿]/.test(x.slice(0, i)) ? i >= 2 : i >= 4
}
export function looksSame(src: { feeds: Feed[]; name: string }, target: Paper): string {
  const ha = new Set(src.feeds.map(clueHost).filter(Boolean))
  const hb = target.feeds.map(clueHost).filter(Boolean)
  const same = hb.find((h) => ha.has(h))
  if (same) return `同一个网站 · ${same}`
  const core = (h: string) => h.split('.')[0]
  const near = hb.find((h) => [...ha].some((x) => core(x).length >= 3 && core(x) === core(h)))
  if (near || samePrefix(src.name, target.name)) return `名字相近${near ? ` · ${near}` : ''}`
  return ''
}
// 并入的候选：像的排前面，其余按刊名
export function mergeTargets(src: { feeds: Feed[]; name: string }, papers: Paper[]) {
  const all = papers.filter((p) => !p.feeds.some((f) => src.feeds.includes(f)))   // 不能并进自己所在的那本
  const rows = all.map((p) => ({ paper: p, why: looksSame(src, p), ok: canMerge(src.feeds, p) }))
  return {
    near: rows.filter((r) => r.why).sort((a, b) => byName(a.paper.name, b.paper.name)),
    other: rows.filter((r) => !r.why).sort((a, b) => byName(a.paper.name, b.paper.name)),
  }
}
// 把几栏并进 target：栏目名用原来的（一栏的报刊就从源名里去掉目标刊名得来），类别跟着 target
export async function mergeInto(from: Paper, feeds: Feed[], target: Paper) {
  const m = currentMeta()
  const cols = new Map(target.columns)
  let name = target.name
  if (target.feeds.length === 1) {
    // 一栏的报刊变成多栏：刊名取两边源名共有的开头（「LOW←TECH MAGAZINE English」+「… Español」→「LOW←TECH MAGAZINE」）
    const saved = m.feeds[target.lead.id]?.column
    const head = m.papers?.[target.key]?.name && m.papers[target.key].name !== target.lead.title ? '' : commonHead([target.lead.title, ...feeds.map((f) => f.title)])
    if (head) name = head
    const c = saved || shortColumn(target.lead.title, name)
    cols.set(target.lead.id, c && c !== name ? c : '综合')
  }
  for (const f of feeds) {
    const own = from.feeds.length > 1 ? from.columns.get(f.id) : m.feeds[f.id]?.column
    const c = own || shortColumn(f.title, name)
    cols.set(f.id, c && c !== name ? c : f.title)
  }
  target = { ...target, name }
  const all = [...target.feeds, ...feeds]
  const merged: Paper = { ...target, feeds: all, columns: cols }
  for (const f of feeds) if (f.category.id !== target.category.id) await api.updateFeed(f.id, { category_id: target.category.id })
  await retitle(all.map((f) => ({ f, title: feedTitle(target.name, cols.get(f.id), false) })))
  const rest = from.feeds.filter((f) => !feeds.includes(f))
  await updateMeta((m) => {
    let next = remember(m, merged)
    if (rest.length && from.key !== target.key) next = remember(next, from, rest)
    return next
  })
  await loadShelf()
}

// ——— 退订整本 ———
export async function unsubscribePaper(p: Paper) {
  for (const f of p.feeds) await api.deleteFeed(f.id)
  await updateMeta((m) => {
    const feeds = { ...m.feeds }
    for (const f of p.feeds) delete feeds[f.id]
    const papers = { ...m.papers }
    delete papers[p.key]
    return { ...m, feeds, papers }
  })
  await loadShelf()
}
export async function unsubscribeColumn(p: Paper, f: Feed) {
  await api.deleteFeed(f.id)
  const rest = p.feeds.filter((x) => x.id !== f.id)
  if (rest.length === 1) await retitle([{ f: rest[0], title: p.name }])   // 只剩一栏：源名回到刊名
  await updateMeta((m) => { const next = remember(m, p, rest); delete next.feeds[f.id]; return next })
  await loadShelf()
}

// 添加信源时：网站不同、名字像的已有报刊（只提示，不替你并）
export function nearPaper(hostName: string, title: string, papers: Paper[]): Paper | null {
  const core = isPlatformHost(hostName) ? '' : hostName.split('.')[0]
  return papers.find((p) => p.feeds.some((f) => { const h = clueHost(f); return core.length >= 3 && !!h && h.split('.')[0] === core && h !== hostName }) || (title && samePrefix(title, p.name))) ?? null
}

// 路由目录（阶段 6，2026-10-23）：站点 → 路由 → 参数。数据来自誊写服务转来的 RSSHub 目录（和用哪台实例拉取无关）。
//   · 参数选项三个来源：parameters 里的 options；说明里的 Markdown 表（竖排「ID | 名称」、横排「中国 | 新加坡」两种）；都没有就让人自己填
//   · 路由标记：要浏览器 / 要服务器配置 → 用不了；可选配置 / 反爬 → 可能不稳定；没标 → 不提示
//   · 报刊归属：灵媒设置里记过的 → RSSHub 路由的命名空间 → 网站域名
import { getToken, type Feed } from '../api/miniflux'
import type { Meta } from '../api/meta'
import { original, rsshubRoute } from './doctor'
import { hubConfigured, nestedSites } from './hub'

export type Site = { id: string; name: string; url: string; lang: string; n: number }
export type Option = { label: string; value: string }
export type Features = { requirePuppeteer?: boolean; requireConfig?: false | { name: string; optional?: boolean }[]; antiCrawler?: boolean }
export type Route = {
  path: string; name: string; example: string | null; description: string | null; url: string | null
  parameters: Record<string, string | { description?: string; options?: Option[] }> | null
  features: Features | null
}
export type SiteDetail = { id: string; name: string; url: string; lang: string; description: string | null; routes: Route[] }
export type Match = { site: string; siteName: string; route: string; name: string; path: string | null; needsInput: boolean }

async function get<T>(path: string): Promise<T> {
  let r: Response
  try { r = await fetch('/scribe' + path, { headers: { 'X-Auth-Token': getToken() ?? '' } }) }
  catch { throw new Error('暂时查不到，稍后再试') }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : '暂时查不到，稍后再试')
  return j as T
}
export const searchSites = (q: string) => get<{ sites: Site[] }>(`/hub/search?q=${encodeURIComponent(q)}`).then((r) => r.sites)
export const siteDetail = (id: string) => get<SiteDetail>(`/hub/site?id=${encodeURIComponent(id)}`)
export const matchUrl = (url: string) => get<{ routes: Match[] }>(`/hub/match?url=${encodeURIComponent(url)}`).then((r) => r.routes)

// ——— 路由模板 ———
// "/list/:id"、"/realtime/:section?"、"/other/:type?/:section?"、"/user/:id{.+}?"
export type Seg = { lit?: string; name?: string; optional?: boolean; rest?: boolean }
export function segs(template: string): Seg[] {
  return template.split('/').filter(Boolean).map((s) => {
    const m = s.match(/^:(\w+)(\{[^}]*\})?(\?)?$/)
    if (!m) return { lit: s }
    return { name: m[1], optional: !!m[3], rest: !!m[2] && /\.[+*]/.test(m[2]) }
  })
}
export const paramNames = (template: string) => segs(template).filter((s) => s.name).map((s) => s.name!)

// 填参数拼出完整路径（带命名空间）；必填的没填返回 null。可省的空着就去掉；后面还有填了的，前面的空位就成了必填
export function buildPath(site: string, template: string, values: Record<string, string>, extra = ''): string | null {
  const ss = segs(template)
  const lastFilled = ss.reduce((a, s, i) => (s.name && values[s.name]?.trim() ? i : a), -1)
  const out: string[] = []
  for (let i = 0; i < ss.length; i++) {
    const s = ss[i]
    if (s.lit) { out.push(s.lit); continue }
    const v = values[s.name!]?.trim() ?? ''
    if (!v) { if (s.optional && i > lastFilled) continue; return null }
    out.push(s.rest ? v.split('/').map(encodeURIComponent).join('/') : encodeURIComponent(v))
  }
  const q = extra.trim().replace(/^[?&]+/, '')
  return `/${site}/${out.join('/')}`.replace(/\/$/, '') + (q ? `?${q}` : '')
}

// 一个具体路径（/thepaper/list/25483?x=1）能不能对上这个模板，对上就给出参数值
export function matchTemplate(site: string, template: string, path: string): Record<string, string> | null {
  const [p, q] = path.split('?')
  const parts = p.split('/').filter(Boolean), head = site.split('/').length
  if (parts.slice(0, head).join('/') !== site) return null
  const rest = parts.slice(head), ss = segs(template), values: Record<string, string> = {}
  let i = 0
  for (const s of ss) {
    if (s.lit) { if (rest[i] !== s.lit) return null; i++; continue }
    if (s.rest) { if (i >= rest.length) { if (!s.optional) return null; continue } values[s.name!] = rest.slice(i).map(decodeURIComponent).join('/'); i = rest.length; continue }
    if (i >= rest.length) { if (!s.optional) return null; continue }
    values[s.name!] = decodeURIComponent(rest[i]); i++
  }
  if (i !== rest.length) return null
  if (q) values.__extra = q
  return values
}

// ——— 参数选项 ———
const isValue = (s: string) => /^[\w.\-:~+]+$/.test(s.replace(/`/g, '').trim())
const clean = (s: string) => s.replace(/`|\*\*/g, '').trim()
function tables(md: string): string[][][] {
  const out: string[][][] = []
  let cur: string[][] = []
  for (const line of md.split('\n')) {
    const t = line.trim()
    if (/^\|.*\|$/.test(t)) {
      if (/^\|[\s:|-]+\|$/.test(t)) continue   // 分隔行
      cur.push(t.slice(1, -1).split('|').map(clean))
    } else if (cur.length) { out.push(cur); cur = [] }
  }
  if (cur.length) out.push(cur)
  return out
}
// 参数的叫法：取说明的第一小句、去掉末尾的 id（「状态 id，可选…」→「状态」）；取不到就用参数名
export function paramLabel(description: string, name: string): string {
  const head = (description.split(/[，,。；;（(]/)[0] ?? '').replace(/`/g, '').trim().replace(/\s*id$/i, '')
  return head && head.length <= 8 ? head : name
}
// 从说明文字的表格里认选项；也认「`1` 即 有定论 或 `0` 即 核查中」这种写法
export function optionsFromText(md: string | null | undefined): Option[] {
  if (!md) return []
  const out: Option[] = []
  for (const m of md.matchAll(/`([\w.\-]+)`\s*(?:即|为|表示|是|:|：)\s*([^`，,或；;。\n]+)/g)) out.push({ label: m[2].trim(), value: m[1] })
  for (const t of tables(md)) {
    if (t.length < 2) continue
    const [head, ...rows] = t
    // 横排：表头是名字、下一行是值（可能好几组「名字行 + 值行」叠着）
    const horizontal = rows.length >= 1 && head.some((c) => !isValue(c)) && rows[0].every((c) => !c || isValue(c))
      && (rows.length === 1 || rows.length % 2 === 1)
    if (horizontal) {
      const groups = [head, ...rows]
      for (let g = 0; g + 1 < groups.length; g += 2) groups[g].forEach((label, i) => { const v = groups[g + 1][i]; if (label && v && isValue(v)) out.push({ label, value: v }) })
      continue
    }
    // 竖排：找全是值的那一列当值，另一列当名字
    const cols = head.length
    let vi = -1
    for (let c = 0; c < cols; c++) if (rows.every((r) => !r[c] || isValue(r[c])) && rows.some((r) => r[c])) { vi = c; break }
    if (vi < 0) continue
    const li = [...Array(cols).keys()].find((c) => c !== vi && rows.some((r) => r[c] && !isValue(r[c]))) ?? (vi === 0 ? 1 : 0)
    for (const r of rows) if (r[vi]) out.push({ label: r[li] || r[vi], value: r[vi] })
  }
  const seen = new Set<string>()
  return out.filter((o) => !seen.has(o.value) && seen.add(o.value))
}
// ——— 参数说人话（0.29.1，2026-10-26 Hana：小红书那条全是 user、category、routeParams，看不懂） ———
// 先看下面这张表里有没有这条路由的专门说法；没有的话，参数名、选项是英文原样的，按常见的叫法换成中文
type Say = { label?: string; hint?: string; options?: Record<string, string>; fold?: boolean }
const ROUTE_SAY: Record<string, Record<string, Say>> = {
  'xiaohongshu/user/:user_id/:category/:routeParams?': {
    user_id: { label: '用户 id', hint: '博主主页地址里 user/profile/ 后面那串，24 位字母和数字（问号前面那段）' },
    category: { label: '看什么', options: { notes: '笔记', collect: '收藏' } },
    routeParams: { label: '实况照片', fold: true, hint: '不填：实况照片显示成图片；填 displayLivePhoto=1：显示成视频' },
  },
  'instagram/:category/:key': {
    category: { label: '看什么', options: { user: '帖子', stories: '快拍', highlights: '精选快拍', tags: '话题标签' } },
    key: { label: '用户名', hint: '主页地址 instagram.com/ 后面的名字，不带 @；看「话题标签」时填标签名' },
  },
}
const NAME_SAY: Record<string, string> = {
  user: '用户', user_id: '用户 id', userid: '用户 id', uid: '用户 id', username: '用户名', name: '名字',
  category: '类型', type: '类型', keyword: '关键词', keywords: '关键词', query: '关键词', tag: '标签',
  lang: '语言', language: '语言', channel: '频道', sort: '排序', order: '排序', routeParams: '附加设置',
}
const OPTION_SAY: Record<string, string> = {
  notes: '笔记', collect: '收藏', all: '全部', hot: '热门', latest: '最新', new: '最新', top: '置顶',
  video: '视频', videos: '视频', posts: '帖子', article: '文章', articles: '文章', news: '新闻',
}
// 可选、又没有选项的这几种参数：收进「附加参数」，默认不露出来
const FOLD = new Set(['routeParams', 'params', 'filter', 'options'])
const ascii = (t: string) => !!t && !/[^\x00-\x7f]/.test(t)

export type ParamInfo = { description: string; options: Option[]; label: string; hint: string; fold: boolean }
// 每个参数：说明文字 + 选项 + 叫法、提示、要不要收起来。site：路由属于哪个站点（查专门说法用）
export function paramInfo(r: Route, site?: string): Record<string, ParamInfo> {
  const names = paramNames(r.path)
  const special = site ? ROUTE_SAY[`${site}${r.path}`] ?? ROUTE_SAY[`${site}/${r.path.replace(/^\//, '')}`] ?? {} : {}
  const optionalOf = (n: string) => /:\w+(\{[^}]*\})?\?/.test(r.path.split('/').find((x) => x.startsWith(':' + n)) ?? '')
  const info: Record<string, ParamInfo> = {}
  for (const n of names) {
    const p = r.parameters?.[n]
    const description = typeof p === 'string' ? p : p?.description ?? ''
    const options = typeof p === 'object' && p?.options?.length ? p.options : optionsFromText(description)
    info[n] = { description, options, label: '', hint: '', fold: false }
  }
  // 说明里的表：只有一个参数还没选项时才归给它（几个参数时分不清是谁的）
  const bare = names.filter((n) => !info[n].options.length)
  if (bare.length === 1) { const o = optionsFromText(r.description); if (o.length) info[bare[0]].options = o }
  for (const n of names) {
    const it = info[n], say = special[n] ?? {}
    const raw = paramLabel(it.description, n)
    it.label = say.label ?? (ascii(raw) ? NAME_SAY[n] ?? NAME_SAY[raw] ?? raw : raw)
    it.options = it.options.map((o) => {
      const zh = say.options?.[o.value] ?? (ascii(o.label) ? OPTION_SAY[o.value] ?? OPTION_SAY[o.label.toLowerCase()] : undefined)
      return zh ? { ...o, label: zh } : o
    })
    it.hint = say.hint ?? it.description.replace(/`/g, '')
    it.fold = say.fold ?? (optionalOf(n) && !it.options.length && FOLD.has(n))
  }
  return info
}

// 路由的一句话说明：要不要填、填什么（2026-10-23 Hana：只有名字看不懂）。收起来的参数不提
export function routeNeeds(r: Route, site?: string): string {
  const info = paramInfo(r, site)
  const names = paramNames(r.path).filter((n) => !info[n].fold)
  if (!names.length) return '不用填，直接订'
  const req = segs(r.path).filter((x) => x.name && !x.optional && !info[x.name].fold).map((x) => x.name!)
  const bits = names.map((n) => {
    const { options, label } = info[n]
    if (options.length) return `选${label}：${options.slice(0, 3).map((o) => o.label).join('、')}${options.length > 3 ? ` 等 ${options.length} 个` : ''}`
    return `填${label}`
  })
  return (req.length ? '要' : '可直接订，也可') + bits.join('；')
}
// 显示名：去掉打头的站点名（「澎湃美数课作品集 - 分类」→「美数课作品集 - 分类」）
export function routeTitle(r: Route, siteName: string): string {
  const short = siteName.replace(/(新闻|网|官网)$/, '')
  for (const p of [siteName, short]) if (p && r.name.startsWith(p) && r.name.length > p.length + 1) return r.name.slice(p.length).replace(/^[\s\-—·:：]+/, '')
  return r.name
}
// 排序：能直接订的在前，要选一项的其次，要自己填的再后，用不了的最后
export function routeRank(r: Route): number {
  if (flag(r).off) return 9
  const req = segs(r.path).filter((x) => x.name && !x.optional)
  if (!req.length) return 0
  const info = paramInfo(r)
  return req.every((x) => info[x.name!].options.length) ? 1 : 2
}

// ——— 路由标记 ———
// 0.29：灵媒自建上配好了的（hubConfigured，比如小红书、Instagram 的 cookie）不再算「用不了」；
//   要浏览器的路由，配了它的账号配置也放行（小红书给了 cookie 先走不用浏览器的路），标「可能时好时坏」
export function flag(r: Route): { off?: string; warn?: string } {
  const f = r.features
  if (!f) return {}
  const cfg = Array.isArray(f.requireConfig) ? f.requireConfig : []
  const have = hubConfigured()
  const got = cfg.some((c) => have.has(c.name))
  if (f.requirePuppeteer && !got) return { off: '要浏览器，用不了' }
  if (cfg.some((c) => !c.optional && !have.has(c.name))) return { off: '要服务器配置，用不了' }
  // 「可能不稳定」拆成两种说法（2026-10-24 Hana 问是什么意思）
  if (f.antiCrawler || f.requirePuppeteer) return { warn: '对方有反爬，可能时好时坏' }
  if (cfg.length && !got) return { warn: '配了账号更完整，灵媒自建没配' }
  return {}
}

// ——— 报刊归属 ———
const host = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^(www|m)\./, '') } catch { return '' } }
// 路由属于哪个站点：一般是第一段；带斜杠的站点 id（gov/xxx）整段比，取最长的
export function siteOfRoute(path: string): string {
  const segs = path.split('?')[0].split('/').filter(Boolean)
  const hit = nestedSites().filter((id) => segs.slice(0, id.split('/').length).join('/') === id && segs.length > id.split('/').length).sort((a, b) => b.length - a.length)[0]
  return hit ?? segs[0] ?? ''
}
// 一个源属于哪份报刊（站点 id 或 d:域名）
export function paperOf(m: Meta, f: Feed): string {
  const saved = m.feeds[f.id]?.paper
  if (saved) return saved
  const route = rsshubRoute(f.feed_url)
  if (route) return siteOfRoute(route)
  return 'd:' + (host(f.site_url) || host(original(f.feed_url)))
}
// 这个站点（RSSHub 命名空间 + 官网域名）已经订了哪些
export function feedsOfSite(m: Meta, feeds: Feed[], site: { id: string; url: string }): Feed[] {
  return feeds.filter((f) => { const p = paperOf(m, f); return p === site.id || (!!site.url && p === 'd:' + site.url.replace(/^(www|m)\./, '')) })
}
// 路由比对（不看哪台实例）：/thepaper/list/25483
export const routeKey = (url: string) => { const r = rsshubRoute(url); return r ? r.replace(/\/$/, '') : null }

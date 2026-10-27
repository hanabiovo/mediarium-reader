// 本站 RSSHub（阶段 6，2026-10-23）：灵媒里叫「灵媒自建」。
//   · 地址来自服务器配置 RSSHUB_URL（如 http://mediarium-rsshub:1200），不写死：朋友自己部署灵媒时改这一行就行；不配就当没有
//   · 体检放行它（guard.js 的例外），别的内网地址照样拦
//   · 路由目录：整份目录很大，不让浏览器下载。这里一天取一次，只留一份小索引（站点名、域名、网址规则），
//     灵媒查：按站点名 / 域名搜、看一个站点的全部路由、按网址认路由
//   · 字段以 CC 2026-10-23 在 6f4f814f 版本上取的样例为准（计划与说明/RSSHub 目录接口样例.md）
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { safeFetch, trustOrigin } from './guard.js'

export const HUB = (process.env.RSSHUB_URL || '').replace(/\/+$/, '')
// 灵媒自建上配好了哪些路由配置（只是名字，比如 XIAOHONGSHU_COOKIE，不是值）：前端据此不再把这些路由标成「用不了」（0.9.2）
export const HUB_CONFIGURED = (process.env.HUB_CONFIGURED || '').split(',').map((x) => x.trim()).filter((x) => /^[A-Z][A-Z0-9_]{1,63}$/.test(x))
trustOrigin(HUB)
export const hubOn = () => !!HUB

const FILE = path.join(process.env.DATA_DIR || '/data', 'hub-index.json')
const DAY = 864e5
const log = (...a) => console.log(new Date().toISOString(), ...a)

// ——— 小索引 ———
// sites: [{ id, name, url, lang, n }]   rules: [{ id, host, segs, target, route }]
// nested: 带斜杠的站点 id（如 gov/xxx）的整份目录——RSSHub 单个站点的接口按一段路径取，这种取不到，就从整份目录里留一份（2026-10-24）
let index = null
let loading = null

const bareHost = (h) => String(h || '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^(www|m)\./, '')

// radar 的 source 形如 "thepaper.cn/"、"zaobao.com.sg/news"、"www.bilibili.com/space/:uid"
function parseSource(src) {
  const s = String(src).replace(/^https?:\/\//, '')
  const i = s.indexOf('/')
  const host = bareHost(i < 0 ? s : s.slice(0, i))
  const segs = (i < 0 ? '' : s.slice(i + 1)).split(/[?#]/)[0].split('/').filter(Boolean)
  return host ? { host, segs } : null
}

export function buildIndex(all) {
  const sites = [], rules = [], nested = {}
  for (const [id, ns] of Object.entries(all ?? {})) {
    if (!ns || typeof ns !== 'object') continue
    if (id.includes('/')) nested[id] = ns
    const routes = ns.routes ?? {}
    sites.push({ id, name: String(ns.name ?? id), url: bareHost(ns.url), lang: ns.lang ?? '', n: Object.keys(routes).length })
    for (const [key, r] of Object.entries(routes)) {
      for (const rd of r?.radar ?? []) {
        for (const src of rd?.source ?? []) {
          const p = parseSource(src)
          if (p) rules.push({ id, host: p.host, segs: p.segs, target: rd.target ?? null, route: key, name: String(r.name ?? key) })
        }
      }
    }
  }
  return { at: Date.now(), sites, rules, nested }
}

async function fetchJson(p, maxBytes) {
  const r = await safeFetch(HUB + p, { maxBytes, timeout: 60000, headers: { accept: 'application/json' } })
  if (r.status !== 200) throw Object.assign(new Error(`RSSHub 回了 ${r.status}`), { status: 502 })
  return JSON.parse(r.body.toString('utf8'))
}

async function refresh() {
  const all = await fetchJson('/api/namespace', 40 * 1024 * 1024)
  index = buildIndex(all)
  await mkdir(path.dirname(FILE), { recursive: true }).catch(() => {})
  await writeFile(FILE, JSON.stringify(index)).catch((e) => log('hub index write failed', e.message))
  log(`hub index: ${index.sites.length} sites, ${index.rules.length} rules`)
  return index
}

export async function getIndex() {
  if (!HUB) throw Object.assign(new Error('没有配 RSSHub'), { status: 404 })
  if (!index) { try { index = JSON.parse(await readFile(FILE, 'utf8')) } catch { /* 第一次 */ } }
  const stale = !index || Date.now() - index.at > DAY
  if (stale && !loading) loading = refresh().finally(() => { loading = null })
  if (!index) return await loading   // 一份都没有：等这一次
  if (stale) loading?.catch((e) => log('hub index refresh failed', e.message))   // 有旧的先用着，后台更新
  return index
}

// ——— 搜站点：中文名、命名空间 id、域名都能搜 ———
export function searchSites(idx, q) {
  const k = String(q || '').trim().toLowerCase()
  if (!k) return []
  const scored = []
  for (const s of idx.sites) {
    const name = s.name.toLowerCase(), id = s.id.toLowerCase(), url = s.url
    let sc = 0
    if (name === k || id === k || url === k) sc = 4
    else if (name.startsWith(k) || id.startsWith(k) || url.startsWith(k)) sc = 3
    else if (name.includes(k)) sc = 2
    else if (id.includes(k) || url.includes(k)) sc = 1
    if (sc) scored.push([sc, s])
  }
  return scored.sort((a, b) => b[0] - a[0] || b[1].n - a[1].n).slice(0, 30).map(([, s]) => s)
}

// ——— 按网址认路由 ———
export function matchUrl(idx, raw) {
  let u
  try { u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw) } catch { return [] }
  const host = bareHost(u.hostname)
  const segs = u.pathname.split('/').filter(Boolean)
  const out = [], seen = new Set()
  for (const r of idx.rules) {
    if (host !== r.host && !host.endsWith('.' + r.host)) continue
    const vals = {}
    let ok = true
    for (let i = 0; i < r.segs.length; i++) {
      const p = r.segs[i]
      if (p === '*') break
      const v = segs[i]
      if (v === undefined) { ok = false; break }
      if (p.startsWith(':')) vals[p.slice(1).replace(/\?$/, '')] = decodeURIComponent(v)
      else if (p !== v) { ok = false; break }
    }
    if (!ok || (!r.segs.includes('*') && segs.length !== r.segs.length)) continue
    // target 里的参数用网址里认出的值填上；可省的没值就去掉；必填的没值就留给用户填
    let path = null
    if (r.target) {
      const filled = r.target.replace(/\/:(\w+)(\?)?/g, (m, n, opt) => (vals[n] !== undefined ? '/' + encodeURIComponent(vals[n]) : opt ? '' : m))
      path = `/${r.id}${filled.startsWith('/') ? '' : '/'}${filled}`
    }
    const key = r.id + '|' + r.route + '|' + path
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ site: r.id, siteName: idx.sites.find((s) => s.id === r.id)?.name ?? r.id, route: r.route, name: r.name, path, needsInput: !path || /\/:\w/.test(path) })
  }
  return out.slice(0, 20)
}

// 站点 id：字母数字、- _ .，可以有斜杠分段；不许 ..（2026-10-24 放宽：原来只认 [\w-]，带点的站点进不去）
export const validId = (id) => typeof id === 'string' && id.length <= 80 && !id.includes('..') && /^[\w.-]+(\/[\w.-]+)*$/.test(id)
// 一条路由（/gov/xxx/list）属于哪个站点：带斜杠的 id 取最长的那个，否则取第一段
export function siteOfPath(idx, route) {
  const segs = String(route || '').split('?')[0].split('/').filter(Boolean)
  for (let n = segs.length - 1; n >= 2; n--) { const id = segs.slice(0, n).join('/'); if (idx?.nested?.[id]) return id }
  return segs[0] ?? ''
}
export const nestedIds = (idx) => Object.keys(idx?.nested ?? {})

// ——— 一个站点的全部路由（站点小，直接问 RSSHub，记一小时）———
const nsCache = new Map()
export async function siteDetail(id, idx) {
  if (!HUB) throw Object.assign(new Error('没有配 RSSHub'), { status: 404 })
  if (!validId(id)) throw Object.assign(new Error('站点 id 不对'), { status: 400 })
  const hit = nsCache.get(id)
  if (hit && Date.now() - hit.at < 3600e3) return hit.v
  const ns = id.includes('/') ? idx?.nested?.[id] : await fetchJson(`/api/namespace/${encodeURIComponent(id)}`, 4 * 1024 * 1024)
  if (!ns) throw Object.assign(new Error('没有这个站点'), { status: 404 })
  const routes = Object.entries(ns.routes ?? {}).map(([key, r]) => ({
    path: key, name: String(r.name ?? key), example: r.example ?? null,
    parameters: r.parameters ?? null, description: r.description ?? null,
    features: r.features ?? null, url: r.url ?? null, categories: r.categories ?? [],
  }))
  const v = { id, name: String(ns.name ?? id), url: bareHost(ns.url), lang: ns.lang ?? '', description: ns.description ?? null, routes }
  nsCache.set(id, { at: Date.now(), v })
  if (nsCache.size > 60) nsCache.delete(nsCache.keys().next().value)
  return v
}

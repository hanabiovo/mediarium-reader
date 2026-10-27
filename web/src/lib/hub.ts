// 本站 RSSHub（阶段 6，2026-10-23）：界面上叫「灵媒自建」，不露 RSSHub 这个词，也不露内部地址（Hana 定）。
// 地址由誊写服务告诉灵媒（服务器配置 RSSHUB_URL）；没配就当没有，候选里不出现
// 0.21.2（2026-10-24）：Miniflux 不肯订内网地址（也不改它的设置，Hana 定），灵媒自建上的源改订誊写服务签过名的转发地址
//   （…/scribe/feed?url=内部地址&s=签名）。签名在服务器上算，密钥不到浏览器；体检也体检这个转发地址，和 Miniflux 取的是同一条路
import { getToken } from '../api/miniflux'

export const HUB_LABEL = '灵媒自建'
let info: { on: boolean; base?: string; wrap?: boolean; nested?: string[]; configured?: string[] } | null = null
let loading: Promise<void> | null = null

export function ensureHub(): Promise<void> {
  if (info) return Promise.resolve()
  return (loading ??= fetch('/scribe/hub/info', { headers: { 'X-Auth-Token': getToken() ?? '' } })
    .then((r) => (r.ok ? r.json() : { on: false }))
    .then((j) => {
      info = j?.on && typeof j.base === 'string'
        ? { on: true, base: j.base.replace(/\/+$/, ''), wrap: j.wrap !== false, nested: Array.isArray(j.nested) ? j.nested.filter((x: unknown) => typeof x === 'string') : [], configured: Array.isArray(j.configured) ? j.configured.filter((x: unknown) => typeof x === 'string') : [] }
        : { on: false }
    })
    .catch(() => { info = null })   // 誊写服务没接上：下次再问
    .finally(() => { loading = null }))
}
export const hubBase = () => (info?.on ? info.base! : '')
// 带斜杠的站点 id（gov/xxx 这种），归报刊时要整段比
export const nestedSites = () => info?.nested ?? []
// 灵媒自建上配好了的路由配置（名字，比如 XIAOHONGSHU_COOKIE）（0.29）
export const hubConfigured = () => new Set(info?.configured ?? [])

const onBase = (url: string) => { const b = hubBase(); return !!b && url.startsWith(b + '/') }

// 给 Miniflux 订 / 给体检的地址：灵媒自建上的换成签过名的转发地址，别的原样
const wrapped = new Map<string, string>()
export async function feedUrlFor(url: string): Promise<string> {
  if (!onBase(url)) return url
  const hit = wrapped.get(url)
  if (hit) return hit
  let r: Response
  try { r = await fetch(`/scribe/hub/wrap?url=${encodeURIComponent(url)}`, { headers: { 'X-Auth-Token': getToken() ?? '' } }) }
  catch { throw new Error('灵媒自建暂时订不了，稍后再试') }
  const j = await r.json().catch(() => ({}))
  if (!r.ok || typeof j.path !== 'string') throw new Error(typeof j.error === 'string' ? j.error : '灵媒自建暂时订不了，稍后再试')
  const full = location.origin + j.path
  wrapped.set(url, full)
  return full
}

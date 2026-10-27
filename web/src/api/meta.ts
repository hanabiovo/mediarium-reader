// 灵媒自己的设置（Miniflux 里没有的字段）：刊物西文名、分类西文名、分类图标。
// 存在 Miniflux 账户的「自定义样式」（stylesheet）里，写成一段 CSS 注释：
//   /* mediarium-meta:{...json...}:mediarium-meta */
// 对 Miniflux 自己的界面没有任何影响；手机、电脑读到的是同一份。
// 阶段 4 有了灵媒自己的后台后，整块搬过去即可，界面不用动。
import { useEffect, useState } from 'react'
import { api, request, type Category } from './miniflux'
import type { Palette } from '../theme/themes'

export type Meta = {
  v: 1
  uncategorized?: number   // 当作「无类别」的那个 Miniflux 分类的 id
  feeds: Record<string, { latin?: string; notes?: { t: string; what: string }[]; trTitle?: boolean; paper?: string; column?: string; fine?: Record<string, string>; ignore?: Record<string, IgnoreRule>; added?: string }>   // fine：源医生里点过「它没事」的（毛病种类 → 点的时间，6 小时内有效）   // notes：源医生的病历（5b-3）；paper / column：属于哪份报刊、栏目名（阶段 6）
  // 报刊（阶段 6）：键 = 站点 id（RSSHub 命名空间，如 thepaper）或 d:域名（目录里没有的站点）
  papers?: Record<string, { name: string; latin?: string; site?: string; domain?: string }>
  categories: Record<string, { latin?: string; icon?: string }>
  themes?: SavedTheme[]   // 寒鸦衔色存下的配色（跟着账户走，各台设备都看得到；眼下用哪套各台自己记）
  hidden?: number[]        // 源医生去重藏起来的文章（Miniflux 接口删不了单篇，只能标已读 + 灵媒里不显示；最多留最近 500 篇）
  // 不爱看（0.28，lib/attention.ts）：文章 id → { f: 源 id, t: 划掉的时间（毫秒）}；只留最近 90 天
  muted?: Record<string, Mark>
}
export type Mark = { f: number; t: number }
// AI 判定的忽略规则（MCP 的 triage_source 写，2026-10-27）：源医生不再为这类问题提醒，到 until 自动恢复；match 只忽略报错原文里含这段字的
export type IgnoreRule = { why: string; at: string; until?: string; match?: string; by?: string }
type UserCss = { id: number; stylesheet: string }
export type SavedTheme = { id: string; name: string; light: Palette; dark: Palette }

const START = '/* mediarium-meta:'
const END = ':mediarium-meta */'
const EMPTY: Meta = { v: 1, feeds: {}, categories: {} }

let meta: Meta = EMPTY
let loaded: Promise<Meta> | null = null
const listeners = new Set<(m: Meta) => void>()

function parse(css: string): Meta {
  const i = css.indexOf(START), j = css.indexOf(END)
  if (i < 0 || j < i) return EMPTY
  try {
    const m = JSON.parse(css.slice(i + START.length, j)) as Meta
    return { v: 1, uncategorized: m.uncategorized, feeds: m.feeds ?? {}, categories: m.categories ?? {}, hidden: m.hidden, papers: m.papers, muted: m.muted, themes: Array.isArray(m.themes) ? m.themes : undefined }
  } catch { return EMPTY }
}

function render(css: string, m: Meta): string {
  // JSON 里出现 */ 会提前结束注释，转义成 *\/（JSON 允许这种写法）
  const block = START + JSON.stringify(m).replace(/\*\//g, '*\\/') + END
  const i = css.indexOf(START), j = css.indexOf(END)
  if (i >= 0 && j > i) return css.slice(0, i) + block + css.slice(j + END.length)
  return css ? `${css}\n${block}` : block
}

export function loadMeta(force = false): Promise<Meta> {
  if (!loaded || force) {
    loaded = request<UserCss>('/me').then((u) => {
      meta = parse(u.stylesheet ?? '')
      listeners.forEach((f) => f(meta))
      return meta
    }).catch((e) => { loaded = null; throw e })
  }
  return loaded
}

// 改一部分：先改本地（界面立刻变），再写回 Miniflux；写之前重新读一次，免得盖掉别的设备刚写的
export async function updateMeta(change: (m: Meta) => Meta): Promise<void> {
  meta = change(meta)
  listeners.forEach((f) => f(meta))
  const u = await request<UserCss>('/me')
  const merged = change(parse(u.stylesheet ?? ''))
  await request<void>(`/users/${u.id}`, { method: 'PUT', body: JSON.stringify({ stylesheet: render(u.stylesheet ?? '', merged) }) })
  meta = merged
  listeners.forEach((f) => f(meta))
}

// 眼下这一份（含刚改、还没写回的）：loadMeta() 返回的是第一次读到的那份
export const currentMeta = (): Meta => meta

export function useMeta(): Meta {
  const [m, setM] = useState<Meta>(meta)
  useEffect(() => {
    listeners.add(setM)
    loadMeta().catch(() => {})
    return () => { listeners.delete(setM) }
  }, [])
  return m
}

// 去重藏起来的文章：列表里跳过（先等灵媒设置读到，免得一闪而过）
export async function visible<T extends { id: number }>(list: T[]): Promise<T[]> {
  await loadMeta().catch(() => {})
  const h = new Set(meta.hidden ?? [])
  return h.size ? list.filter((e) => !h.has(e.id)) : list
}

export const feedLatin = (m: Meta, id: number) => m.feeds[id]?.latin ?? ''
export const categoryLatin = (m: Meta, id: number) => m.categories[id]?.latin ?? ''
export const categoryIcon = (m: Meta, id?: number) => (id ? m.categories[id]?.icon : undefined)

// ── 无类别 ───────────────────────────────
// Miniflux 规定每本刊物都必须属于一个分类，新账户自带一个「All」。灵媒把它当成「无类别」：
// 名称固定显示「无类别」，不能改名、不能删；删别的分类时，里面的刊物移到这里；报刊架上排在最后。
// 认哪一个：灵媒设置里记过的 → 名叫 All 的 → 名叫「无类别」的；都没有就新建一个（ensureUncategorized）。
export const UNCATEGORIZED = '无类别'

export function uncategorizedId(m: Meta, categories: Category[]): number | null {
  if (m.uncategorized && categories.some((c) => c.id === m.uncategorized)) return m.uncategorized
  const c = categories.find((x) => x.title.toLowerCase() === 'all') ?? categories.find((x) => x.title === UNCATEGORIZED)
  return c?.id ?? null
}

export async function ensureUncategorized(m: Meta, categories: Category[]): Promise<number> {
  let id = uncategorizedId(m, categories)
  if (!id) id = (await api.createCategory(UNCATEGORIZED)).id
  if (m.uncategorized !== id) { const fixed = id; await updateMeta((x) => ({ ...x, uncategorized: fixed })) }
  return id
}

export function categoryName(m: Meta, c: Category, categories: Category[]): string {
  return c.id === uncategorizedId(m, categories) ? UNCATEGORIZED : c.title
}

// 分类的显示顺序：照 Miniflux 的顺序，无类别放最后
export function orderedCategories(m: Meta, categories: Category[]): Category[] {
  const u = uncategorizedId(m, categories)
  return [...categories.filter((c) => c.id !== u), ...categories.filter((c) => c.id === u)]
}

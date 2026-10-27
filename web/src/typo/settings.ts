// 排版设置：界面预设 + 文章组字体（正文、标题、西文）+ 字号、行距两档滑杆 + 首行缩进开关 + 外链字体。存在这台设备上。
// 滑杆分挡、不做无极（2026-10-20 Hana 定）：数值照业内惯例，段距、栏宽、页边距跟着自动算。
// 存的是数值不是挡位序号（2026-10-21）：以后增减挡位，已调好的字号不会错位。
import { useSyncExternalStore } from 'react'
import { load, save } from '../api/storage'
import { applyFonts, CJK_FONTS, DEFAULT_ARTICLE, DEFAULT_UI, UI_PRESETS, type ArticleFonts, type CjkFont } from './fonts'
import { loadLocalFonts } from './localFonts'

// 手机上的字号；电脑上每挡大 1。Hana 爱小密字，往下加了 13、14（2026-10-21）
export const SIZE_STEPS = [13, 14, 15, 16, 17, 18, 20]
// 中文比英文要更松的行距；往下加了 1.4、1.5
export const LEADING_STEPS = [1.4, 1.5, 1.6, 1.75, 1.9, 2.0]

// sync：文章字体同步界面字体（2026-10-21 Hana 定）——界面大字做文章标题、小字做正文、界面西文做西文。
// 在任何地方改了文章字体就静默取消同步；改文章字体永远不动界面字体
export type Typo = { v: 2; ui: string; article: ArticleFonts; sync: boolean; size: number; leading: number; indent: boolean; links: CjkFont[] }
export const articleOf = (ui: string): ArticleFonts => {
  const u = UI_PRESETS.find((x) => x.id === ui) ?? UI_PRESETS[0]
  return { title: u.display, body: u.small, latin: u.latin }
}
const DEFAULT: Typo = { v: 2, ui: DEFAULT_UI, article: articleOf(DEFAULT_UI), sync: true, size: 17, leading: 1.75, indent: false, links: [] }
const KEY = 'mediarium.typo'

const nearest = (steps: number[], v: unknown, d: number) =>
  typeof v === 'number' && isFinite(v) ? steps.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a)) : d

function read(): Typo {
  try {
    const raw = JSON.parse(load(KEY) ?? 'null')
    if (!raw) return DEFAULT
    if (raw.v !== 2) {
      // V0.9.0 存的是挡位序号和四个槽
      const OLD_SIZE = [15, 16, 17, 18, 20], OLD_LEAD = [1.6, 1.75, 1.9, 2.0]
      return {
        ...DEFAULT, sync: false,
        article: { body: raw.slots?.body ?? DEFAULT_ARTICLE.body, title: raw.slots?.title ?? DEFAULT_ARTICLE.title, latin: raw.slots?.latin ?? DEFAULT_ARTICLE.latin },
        size: OLD_SIZE[raw.size] ?? DEFAULT.size, leading: OLD_LEAD[raw.leading] ?? DEFAULT.leading, indent: !!raw.indent,
      }
    }
    return {
      v: 2, ui: typeof raw.ui === 'string' ? raw.ui : DEFAULT_UI,
      article: { ...DEFAULT_ARTICLE, ...(raw.article ?? {}) },
      // 以前存的设置没有这一项：照原样保留文章字体，不同步（免得一升级文章字体就变了）
      sync: typeof raw.sync === 'boolean' ? raw.sync : false,
      size: nearest(SIZE_STEPS, raw.size, DEFAULT.size), leading: nearest(LEADING_STEPS, raw.leading, DEFAULT.leading),
      indent: !!raw.indent, links: Array.isArray(raw.links) ? raw.links : [],
    }
  } catch { return DEFAULT }
}

let state: Typo = read()
let local: CjkFont[] = []
let fonts: CjkFont[] = [...CJK_FONTS, ...state.links]
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())
const rebuild = () => { fonts = [...CJK_FONTS, ...state.links, ...local] }

function apply() {
  applyFonts(state.ui, state.article, fonts)
  const root = document.documentElement.style
  root.setProperty('--prose-size-m', `${state.size}px`)
  root.setProperty('--prose-size-d', `${state.size + 1}px`)
  root.setProperty('--prose-leading', String(state.leading))
  document.documentElement.dataset.indent = state.indent ? 'on' : 'off'
}

export function initTypo() {
  apply()
  // 本机字体要从数据库里读出来再注册；读到之后若文章组选的是它，重新套一次
  loadLocalFonts().then((l) => {
    if (!l.length) return
    local = l; rebuild(); apply(); emit()
  })
}

export function setTypo(change: Partial<Omit<Typo, 'article' | 'v'>> & { article?: Partial<ArticleFonts> }) {
  const sync = change.sync ?? (change.article ? false : state.sync)
  state = { ...state, ...change, sync, article: { ...state.article, ...(change.article ?? {}) } }
  if (sync) state.article = articleOf(state.ui)
  save(KEY, JSON.stringify(state))
  rebuild(); apply(); emit()
}

export function addLocalFont(f: CjkFont) { local = [...local.filter((x) => x.id !== f.id), f]; rebuild(); emit() }

// 删掉一款字体（外链或本机）；文章组正在用它的槽退回默认
export function dropFont(id: string) {
  local = local.filter((x) => x.id !== id)
  const article = { ...state.article }
  for (const k of ['body', 'title'] as const) if (article[k] === id) article[k] = DEFAULT_ARTICLE[k]
  setTypo({ article, sync: state.sync, links: state.links.filter((x) => x.id !== id) })
}

// 外链字体（2026-10-21，灵感之海做过）：贴一个字体样式表地址；字体名能从样式表里读出来就自动填，读不到要手填
export async function addLinkFont(url: string, name?: string): Promise<CjkFont> {
  let family = name?.trim() ?? ''
  if (!family) {
    try {
      const css = await (await fetch(url)).text()
      family = css.match(/font-family\s*:\s*["']?([^"';}]+)["']?/i)?.[1]?.trim() ?? ''
    } catch { /* 跨站读不到，交给用户手填 */ }
  }
  if (!family) throw new Error('读不到字体名，请手动填一下')
  const f: CjkFont = { id: `link:${Date.now().toString(36)}`, label: family, family, css: url, multiWeight: false, source: 'link' }
  setTypo({ links: [...state.links, f] })
  return f
}

const snap = { get: () => state }
export function useTypo(): Typo {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, snap.get)
}
export function useFonts(): CjkFont[] {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => fonts)
}

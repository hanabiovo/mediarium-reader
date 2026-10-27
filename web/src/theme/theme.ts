// 配色与深浅色（3e）。主题 × 明暗：跟随系统（默认）/ 浅 / 深。存在这台设备上。
// 只改 tokens.css 里那几个颜色变量；页面上所有颜色都从它们取，鸟用 currentColor 跟着变。
import { useSyncExternalStore } from 'react'
import { load, save } from '../api/storage'
import { THEMES, type Palette } from './themes'
import type { Pair } from './roll'

export type Mode = 'auto' | 'light' | 'dark'
// override：在文章 Aa 里临时切的深浅（2026-10-21 Hana 定）。只在「跟随系统」时出现，记下切的时候系统是什么；
// 系统下一次自己切换深浅，临时覆盖作废，回到跟随系统
type Override = { mode: 'light' | 'dark'; sys: 'light' | 'dark' }
// theme：预设的 id；「u:…」= 寒鸦衔色存下的；「roll」= 刚 roll 出来、还没保存的。
// custom：后两种的颜色（带名字）存一份在本机，开 app 时不用等账户设置读到就能上色；prev：roll 之前在用的那套，「不保存」时换回去
type Custom = Pair & { name: string }
type Prev = { theme: string; custom?: Custom }
type State = { theme: string; mode: Mode; override?: Override; custom?: Custom; prev?: Prev }
const KEY = 'mediarium.theme'
const DEFAULT: State = { theme: 'paper', mode: 'auto' }

function read(): State {
  try {
    const raw = JSON.parse(load(KEY) ?? 'null')
    const okCustom = (c: unknown): c is Custom => !!c && typeof (c as Custom).light?.bg === 'string' && typeof (c as Custom).dark?.bg === 'string'
    let theme = THEMES.some((t) => t.id === raw?.theme) || (/^u:/.test(raw?.theme) && okCustom(raw?.custom)) ? raw.theme : DEFAULT.theme
    let custom = theme.startsWith('u:') ? raw.custom : undefined
    // 上次 roll 了没保存就关了 app：换回 roll 之前那套
    if (raw?.theme === 'roll') { const pv = raw.prev; theme = pv?.theme && (THEMES.some((t) => t.id === pv.theme) || okCustom(pv.custom)) ? pv.theme : DEFAULT.theme; custom = theme.startsWith('u:') ? pv.custom : undefined }
    return {
      theme, custom,
      mode: raw?.mode === 'light' || raw?.mode === 'dark' ? raw.mode : 'auto',
      override: raw?.override?.mode && raw?.override?.sys ? raw.override : undefined,
    }
  } catch { return DEFAULT }
}

let state = read()
const subs = new Set<() => void>()
const dark = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null

const VARS: Record<keyof Palette, string> = {
  bg: '--bg', ink: '--ink', body: '--ink-body', mid: '--ink-mid', faint: '--ink-faint', ghost: '--ink-ghost',
  rule: '--rule', accent: '--accent', muted: '--muted', surface: '--surface', danger: '--danger',
}

const systemMode = (): 'light' | 'dark' => (dark?.matches ? 'dark' : 'light')
export const resolvedMode = (): 'light' | 'dark' => {
  if (state.mode !== 'auto') return state.mode
  if (state.override && state.override.sys === systemMode()) return state.override.mode
  return systemMode()
}

function apply() {
  const custom = state.theme === 'roll' || state.theme.startsWith('u:') ? state.custom : undefined
  const t = custom ? { id: 'custom', ...custom } : THEMES.find((x) => x.id === state.theme) ?? THEMES[0]
  const m = resolvedMode()
  const p = t[m]
  const root = document.documentElement
  for (const k of Object.keys(VARS) as (keyof Palette)[]) root.style.setProperty(VARS[k], p[k])
  root.dataset.theme = t.id
  root.dataset.mode = m
  // 手机状态栏、浏览器顶栏跟着底色
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', p.bg)
}

export function initTheme() {
  apply()
  // 跟随系统时，系统一切深色就跟着变
  // 关着 app 时系统切过了：临时覆盖已经过期
  if (state.override && state.override.sys !== systemMode()) setTheme({ override: undefined })
  dark?.addEventListener('change', () => {
    if (state.mode !== 'auto') return
    if (state.override) setTheme({ override: undefined })
    else { apply(); subs.forEach((f) => f()) }
  })
}

export function setTheme(change: Partial<State>) {
  state = { ...state, ...change }
  if (state.mode !== 'auto') state.override = undefined
  save(KEY, JSON.stringify(state))
  apply()
  subs.forEach((f) => f())
}

// ——— 寒鸦衔色 ———
export const rolling = () => state.theme === 'roll'
// 换上一组刚 roll 的（还没保存）：第一次 roll 时记下之前在用的那套
export function previewRoll(c: Custom) {
  const prev = rolling() ? state.prev : { theme: state.theme, custom: state.custom }
  setTheme({ theme: 'roll', custom: c, prev })
}
// 不保存：换回 roll 之前那套
export function discardRoll() {
  if (!rolling()) return
  const pv = state.prev ?? { theme: DEFAULT.theme }
  setTheme({ theme: pv.theme, custom: pv.custom, prev: undefined })
}
// 用一套存下的（或刚存好的）
export function applySaved(id: string, c: Custom) { setTheme({ theme: id, custom: c, prev: undefined }) }
export const prevName = () => { const pv = state.prev; return pv ? (pv.custom?.name ?? THEMES.find((t) => t.id === pv.theme)?.label ?? '') : '' }

// 文章里 Aa 面板的快捷切换。手动浅 / 深：直接改设置。跟随系统：只临时覆盖；切回和系统一样时覆盖取消
export function toggleMode() {
  const next = resolvedMode() === 'dark' ? 'light' : 'dark'
  if (state.mode !== 'auto') return setTheme({ mode: next })
  setTheme({ override: next === systemMode() ? undefined : { mode: next, sys: systemMode() } })
}

let snap = { ...state, resolved: resolvedMode() }
// 选了某一项（设置页里点「跟随系统」）也清掉临时覆盖：由 ThemePicker 传 override: undefined
subs.add(() => { snap = { ...state, resolved: resolvedMode() } })
export function useTheme() {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => snap)
}

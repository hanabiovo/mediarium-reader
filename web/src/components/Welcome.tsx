// 欢迎页（3e，2026-10-21 定）：冷启动时盖在最上面。logo 放在屏幕正中，和安卓原生开屏的图标同一位置，
// 原生开屏一结束就接上（不必等大，原生的偏大）；底色跟着主题和深浅。第一屏的数据和 slogan 字体到了就淡出，最短 1.2 秒、最长 3 秒；点一下提前进。
import { useEffect, useState } from 'react'
import { Logo } from './Logo'

const SLOGAN = '一个人的书报亭'
let ready = false
const waiters = new Set<() => void>()
// 第一屏有内容了：报刊架、信息流读到数据时调一下
export function markReady() { if (ready) return; ready = true; waiters.forEach((f) => f()) }

// 一个标签页只放一次（2026-10-22 Hana：电脑上按浏览器后退，会退回上一次打开灵媒的那一页，整页重载又放一遍欢迎动画）。
// 浏览器的前进 / 后退带回来的整页，也不放
function shouldShow(): boolean {
  try {
    if (sessionStorage.getItem('mediarium.welcomed')) return false
    sessionStorage.setItem('mediarium.welcomed', '1')
  } catch { /* 隐私模式：照放 */ }
  const nav = performance.getEntriesByType?.('navigation')[0] as PerformanceNavigationTiming | undefined
  return nav?.type !== 'back_forward'
}
const showThisTime = shouldShow()

export function Welcome() {
  const [state, setState] = useState<'on' | 'leaving' | 'gone'>(showThisTime ? 'on' : 'gone')
  const [fonts, setFonts] = useState(false)
  // slogan 用界面大字；中文字体是按字分片从网上取的，没到之前字是隐形的，等它到了再一起淡入
  useEffect(() => {
    const fam = getComputedStyle(document.documentElement).getPropertyValue('--font-ui-display')
    const t = window.setTimeout(() => setFonts(true), 1500)
    document.fonts.load(`16px ${fam}`, SLOGAN).then(() => setFonts(true)).catch(() => setFonts(true))
    return () => window.clearTimeout(t)
  }, [])
  const [data, setData] = useState(ready)
  const [t0] = useState(() => Date.now())
  const [fontsAt, setFontsAt] = useState(0)
  useEffect(() => { if (fonts && !fontsAt) setFontsAt(Date.now()) }, [fonts, fontsAt])
  useEffect(() => {
    if (ready) setData(true)
    const on = () => setData(true)
    waiters.add(on)
    const cap = window.setTimeout(() => setState((s) => (s === 'on' ? 'leaving' : s)), 3000)   // 最多 3 秒
    return () => { waiters.delete(on); window.clearTimeout(cap) }
  }, [])
  // 数据和 slogan 都到了才走：最短停 1.2 秒，slogan 露面后至少停 0.9 秒（2026-10-21 Hana：手机上不到一秒，太快）
  useEffect(() => {
    if (!data || !fontsAt) return
    const wait = Math.max(t0 + 1200, fontsAt + 900) - Date.now()
    const t = window.setTimeout(() => setState((s) => (s === 'on' ? 'leaving' : s)), Math.max(0, wait))
    return () => window.clearTimeout(t)
  }, [data, fontsAt, t0])
  useEffect(() => {
    if (state !== 'leaving') return
    const t = window.setTimeout(() => setState('gone'), 320)
    return () => window.clearTimeout(t)
  }, [state])
  if (state === 'gone') return null
  return (
    <div className={`welcome ${state}${fonts ? ' fonts' : ''}`} onClick={() => setState('leaving')} aria-hidden="true">
      <span className="welcome-logo"><Logo size={96} /></span>
      <p className="welcome-slogan">{SLOGAN}</p>
      <p className="welcome-name mono-label">MEDIARIUM</p>
    </div>
  )
}

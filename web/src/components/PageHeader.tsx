// 一级页面的页头（视觉规则 6）：
// 顶栏 —— 左「MEDIARIUM」，右操作按钮（最右按钮图形对齐页边）；
// 刊头 —— 左侧日期或 logo，右侧页名右对齐；两行各自共用基线。
// collapsible（可选，信息流在用，2026-10-20 Hana 定的样子）：
//   顶栏原样贴顶不动；往下滚时刊头跟着收窄——左边的大日期和右边的页名一起缩小、页名下的英文淡出，
//   最后收成顶栏下面的一行：左「20 OCT · TUE」、右「信息流」，同一字体、同一字号、同一基线。滚回去再展开。
//   收窄跟着手指走（滚一半就收一半）。
import type { CSSProperties, ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { dayLine, dayNumber } from '../lib/day'

export function today() {
  const d = new Date()
  return { day: dayNumber(d), line: dayLine(d) }
}

type Props = {
  title: string          // 页名，如「报刊架」
  subtitle: string       // 等宽小字，如「THE NEWSSTAND」
  lead?: ReactNode       // 左上：默认今天的日期；设置页传 logo
  leadLine?: string      // 左下小字：默认「OCT · MON」
  actions?: ReactNode    // 顶栏右侧按钮
  collapsible?: boolean  // 刊头随滚动收成一行
  onCollapsedHeight?: (topbar: number, row: number) => void  // 告诉页面：顶栏高、收起后那一行高（下面的筛选栏贴在它们下面）
}

const ROW = 40   // 收起后那一行的高度

export function PageHeader({ title, subtitle, lead, leadLine, actions, collapsible, onCollapsedHeight }: Props) {
  useEffect(() => { document.title = title }, [title])
  const t = today()
  const bar = useRef<HTMLDivElement>(null)
  const wrap = useRef<HTMLDivElement>(null)
  const [dims, setDims] = useState({ bar: 0, full: 0 })
  const [p, setP] = useState(0)   // 收起的程度：0 = 展开，1 = 收成一行

  useLayoutEffect(() => {
    if (!collapsible || !bar.current || !wrap.current) return
    const b = bar.current, w = wrap.current
    const measure = () => {
      const next = { bar: b.offsetHeight, full: w.offsetHeight }
      setDims((d) => (d.bar === next.bar && d.full === next.full ? d : next))
      onCollapsedHeight?.(next.bar, ROW)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(b); ro.observe(w)
    return () => ro.disconnect()
  }, [collapsible]) // eslint-disable-line react-hooks/exhaustive-deps

  // 跟着滚动算收起程度。滚动可能发生在窗口，也可能发生在宽屏的列表栏里，用捕获阶段一并接住
  useEffect(() => {
    if (!collapsible) return
    let raf = 0
    const update = () => {
      raf = 0
      const w = wrap.current
      if (!w || !dims.full) return
      const travel = dims.full - ROW
      // 滚动容器（窗口，或宽屏的列表栏）的上沿都在屏幕顶端，直接看刊头离屏幕顶端多远
      const top = w.getBoundingClientRect().top
      setP(Math.min(1, Math.max(0, (dims.bar - top) / travel)))
    }
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(update) }
    update()
    window.addEventListener('scroll', onScroll, { capture: true, passive: true })
    window.addEventListener('resize', onScroll)
    return () => { window.removeEventListener('scroll', onScroll, { capture: true }); window.removeEventListener('resize', onScroll); cancelAnimationFrame(raf) }
  }, [collapsible, dims])

  if (!collapsible) {
    return (
      <header className="page-header">
        <div className="topbar">
          <span className="mono-label">MEDIARIUM</span>
          <div className="topbar-actions">{actions}</div>
        </div>
        <div className="masthead">
          <span className="masthead-lead">{lead ?? t.day}</span>
          <h1 className="masthead-title">{title}</h1>
          <span className="mono-label">{leadLine ?? t.line}</span>
          <span className="mono-label masthead-sub">{subtitle}</span>
        </div>
      </header>
    )
  }

  // 大字缩到和收起那一行同样大小时的比例
  const fade = Math.min(1, p / 0.7)               // 大字在前 70% 的行程里淡出
  const show = Math.max(0, (p - 0.45) / 0.55)     // 小字在后半程淡入
  const big = (scaleTo: number): CSSProperties => ({ transform: `scale(${1 - (1 - scaleTo) * p})`, opacity: 1 - fade })
  const stickTop = dims.full ? dims.bar - (dims.full - ROW) : 0

  return (
    <header className="page-header collapsible">
      <div className="topbar" ref={bar}>
        <span className="mono-label">MEDIARIUM</span>
        <div className="topbar-actions">{actions}</div>
      </div>
      <div className="masthead-wrap" ref={wrap} style={{ top: stickTop }}>
        <div className="masthead">
          <span className="masthead-lead grow-left" style={big(18 / 42)}>{lead ?? t.day}</span>
          <h1 className="masthead-title grow-right" style={big(18 / 30)}>{title}</h1>
          <span className="mono-label grow-left" style={{ opacity: 1 - fade }}>{leadLine ?? t.line}</span>
          <span className="mono-label masthead-sub grow-right" style={{ opacity: 1 - fade }}>{subtitle}</span>
        </div>
        <div className="masthead-row" aria-hidden={show < 0.5} style={{ opacity: show }}>
          <span>{t.day} {leadLine ?? t.line}</span>
          <span>{title}</span>
        </div>
      </div>
    </header>
  )
}

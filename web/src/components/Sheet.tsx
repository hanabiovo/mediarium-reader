// 面板。视觉规则 8：从顶部按钮打开的，就地展开；在内容上长按、或需要输入的，从底部出。
// placement="anchor"：从触发按钮正下方展开的小面板，右边对齐页边，不压暗（手机、宽屏都这样）。
// placement="bottom"：手机上从底部滑出（上沿一条线，背后压暗）；720px 以上仍挂在触发处展开。
// placement="dock"：手机、宽屏都从底部出；宽屏上宽度跟着文章栏（文章里的 Aa 面板，面板大，2026-10-21 Hana 定）。
import type { ReactNode } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

type Props = {
  title: string
  placement: 'anchor' | 'bottom' | 'dock'
  anchor: HTMLElement | null   // 小面板挂在这个元素下面
  // 小面板右边离 anchor 右边多远。不写：anchor 是顶栏按钮（按钮右边离内容右边 12px，页边离内容右边一个 gutter）
  inset?: number
  align?: 'right' | 'left'     // 小面板对齐 anchor 的右边（默认）还是左边
  form?: boolean               // 表单（添加 / 编辑信源）：宽屏小面板放宽一些
  label?: string               // 标题右边的等宽小字，比如「NO. 02」
  focusInput?: boolean         // 打开时把光标放进第一个输入框（添加信源）；默认只聚焦按钮，免得手机键盘一下弹出来
  onClose: () => void
  children: ReactNode
}

const WIDE = '(min-width: 720px)'
let pendingBack = 0

export function Sheet({ title, placement, anchor, inset, align = 'right', form = false, label, focusInput = false, onClose, children }: Props) {
  const panel = useRef<HTMLElement>(null)
  const [popover] = useState(() => placement === 'anchor' || (placement === 'bottom' && window.matchMedia(WIDE).matches))
  const [pos, setPos] = useState<{ top: number; right?: number; left?: number } | null>(null)

  // 先算好位置再显示，避免小面板闪一下
  useLayoutEffect(() => {
    if (popover && anchor) {
      const r = anchor.getBoundingClientRect()
      const gutter = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gutter')) || 32
      const right = window.innerWidth - r.right + (inset ?? gutter - 12)
      // 下面放不下就放到上面
      const h = panel.current?.offsetHeight ?? 0
      const below = r.bottom + 8
      const top = below + h > window.innerHeight - 16 ? Math.max(16, r.top - h - 8) : below
      // 左右都不出屏幕
      const w = panel.current?.offsetWidth ?? 0
      const vw = window.innerWidth
      if (align === 'left') setPos({ top, left: Math.max(16, Math.min(r.left, vw - 16 - w)) })
      else setPos({ top, right: Math.max(16, Math.min(right, vw - 16 - w)) })
    }
  }, [popover, anchor, inset, align])

  // 返回手势 / 返回键先关面板，不退出页面（2026-10-21 Hana：在分享面板上划动返回，整个文章页都退出了）。
  // 打开时在历史里垫一格；返回时浏览器先退掉这一格，面板跟着关。用按钮关时自己退掉这一格——
  // 但如果面板里的操作已经跳到了别的页（历史变了），就不退，免得把刚跳的页退回去
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const id = Math.random().toString(36).slice(2)
    // 一个面板关了紧接着开另一个（长按菜单 → 分享面板）：沿用那一格，不另垫，也不退
    if (pendingBack) { window.clearTimeout(pendingBack); pendingBack = 0; window.history.replaceState({ ...(window.history.state ?? {}), mSheet: id }, '') }
    else window.history.pushState({ ...(window.history.state ?? {}), mSheet: id }, '')
    const onPop = () => { if (window.history.state?.mSheet !== id) closeRef.current() }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      if (window.history.state?.mSheet !== id) return
      pendingBack = window.setTimeout(() => { pendingBack = 0; if (window.history.state?.mSheet === id) window.history.back() }, 0)
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    panel.current?.querySelector<HTMLElement>(focusInput ? 'input' : 'button')?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return createPortal(
    <div className={['sheet-layer', popover && 'popover', placement === 'dock' && 'dock', form && 'form'].filter(Boolean).join(' ')}>
      <div className="sheet-scrim" onClick={onClose} aria-hidden="true" />
      <section ref={panel} className="sheet" role="dialog" aria-label={title}
        style={popover && pos ? pos : undefined}>
        <div className="sheet-head">
          <h3 className="sheet-title">{title}</h3>
          {label && <span className="mono-label">{label}</span>}
        </div>
        {children}
      </section>
    </div>,
    document.body,
  )
}

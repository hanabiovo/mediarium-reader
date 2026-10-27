// 信息流一行的手势：右滑、左滑、长按。
// - 横向拖过 84px 松手才算数，越过时（安卓）轻震一下；没拖够就弹回。
// - 从屏幕左边 24px 以内起手的不算：那是 iPhone 的右滑返回区。
// - 竖向先动就交给页面滚动，不抢。
// - 按住 500ms 不动算长按；电脑上右键也算。长按或拖动之后的那一下点击作废，免得误开文章。
import { useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

export const SWIPE_AT = 84
const EDGE = 24
const SLOP = 8
const HOLD_MS = 500

type Handlers = { onRight: () => void; onLeft: () => void; onHold: () => void }
const buzz = () => { try { navigator.vibrate?.(10) } catch { /* 不支持就算了 */ } }

export function useSwipeRow({ onRight, onLeft, onHold }: Handlers) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const g = useRef({ x: 0, y: 0, id: -1, mode: '' as '' | 'h' | 'v' | 'off', timer: 0, armed: false, swallow: false, dir: 0 })

  const clearHold = () => { window.clearTimeout(g.current.timer); g.current.timer = 0 }

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const s = g.current
    s.x = e.clientX; s.y = e.clientY; s.id = e.pointerId; s.armed = false; s.swallow = false
    s.mode = e.clientX < EDGE ? 'off' : ''
    if (s.mode === 'off') return
    clearHold()
    s.timer = window.setTimeout(() => { s.mode = 'off'; s.swallow = true; buzz(); onHold() }, HOLD_MS)
  }

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const s = g.current
    if (e.pointerId !== s.id || s.mode === 'off' || s.mode === 'v') return
    const mx = e.clientX - s.x, my = e.clientY - s.y
    if (s.mode === '') {
      if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return
      clearHold()
      if (Math.abs(mx) > Math.abs(my)) {
        s.mode = 'h'; setDragging(true)
        e.currentTarget.setPointerCapture(e.pointerId)
      } else { s.mode = 'v'; return }
    }
    // 拖过门槛以后加阻尼，手感像拉橡皮筋
    const d = Math.abs(mx) <= SWIPE_AT ? mx : Math.sign(mx) * (SWIPE_AT + (Math.abs(mx) - SWIPE_AT) * 0.35)
    const past = Math.abs(mx) >= SWIPE_AT
    if (past && !s.armed) buzz()
    s.armed = past
    s.dir = Math.sign(mx)
    setDx(d)
  }

  const end = () => {
    const s = g.current
    clearHold()
    if (s.mode === 'h') {
      s.swallow = true
      if (s.armed) (s.dir > 0 ? onRight : onLeft)()
    }
    s.mode = ''; s.armed = false; s.id = -1
    setDragging(false); setDx(0)
  }

  const onClickCapture = (e: MouseEvent) => {
    if (g.current.swallow) { e.preventDefault(); e.stopPropagation(); g.current.swallow = false }
  }
  const onContextMenu = (e: MouseEvent) => { e.preventDefault(); clearHold(); g.current.mode = 'off'; onHold() }

  return {
    dx, dragging,
    bind: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture, onContextMenu },
  }
}

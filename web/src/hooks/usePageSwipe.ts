// 左右滑动翻页（杂志目录）：手指往右滑 = 回到左边那一天（更早），往左滑 = 右边那一天（更新），
// 和日历一样：日期从左往右排（2026-10-20 Hana 定）。
// 和返回手势不撞：从屏幕左右边缘 24px 以内起手的不算（那是 iPhone / 安卓的返回区）；
// 竖向先动就交给页面滚动；横向拖过 60px 松手才翻，没拖够就弹回。翻过之后那一下点击作废，免得误开文章。
import { useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

const EDGE = 24
const SLOP = 8
const TURN_AT = 60

// onLeft：手指往左滑时；onRight：手指往右滑时
export function usePageSwipe(onLeft: (() => void) | null, onRight: (() => void) | null) {
  const [dx, setDx] = useState(0)
  const [dragging, setDragging] = useState(false)
  const s = useRef({ x: 0, y: 0, id: -1, mode: '' as '' | 'h' | 'v' | 'off', swallow: false, dx: 0 })

  const onPointerDown = (e: PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'mouse') return   // 电脑上用翻页条，不拖
    const r = s.current
    r.x = e.clientX; r.y = e.clientY; r.id = e.pointerId; r.swallow = false
    r.mode = e.clientX < EDGE || e.clientX > window.innerWidth - EDGE ? 'off' : ''
  }
  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    const r = s.current
    if (e.pointerId !== r.id || r.mode === 'off' || r.mode === 'v') return
    const mx = e.clientX - r.x, my = e.clientY - r.y
    if (r.mode === '') {
      if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return
      if (Math.abs(mx) > Math.abs(my)) { r.mode = 'h'; setDragging(true); e.currentTarget.setPointerCapture(e.pointerId) }
      else { r.mode = 'v'; return }
    }
    // 没有可翻的方向时只给一点阻力感
    const can = mx < 0 ? !!onLeft : !!onRight
    r.dx = mx
    setDx(can ? mx * 0.5 : mx * 0.15)
  }
  const end = () => {
    const r = s.current
    if (r.mode === 'h') {
      r.swallow = true
      // 按手指实际划过的距离判断（不看画面上带阻尼的位移）
      if (r.dx <= -TURN_AT && onLeft) onLeft()
      else if (r.dx >= TURN_AT && onRight) onRight()
    }
    r.mode = ''; r.id = -1; r.dx = 0
    setDragging(false); setDx(0)
  }
  const onClickCapture = (e: MouseEvent) => {
    if (s.current.swallow) { e.preventDefault(); e.stopPropagation(); s.current.swallow = false }
  }
  return {
    style: { transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : 'transform 0.2s ease-out' },
    bind: { onPointerDown, onPointerMove, onPointerUp: end, onPointerCancel: end, onClickCapture },
  }
}

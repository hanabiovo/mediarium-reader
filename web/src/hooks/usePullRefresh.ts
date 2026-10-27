// 信息流自己的下拉刷新（2026-10-20 Hana 定）：只认手指，只在列表滚到顶时起作用。
// 往下拉时刊头和列表带阻尼往下走，顶栏不动，右上角的刷新键跟着手指转；
// 拉够 PULL_AT（转满一圈）松手就刷新：列表停在半路，缝里露出俯冲的鸟，刷新键原地转，刷完再弹回去。没拉够松手直接弹回。
// 横向先动（滑动标记已读）或往上先动（正常滚动）都不管。浏览器自带的下拉刷新已在 base.css 里关掉。
import { useEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

const SLOP = 8
const PULL_AT = 64     // 画面上拉开这么多算拉够
const HOLD = 44        // 刷新时列表停的位置
const MAX = 110

export function usePullRefresh(el: RefObject<HTMLElement | null>, enabled: boolean, refreshing: boolean, onRefresh: () => void) {
  const [pull, setPull] = useState(0)
  const [dragging, setDragging] = useState(false)
  const [mine, setMine] = useState(false)    // 这次刷新是不是下拉触发的（按钮触发的不挪列表）
  const live = useRef({ enabled, onRefresh })
  live.current = { enabled, onRefresh }

  useEffect(() => {
    const node = el.current
    if (!node) return
    const s = { x: 0, y: 0, mode: '' as '' | 'pull' | 'off', d: 0, armed: false }
    const start = (e: TouchEvent) => {
      s.mode = !live.current.enabled || e.touches.length > 1 || window.scrollY > 0 ? 'off' : ''
      s.x = e.touches[0].clientX; s.y = e.touches[0].clientY; s.d = 0; s.armed = false
    }
    const move = (e: TouchEvent) => {
      if (s.mode === 'off') return
      const mx = e.touches[0].clientX - s.x, my = e.touches[0].clientY - s.y
      if (s.mode === '') {
        if (Math.abs(mx) < SLOP && Math.abs(my) < SLOP) return
        if (my <= 0 || Math.abs(mx) > Math.abs(my) || window.scrollY > 0) { s.mode = 'off'; return }
        s.mode = 'pull'; setDragging(true)
      }
      if (e.cancelable) e.preventDefault()
      // 越拉越沉
      s.d = Math.min(MAX, Math.max(0, my - SLOP) * 0.5)
      const armed = s.d >= PULL_AT
      if (armed && !s.armed) { try { navigator.vibrate?.(10) } catch { /* 无 */ } }
      s.armed = armed
      setPull(s.d)
    }
    const end = () => {
      if (s.mode === 'pull') {
        setDragging(false)
        if (s.armed) { setMine(true); live.current.onRefresh() }
        setPull(0)
      }
      s.mode = ''
    }
    node.addEventListener('touchstart', start, { passive: true })
    node.addEventListener('touchmove', move, { passive: false })
    node.addEventListener('touchend', end)
    node.addEventListener('touchcancel', end)
    return () => {
      node.removeEventListener('touchstart', start)
      node.removeEventListener('touchmove', move)
      node.removeEventListener('touchend', end)
      node.removeEventListener('touchcancel', end)
    }
  }, [el])

  // 点刷新键也让出那道缝放鸟（2026-10-21 Hana 提），但只在列表在顶上时，免得滚到半路整页一跳
  useEffect(() => {
    if (!refreshing) setMine(false)
    else if (live.current.enabled && window.scrollY === 0) setMine(true)
  }, [refreshing])

  const holding = mine && refreshing
  const offset = dragging ? pull : holding ? HOLD : 0
  return {
    offset, dragging,
    // 刷新键转多少度：拉够正好一整圈，刷新时交给 CSS 的转圈
    turn: dragging ? Math.min(1, pull / PULL_AT) * 360 : 0,
  }
}

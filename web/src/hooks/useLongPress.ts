// 长按（报刊架上的封面、列表行，管理页的行）：按住 500ms 不动算长按，电脑上右键也算。
// 防误触：手指一动（超过 8px，比如在滚动）就作废；长按之后那一下点击作废，不会顺手打开刊物。
// 手感：按住 150ms 后先给一个「按下去」的样子（pressing），到点时（安卓）轻震。iPhone 浏览器不支持震动，只有视觉反馈。
import { useRef, useState } from 'react'
import type { MouseEvent, PointerEvent } from 'react'

const HOLD_MS = 500
const PRESS_MS = 150
const SLOP = 8

export function useLongPress(onHold: () => void) {
  const [pressing, setPressing] = useState(false)
  const s = useRef({ x: 0, y: 0, hold: 0, press: 0, swallow: false })

  const cancel = () => {
    window.clearTimeout(s.current.hold); window.clearTimeout(s.current.press)
    setPressing(false)
  }
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const r = s.current
    r.x = e.clientX; r.y = e.clientY; r.swallow = false
    cancel()
    r.press = window.setTimeout(() => setPressing(true), PRESS_MS)
    r.hold = window.setTimeout(() => {
      setPressing(false); r.swallow = true
      try { navigator.vibrate?.(10) } catch { /* 不支持 */ }
      onHold()
    }, HOLD_MS)
  }
  const onPointerMove = (e: PointerEvent) => {
    if (Math.abs(e.clientX - s.current.x) > SLOP || Math.abs(e.clientY - s.current.y) > SLOP) cancel()
  }
  const onClickCapture = (e: MouseEvent) => {
    if (s.current.swallow) { e.preventDefault(); e.stopPropagation(); s.current.swallow = false }
  }
  const onContextMenu = (e: MouseEvent) => { e.preventDefault(); cancel(); onHold() }

  return {
    pressing,
    bind: { onPointerDown, onPointerMove, onPointerUp: cancel, onPointerCancel: cancel, onPointerLeave: cancel, onClickCapture, onContextMenu },
  }
}

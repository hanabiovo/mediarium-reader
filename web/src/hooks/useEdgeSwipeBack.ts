// iPhone 装到桌面后没有系统返回手势，这里补一个「从左边缘右滑返回」。
// 安卓有系统返回手势，不启用，免得两套手势打架。
// 0.27.3（2026-10-24 Hana 测出）：新一些的 iOS 装到桌面后自己也会右滑返回，两边各退一步，就多退了一层。
// 现在手势松开后等一下：这期间系统已经退过了（地址变了），就不再退

import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'

const EDGE = 24      // 起手要在屏幕左边 24px 以内
const TRIGGER = 80   // 横向滑过 80px 才算返回
// 只认 navigator.standalone：这是 iOS 上「从主屏幕打开」独有的标记。
// 0.27.4（2026-10-24 Hana 测出）：原来还认 display-mode: standalone，iPhone 上的 Chrome 在浏览器里也会被当成装到桌面，
// 它自己有右滑返回，再加上这里补的一下，就退了两步（Safari 没事）
const isIOSStandalone = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) && !/CriOS|FxiOS|EdgiOS|OPiOS/.test(navigator.userAgent) &&
  (navigator as unknown as { standalone?: boolean }).standalone === true

export function useEdgeSwipeBack(enabled: boolean) {
  const navigate = useNavigate()
  useEffect(() => {
    if (!enabled || !isIOSStandalone()) return
    let startX = 0, startY = 0, tracking = false, popped = false, timer = 0
    const onPop = () => { popped = true }
    const onStart = (e: TouchEvent) => {
      popped = false
      const t = e.touches[0]
      tracking = t.clientX <= EDGE
      startX = t.clientX; startY = t.clientY
    }
    const onEnd = (e: TouchEvent) => {
      if (!tracking) return
      tracking = false
      const t = e.changedTouches[0]
      const dx = t.clientX - startX, dy = Math.abs(t.clientY - startY)
      if (!(dx > TRIGGER && dy < dx * 0.6)) return
      const at = location.href
      clearTimeout(timer)
      timer = window.setTimeout(() => { if (!popped && location.href === at) navigate(-1) }, 400)
    }
    const onCancel = () => { tracking = false }
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchend', onEnd, { passive: true })
    window.addEventListener('touchcancel', onCancel, { passive: true })
    window.addEventListener('popstate', onPop)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('touchcancel', onCancel)
      window.removeEventListener('popstate', onPop)
      window.removeEventListener('touchstart', onStart)
      window.removeEventListener('touchend', onEnd)
    }
  }, [enabled, navigate])
}

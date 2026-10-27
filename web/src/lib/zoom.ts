// 整页不缩放（2026-10-23 Hana 定）：灵媒当 App 用，双指缩放、双击放大、点输入框自动放大都关掉。
//   · viewport 写了 maximum-scale=1, user-scalable=no：安卓照办；iPhone 的 Safari 为了无障碍不认这句，
//     但 maximum-scale=1 能止住「点输入框自动放大」
//   · iPhone 的双指缩放：拦 gesturestart / gesturechange（Safari 专有的手势事件）和两指 touchmove
//   · 双击放大：base.css 里 html { touch-action: manipulation }
//   · 看图要放大：点图打开查看器（components/ImageViewer.tsx），在那里面自己缩放
export function noPageZoom() {
  const stop = (e: Event) => e.preventDefault()
  document.addEventListener('gesturestart', stop, { passive: false })
  document.addEventListener('gesturechange', stop, { passive: false })
  document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault() }, { passive: false })
}

// 看图（2026-10-23 Hana 定，仿普通 SNS）：点正文里的图，黑底全屏打开。
//   · 双指缩放、双击放大 / 还原、放大后拖着看；电脑上滚轮缩放
//   · 没放大时：左右滑换这篇里的别的图，往下滑关；单击关（等一下，看是不是双击）
//   · 顶上：关闭、「2 / 5」、保存（手机弹系统分享菜单，里面有「存储图像」；电脑直接下载）、图本身带链接时「打开链接」
//   · 底下：图注
//   · 整页的缩放是关掉的（lib/zoom.ts），这里的缩放是自己算的
// 0.30.4（2026-10-27 Hana：看图时老是误划退出整篇文章，伸手去点关闭又麻烦）：
//   · 打开时在历史里垫一格（同 Sheet）：系统返回手势、返回键只关看图，回到文章
//   · 点图外的空白处立刻关；点图本身仍等一下看是不是双击
//   · 下滑关的门槛放低，快速往下一甩也算；首尾两张再往外划有阻力
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { fetchImage } from '../lib/scribe'
import { deliver } from '../lib/exporter'
import { toast, toastError } from './Toast'

export type ViewImage = { src: string; caption: string; href?: string }

const MAX = 5
const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/avif': 'avif', 'image/svg+xml': 'svg' }

function fileName(src: string, type: string) {
  const ext = EXT[type] ?? 'jpg'
  let base = ''
  try { base = decodeURIComponent(new URL(src).pathname.split('/').pop() ?? '').replace(/\.[a-z0-9]{2,5}$/i, '') } catch { /* 无 */ }
  if (!/^[\w一-鿿.-]{1,60}$/.test(base)) base = `灵媒图片 ${new Date().toISOString().slice(0, 10)}`
  return `${base}.${ext}`
}

export function ImageViewer({ images, start, onClose }: { images: ViewImage[]; start: number; onClose: () => void }) {
  const [at, setAt] = useState(start)
  const [z, setZ] = useState({ s: 1, x: 0, y: 0 })          // 缩放、平移
  const [drag, setDrag] = useState({ x: 0, y: 0 })          // 没放大时的滑动（换图 / 下滑关）
  const [anim, setAnim] = useState(false)
  const [saving, setSaving] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const pts = useRef(new Map<number, { x: number; y: number }>())
  const g = useRef<{ dist?: number; s0?: number; x0?: number; y0?: number; cx?: number; cy?: number; sx: number; sy: number; moved: boolean; t: number } | null>(null)
  const lastTap = useRef(0)
  const tapTimer = useRef<number | undefined>(undefined)
  const img = images[at]
  const imgEl = useRef<HTMLImageElement>(null)

  // 返回手势 / 返回键先关看图（做法同 components/Sheet.tsx）
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  useEffect(() => {
    const id = Math.random().toString(36).slice(2)
    window.history.pushState({ ...(window.history.state ?? {}), mViewer: id }, '')
    const onPop = () => { if (window.history.state?.mViewer !== id) closeRef.current() }
    window.addEventListener('popstate', onPop)
    return () => {
      window.removeEventListener('popstate', onPop)
      // 用按钮、点空白、下滑关时自己退掉这一格；晚一拍再看，开发模式下效果跑两遍时不误退
      window.setTimeout(() => { if (window.history.state?.mViewer === id) window.history.back() }, 0)
    }
  }, [])

  // 打开时：页面别跟着滚；Esc 关，左右键换图
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') go(-1)
      if (e.key === 'ArrowRight') go(1)
    }
    window.addEventListener('keydown', key)
    return () => { document.body.style.overflow = prev; window.removeEventListener('keydown', key) }
  }) // eslint-disable-line react-hooks/exhaustive-deps
  // 单击关的计时器只在关掉看图时清（原来放在上面那段里，每次重绘都清，点图本身就永远关不掉）
  useEffect(() => () => window.clearTimeout(tapTimer.current), [])

  const reset = () => setZ({ s: 1, x: 0, y: 0 })
  const go = (d: number) => {
    const n = at + d
    if (n < 0 || n >= images.length) return
    setAt(n); reset(); setDrag({ x: 0, y: 0 })
  }
  // 以 (px, py)（相对画面中心）为中心缩放到 s
  const zoomAt = (s: number, px: number, py: number, from = z) => {
    s = Math.min(MAX, Math.max(1, s))
    if (s === 1) return { s: 1, x: 0, y: 0 }
    const k = s / from.s
    return { s, x: px - (px - from.x) * k, y: py - (py - from.y) * k }
  }
  const center = (cx: number, cy: number) => {
    const r = box.current!.getBoundingClientRect()
    return { px: cx - r.left - r.width / 2, py: cy - r.top - r.height / 2 }
  }

  const down = (e: React.PointerEvent) => {
    if ((e.target as HTMLElement).closest('.iv-bar')) return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    setAnim(false)
    const p = [...pts.current.values()]
    if (p.length === 2) {
      const { px, py } = center((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2)
      g.current = { dist: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y), s0: z.s, x0: z.x, y0: z.y, cx: px, cy: py, sx: e.clientX, sy: e.clientY, moved: true, t: Date.now() }
    } else if (p.length === 1) {
      g.current = { x0: z.x, y0: z.y, sx: e.clientX, sy: e.clientY, moved: false, t: Date.now() }
    }
  }
  const move = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId) || !g.current) return
    pts.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    const p = [...pts.current.values()]
    const st = g.current
    if (p.length >= 2 && st.dist) {
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y)
      setZ(zoomAt(st.s0! * (d / st.dist), st.cx!, st.cy!, { s: st.s0!, x: st.x0!, y: st.y0! }))
      return
    }
    const dx = e.clientX - st.sx, dy = e.clientY - st.sy
    if (Math.abs(dx) + Math.abs(dy) > 6) st.moved = true
    if (z.s > 1) setZ((v) => ({ ...v, x: st.x0! + dx, y: st.y0! + dy }))
    else if (Math.abs(dx) > Math.abs(dy)) {
      const edge = (dx > 0 && at === 0) || (dx < 0 && at === images.length - 1)
      setDrag({ x: edge ? dx / 3 : dx, y: 0 })   // 第一张往右、最后一张往左：拉不动多少
    } else setDrag({ x: 0, y: Math.max(0, dy) })
  }
  const up = (e: React.PointerEvent) => {
    if (!pts.current.has(e.pointerId)) return
    pts.current.delete(e.pointerId)
    const st = g.current
    if (pts.current.size > 0) {   // 双指松了一指：剩下那只接着拖
      const [q] = [...pts.current.values()]
      g.current = { x0: z.x, y0: z.y, sx: q.x, sy: q.y, moved: true, t: Date.now() }
      return
    }
    g.current = null
    if (!st) return
    setAnim(true)
    if (z.s > 1) return
    // 没放大：滑动换图 / 下滑关 / 点按
    const fast = Date.now() - st.t < 260
    if (drag.y > 80 || (fast && drag.y > 30)) { onClose(); return }
    if (drag.x < -60) go(1)
    else if (drag.x > 60) go(-1)
    setDrag({ x: 0, y: 0 })
    if (!st.moved && Date.now() - st.t < 300) {
      if (outside(e.clientX, e.clientY)) { window.clearTimeout(tapTimer.current); onClose(); return }
      tap(e.clientX, e.clientY)
    }
  }
  // 点在图外的空白处
  const outside = (cx: number, cy: number) => {
    const r = imgEl.current?.getBoundingClientRect()
    return !r || cx < r.left || cx > r.right || cy < r.top || cy > r.bottom
  }
  // 单击关；双击放大 / 还原
  const tap = (cx: number, cy: number) => {
    const now = Date.now()
    if (now - lastTap.current < 280) {
      window.clearTimeout(tapTimer.current); lastTap.current = 0
      const { px, py } = center(cx, cy)
      setAnim(true); setZ(z.s > 1 ? { s: 1, x: 0, y: 0 } : zoomAt(2.5, px, py))
      return
    }
    lastTap.current = now
    tapTimer.current = window.setTimeout(() => { if (z.s === 1) onClose() }, 280)
  }
  const wheel = (e: React.WheelEvent) => {
    const { px, py } = center(e.clientX, e.clientY)
    setAnim(false); setZ(zoomAt(z.s * (e.deltaY < 0 ? 1.15 : 1 / 1.15), px, py))
  }

  const save = async () => {
    setSaving(true)
    try {
      const blob = await fetchImage(img.src)
      if (!blob) { toast({ text: '这张图取不下来。', kind: 'error', bird: 'puzzled' }); return }
      const r = await deliver(fileName(img.src, blob.type), blob)
      if (r === 'saved') toast('已保存。')
    } catch (e) { toastError(`没存成：${(e as Error).message}`) } finally { setSaving(false) }
  }

  const fade = Math.max(0.35, 1 - drag.y / 400)
  return createPortal(
    <div className="iv" role="dialog" aria-modal="true" aria-label="看图" style={{ background: `rgba(0,0,0,${fade})` }}>
      <div className="iv-bar" onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) onClose() }}>
        <button className="iv-btn" aria-label="关闭" onClick={onClose}>✕</button>
        <span className="iv-count mono-label">{images.length > 1 ? `${at + 1} / ${images.length}` : ''}</span>
        <span className="iv-acts">
          {img.href && <a className="iv-btn" href={img.href} target="_blank" rel="noopener noreferrer">打开链接</a>}
          <button className="iv-btn" onClick={save} disabled={saving}>{saving ? '保存中' : '保存'}</button>
        </span>
      </div>
      <div ref={box} className="iv-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onWheel={wheel}>
        <img ref={imgEl} key={img.src} src={img.src} alt={img.caption} draggable={false} className={anim ? 'iv-img anim' : 'iv-img'}
          style={{ transform: `translate(${z.x + drag.x}px, ${z.y + drag.y}px) scale(${z.s * (drag.y ? 1 - drag.y / 1200 : 1)})` }} />
      </div>
      {img.caption && z.s === 1 && <p className="iv-cap">{img.caption}</p>}
    </div>,
    document.body,
  )
}

// 正文里哪些图能点开看：图标、小图（< 160px，typeset 标了 prose-small）不算
export function viewableImages(root: HTMLElement): HTMLImageElement[] {
  return Array.from(root.querySelectorAll<HTMLImageElement>('img')).filter((i) => !i.classList.contains('prose-small') && !i.closest('.prose-tail'))
}
export function toViewImage(img: HTMLImageElement): ViewImage {
  const cap = img.closest('figure')?.querySelector('figcaption')
  let caption = ''
  if (cap) { const c = cap.cloneNode(true) as HTMLElement; c.querySelectorAll('.prose-tr').forEach((n) => n.remove()); caption = (c.textContent ?? '').replace(/\s+/g, ' ').trim() }
  const a = img.closest('a')
  return { src: img.currentSrc || img.src, caption: caption || '', href: a?.href && !/\.(jpe?g|png|gif|webp|avif)(\?|$)/i.test(a.href) ? a.href : undefined }
}

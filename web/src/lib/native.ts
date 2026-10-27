// 墨水屏 APK（0.29.7，2026-10-26 Hana 定；壳在 android/ 里）。
// 壳在网页标识里加了「MediariumInk/1」，还挂了一个 window.MediariumApp：存文件、写剪贴板（网页框里这两样浏览器办法不灵）。
// 在壳里打开时：
//   · 关掉所有动画（墨水屏上动画只剩残影）
//   · 翻页键（壳把音量键截下来）→ window.__mediariumPage(±1)：整屏翻，留两行重叠，不滚动
//   · 切页面时闪一下黑屏，让墨水屏整屏刷新、清掉残影（外观里能关：费一点电）
//   · 字迹加深：宋体的细横在墨水屏上会被抖成一串点，给字描一道很细的边
import { load, save } from '../api/storage'

type Bridge = { saveFile(name: string, mime: string, b64: string): boolean; copy(text: string): void }
const bridge = (): Bridge | undefined => (window as unknown as { MediariumApp?: Bridge }).MediariumApp

export const ink = typeof navigator !== 'undefined' && /MediariumInk\//.test(navigator.userAgent)

const FLASH_KEY = 'mediarium.inkFlash'
const BOLD_KEY = 'mediarium.inkBold'
export const inkFlashOn = () => load(FLASH_KEY) !== 'off'
export const setInkFlash = (on: boolean) => save(FLASH_KEY, on ? 'on' : 'off')
export const inkBoldOn = () => load(BOLD_KEY) !== 'off'
export const setInkBold = (on: boolean) => { save(BOLD_KEY, on ? 'on' : 'off'); markInk() }

function markInk() {
  const root = document.documentElement
  root.dataset.ink = 'on'
  if (inkBoldOn()) root.dataset.inkBold = 'on'
  else delete root.dataset.inkBold
}

// 文件：交给壳存进「下载」文件夹
export async function nativeSave(name: string, blob: Blob): Promise<boolean> {
  const b = bridge()
  if (!b) return false
  const b64 = await new Promise<string>((ok, bad) => {
    const r = new FileReader()
    r.onload = () => ok(String(r.result).split(',')[1] ?? '')
    r.onerror = () => bad(r.error)
    r.readAsDataURL(blob)
  })
  return b.saveFile(name, blob.type || 'application/octet-stream', b64)
}

// 剪贴板：壳里走壳，别处走浏览器
export async function copyText(text: string) {
  const b = bridge()
  if (b) { b.copy(text); return }
  await navigator.clipboard.writeText(text)
}

// 翻页：屏幕上下贴着的顶栏、底栏不算，剩下的高度翻过去，留两行（约 48px）接上
function covered(el: Element | null): boolean {
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const p = getComputedStyle(n).position
    if (p === 'fixed' || p === 'sticky') return true
  }
  return false
}
function edge(fromTop: boolean): number {
  const x = window.innerWidth / 2, h = window.innerHeight
  for (let d = 0; d < h / 2; d += 8) {
    const y = fromTop ? d : h - 1 - d
    if (!covered(document.elementFromPoint(x, y))) return d
  }
  return 0
}
function page(dir: 1 | -1) {
  const open = document.querySelector<HTMLElement>('.sheet')   // 底部面板开着：翻面板
  if (open && open.scrollHeight > open.clientHeight) { open.scrollBy(0, dir * (open.clientHeight - 48)); return }
  const step = Math.max(200, window.innerHeight - edge(true) - edge(false) - 48)
  window.scrollBy({ top: dir * step, behavior: 'instant' as ScrollBehavior })
}

// 切页面闪黑：盖一层黑，停 120ms 再揭掉（太短的话墨水屏来不及画，等于没闪）
export function inkFlash() {
  if (!ink || !inkFlashOn()) return
  const d = document.createElement('div')
  d.className = 'ink-flash'
  document.body.appendChild(d)
  window.setTimeout(() => d.remove(), 120)
}

export function initInk() {
  if (!ink) return
  markInk()
  ;(window as unknown as { __mediariumPage: (d: number) => void }).__mediariumPage = (d) => page(d > 0 ? 1 : -1)
}

// 轻提示（3e，2026-10-21 定）：同一时间只有一条，新的顶掉旧的。
//   info  —— 提示，约 3 秒自己消失
//   error —— 出错，前面一个危险色小方块，停 6 秒，点一下就收
//   crow  —— 寒鸦说话，前面一只停着的鸟（见 src/lib/crow.ts）
// 可以带一个操作（撤销、重试）。手机在底栏正上方，电脑在左下角
import { useEffect, useState } from 'react'
import { Bird, type BirdName } from './Bird'

export type ToastKind = 'info' | 'error' | 'crow'
export type ToastInput = { text: string; kind?: ToastKind; action?: { label: string; run: () => void }; sticky?: boolean; bird?: BirdName }
// sticky：不自己消失，等下一条顶掉。bird：前面放一只鸦（彩蛋默认是停着的那只）；出错的带了鸦就不再放危险色小方块
type Item = ToastInput & { id: number }

let current: Item | null = null
let seq = 0
const subs = new Set<() => void>()
const emit = () => subs.forEach((f) => f())

export function toast(t: ToastInput | string) {
  current = { ...(typeof t === 'string' ? { text: t } : t), id: ++seq }
  emit()
}
export const toastError = (text: string, action?: ToastInput['action']) => toast({ text, kind: 'error', action })
function dismiss(id: number) { if (current?.id === id) { current = null; emit() } }

export function ToastHost() {
  const [t, setT] = useState<Item | null>(current)
  useEffect(() => { const f = () => setT(current); subs.add(f); return () => { subs.delete(f) } }, [])
  useEffect(() => {
    if (!t || t.sticky) return
    const ms = t.kind === 'error' ? 6000 : t.action ? 5000 : 3200
    const timer = window.setTimeout(() => dismiss(t.id), ms)
    return () => window.clearTimeout(timer)
  }, [t])
  if (!t) return null
  const bird = t.bird ?? (t.kind === 'crow' ? 'perched' : undefined)
  return (
    <div key={t.id} className={['toast', `toast-${t.kind ?? 'info'}`, bird && 'has-bird'].filter(Boolean).join(' ')} role={t.kind === 'error' ? 'alert' : 'status'}
      onClick={() => dismiss(t.id)}>
      {bird && <Bird name={bird} className="toast-bird" />}
      <span className="toast-text">{t.text}</span>
      {t.action && (
        <button className="toast-action" onClick={(e) => { e.stopPropagation(); t.action!.run(); dismiss(t.id) }}>{t.action.label}</button>
      )}
    </div>
  )
}

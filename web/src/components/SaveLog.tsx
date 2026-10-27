// 保存信源的日志浮层（0.29，lib/saveLog.ts）。底部一条，一行一步；做完自己收起，出了问题留着等你点「重试」
import { useEffect } from 'react'
import { closeTask, dropTask, useTasks } from '../lib/saveLog'
import { IconClose } from './Icons'

export function SaveLog() {
  const t = useTasks().filter((x) => !x.closed).at(-1)
  // 顺利做完的：停几秒自己收起
  useEffect(() => {
    if (!t || t.state !== 'done') return
    const timer = window.setTimeout(() => dropTask(t.id), 4000)
    return () => window.clearTimeout(timer)
  }, [t?.id, t?.state]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!t) return null
  const canClose = t.bg || t.state !== 'run'
  return (
    <div className="savelog" role="status" aria-live="polite">
      <div className="savelog-head">
        <span className="mono-label savelog-title">保存《{t.title}》</span>
        {canClose && <button className="savelog-x" onClick={() => (t.state === 'run' ? closeTask(t.id) : dropTask(t.id))} aria-label="关掉"><IconClose size={14} /></button>}
      </div>
      {t.lines.map((l) => (
        <p key={l.id} className={`savelog-line ${l.kind}`}>
          <span>{l.text}</span>
          {l.retry && <button className="savelog-retry" onClick={l.retry}>重试</button>}
        </p>
      ))}
      {t.bg && t.state === 'run' && <p className="savelog-line note">后台继续取，订好了告诉你。</p>}
    </div>
  )
}

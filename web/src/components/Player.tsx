// 播放器的样子（0.27，2026-10-24 Hana 定）。播放本身在 lib/player.ts，全灵媒只有一个。
//   · FloatPlayer：开始播一集以后才出现；右下角一个小方块（播放 / 暂停 + 一道进度），点开是一条：标题、基本按钮、进度
//     关闭只在展开以后有，放在标题那一行最右，离播放按钮远，不容易误触；关掉以后给一次「接着听」
//     正在看播着的那一篇时不出现（文章里有自己的那一条）
//   · AudioControls：按钮 + 进度，悬浮条和文章里共用
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { clockOf, close, cycleRate, play, savedPos, seek, skip, toggle, usePlayer, type Track } from '../lib/player'
import { IconChevronDown, IconClose, IconPause, IconPlay } from './Icons'
import { toast } from './Toast'

export function AudioControls() {
  const s = usePlayer()
  const [drag, setDrag] = useState<number | null>(null)
  const commit = () => { if (drag != null) seek(drag); setDrag(null) }
  const at = drag ?? s.time
  return (
    <div className="pl-controls">
      <input className="pl-range" type="range" min={0} max={s.duration || 1} step={1} value={Math.min(at, s.duration || 1)}
        aria-label="进度" aria-valuetext={clockOf(at)} disabled={!s.duration}
        style={{ '--pl-at': s.duration ? `${(at / s.duration) * 100}%` : '0%' } as React.CSSProperties}
        onChange={(e) => setDrag(Number(e.target.value))} onPointerUp={commit} onKeyUp={commit} onBlur={commit} />
      <div className="pl-row">
        <button className="pl-btn pl-skip" onClick={() => skip(-15)} aria-label="后退 15 秒">−15</button>
        <button className="pl-btn pl-main" onClick={() => toggle()} aria-label={s.playing ? '暂停' : '播放'}>{s.playing ? <IconPause size={16} /> : <IconPlay size={16} />}</button>
        <button className="pl-btn pl-skip" onClick={() => skip(30)} aria-label="前进 30 秒">+30</button>
        <button className="pl-btn pl-rate" onClick={cycleRate} aria-label={`倍速 ${s.rate}`}>{s.rate}×</button>
        <span className="mono-label pl-time">{clockOf(at)}{s.duration ? ` / ${clockOf(s.duration)}` : ''}</span>
      </div>
    </div>
  )
}

// 播着的这一篇在不在眼前（地址末尾是这篇的编号）
const onArticle = (pathname: string, entryId: number) => new RegExp(`^/(shelf/feed/\\d+|stream)/${entryId}$`).test(pathname)

function stop(t: Track) {
  close()
  toast({ text: '关掉了。', action: { label: '接着听', run: () => play(t) } })
}

export function FloatPlayer() {
  const s = usePlayer()
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const t = s.track
  useEffect(() => { if (!t) setOpen(false) }, [t])   // 关掉以后再播，从小方块开始
  if (!t || onArticle(pathname, t.entryId)) return null
  const pct = s.duration ? (s.time / s.duration) * 100 : 0
  if (!open) return (
    <button className={s.playing ? 'pl-float pl-bubble playing' : 'pl-float pl-bubble'} onClick={() => setOpen(true)} aria-label={`正在听：${t.title}，点开播放器`}>
      {s.playing ? <IconPause size={14} /> : <IconPlay size={14} />}
      <span className="pl-bubble-bar" style={{ width: `${pct}%` }} />
    </button>
  )
  return (
    <div className="pl-float pl-bar" role="region" aria-label="播放器">
      <div className="pl-head">
        <button className="pl-title" onClick={() => navigate(t.back)} title={t.title}>
          <span className="mono-label pl-source">{t.source}</span>
          <span className="pl-name">{t.title}</span>
        </button>
        <button className="pl-btn pl-close" onClick={() => stop(t)} aria-label="关掉播放器（停止播放）"><IconClose size={15} /></button>
      </div>
      <AudioControls />
      <button className="pl-btn pl-fold" onClick={() => setOpen(false)} aria-label="收起播放器"><IconChevronDown size={16} /></button>
    </div>
  )
}

// 文章里那一条：这篇在播就是全局的按钮；没在播就一个「播放」，听过的说一声听到哪儿
export function ArticleAudio({ track }: { track: Track }) {
  const s = usePlayer()
  if (s.track?.entryId === track.entryId) return <AudioControls />
  const from = savedPos(track.entryId)
  return (
    <div className="pl-row pl-start">
      <button className="pl-btn pl-main" onClick={() => play(track)} aria-label="播放"><IconPlay size={16} /></button>
      <span className="mono-label pl-time">{from ? `上次听到 ${clockOf(from)}` : '从头听'}</span>
    </div>
  )
}

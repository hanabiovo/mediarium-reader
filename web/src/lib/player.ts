// 全局播放器（0.27，2026-10-24 Hana 定）：全灵媒只有一个，挂在最外层，换页不断。
//   · 只有开始播一集以后才有；暂停时留着；播完自动收起；手动关掉 = 停播 + 撤掉锁屏 / 通知栏的控制
//   · 每集听到哪儿记在这台设备上，下次接着放
//   · 接系统的媒体会话（Media Session）：锁屏、通知栏显示标题和封面，能暂停、快进快退
import { useSyncExternalStore } from 'react'
import { load, save } from '../api/storage'

export type Track = { entryId: number; feedId: number; url: string; title: string; source: string; art?: string; back: string }
export type PlayerState = { track: Track | null; playing: boolean; time: number; duration: number; rate: number; ended: boolean }

const RATES = [1, 1.25, 1.5, 2]
const POS_KEY = 'mediarium.podpos'
const RATE_KEY = 'mediarium.podrate'

let audio: HTMLAudioElement | null = null
let state: PlayerState = { track: null, playing: false, time: 0, duration: 0, rate: Number(load(RATE_KEY)) || 1, ended: false }
const subs = new Set<() => void>()
const emit = (p: Partial<PlayerState>) => { state = { ...state, ...p }; subs.forEach((f) => f()) }

// ——— 听到哪儿（最多记 200 集） ———
type Pos = Record<string, number>
const readPos = (): Pos => { try { return JSON.parse(load(POS_KEY) ?? '{}') } catch { return {} } }
export const savedPos = (entryId: number) => readPos()[entryId] ?? 0
function writePos(entryId: number, t: number, duration: number) {
  const p = readPos()
  if (duration && t > duration - 15) delete p[entryId]   // 快听完了就当听完，下次从头
  else if (t > 5) p[entryId] = Math.floor(t)
  const keys = Object.keys(p)
  if (keys.length > 200) for (const k of keys.slice(0, keys.length - 200)) delete p[k]
  save(POS_KEY, JSON.stringify(p))
}

// 每次开播用一个新的 <audio>；关掉就扔掉。
// iPhone（Safari）上同一个元素清掉地址再接着用，会卡住：进度不走、没声音（2026-10-24 Hana 测出，安卓、电脑都没事）
// 事件里只认自己这个元素，扔掉的旧元素再发什么都不管
function el(): HTMLAudioElement {
  if (audio) return audio
  const a = new Audio()
  audio = a
  a.preload = 'metadata'
  const mine = () => audio === a
  let last = 0
  a.addEventListener('timeupdate', () => {
    if (!mine()) return
    emit({ time: a.currentTime })
    if (state.track && Math.abs(a.currentTime - last) > 5) { last = a.currentTime; writePos(state.track.entryId, last, a.duration) }
  })
  a.addEventListener('durationchange', () => { if (mine()) emit({ duration: Number.isFinite(a.duration) ? a.duration : 0 }) })
  a.addEventListener('play', () => { if (!mine()) return; emit({ playing: true, ended: false }); if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'playing' })
  a.addEventListener('pause', () => {
    if (!mine()) return
    emit({ playing: false })
    if (state.track) writePos(state.track.entryId, a.currentTime, a.duration)
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = 'paused'
  })
  // 播完：记成听完，收起来
  a.addEventListener('ended', () => { if (!mine()) return; if (state.track) writePos(state.track.entryId, a.duration, a.duration); close() })
  return a
}

function session(t: Track) {
  if (!('mediaSession' in navigator)) return
  const ms = navigator.mediaSession
  ms.metadata = new MediaMetadata({ title: t.title, artist: t.source, album: '灵媒', artwork: t.art ? [{ src: t.art, sizes: '512x512' }] : [] })
  const set = (a: MediaSessionAction, h: MediaSessionActionHandler | null) => { try { ms.setActionHandler(a, h) } catch { /* 不支持这个动作 */ } }
  set('play', () => toggle(true))
  set('pause', () => toggle(false))
  set('seekbackward', () => skip(-15))
  set('seekforward', () => skip(30))
  set('seekto', (d) => { if (d.seekTime != null) seek(d.seekTime) })
  set('stop', () => close())
}

// 播一集（at：从第几秒开始；不给就从上次听到的地方）
export function play(t: Track, at?: number) {
  const a = el()
  if (state.track?.entryId !== t.entryId) {
    a.src = t.url
    a.playbackRate = state.rate
    emit({ track: t, time: 0, duration: 0, ended: false })
    const from = at ?? savedPos(t.entryId)
    if (from) {
      emit({ time: from })
      // iPhone 不预先取元数据，要等开播以后才能跳；跳没跳成，开始出声时再补一次
      const go = () => { if (Math.abs(a.currentTime - from) > 2) a.currentTime = from }
      if (a.readyState >= 1) go(); else a.addEventListener('loadedmetadata', go, { once: true })
      a.addEventListener('playing', go, { once: true })
    }
    session(t)
  } else if (at != null) a.currentTime = at
  a.play().catch(() => emit({ playing: false }))
}
export function toggle(on?: boolean) {
  const a = audio
  if (!a || !state.track) return
  const want = on ?? a.paused
  if (want) a.play().catch(() => {}); else a.pause()
}
export function seek(t: number) { if (audio && state.track) audio.currentTime = Math.max(0, Math.min(t, audio.duration || t)) }
export function skip(d: number) { if (audio) seek(audio.currentTime + d) }
export function cycleRate() {
  const next = RATES[(RATES.indexOf(state.rate) + 1) % RATES.length]
  if (audio) audio.playbackRate = next
  save(RATE_KEY, String(next))
  emit({ rate: next })
}
// 关掉：停播、撤掉锁屏控制，什么都不留（听到哪儿照旧记着）
export function close() {
  if (audio) {
    if (state.track) writePos(state.track.entryId, audio.currentTime, audio.duration)
    const a = audio
    audio = null   // 先断开，旧元素停下时发的事件就不算数了
    a.pause(); a.removeAttribute('src'); a.load()
  }
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = null
    navigator.mediaSession.playbackState = 'none'
    for (const a of ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'stop'] as MediaSessionAction[]) { try { navigator.mediaSession.setActionHandler(a, null) } catch { /* 无 */ } }
  }
  emit({ track: null, playing: false, time: 0, duration: 0, ended: false })
}

export function usePlayer(): PlayerState {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => state)
}

// 「12:34」「102:59」「1:02:03」→ 秒
export function parseStamp(s: string): number | null {
  const p = s.split(':').map(Number)
  if (p.some((x) => !Number.isFinite(x))) return null
  if (p.length === 2) return p[1] < 60 ? p[0] * 60 + p[1] : null
  if (p.length === 3) return p[1] < 60 && p[2] < 60 ? p[0] * 3600 + p[1] * 60 + p[2] : null
  return null
}
export const clockOf = (t: number) => {
  if (!Number.isFinite(t) || t < 0) t = 0
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = Math.floor(t % 60)
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

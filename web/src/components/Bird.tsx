// 灵媒的鸟（2026-10-20 Hana 定）：原图在「素材/corvid-ornaments」，这里用的是去掉线条的矢量版。
// 原则：原图里的线和拐角，要么落在界面里真实存在的边上，要么去掉，不悬空当装饰。
// 颜色跟随文字色（currentColor），换配色、深色都不用重画。
//   messenger 送信 —— 正文分隔记号        perched 停驻 —— 文末标记
//   reading 低头读 —— 「都读完了」         peeking 探角 —— 空报刊架（站在空封面上沿）、空页
//   diving 俯冲 —— 读取中                  departing 起飞 —— 读取出错
// 提示条里的六只（0.29.4，2026-10-26 Hana 定，原图在「素材/corvid-emotions」，去掉了烘托气氛的小线）：
//   news 衔信 —— 有新文章        done 衔信跃起 —— 订好了、做完了     oops 冒汗 —— 没做成
//   alert 喊一声 —— 注意一下     puzzled 挠头 —— 认不出、拿不准        rest 打盹 —— 眼不见为净、先不提
import { useEffect, useState, type CSSProperties } from 'react'
import messenger from '../assets/birds/messenger.svg?raw'
import perched from '../assets/birds/perched.svg?raw'
import reading from '../assets/birds/reading.svg?raw'
import peeking from '../assets/birds/peeking.svg?raw'
import diving from '../assets/birds/diving.svg?raw'
import departing from '../assets/birds/departing.svg?raw'
import news from '../assets/birds/news.svg?raw'
import done from '../assets/birds/done.svg?raw'
import oops from '../assets/birds/oops.svg?raw'
import alert from '../assets/birds/alert.svg?raw'
import puzzled from '../assets/birds/puzzled.svg?raw'
import rest from '../assets/birds/rest.svg?raw'

export const BIRDS = { messenger, perched, reading, peeking, diving, departing, news, done, oops, alert, puzzled, rest }
export type BirdName = keyof typeof BIRDS

export function Bird({ name, className, style }: { name: BirdName; className?: string; style?: CSSProperties }) {
  return <span className={['bird', className].filter(Boolean).join(' ')} style={style} aria-hidden="true"
    dangerouslySetInnerHTML={{ __html: BIRDS[name] }} />
}

// 空状态、读取中、出错：鸟 + 一行字
export function BirdNote({ bird, children, action }: { bird: BirdName; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className={`bird-note bird-note-${bird}`} role={bird === 'diving' ? 'status' : undefined}>
      <Bird name={bird} />
      <p>{children}</p>
      {action}
    </div>
  )
}

// 读取中：晚 300ms 才露面。读得快就不出现，免得一闪而过（2026-10-21 Hana 提）；
// 鸟真正露面的地方是手动刷新（下拉、点刷新键），那里本来就要等几秒
export function LoadingNote() {
  const [show, setShow] = useState(false)
  useEffect(() => { const t = setTimeout(() => setShow(true), 300); return () => clearTimeout(t) }, [])
  if (!show) return <div className="bird-note bird-note-wait" role="status" aria-label="读取中" />
  return <BirdNote bird="diving"><span className="mono-label">LOADING</span></BirdNote>
}

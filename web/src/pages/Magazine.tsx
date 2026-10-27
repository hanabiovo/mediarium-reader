// 杂志目录（视觉稿「杂志目录」）：左侧当天日期，右侧当天文章；底部按天翻页。
// 读过的标题和编号变淡；未读编号用强调色。页码只显示第几页（不显示总数，2026-10-20 定）。
// 刊名一块贴顶、日期贴在它下面，滚动时只有文章列表动（2026-10-20 Hana 提出）。
// 手机上左右滑翻页（手指往右 = 前一天，往左 = 后一天，像日历），整页都能划，边缘 24px 留给返回手势。
// 翻页条贴在屏幕底部，不随当天文章多少上下移；最新一天右边是刷新（2026-10-20 Hana 提出）。
import { useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link, useLocation } from 'react-router-dom'
import type { Entry } from '../api/miniflux'
import { IconBack, IconRefresh } from '../components/Icons'
import { useBack } from '../hooks/useDeepNav'
import { usePageSwipe } from '../hooks/usePageSwipe'
import { aliasClass } from '../lib/title'
import { clock, dayLine, dayNumber, monthDay, parseDay } from '../lib/day'
import type { DayData } from './FeedLayout'
import { Bird, BirdNote, LoadingNote } from '../components/Bird'
import { useTitleTr } from '../lib/translate'
import { TitleText } from '../components/TitleText'

const pad = (n: number) => String(n).padStart(2, '0')

type Props = {
  feedId: number; title: string; latin: string; no: number | null
  day: DayData | null; page: number; empty: boolean; error: string
  activeId: number | null
  columns: Map<number, string> | null   // 多栏报刊：每篇带栏目名（阶段 6 第 3 步）
  onPage: (key: string, page: number) => void
  onRefresh: () => void; refreshing: boolean
}

export function Magazine({ feedId, title, latin, no, day, page, empty, error, activeId, columns, onPage, onRefresh, refreshing }: Props) {
  const trTitles = useTitleTr(day?.entries)
  const back = useBack('/shelf', true)
  const date = day ? parseDay(day.key) : null

  // 刊名这一块贴在顶上，滚动时只动文章列表；量出它的高度，左边的日期贴在它下面
  const top = useRef<HTMLDivElement>(null)
  const [topH, setTopH] = useState(0)
  useLayoutEffect(() => {
    const el = top.current
    if (!el) return
    const ro = new ResizeObserver(() => setTopH(el.offsetHeight))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // 手机上左右滑翻页：手指往右 = 前一天（更早的在左边），往左 = 后一天。整页任何地方都能划，不只是标题上
  const swipe = usePageSwipe(
    day?.newer ? () => onPage(day.newer!, Math.max(1, page - 1)) : null,
    day?.older ? () => onPage(day.older!, page + 1) : null,
  )

  return (
    <div className="magazine" style={{ '--mag-top-h': `${topH}px` } as CSSProperties} {...swipe.bind}>
      <div className="mag-top" ref={top}>
        <div className="deep-bar">
          <button className="icon-btn mag-back" aria-label="返回报刊架" onClick={back}><IconBack /></button>
          <span className="mono-label">{no ? `NO. ${pad(no)}` : ''}</span>
        </div>

        <header className="mag-head">
          <h1 className="mag-title">{title}</h1>
          {latin && <span className={aliasClass('mag-latin', latin)}>{latin}</span>}
        </header>
      </div>

      {error && <div className="mag-note"><BirdNote bird="departing">信没送到。{error}</BirdNote></div>}
      {empty && <div className="mag-note"><BirdNote bird="perched">这份刊物还没有文章。</BirdNote></div>}
      {!day && !empty && !error && <div className="mag-note"><LoadingNote /></div>}

      {day && date && (
        <div className="mag-body" style={swipe.style}>
          <div className="mag-date">
            <span className="mag-day">{dayNumber(date)}</span>
            <span className="mono-label">{dayLine(date)}</span>
          </div>
          <ol className="mag-list">
            {day.entries.map((e, i) => (
              <li key={e.id}><EntryRow entry={e} zh={trTitles[e.id]} no={i + 1} feedId={feedId} active={e.id === activeId} column={columns?.get(e.feed_id)} /></li>
            ))}
          </ol>
        </div>
      )}

      {day && (
        <nav className="mag-pager" aria-label="按日期翻页">
          <button disabled={!day.older} onClick={() => day.older && onPage(day.older, page + 1)}>
            ‹ {day.older ? monthDay(parseDay(day.older)!) : ''}
          </button>
          <span className="mono-label">{pad(page)}</span>
          {day.newer
            ? <button onClick={() => onPage(day.newer!, Math.max(1, page - 1))}>{monthDay(parseDay(day.newer)!)} ›</button>
            : (
              // 最新的一天没有「下一天」：这里换成刷新
              <button className={refreshing ? 'mag-refresh spinning' : 'mag-refresh'} aria-label="刷新" title="刷新"
                onClick={onRefresh} disabled={refreshing}>{refreshing ? <Bird name="diving" className="mag-refresh-bird" /> : <IconRefresh />}</button>
            )}
        </nav>
      )}
    </div>
  )
}

function EntryRow({ entry, zh, no, feedId, active, column }: { entry: Entry; zh?: string; no: number; feedId: number; active: boolean; column?: string }) {
  const { search, state } = useLocation()
  const read = entry.status === 'read'
  // 「01　14:40 · 私家历史 · 2 MIN」
  const meta = [clock(new Date(entry.published_at)), column ?? '', entry.reading_time ? `${entry.reading_time} MIN` : '', read ? '已读' : '']
    .filter(Boolean).join(' · ')
  // 宽屏上在两篇文章之间切换时替换历史，返回键直接回报刊架
  const replacing = (state as { depth?: number } | null)?.depth === 2
  return (
    <Link to={{ pathname: `/shelf/feed/${feedId}/${entry.id}`, search }} replace={replacing}
      state={{ depth: 2 }} className={['mag-entry', read && 'read', active && 'active'].filter(Boolean).join(' ')}
      aria-current={active ? 'page' : undefined}>
      <TitleText className="mag-entry-title" title={entry.title} zh={zh} />
      <span className="mag-entry-meta"><span className="mag-entry-no">{pad(no)}</span>　{meta}</span>
    </Link>
  )
}

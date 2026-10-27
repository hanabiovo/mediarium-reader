// 一份刊物：杂志目录 +（选中时）文章。
// 手机和中屏：一次只显示一页，进文章时目录藏起来但不卸载，返回时不重新加载、回到原来的位置。
// 1024px 以上：左目录、右文章并排（视觉稿「宽屏三栏」，边注栏在 3d 排版模块里做）。
// 分页按天：网址里带 ?d=2026-10-19&p=1，返回时停在同一天。
// 阶段 6 第 3 步（2026-10-24）：网址里的源属于一份多栏报刊时，整份报刊的栏目一起混排（按时间），每篇带栏目名。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Outlet, useLocation, useParams, useSearchParams } from 'react-router-dom'
import { api, type Entry } from '../api/miniflux'
import { visible } from '../api/meta'
import { paperNumber, usePapers } from '../lib/papers'
import { dayKey, dayRange } from '../lib/day'
import { Magazine } from './Magazine'
import type { ReaderContext } from './Article'
import { toast, toastError } from '../components/Toast'

export type DayData = { key: string; entries: Entry[]; older: string | null; newer: string | null }

// 看过的日子留在内存里，来回翻页、进出文章都不重复请求
const days = new Map<string, DayData>()

// 一天：几个栏目各取一遍再合起来，新的在前；前一天取各栏最近的那天，后一天同理
async function loadDay(ids: number[], key: string): Promise<DayData> {
  const [start, end] = dayRange(key)
  const per = await Promise.all(ids.map((id) => Promise.all([
    api.feedEntries(id, { published_after: start - 1, published_before: end }),
    api.feedEntries(id, { published_before: start, limit: 1 }),
    api.feedEntries(id, { published_after: end - 1, limit: 1, direction: 'asc' }),
  ])))
  const t = (e: Entry) => Date.parse(e.published_at)
  const entries = per.flatMap(([l]) => l.entries).sort((a, b) => t(b) - t(a))
  const olders = per.map(([, o]) => o.entries[0]).filter(Boolean) as Entry[]
  const newers = per.map(([, , n]) => n.entries[0]).filter(Boolean) as Entry[]
  const older = olders.sort((a, b) => t(b) - t(a))[0], newer = newers.sort((a, b) => t(a) - t(b))[0]
  const near = (e?: Entry) => (e ? dayKey(new Date(e.published_at)) : null)
  return { key, entries: await visible(entries), older: near(older), newer: near(newer) }
}
async function latestOf(ids: number[]): Promise<Entry | undefined> {
  const r = await Promise.all(ids.map((id) => api.feedEntries(id, { limit: 1 })))
  return r.map((x) => x.entries[0]).filter(Boolean).sort((a, b) => Date.parse(b.published_at) - Date.parse(a.published_at))[0]
}

export function FeedLayout() {
  const { fid, eid } = useParams()
  const feedId = Number(fid)
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const d = params.get('d')
  const page = Math.max(1, Number(params.get('p')) || 1)

  const idx = usePapers()
  const paper = idx.byFeed.get(feedId)
  const ids = paper ? paper.feeds.map((f) => f.id) : [feedId]
  const group = ids.join(',')   // 缓存、重新加载都按这一组源
  const [day, setDay] = useState<DayData | null>(() => (d ? days.get(`${group}:${d}`) ?? null : null))
  const [empty, setEmpty] = useState(false)
  const [error, setError] = useState('')


  // 没指定哪天：先找最新一篇在哪天，那天就是第 1 页
  useEffect(() => {
    if (d || !idx.data) return   // 等报刊架读到，才知道这份报刊有哪几栏
    latestOf(ids).then((latest) => {
      if (!latest) { setEmpty(true); return }
      setParams({ d: dayKey(new Date(latest.published_at)), p: '1' }, { replace: true, state: location.state })
    }).catch((e) => setError(String(e.message)))
  }, [group, d, !!idx.data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!d || !idx.data) return
    const k = `${group}:${d}`
    const hit = days.get(k)
    if (hit) { setDay(hit); return }
    setDay(null)
    let alive = true
    loadDay(ids, d).then((data) => { days.set(k, data); if (alive) setDay(data) })
      .catch((e) => alive && setError(String(e.message)))
    return () => { alive = false }
  }, [group, d, !!idx.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // 刷新（最新一页的翻页条右边）：让 Miniflux 马上去源站抓一次，稍等后重新读；有了更新的一天就跳过去
  const [refreshing, setRefreshing] = useState(false)
  const refresh = async () => {
    if (refreshing) return
    setRefreshing(true); setError('')
    const before = day ? Math.max(0, ...day.entries.map((x) => x.id)) : 0
    let failed = false
    try {
      await Promise.all(ids.map((id) => api.refreshFeed(id).catch(() => { failed = true })))
      await new Promise((r) => setTimeout(r, 3000))   // Miniflux 在后台抓，给它一点时间
      for (const k of [...days.keys()]) if (k.startsWith(`${group}:`)) days.delete(k)
      const latest = await latestOf(ids)
      if (!latest) { setEmpty(true); return }
      const key = dayKey(new Date(latest.published_at))
      const data = await loadDay(ids, key)
      days.set(`${group}:${key}`, data)
      setDay(data)
      if (key !== d) setParams({ d: key, p: '1' }, { replace: true, state: location.state })
      if (failed) toastError(ids.length > 1 ? '有栏目没能刷新。' : '没能刷新这个源。', { label: '重试', run: refresh })
      else toast(latest.id > before ? { text: '有新文章。', bird: 'news' } : '没有新文章。')
    } catch (e) { toastError(`刷新没成功：${(e as Error).message}`, { label: '重试', run: refresh }) }
    finally { setRefreshing(false) }
  }

  const goDay = (key: string, p: number) => {
    setParams({ d: key, p: String(p) }, { replace: true, state: location.state })
    window.scrollTo(0, 0)
  }

  // 改一篇文章的状态（已读、收藏），目录和缓存一起更新
  const patch = useCallback((id: number, change: Partial<Entry>) => {
    setDay((cur) => {
      if (!cur) return cur
      const next = { ...cur, entries: cur.entries.map((e) => (e.id === id ? { ...e, ...change } : e)) }
      days.set(`${group}:${cur.key}`, next)
      return next
    })
  }, [group])

  // 手机上进出文章：记住目录滚到哪了，进文章回到顶部，返回时恢复
  useLayoutEffect(() => { window.scrollTo(0, 0) }, [feedId]) // 从报刊架进来，从顶部开始
  const savedY = useRef(0)
  const prevEid = useRef(eid)
  useLayoutEffect(() => {
    if (eid && !prevEid.current) { savedY.current = window.scrollY; window.scrollTo(0, 0) }
    else if (!eid && prevEid.current) window.scrollTo(0, savedY.current)
    else if (eid && eid !== prevEid.current) window.scrollTo(0, 0)
    prevEid.current = eid
  }, [eid])

  const title = paper?.name ?? ''
  const no = paper ? paperNumber(idx, paper) : null
  const columns = paper && paper.feeds.length > 1 ? paper.columns : null

  useEffect(() => { if (!eid && title) document.title = title }, [eid, title])

  const ctx: ReaderContext = { backPath: `/shelf/feed/${feedId}`, sourceTitle: title, entries: day?.entries ?? [], patch, numbered: true }

  return (
    <div className={eid ? 'feed-layout has-article' : 'feed-layout'}>
      <div className="magazine-pane">
        <Magazine feedId={feedId} title={title} latin={paper?.latin ?? ''} no={no} day={day} page={page} columns={columns}
          empty={empty} error={error} activeId={eid ? Number(eid) : null} onPage={goDay}
          onRefresh={refresh} refreshing={refreshing} />
      </div>
      <div className="article-pane">
        <Outlet context={ctx} />
      </div>
    </div>
  )
}

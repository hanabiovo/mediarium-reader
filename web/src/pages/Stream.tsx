// 信息流（视觉稿「信息流 · 右滑已读」）：全部信源的文章按时间排。
// 筛选：未读（带未读数，全应用只有这里显示未读数）/ 全部 / 收藏；记在网址里（?f=all、?f=starred）。
// 手势：右滑 = 已读（已读的再右滑 = 改回未读），左滑 = 收藏 / 取消收藏，长按 = 底部菜单。
// 1024px 以上点开文章：左列表、右文章并排；手机上整页进文章，返回时回到原位。
// 页头：顶栏（刷新、菜单）贴顶；往下滚时大日期和「信息流」一起缩小，收成顶栏下的一行；筛选栏、时间轴照旧贴顶，只滚文章列表（2026-10-20 Hana 定）。
// 时间轴：按天分组，每天一条日期栏（只有日期，不用线），滚动时当天的日期栏贴在顶上，下一天的把它顶上去。
// 两种形式：列表 / 卡片（视觉稿「卡片 B · 色块」：不放图，比底色略浅的色块托出卡片，带分类符号），
// 在右上角「···」菜单里切换，记在本机。
// 刷新：右上角圆箭头，让 Miniflux 马上把所有源抓一遍，稍等后重新读列表和未读数。
// 手机上还能下拉刷新：列表滚到顶时往下拉，刷新键跟着转，转满一圈松手就刷（2026-10-20 Hana 定，见 usePullRefresh）。
// 一键已读：长按「未读」标签 → 数字往左藏到字后面、「未读」变「已读」→ 底部弹窗确认。
// 0.28（2026-10-26 Hana 定，草图：草图/信息流分类 草图 v1.html）：
//   · 筛选：未读 / 全部 / 收藏；长按「收藏」换成「不看的」（再长按或点它回到收藏）。「稍后读」试了一版，0.28.1 下架（Hana：太鸡肋）
//   · 类别：第二排按报刊架的类别分着刷；每个类别都配了符号、互不重复时只放符号（B），否则字签（A）
//   · 滚过即已读：只在「未读」里，滚出上沿只变灰；离开信息流（切页、换筛选、换类别、刷新）才报给 Miniflux、灰的清掉；
//     切到后台先报一次但不清；点开文章再回来不算离开。设置 → 外观里能关
//   · 手势：右滑 = 不爱看（「不看的」里右滑 = 放回来），左滑 = 收藏；长按出菜单
//   · 点来源名：打开那本报刊的杂志目录，停在这篇那一天
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as RPointerEvent } from 'react'
import { Link, Outlet, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ApiError, api, cachedShelf, loadShelf, type Entry, type EntryQuery } from '../api/miniflux'
import { load, save } from '../api/storage'
import { IconCards, IconList, IconRefresh } from '../components/Icons'
import { CategoryIcon } from '../components/CategoryIcon'
import { categoryIcon, categoryName, currentMeta, loadMeta, orderedCategories, updateMeta, useMeta, visible } from '../api/meta'
import { PageHeader } from '../components/PageHeader'
import { Sheet } from '../components/Sheet'
import { SWIPE_AT, useSwipeRow } from '../hooks/useSwipeRow'
import { usePullRefresh } from '../hooks/usePullRefresh'
import { clock, dayKey, dayShort, parseDay } from '../lib/day'
import { autoReadOn, isMuted, mute, mutedOf, unmute } from '../lib/attention'
import { LINES, say } from '../lib/crow'
import { useShelf } from '../hooks/useShelf'
import { summaryOf } from '../lib/summary'
import type { ReaderContext } from './Article'
import { Bird, BirdNote, LoadingNote } from '../components/Bird'
import { markReady } from '../components/Welcome'
import { toast, toastError } from '../components/Toast'
import { ShareSheet } from '../components/ShareSheet'
import { originOf } from '../lib/exporter'
import { typeset } from '../typo/typeset'
import { useTitleTr } from '../lib/translate'
import { TitleText } from '../components/TitleText'
import { sourceOf, usePapers } from '../lib/papers'

type Filter = 'unread' | 'all' | 'starred' | 'muted'
type View = 'list' | 'cards'
const VIEW_KEY = 'mediarium.streamView'
type List = { items: Entry[]; done: boolean; next?: number }
const PAGE = 30
const FILTERS: [Filter, string][] = [['unread', '未读'], ['all', '全部'], ['starred', '收藏']]
const EMPTY: Record<Filter, string> = { unread: '都读完了。', all: '还没有文章。', starred: '还没有收藏。', muted: '没有不看的。' }
const ALL_FILTERS: Filter[] = ['unread', 'all', 'starred', 'muted']


// 列表已按发布时间倒序，相邻的同一天归为一组
function byDay(items: Entry[]): [string, Entry[]][] {
  const out: [string, Entry[]][] = []
  for (const e of items) {
    const k = dayKey(new Date(e.published_at))
    if (out.length && out[out.length - 1][0] === k) out[out.length - 1][1].push(e)
    else out.push([k, [e]])
  }
  return out
}
const dayBar = (key: string) => dayShort(parseDay(key)!)

// 「不进信息流」的源：未读、全部里都不出现，未读数也不算（0.27.6，2026-10-26 Hana 测出痛いニュース照样刷进来）。
// 收藏是自己点的，照常都在
const query = (f: Filter, c?: number): EntryQuery =>
  f === 'unread' ? { status: ['unread'], visible: true, category: c } : f === 'starred' ? { starred: true, category: c } : { visible: true, category: c }

// 各筛选（× 类别）的列表留在内存里，切标签、进出文章都不重新从头加载
const lists = new Map<string, List>()
const keyOf = (f: Filter, c?: number) => `${f}|${c ?? 0}`
// 每个源的未读数（Miniflux 的 counters），本地改状态时跟着加减
let counters: Record<string, number> | null = null
// 滚过即已读：灰了的（离开时从「未读」里清掉）、还没报给 Miniflux 的
const greyed = new Set<number>()
const pending = new Set<number>()
const unseenNew = new Set<number>()   // 点刷新键插进来、还没在屏幕上露过脸的（滚过即已读先不算它们）
// 服务器给的未读数，减去本地已经灰了、还没报上去的（不然一拿新数字，刚滚过的又被算回去）
function localCounts(server: Record<string, number>): Record<string, number> {
  const out = { ...server }
  for (const id of pending) {
    let e: Entry | undefined
    for (const l of lists.values()) { e = l.items.find((x) => x.id === id); if (e) break }
    if (e) out[e.feed_id] = Math.max(0, (out[e.feed_id] ?? 0) - 1)
  }
  return out
}

// 按 id 取一批（不看的）：已经被 Miniflux 清掉的（404）记下来，回头从单子里拿掉
async function fetchIds(ids: number[]): Promise<{ got: Entry[]; gone: number[] }> {
  const got: Entry[] = [], gone: number[] = []
  for (let i = 0; i < ids.length; i += 6) {
    const r = await Promise.all(ids.slice(i, i + 6).map((id) => api.entry(id).then((e) => e, (err) => (err instanceof ApiError && err.status === 404 ? null : undefined))))
    r.forEach((e, k) => { if (e) got.push(e); else if (e === null) gone.push(ids[i + k]) })
  }
  return { got, gone }
}

export function StreamLayout() {
  const papers = usePapers()   // 来源写「报刊 · 栏目」（阶段 6 第 3 步）
  const meta = useMeta()
  const { data: shelf } = useShelf()
  const navigate = useNavigate()
  const { eid } = useParams()
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const f = (ALL_FILTERS.includes(params.get('f') as Filter) ? params.get('f') : 'unread') as Filter
  const cRaw = Number(params.get('c')) || undefined
  const c = cRaw && shelf && !shelf.categories.some((x) => x.id === cRaw) ? undefined : cRaw
  const key = keyOf(f, c)

  const [list, setList] = useState<List | null>(() => lists.get(key) ?? null)
  const trTitles = useTitleTr(list?.items)
  const [counts, setCounts] = useState<Record<string, number> | null>(counters)
  const [error, setError] = useState('')
  const [menu, setMenu] = useState<{ entry: Entry; anchor: HTMLElement } | null>(null)
  const [view, setView] = useState<View>(() => (load(VIEW_KEY) === 'cards' ? 'cards' : 'list'))
  const chooseView = (v: View) => { setView(v); save(VIEW_KEY, v) }

  // 一键已读：arming = 长按后「未读」变「已读」、数字藏起来，等确认
  const [arming, setArming] = useState(false)
  const unreadTab = useRef<HTMLButtonElement>(null)
  const hold = useRef({ timer: 0, x: 0, y: 0, fired: false })
  const starHold = useRef({ timer: 0, x: 0, y: 0, fired: false })
  const loading = useRef(false)

  // ——— 未读数：按源记，按类别、按「进信息流」的源加起来 ———
  const feedCat = new Map((shelf?.feeds ?? []).map((x) => [x.id, x.category.id]))
  const shown = new Set((shelf?.feeds ?? []).filter((x) => !x.hide_globally).map((x) => x.id))
  const unreadIn = (cat?: number): number | null => {
    if (!counts || !shelf) return null
    let n = 0
    for (const id of shown) if (!cat || feedCat.get(id) === cat) n += counts[id] ?? 0
    return Math.max(0, n)
  }
  const unread = unreadIn()
  const loadCounts = useCallback(() => api.counters().then((r) => { counters = localCounts(r.unreads); setCounts({ ...counters }) }).catch(() => {}), [])
  const bump = (feedId: number, by: number) => {
    if (!counters) return
    counters = { ...counters, [feedId]: Math.max(0, (counters[feedId] ?? 0) + by) }
    setCounts(counters)
  }
  useEffect(() => { if (!counters) loadCounts() }, [loadCounts])

  const commit = useCallback((k: string, next: List) => {
    lists.set(k, next)
    if (k === key) setList(next)
  }, [key])

  const more = useCallback(async (reset = false) => {
    const cur = reset ? null : lists.get(key)
    if (loading.current || cur?.done) return
    loading.current = true
    try {
      if (f === 'muted') {
        // 不看的记在灵媒自己那儿：按划掉的时间，新的在前，一页页按 id 取
        await loadMeta().catch(() => {})
        const sh = cachedShelf() ?? await loadShelf()
        const cats = new Map(sh.feeds.map((x) => [x.id, x.category.id]))
        const m = currentMeta()
        const marks = Object.entries(mutedOf(m)).sort((a, b) => b[1].t - a[1].t)
        const ids = marks.filter(([, v]) => !c || cats.get(v.f) === c).map(([id]) => Number(id))
        const from = cur?.next ?? 0
        const { got, gone } = await fetchIds(ids.slice(from, from + PAGE))
        if (gone.length) updateMeta((x) => { const pool = { ...x.muted }; for (const id of gone) delete pool[id]; return { ...x, muted: pool } }).catch(() => {})
        const items = got
        commit(key, { items: [...(cur?.items ?? []), ...items], done: from + PAGE >= ids.length, next: from + PAGE })
        return
      }
      const last = cur?.items[cur.items.length - 1]
      // 按发布时间往前翻；同一秒的可能重复，按 id 去重
      const before = last ? Math.floor(new Date(last.published_at).getTime() / 1000) + 1 : undefined
      const r = await api.entries({ ...query(f, c), limit: PAGE, published_before: before })
      const seen = new Set(cur?.items.map((e) => e.id))
      const raw = r.entries.filter((e) => !seen.has(e.id))
      const fresh = await visible(raw)   // 去重藏起来的不显示（但翻页照原样算，免得同一秒的文章翻不完）
      commit(key, { items: [...(cur?.items ?? []), ...fresh], done: raw.length === 0 || r.entries.length < PAGE })
    } catch (e) { setError(String((e as Error).message)) }
    finally { loading.current = false }
  }, [f, c, key, commit])

  useEffect(() => {
    setError('')
    const cached = lists.get(key)
    setList(cached ?? null)
    // 重新拉列表时未读数也一起重拿：Miniflux 在后台陆续抓到的新文章，列表和数字才对得上
    if (!cached) { more(true); if (counters) loadCounts() }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps


  // 滚到底自动加载下一页
  const sentinel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sentinel.current
    if (!el) return
    const io = new IntersectionObserver((xs) => { if (xs.some((x) => x.isIntersecting)) more() }, { rootMargin: '600px' })
    io.observe(el)
    return () => io.disconnect()
  }, [more, list])

  // 改一篇的状态：所有列表一起改；remove 为真时从当前列表里拿掉
  const patch = useCallback((id: number, change: Partial<Entry>, remove = false) => {
    for (const [k, l] of lists) {
      const items = l.items.map((e) => (e.id === id ? { ...e, ...change } : e))
        .filter((e) => !(remove && k === key && e.id === id))
      commit(k, { ...l, items })
    }
  }, [key, commit])
  const findEntry = (id: number) => { for (const l of lists.values()) { const e = l.items.find((x) => x.id === id); if (e) return e } return undefined }

  const setRead = (e: Entry, read: boolean) => {
    if ((e.status === 'read') === read) return
    pending.delete(e.id)
    patch(e.id, { status: read ? 'read' : 'unread' }, read && f === 'unread')
    bump(e.feed_id, read ? -1 : 1)
    api.setStatus([e.id], read ? 'read' : 'unread').catch(() => {
      patch(e.id, { status: e.status }); bump(e.feed_id, read ? 1 : -1)
    })
  }
  const setStar = (e: Entry) => {
    const starred = !e.starred
    patch(e.id, { starred }, !starred && f === 'starred')
    api.toggleStar(e.id).catch(() => patch(e.id, { starred: e.starred }))
  }

  // ——— 不爱看 ———
  const doMute = (e: Entry) => {
    // 滚过变灰的：本地已读、Miniflux 那边还是未读
    const local = e.status === 'unread', server = local || pending.has(e.id)
    pending.delete(e.id); greyed.delete(e.id)
    if (local) { patch(e.id, { status: 'read' }); bump(e.feed_id, -1) }
    if (server) api.setStatus([e.id], 'read').catch(() => {})
    mute(e).catch((err) => toastError(`没记上：${(err as Error).message}`))
    toast({ text: '眼不见为净。', bird: 'rest', action: { label: '撤销', run: () => {
      unmute(e.id).catch(() => {})
      if (server) { patch(e.id, { status: 'unread' }); bump(e.feed_id, 1); api.setStatus([e.id], 'unread').catch(() => {}) }
    } } })
  }
  const doUnmute = (e: Entry) => { unmute(e.id).then(() => toast('放回信息流了。')).catch((err) => toastError(`没改成：${(err as Error).message}`)) }
  // ——— 滚过即已读 ———
  // 报给 Miniflux；clear 为真时把灰了的从「未读」列表里清掉
  const flush = useCallback(async (clear: boolean) => {
    const ids = [...pending]
    pending.clear()
    if (ids.length) await api.setStatus(ids, 'read').catch(() => ids.forEach((id) => pending.add(id)))
    if (clear && greyed.size) {
      for (const [k, l] of lists) if (k.startsWith('unread|')) commit(k, { ...l, items: l.items.filter((e) => !greyed.has(e.id)) })
      greyed.clear()
    }
  }, [commit])
  const flushRef = useRef(flush)
  flushRef.current = flush
  useEffect(() => {
    const hide = () => { if (document.visibilityState === 'hidden') flushRef.current(false) }
    const leave = () => flushRef.current(false)
    document.addEventListener('visibilitychange', hide)
    window.addEventListener('pagehide', leave)
    return () => { document.removeEventListener('visibilitychange', hide); window.removeEventListener('pagehide', leave); flushRef.current(true) }
  }, [])

  // 顶栏（刷新、菜单）贴顶；刊头随滚动收成一行贴在顶栏下面；筛选栏再贴在它下面，时间轴的日期栏贴在筛选栏下面
  const tabsRef = useRef<HTMLDivElement>(null)
  const [head, setHead] = useState({ bar: 0, row: 0 })
  const onHead = useCallback((bar: number, row: number) => setHead((h) => (h.bar === bar && h.row === row ? h : { bar, row })), [])
  const [tabsH, setTabsH] = useState(0)
  useLayoutEffect(() => {
    const tabs = tabsRef.current
    if (!tabs) return
    const ro = new ResizeObserver(() => setTabsH(tabs.offsetHeight))
    ro.observe(tabs)
    return () => ro.disconnect()
  }, [])

  const pane = useRef<HTMLDivElement>(null)
  const auto = f === 'unread' && autoReadOn()
  useEffect(() => {
    if (!auto || !list || !pane.current) return
    const top = head.bar + head.row + tabsH
    const io = new IntersectionObserver((xs) => {
      for (const x of xs) {
        const id = Number((x.target as HTMLElement).dataset.id)
        // 没显示出来的（手机上进了文章，列表整个藏起来，量出来是 0）不算
        if (!x.boundingClientRect.height) continue
        // 点刷新键后插到上面去的新文章你还没见过，不能一插进来就灰：露过一次脸才算
        // （0.29.5：原来是每一篇都要露过脸，滚得快、一下翻过一整屏时中间几篇会漏掉）
        if (x.isIntersecting) { unseenNew.delete(id); continue }
        if (unseenNew.has(id) || !x.rootBounds || x.boundingClientRect.bottom > x.rootBounds.top + 1) continue
        const e = findEntry(id)
        if (!e || e.status === 'read' || isMuted(currentMeta(), id)) continue
        greyed.add(id); pending.add(id)
        patch(id, { status: 'read' })
        bump(e.feed_id, -1)
      }
    }, { rootMargin: `-${top}px 0px 0px 0px`, threshold: 0 })
    pane.current.querySelectorAll('.stream-row[data-unread]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [auto, list, head, tabsH]) // eslint-disable-line react-hooks/exhaustive-deps

  // 彩蛋（0.29.6）：「到底了」露面以后还往下滚，第三下喊一声「都说了到底了。」
  // 每到一次底只喊一次；手机算手指往上推一下，电脑算滚轮一阵
  const atEnd = auto && !!list?.done && (list?.items.length ?? 0) > 0
  useEffect(() => {
    if (!atEnd) return
    const p = pane.current
    const own = !!p && getComputedStyle(p).overflowY === 'auto'   // 电脑上左列表右文章时，列表自己滚
    const box = () => (own ? p! : document.documentElement)
    const bottom = () => { const s = box(); return s.scrollTop + s.clientHeight >= s.scrollHeight - 4 }
    let tries = 0, said = false, lastWheel = 0, lastMove = 0, startY = 0, pushed = false
    const nudge = () => { if (!said && ++tries >= 3) { said = true; say(LINES.streamEnd, 'alert') } }
    const onScroll = () => { lastMove = Date.now(); if (!bottom()) { tries = 0; said = false } }
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY <= 0 || !bottom()) return
      const now = Date.now()
      if (now - lastMove < 500) { lastWheel = now; return }   // 刚滚到底的那一阵惯性不算
      if (now - lastWheel > 400) nudge()
      lastWheel = now
    }
    const onStart = (e: TouchEvent) => { startY = e.touches[0].clientY; pushed = false }
    const onMove = (e: TouchEvent) => { if (!pushed && bottom() && startY - e.touches[0].clientY > 30) { pushed = true; nudge() } }
    const target: EventTarget = own ? p! : window
    target.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('wheel', onWheel, { passive: true })
    window.addEventListener('touchstart', onStart, { passive: true })
    window.addEventListener('touchmove', onMove, { passive: true })
    return () => {
      target.removeEventListener('scroll', onScroll)
      window.removeEventListener('wheel', onWheel); window.removeEventListener('touchstart', onStart); window.removeEventListener('touchmove', onMove)
    }
  }, [atEnd, eid])

  const [refreshing, setRefreshing] = useState(false)
  // 刷新（0.29.3，2026-10-26 Hana 定）：
  //   下拉刷新 → 人本来就在顶上：滚过的清掉，从头重拉，新的直接在最上面
  //   点刷新键 → 不动你看到哪：新到的按时间静默插进已经加载的那段（多半在你上面），滚过变灰的先留着；想看新的，点底栏「信息流」回顶
  const refreshAll = async (keep = false) => {
    if (refreshing) return
    setRefreshing(true); setError('')
    const again = () => refreshAll(keep)
    await flush(!keep)
    // 「新到几篇」拿服务器前后两次的数字相减（本地加减过的数字可能和服务器差几篇，比如别的设备上读过）
    const sum = (r: Record<string, number>, cat?: number) =>
      Object.entries(r).reduce((n, [id, k]) => n + (shown.has(Number(id)) && (!cat || feedCat.get(Number(id)) === cat) ? k : 0), 0)
    const before = await api.counters().then((r) => r.unreads).catch(() => null)
    let failed = false
    await api.refreshAll().catch(() => { failed = true })
    await new Promise((r) => setTimeout(r, 3000))   // Miniflux 在后台抓，给它一点时间
    const cur = keep && f !== 'muted' ? lists.get(key) : undefined
    lists.clear()
    try {
      const r = await api.counters()
      counters = localCounts(r.unreads); setCounts({ ...counters })
      if (failed) toastError('没能刷新。', { label: '重试', run: again })
      else if (before) {
        const all = Math.max(0, sum(r.unreads) - sum(before)), here = c ? Math.max(0, sum(r.unreads, c) - sum(before, c)) : all
        toast(!all ? '没有新文章。' : { text: here === all ? `新到 ${all} 篇。` : `新到 ${all} 篇，这一类 ${here} 篇。`, bird: 'news' })
      }
    } catch { toastError('刷新没成功。', { label: '重试', run: again }) }
    if (cur) {
      try { await mergeNew(cur) } catch { lists.set(key, cur) }
    } else {
      setList(null)
      await more(true)
    }
    setRefreshing(false)
  }
  // 把新到的按时间并进当前列表：从最新的一页页往前取，碰到已经有的、或者翻过了已加载的最早一篇就停
  const mergeNew = async (cur: List) => {
    const have = new Set(cur.items.map((e) => e.id))
    const oldest = cur.items.length ? new Date(cur.items[cur.items.length - 1].published_at).getTime() : 0
    const got: Entry[] = []
    let before: number | undefined
    for (let page = 0; page < 10; page++) {
      const r = await api.entries({ ...query(f, c), limit: PAGE, published_before: before })
      const fresh = (await visible(r.entries)).filter((e) => !have.has(e.id) && (cur.done || new Date(e.published_at).getTime() >= oldest))
      got.push(...fresh)
      const last = r.entries[r.entries.length - 1]
      if (!last || r.entries.length < PAGE || r.entries.some((e) => have.has(e.id)) || new Date(last.published_at).getTime() < oldest) break
      before = Math.floor(new Date(last.published_at).getTime() / 1000) + 1
    }
    const seen = new Set<number>()
    const items = [...cur.items, ...got].filter((e) => (seen.has(e.id) ? false : (seen.add(e.id), true)))
      .sort((a, b) => new Date(b.published_at).getTime() - new Date(a.published_at).getTime())
    got.forEach((e) => unseenNew.add(e.id))
    if (got.length) holdPlace()
    commit(key, { ...cur, items })
  }
  // 插进来的在上面时，记住屏幕上第一篇在哪，插完把页面挪回去，看着一动不动（iOS 的 Safari 不会自己做这件事）
  const place = useRef<{ id: string; top: number } | null>(null)
  const holdPlace = () => {
    place.current = null
    if (window.scrollY < 8) return   // 在顶上：新的直接露出来
    const top = head.bar + head.row + tabsH
    for (const el of pane.current?.querySelectorAll<HTMLElement>('.stream-row') ?? []) {
      const b = el.getBoundingClientRect()
      if (b.height && b.bottom > top) { place.current = { id: el.dataset.id!, top: b.top }; break }
    }
  }
  useLayoutEffect(() => {
    const p = place.current
    if (!p) return
    place.current = null
    const el = pane.current?.querySelector<HTMLElement>(`.stream-row[data-id="${p.id}"]`)
    if (el) window.scrollBy(0, el.getBoundingClientRect().top - p.top)
  }, [list])
  useEffect(() => { if (list || error) markReady() }, [list, error])
  const [sharingEntry, setSharingEntry] = useState<{ e: Entry; anchor: HTMLElement } | null>(null)
  const pullable = !eid && !menu && !arming
  const pull = usePullRefresh(pane, pullable, refreshing, () => refreshAll(false))

  const holdStart = (h: typeof hold.current, e: RPointerEvent, fire: () => void) => {
    h.x = e.clientX; h.y = e.clientY; h.fired = false
    window.clearTimeout(h.timer)
    h.timer = window.setTimeout(() => { h.fired = true; try { navigator.vibrate?.(10) } catch { /* 无 */ } fire() }, 500)
  }
  const holdMove = (h: typeof hold.current, e: RPointerEvent) => { if (Math.abs(e.clientX - h.x) > 8 || Math.abs(e.clientY - h.y) > 8) window.clearTimeout(h.timer) }
  const catUnread = unreadIn(c)
  const markAll = async () => {
    setArming(false)
    try {
      await flush(false)
      // 先记下是哪些篇，好给「撤销」用
      // 只标信息流里的（选了类别就只标这个类别的）
      // Miniflux 一次最多给 1000 篇（MaxEntryLimit）：一批批取、标完再取下一批，直到取不满
      const ids: number[] = []
      if ((catUnread ?? 0) > 1000) toast({ text: '有点多，处理中……', sticky: true, bird: 'alert' })
      for (let round = 0; round < 50; round++) {
        const batch = (await api.entries({ status: ['unread'], limit: 1000, visible: true, category: c })).entries.map((x) => x.id)
          .filter((id) => !ids.includes(id))
        if (!batch.length) break
        for (let i = 0; i < batch.length; i += 500) await api.setStatus(batch.slice(i, i + 500), 'read')
        ids.push(...batch)
        if (batch.length < 1000) break
      }
      if (ids.length) toast({ text: `已把 ${ids.length} 篇标为已读。`, action: { label: '撤销', run: () => {
        (async () => { for (let i = 0; i < ids.length; i += 500) await api.setStatus(ids.slice(i, i + 500), 'unread') })().then(() => { lists.clear(); loadCounts(); setList(null); more(true) })
          .catch(() => toastError('撤销没成功。'))
      } } })
      else if ((catUnread ?? 0) > 1000) toast('都读完了。')   // 顶掉「处理中」
      for (const [k, l] of lists) {
        commit(k, k.startsWith('unread|') ? { items: [], done: true } : { ...l, items: l.items.map((x) => (ids.includes(x.id) ? { ...x, status: 'read' as const } : x)) })
      }
      greyed.clear()
      loadCounts()
    } catch (e) { toast({ text: `没能全部标为已读：${(e as Error).message}`, kind: 'error', bird: 'oops' }) }
  }

  // 换筛选、换类别：先把滚过的报上去、清掉灰的，再重新拉那一页（别的标签里刚收藏、刚改回未读的文章才会出现）
  const go = async (nf: Filter, nc: number | undefined) => {
    if (nf === f && nc === c) return
    await flush(true)
    lists.delete(keyOf(nf, nc))
    const q: Record<string, string> = {}
    if (nf !== 'unread') q.f = nf
    if (nc) q.c = String(nc)
    setParams(q, { replace: true, state: location.state })
    window.scrollTo(0, 0)
  }
  const choose = (nf: Filter) => go(nf, c)

  // 手机上进出文章：记住列表滚到哪，进文章回到顶部，返回时恢复
  const savedY = useRef(0)
  const prevEid = useRef(eid)
  useLayoutEffect(() => {
    if (eid && !prevEid.current) { savedY.current = window.scrollY; window.scrollTo(0, 0) }
    else if (!eid && prevEid.current) window.scrollTo(0, savedY.current)
    else if (eid && eid !== prevEid.current) window.scrollTo(0, 0)
    prevEid.current = eid
  }, [eid])

  // 文章页打开即已读，会经由这里同步回列表（不从「未读」里拿掉，读完回来还看得到）
  const readerPatch = useCallback((id: number, change: Partial<Entry>) => {
    const before = findEntry(id)
    if (change.status && before && before.status !== change.status) {
      bump(before.feed_id, change.status === 'read' ? -1 : 1)
    }
    pending.delete(id)
    patch(id, change)
  }, [patch]) // eslint-disable-line react-hooks/exhaustive-deps
  const search = (() => { const q = new URLSearchParams(); if (f !== 'unread') q.set('f', f); if (c) q.set('c', String(c)); const s = q.toString(); return s ? `?${s}` : '' })()
  const ctx: ReaderContext = {
    backPath: `/stream${search}`,
    sourceTitle: '', entries: list?.items ?? [], patch: readerPatch, numbered: false,
  }

  // 这一页显示哪些：不看的不进信息流；「不看的」里只显示还在单子上的
  const items = (list?.items ?? []).filter((e) => {
    if (f === 'muted') return isMuted(meta, e.id)
    if (f === 'starred') return true
    return !isMuted(meta, e.id)
  })

  // 类别那一排：有「进信息流」的源的类别，照报刊架的顺序
  const cats = shelf ? orderedCategories(meta, shelf.categories).filter((x) => shelf.feeds.some((fd) => fd.category.id === x.id && !fd.hide_globally)) : []
  // 只放符号：每个类别的符号互不重复（没选过的算默认的报纸，两个都没选就撞了）（0.28.1：原来要求每个都选过，选了报纸的「新闻」被当成没配）
  const icons = cats.map((x) => meta.categories[x.id]?.icon || 'news')
  const symbolic = icons.length > 0 && new Set(icons).size === icons.length

  return (
    <div className={eid ? 'reader-layout has-article' : 'reader-layout'}>
      <div ref={pane} className={['list-pane', pull.offset && 'pulled', pull.dragging && 'pulling'].filter(Boolean).join(' ')}
        style={{ '--stream-bar-h': `${head.bar + head.row}px`, '--stream-top-h': `${head.bar + head.row + tabsH}px`, '--pull': `${pull.offset}px` } as CSSProperties}>
        <PageHeader title="信息流" subtitle="The Stream" collapsible onCollapsedHeight={onHead} actions={<>
          <button className={refreshing ? 'icon-btn spinning' : 'icon-btn'} aria-label="刷新" title="刷新"
            onClick={() => refreshAll(true)} disabled={refreshing}>
            <span className="pull-turn" style={pull.turn ? { transform: `rotate(${pull.turn}deg)` } : undefined}><IconRefresh size={17} /></span>
          </button>
          {/* 视图只有两种，一个按钮来回切（0.23，原来的菜单里只有这一项）：图标画的是当前视图 */}
          <button className="icon-btn" aria-label={view === 'cards' ? '视图：卡片，点一下换成列表' : '视图：列表，点一下换成卡片'} title={view === 'cards' ? '卡片' : '列表'}
            onClick={() => chooseView(view === 'cards' ? 'list' : 'cards')}>{view === 'cards' ? <IconCards /> : <IconList />}</button>
        </>} />
        {/* 下拉或点刷新键时，刊头往下让出的那道缝里：俯冲的鸟 */}
        {pull.offset > 0 && <div className="pull-bird" aria-hidden="true" style={{ opacity: Math.min(1, pull.offset / 44) }}><Bird name="diving" /></div>}
        <div className="stream-tabs-wrap" ref={tabsRef}>
        <div className="stream-tabs" role="tablist" aria-label="筛选">
          {FILTERS.map(([k, label]) => k === 'unread' ? (
            <button key={k} ref={unreadTab} role="tab" aria-selected={f === k}
              className={['stream-tab', f === k && 'on', arming && 'arming'].filter(Boolean).join(' ')}
              onPointerDown={(e) => { if (catUnread) holdStart(hold.current, e, () => setArming(true)) }} onPointerMove={(e) => holdMove(hold.current, e)}
              onPointerUp={() => window.clearTimeout(hold.current.timer)} onPointerCancel={() => window.clearTimeout(hold.current.timer)}
              onContextMenu={(e) => { e.preventDefault(); window.clearTimeout(hold.current.timer); if (catUnread) setArming(true) }}
              onClick={() => { if (hold.current.fired) { hold.current.fired = false; return } choose(k) }}>
              <span className="stream-tab-word">
                <span className="word-unread">未读</span>
                <span className="word-read" aria-hidden="true">已读</span>
              </span>
              {unread !== null && unread > 0 && <span className="stream-count">{unread}</span>}
            </button>
          ) : k === 'starred' ? (
            // 长按「收藏」：换成「不看的」；在「不看的」里点它回到收藏
            <button key={k} role="tab" aria-selected={f === 'starred' || f === 'muted'}
              className={['stream-tab', (f === 'starred' || f === 'muted') && 'on', f === 'muted' && 'muted'].filter(Boolean).join(' ')}
              onPointerDown={(e) => holdStart(starHold.current, e, () => go(f === 'muted' ? 'starred' : 'muted', c))} onPointerMove={(e) => holdMove(starHold.current, e)}
              onPointerUp={() => window.clearTimeout(starHold.current.timer)} onPointerCancel={() => window.clearTimeout(starHold.current.timer)}
              onContextMenu={(e) => { e.preventDefault(); window.clearTimeout(starHold.current.timer); go(f === 'muted' ? 'starred' : 'muted', c) }}
              onClick={() => { if (starHold.current.fired) { starHold.current.fired = false; return } choose('starred') }}>
              {f === 'muted' ? '不看的' : label}
            </button>
          ) : (
            <button key={k} role="tab" aria-selected={f === k}
              className={f === k ? 'stream-tab on' : 'stream-tab'} onClick={() => choose(k)}>
              {label}
            </button>
          ))}
        </div>
        {cats.length > 1 && (
          <div className={symbolic ? 'stream-cats symbols' : 'stream-cats'} role="tablist" aria-label="类别">
            <button role="tab" aria-selected={!c} className={!c ? 'stream-cat all on' : 'stream-cat all'} onClick={() => go(f, undefined)}>
              {symbolic ? '全部' : '全部类别'}{f === 'unread' && unread ? <span className="stream-count">{unread}</span> : null}
            </button>
            {cats.map((x) => {
              const n = f === 'unread' ? unreadIn(x.id) ?? 0 : null
              const name = categoryName(meta, x, shelf!.categories)
              return (
                <button key={x.id} role="tab" aria-selected={c === x.id} title={name} aria-label={name}
                  className={['stream-cat', c === x.id && 'on', n === 0 && 'zero'].filter(Boolean).join(' ')} onClick={() => go(f, x.id)}>
                  <CategoryIcon name={categoryIcon(meta, x.id)} size={symbolic ? 15 : 13} />
                  <span className="stream-cat-name">{name}</span>
                  {n ? <span className="stream-count">{n}</span> : null}
                  {symbolic && n ? <i className="stream-cat-dot" aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>
        )}
        </div>

        <div className="stream-list">
          {error && list && <p className="page-error stream-note">{error}</p>}
          {error && !list && <div className="stream-note"><BirdNote bird="departing">信没送到。{error}</BirdNote></div>}
          {!list && !error && <div className="stream-note"><LoadingNote /></div>}
          {list && items.length === 0 && list.done && <div className="stream-note"><BirdNote bird={f === 'unread' ? 'reading' : 'perched'}>{EMPTY[f]}</BirdNote></div>}
          {list && byDay(items).map(([day, rows]) => (
            <section key={day} className={view === 'cards' ? 'stream-day cards' : 'stream-day'} aria-label={dayBar(day)}>
              <div className="stream-day-bar"><span className="mono-label">{dayBar(day)}</span></div>
              {rows.map((e) => {
                return (
                  <Row key={e.id} entry={e} zh={trTitles[e.id]} source={sourceOf(papers, e.feed_id, e.feed?.title ?? '').label}
                    search={search} active={String(e.id) === eid} replace={!!eid} cards={view === 'cards'} mutedTab={f === 'muted'}
                    onMute={() => (f === 'muted' ? doUnmute(e) : doMute(e))} onStar={() => setStar(e)}
                    onHold={(anchor) => setMenu({ entry: e, anchor })}
                    onSource={() => navigate(`/shelf/feed/${e.feed_id}?d=${dayKey(new Date(e.published_at))}`, { state: { depth: 1 } })} />
                )
              })}
            </section>
          ))}
          {list && !list.done && <div ref={sentinel} className="stream-sentinel" aria-hidden="true" />}
          {/* 滚过即已读：到底以后留一屏空白，最后几篇也能滚过顶栏 */}
          {auto && list?.done && items.length > 0 && <div className="stream-end"><BirdNote bird="perched">到底了。</BirdNote></div>}
        </div>
      </div>

      <div className="article-pane"><Outlet context={ctx} /></div>


      {arming && (
        <Sheet title="是否一键已读？" placement="bottom" anchor={unreadTab.current} inset={0} align="left"
          onClose={() => setArming(false)}>
          <p className="sheet-note">{c && shelf ? `「${categoryName(meta, shelf.categories.find((x) => x.id === c)!, shelf.categories)}」里 ${catUnread} 篇未读会全部标为已读。` : `${catUnread} 篇未读文章会全部标为已读。`}</p>
          <div className="sheet-actions">
            <button className="sheet-action" onClick={markAll}>全部标为已读</button>
            <button className="sheet-action quiet" onClick={() => setArming(false)}>取消</button>
          </div>
        </Sheet>
      )}

      {sharingEntry && (
        <ShareSheet anchor={sharingEntry.anchor} onClose={() => setSharingEntry(null)}
          doc={{ title: sharingEntry.e.title, source: sourceOf(papers, sharingEntry.e.feed_id, sharingEntry.e.feed?.title ?? '').label, author: sharingEntry.e.author, published: sharingEntry.e.published_at, url: originOf(sharingEntry.e) || undefined, html: '' }}
          getProse={() => {
            // 信息流里这篇还没在页面上排过版：后台先排一遍，导出的文件和在文章页导出的一样
            const div = document.createElement('div')
            div.className = 'prose'
            div.innerHTML = sharingEntry.e.content
            typeset(div, { url: sharingEntry.e.url, title: sharingEntry.e.title })
            return div
          }} />
      )}
      {menu && (() => {
        // 菜单里显示的是这篇的最新状态
        const e = findEntry(menu.entry.id) ?? menu.entry
        const close = () => setMenu(null)
        const muted = isMuted(meta, e.id)
        return (
          <Sheet title={e.title} placement="bottom" anchor={menu.anchor} onClose={close}
            inset={parseFloat(getComputedStyle(menu.anchor).getPropertyValue('--gutter')) || 0}>
            <div className="sheet-actions">
              <button className="sheet-action" onClick={() => { setStar(e); close() }}>{e.starred ? '取消收藏' : '收藏'}</button>
              <button className="sheet-action" onClick={() => { if (muted) doUnmute(e); else doMute(e); close() }}>{muted ? '取消不爱看' : '不爱看'}</button>
              <button className="sheet-action" onClick={() => { setRead(e, e.status !== 'read'); close() }}>
                {e.status === 'read' ? '标为未读' : '标为已读'}
              </button>
              <button className="sheet-action" onClick={() => { setSharingEntry({ e, anchor: menu.anchor }); close() }}>分享…</button>
              {originOf(e) && <a className="sheet-action" href={originOf(e)} target="_blank" rel="noopener noreferrer" onClick={close}>打开原文</a>}
            </div>
          </Sheet>
        )
      })()}
    </div>
  )
}

type RowProps = {
  entry: Entry; zh?: string; source: string; search: string; active: boolean; replace: boolean; cards: boolean; mutedTab: boolean
  onMute: () => void; onStar: () => void; onHold: (anchor: HTMLElement) => void; onSource: () => void
}

function Row({ entry, zh, source, search, active, replace, cards, mutedTab, onMute, onStar, onHold, onSource }: RowProps) {
  const meta = useMeta()
  const location = useLocation()   // 从报刊架切来的信息流：点进文章也带着这个记号，报刊架按钮才能一次退回去
  const ref = useRef<HTMLDivElement>(null)
  const { dx, dragging, bind } = useSwipeRow({
    onRight: onMute, onLeft: onStar, onHold: () => ref.current && onHold(ref.current),
  })
  const read = entry.status === 'read'
  const past = Math.abs(dx) >= SWIPE_AT
  // 点来源名：去那本报刊（不打开这篇）
  const src = <span className="stream-source stream-source-link" onClick={(ev) => { ev.preventDefault(); ev.stopPropagation(); onSource() }}>{source}</span>
  return (
    <div ref={ref} data-id={entry.id} data-unread={read ? undefined : ''} className={['stream-row', read && 'read', active && 'active'].filter(Boolean).join(' ')}>
      {dx > 0 && <span className={past ? 'stream-hint left on' : 'stream-hint left'}>{mutedTab ? '在看' : '不爱看'}</span>}
      {dx < 0 && <span className={past ? 'stream-hint right on' : 'stream-hint right'}>{entry.starred ? '取消收藏' : '收藏'}</span>}
      <Link to={{ pathname: `/stream/${entry.id}`, search }} state={{ depth: 1, fromShelf: (location.state as { fromShelf?: boolean } | null)?.fromShelf }} replace={replace}
        className={cards ? 'stream-item stream-card' : 'stream-item'} draggable={false} {...bind}
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : undefined }}>
        {cards ? (
          <>
            <span className="card-top"><CategoryIcon name={categoryIcon(meta, entry.feed?.category?.id)} /><span className="stream-time">{clock(new Date(entry.published_at))}</span></span>
            <TitleText className="stream-title card-title" title={entry.title} zh={zh} />
            <span className="card-summary">{summaryOf(entry.id, entry.content)}</span>
            {src}
          </>
        ) : (
          <>
            <span className="stream-time">{clock(new Date(entry.published_at))}</span>
            <span className="stream-text">
              <TitleText className="stream-title" title={entry.title} zh={zh} />
              {src}
            </span>
          </>
        )}
      </Link>
    </div>
  )
}

// 添加 / 编辑信源（视觉稿「报刊架 · 列表视图与编辑」里的编辑面板）。
// 字段：刊名、别名、分类（可当场新建）、选项（抓取全文 / 暂停更新 / 不进信息流）；编辑时显示地址，左下角「移除」。
// 多栏报刊里的一栏只有栏目名和选项：刊名、别名、类别属于整份报刊（0.30.5，2026-10-27 Hana 定）。
// 添加时先填地址找订阅源（网页地址也行，Miniflux 会自己去页面里找 RSS）。
// 改动：Miniflux 自己有的字段写回 Miniflux；别名写进灵媒设置（数据字段仍叫 latin）（见 api/meta.ts）。
// 5b-3 接诊：查找之后每个候选都交给源医生体检（RSSHub 路由会在几台实例上各试一次），自动选推荐的那个；
// 摘要源而原网页取得到，替你勾上「抓取全文」。懂行的人可以跳过体检。誊写服务没接上时退回老办法。
// 编辑时多一行「体检」：当场看这个源现在的状况。
import { useEffect, useRef, useState } from 'react'
import { ApiError, api, cachedShelf, loadShelf, type Category, type Discovered, type Feed, type FeedOptions } from '../api/miniflux'
import { DISCOVER_LINKS, normalizeInput } from '../lib/sources'
import { looksForeign, trTitleOn } from '../lib/translate'
import { IconPick } from './IconPick'
import { checkup, checkupAround, onHub, original, recommend, routeOn, rsshubRoute, showUrl, usable, verdictLine, type Checkup } from '../lib/doctor'
import { ensureHub, feedUrlFor, hubBase } from '../lib/hub'
import { usePapers } from '../lib/papers'
import { feedTitle } from '../lib/subscribe'
import { categoryName, feedLatin, orderedCategories, updateMeta, useMeta } from '../api/meta'
import { Sheet } from './Sheet'
import { aliasClass } from '../lib/title'

type Props = {
  mode: 'add' | 'edit'
  feed?: Feed                 // 编辑时必有
  no?: number | null          // 编辑时标题右边的「NO. 02」
  categories: Category[]
  anchor: HTMLElement | null
  initialUrl?: string         // 从别的 app 分享进来的网址：打开就填好、自动查找
  inline?: boolean            // 设置页里单独一页（不弹面板），页名由页面自己写
  onClose: () => void
}

const OPTION_LABELS: [keyof FeedOptions, string][] = [['crawler', '抓取全文'], ['disabled', '暂停更新'], ['hide_globally', '不进信息流']]
const pad = (n: number) => String(n).padStart(2, '0')

function message(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 404) return '没在这个地址找到订阅源。'
    if (/already exists/i.test(e.detail)) return '这个订阅源已经在报刊架上了。'
    if (/unable to detect feed format/i.test(e.detail)) return '这不是订阅源。点「查找」看看。'
    if (/cloudflare|challenge/i.test(e.detail)) return '对方开了人机验证，进不去。'
    if (e.status === 400) return `地址或设置有问题：${e.detail || '请检查一下'}`
  }
  return String((e as Error).message || e)
}

export function FeedEditor({ mode, feed, no, categories, anchor, initialUrl, inline, onClose }: Props) {
  const meta = useMeta()
  const [url, setUrl] = useState(initialUrl ?? '')
  const [searched, setSearched] = useState(false)
  const [found, setFound] = useState<Discovered[] | null>(null)
  const [picked, setPicked] = useState<string>('')
  const [title, setTitle] = useState(feed?.title ?? '')
  // 多栏报刊里的一栏：栏目名可以手改（阶段 6 第 3 步；存在灵媒设置里，不动 Miniflux 的源名）
  const papers = usePapers()
  const paper = feed ? papers.byFeed.get(feed.id) : undefined
  const multi = !!paper && paper.feeds.length > 1
  const column0 = (feed && paper?.columns.get(feed.id)) || ''
  const [column, setColumn] = useState(column0)
  useEffect(() => { setColumn(column0) }, [column0])
  const [latin, setLatin] = useState(feed ? feedLatin(meta, feed.id) : '')
  const [latinTouched, setLatinTouched] = useState(false)
  // 灵媒设置可能晚一步读到：没动过别名框时，跟着更新
  useEffect(() => { if (feed && !latinTouched) setLatin(feedLatin(meta, feed.id)) }, [meta, feed, latinTouched])
  const [catId, setCatId] = useState<number | 'new'>(feed?.category.id ?? categories[0]?.id ?? 'new')
  const [newCat, setNewCat] = useState('')
  const [newIcon, setNewIcon] = useState<string | undefined>()
  const [opts, setOpts] = useState<FeedOptions>({
    crawler: !!feed?.crawler, disabled: !!feed?.disabled, hide_globally: !!feed?.hide_globally,
  })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmRemove, setConfirmRemove] = useState(false)
  // 体检：每个候选地址的结果（undefined = 体检中，null = 誊写服务没接上）
  const [checks, setChecks] = useState<Record<string, Checkup | null | undefined>>({})
  const [best, setBest] = useState('')
  const [showBad, setShowBad] = useState(false)
  const [crawlerHint, setCrawlerHint] = useState(false)
  // 翻译标题（阶段 4）：存在灵媒设置里；接诊时样本标题是外文就替你勾上
  const [trTitle, setTrTitle] = useState(feed ? trTitleOn(meta, feed.id) : false)
  const [, setTrHint] = useState(false)
  const trTouched = useRef(false)
  useEffect(() => { if (feed && !trTouched.current) setTrTitle(trTitleOn(meta, feed.id)) }, [meta, feed])
  const [diag, setDiag] = useState('')
  const [editCheck, setEditCheck] = useState<Checkup | null | 'busy' | undefined>()

  // 两条路（2026-10-22 Hana 定，去掉「跳过体检」开关）：点「查找」= 找候选 + 体检；不点查找、直接「添加」= 把框里的地址当订阅源直接订
  const ready = mode === 'edit' || !!picked || !!url.trim()

  // 地址本身就是订阅源时，Miniflux 的查找只回地址、不回刊名（拿地址顶着当名字）；
  // 这种情况刊名先空着，添加时 Miniflux 会读出刊物自己的名字（2026-10-20 Hana 发现）
  const nameOf = (d: Discovered) => (d.title && d.title !== d.url && !/^https?:\/\//i.test(d.title) ? d.title : '')

  const pickedRef = useRef('')   // 体检还没出完时用户先点了别的，就不替他改
  const pick = (d: Discovered, c?: Checkup | null) => {
    pickedRef.current = d.url
    setPicked(d.url)
    // 地址栏跟着选中的候选走（2026-10-22 Hana）；灵媒自建的只写路由，不露内部地址
    setUrl(onHub(d.url) ? original(d.url).slice(hubBase().length) : original(d.url))
    setTitle(nameOf(d) || c?.title || '')
    // 摘要源、原网页又取得到：替你勾上抓取全文
    const helps = !!c && c.ok && c.content !== 'full' && !!c.crawlerHelps
    setCrawlerHint(helps)
    if (helps) setOpts((o) => ({ ...o, crawler: true }))
    const foreign = !!c?.titles && looksForeign(c.titles)
    setTrTitle(foreign); setTrHint(foreign)
  }

  const find = async (raw = url) => {
    if (!raw.trim()) return
    await ensureHub()
    const n = normalizeInput(raw, cachedShelf()?.feeds ?? [])
    // 不再把框里的地址改写成 cups.moe 之类的实例（那不是 Hana 自己的，2026-10-22）：候选里列各台实例，选中哪个框里才换成哪个
    setSearched(true)
    setBusy(true); setError(''); setDiag(''); setFound(null); setShowBad(false); setPicked(''); pickedRef.current = ''; setChecks({}); setBest(''); setCrawlerHint(false)
    try {
      // 公众号文章链接：微信没有订阅源，Miniflux 只会按常见路径瞎猜一串（2026-10-22 Hana 贴文章链接时出现）
      if (/^https?:\/\/mp\.weixin\.qq\.com\//i.test(n.url)) {
        setError('公众号没有订阅源。去「去找源」的 Wechat2RSS 列表里找找。')
        return
      }
      // RSSHub 路由：不用找，直接在几台实例上各试一次
      const route = rsshubRoute(n.url)
      const list: Discovered[] = route
        ? routeOn(route, cachedShelf()?.feeds ?? [], 5).map((u) => ({ url: u, title: '', type: 'rss' }))
        : await api.discover(n.url)
      setFound(list)
      if (list.length === 0) { setError('没在这个地址找到订阅源。'); return }
      setBusy(false)
      // 全部候选都体检，一次三个（原来只查前六个，后面的一直停在「体检中…」，2026-10-22）
      const results: (Checkup | null)[] = new Array(list.length)
      let next = 0
      await Promise.all([0, 1, 2].map(async () => {
        while (next < list.length) {
          const k = next++
          results[k] = await checkupAround(list[k].url)
          setChecks((m) => ({ ...m, [list[k].url]: results[k] }))
        }
      }))
      const i = recommend(results, list.map((d) => d.url))
      if (i >= 0) { setBest(list[i].url); if (!pickedRef.current) pick(list[i], results[i]) }
      else if (list.length === 1 && !pickedRef.current) pick(list[0], results[0])
    } catch (e) {
      setError(message(e))
      // 找不到的时候请医生看一眼到底是哪里不对
      checkup(n.url).then((c) => { if (c && !c.ok && c.problem) setDiag(c.problem) })
    } finally { setBusy(false) }
  }

  // 分享进来的：打开就查
  useEffect(() => { if (initialUrl) find(initialUrl) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // 体检过、确定不能用的候选收起来（Miniflux 会按常见路径猜一串，大多是网页）
  const isBad = (d: Discovered) => { const c = checks[d.url]; return !!c && (!c.ok || !!c.problem) }
  const badCount = found?.filter(isBad).length ?? 0
  const allBad = !!found && found.length > 0 && badCount === found.length

  const examine = async () => {
    setEditCheck('busy')
    setEditCheck(await checkup(feed!.feed_url, feed!.fetch_via_proxy ? 'proxy' : undefined))
  }

  const save = async () => {
    setBusy(true); setError('')
    try {
      let category = catId
      if (category === 'new') {
        if (!newCat.trim()) { setError('新类别还没起名字。'); setBusy(false); return }
        category = (await api.createCategory(newCat.trim())).id
        if (newIcon) { const cid = category, ic = newIcon; await updateMeta((m) => ({ ...m, categories: { ...m.categories, [cid]: { ...m.categories[cid], icon: ic } } })).catch(() => {}) }
      }
      let id: number
      if (mode === 'add') {
        // 没查找就添加：框里的地址按贴进来的规则补全（RSSHub 路由补上实例）后直接订
        const target = picked || normalizeInput(url, cachedShelf()?.feeds ?? []).url
        id = (await api.createFeed(await feedUrlFor(target), category, opts)).feed_id
        const hit = found?.find((d) => d.url === picked)
        const discoveredTitle = hit ? nameOf(hit) : ''
        if (title.trim() && title.trim() !== discoveredTitle) await api.updateFeed(id, { title: title.trim() })
      } else {
        id = feed!.id
        // 多栏报刊里的一栏：源名跟着栏目名写成「刊名 · 栏目」（同 lib/paperOps.ts 的 renameColumn）
        const colTitle = multi && column.trim() && column.trim() !== column0 ? feedTitle(paper!.name, column.trim(), false) : ''
        await api.updateFeed(id, { title: colTitle || title.trim() || feed!.title, category_id: category, ...opts })
      }
      const latinChanged = latinTouched && latin.trim() !== (mode === 'edit' ? feedLatin(meta, id) : '')
      const trChanged = trTitle !== (mode === 'edit' ? trTitleOn(meta, id) : false)
      const colChanged = mode === 'edit' && multi && column.trim() !== column0
      if (latinChanged || trChanged || colChanged) {
        await updateMeta((m) => ({ ...m, feeds: { ...m.feeds, [id]: {
          ...m.feeds[id],
          ...(latinChanged ? { latin: latin.trim() || undefined } : {}),
          ...(trChanged ? { trTitle: trTitle || undefined } : {}),
          ...(colChanged ? { column: column.trim() || undefined } : {}),
        } } }))
      }
      await loadShelf()
      onClose()
    } catch (e) { setError(message(e)); setBusy(false) }
  }

  const remove = async () => {
    if (!confirmRemove) { setConfirmRemove(true); return }
    setBusy(true); setError('')
    try {
      await api.deleteFeed(feed!.id)
      await loadShelf()
      onClose()
    } catch (e) { setError(message(e)); setBusy(false) }
  }

  const body = (
    <>
      <div className="form-rows">
        {mode === 'add' && (
          <>
            <label className="sheet-label" htmlFor="fe-url">地址</label>
            <div className="form-inline">
              <input id="fe-url" name="mediarium-source" className="form-input mono" value={url} inputMode="url" autoComplete="off" autoCapitalize="off" autoCorrect="off"
                placeholder="订阅源或网页地址" onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') find() }} />
              <button className="form-text-btn" onClick={() => find()} disabled={busy || !url.trim()}>{busy && !ready ? '查找中…' : '查找'}</button>
            </div>
            {!found && !searched && (
              <>
                <span className="sheet-label">去找源</span>
                <div className="form-links">
                  {DISCOVER_LINKS.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" title={l.note}>{l.label} ↗</a>)}
                </div>
                <span /><span className="form-hint">网页、订阅源、RSSHub 路由都能贴</span>
              </>
            )}
            {found && found.length > 0 && (
              <>
                <span className="sheet-label">候选</span>
                <div className="form-found">
                  {found.filter((d) => showBad || !isBad(d)).map((d) => {
                    const c = checks[d.url]
                    const checked = d.url in checks
                    const bad = isBad(d)
                    return (
                      <button key={d.url} className={`cand${picked === d.url ? ' on' : ''}${bad ? ' bad' : ''}`}
                        aria-pressed={picked === d.url} onClick={() => pick(d, c)}>
                        <span className="cand-name">
                          {nameOf(d) || c?.title || showUrl(d.url)}
                          {usable(c) && <span className="cand-ok"> 可用</span>}
                          {best === d.url && <span className="cand-best"> 推荐</span>}
                          
                        </span>
                        {(nameOf(d) || c?.title) && <span className="cand-url">{showUrl(d.url)}</span>}
                        <span className="cand-check">{!checked ? '体检中…' : c === null ? '体检不了' : verdictLine(c!)}</span>
                      </button>
                    )
                  })}
                  {badCount > 0 && (
                    <button className="form-text-btn cand-fold" onClick={() => setShowBad((v) => !v)}>
                      {showBad ? '收起没法用的' : `${allBad ? '' : '另有 '}${badCount} 个地址试过不能用${allBad ? '：这个网址下没找到能订的源' : ''}，展开看`}
                    </button>
                  )}
                </div>
              </>
            )}
          </>
        )}

        {ready && (
          <>
            {/* 多栏报刊里的一栏：刊名、别名、类别都属于整份报刊（2026-10-27 Hana 定），这里只留栏目名；在长按报刊的面板里改 */}
            {multi ? (
              <>
                <label className="sheet-label" htmlFor="fe-column">栏目名</label>
                <input id="fe-column" className="form-input serif strong" value={column} placeholder={`在「${paper!.name}」里叫什么`} onChange={(e) => setColumn(e.target.value)} />
              </>
            ) : (
              <>
                <label className="sheet-label" htmlFor="fe-title">刊名</label>
                <input id="fe-title" className="form-input serif strong" value={title}
                  placeholder={mode === 'add' ? '留空就用刊物自己的名字' : undefined} onChange={(e) => setTitle(e.target.value)} />

                <label className="sheet-label" htmlFor="fe-latin">别名</label>
                <input id="fe-latin" className={aliasClass('form-input mono faint', latin)} value={latin} autoCorrect="off"
                  placeholder="可不填" onChange={(e) => { setLatin(e.target.value); setLatinTouched(true) }} />
              </>
            )}

            {/* 多栏报刊里的一栏没有类别：类别是整份报刊的（2026-10-24 Hana），在长按报刊的面板里换 */}
            {!multi && (
              <>
            <span className="sheet-label">类别</span>
            <div className="sheet-choices wrap">
              {orderedCategories(meta, categories).map((c) => (
                <button key={c.id} className={catId === c.id ? 'sheet-choice on' : 'sheet-choice'}
                  aria-pressed={catId === c.id} onClick={() => setCatId(c.id)}>
                  {categoryName(meta, c, categories)}
                </button>
              ))}
              <button className={catId === 'new' ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={catId === 'new'}
                onClick={() => setCatId('new')}>新建</button>
            </div>
            {catId === 'new' && (
              <>
                <label className="sheet-label" htmlFor="fe-newcat">新类别</label>
                <div className="form-inline newcat-row">
                  <input id="fe-newcat" className="form-input serif" value={newCat} placeholder="类别名" onChange={(e) => setNewCat(e.target.value)} />
                  <IconPick value={newIcon} onChange={setNewIcon} />
                </div>
              </>
            )}
              </>
            )}

            <span className="sheet-label">选项</span>
            <div className="sheet-choices wrap">
              {OPTION_LABELS.map(([k, label]) => (
                <button key={k} className={opts[k] ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={opts[k]}
                  onClick={() => setOpts((o) => ({ ...o, [k]: !o[k] }))}>
                  {label}
                </button>
              ))}
              <button className={trTitle ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={trTitle} onClick={() => { trTouched.current = true; setTrTitle((v) => !v); setTrHint(false) }}>
                翻译标题
              </button>
            </div>
            {trTitle && <><span /><span className="form-hint">标题自动翻译。</span></>}
            {crawlerHint && opts.crawler && <><span /><span className="form-hint">只有摘要，已勾上抓取全文。</span></>}

            {mode === 'edit' && (
              <>
                <span className="sheet-label">地址</span>
                <span className="form-url">{showUrl(feed!.feed_url)}</span>
                <span className="sheet-label">体检</span>
                <div className="form-inline">
                  <span className="form-hint">{editCheck === 'busy' ? '体检中…' : editCheck === null ? '体检不了' : editCheck ? verdictLine(editCheck) : ''}</span>
                  {editCheck !== 'busy' && <button className="form-text-btn" onClick={examine}>{editCheck ? '再查' : '查一下'}</button>}
                </div>
              </>
            )}
          </>
        )}
      </div>

      {error && <p className="page-error">{error}{diag && <><br />源医生：{diag}。</>}</p>}

      <div className="form-actions">
        {mode === 'edit'
          ? <button className="form-danger" onClick={remove} disabled={busy}>{confirmRemove ? '确认移除（文章一起删掉）' : '移除'}</button>
          : <span />}
        <button className="form-submit" onClick={save} disabled={busy || !ready}>{mode === 'add' ? '添加' : '保存'}</button>
      </div>
    </>
  )
  if (inline) return <div className="feed-inline">{body}</div>
  return (
    <Sheet title={mode === 'add' ? '添加信源' : '编辑信源'} label={no ? `NO. ${pad(no)}` : undefined}
      placement="bottom" anchor={anchor} form focusInput={mode === 'add'} onClose={onClose}
      align={mode === 'edit' ? 'left' : 'right'}>
      {body}
    </Sheet>
  )
}

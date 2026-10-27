// 报刊架：封面视图 / 列表视图，按分类分组，点进去是这份刊物的杂志目录。
// 规则：报刊架上不显示未读数；视图选择记在本机。
// 右上角一排按钮（0.23）：视图（报 / 刊 / 架）、添加信源、报刊管理。
// 长按一本（电脑上右键）：编辑信源。
// 别名、分类图标存在灵媒设置里（api/meta.ts），没设过图标的分类用报纸。「无类别」排在最后。
// 阶段 6 第 3 步（2026-10-24）：一份报刊一张封面（lib/papers.ts）；多栏的封面底下小字写「4 栏」，一栏的和原来一样。
// 长按多栏的报刊：列出各栏目，点哪栏改哪栏；类别是整份报刊的，也在这里换（0.22.1）。
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api, feedNumber, loadShelf, type Category, type Feed } from '../api/miniflux'
import { toast, toastError } from '../components/Toast'
import { categoryIcon, categoryLatin, categoryName, orderedCategories, useMeta, type Meta } from '../api/meta'
import { paperNumber, shortTitle, usePapers, type Paper as PaperT } from '../lib/papers'
import { load, save } from '../api/storage'
import { CategoryIcon } from '../components/CategoryIcon'
import { FeedEditor } from '../components/FeedEditor'
import { IconPlus, IconTree } from '../components/Icons'
import { PageHeader } from '../components/PageHeader'
import { Sheet } from '../components/Sheet'
import { useLongPress } from '../hooks/useLongPress'
import { useShelf } from '../hooks/useShelf'
import { aliasClass, splitTitle } from '../lib/title'
import { BirdNote, Bird, LoadingNote } from '../components/Bird'
import { markReady } from '../components/Welcome'
import { importOpmlFile } from '../lib/opml'
import { autoAround } from '../lib/around'

// 三种视图（3f，2026-10-21 Hana 定）：书脊 / 报纸 / 列表，整个报刊架统一换
type View = 'covers' | 'paper' | 'list'
type Section = { category: Category; papers: PaperT[] }
type Editing = { mode: 'add'; url?: string } | { mode: 'edit'; feed: Feed; anchor: HTMLElement }

const VIEW_KEY = 'mediarium.shelfView'
const FOLD_KEY = 'mediarium.shelfFolded'
// 报 · 刊 · 架：三个视图连起来念就是「报刊架」（2026-10-21 Hana 的冷笑话，2026-10-24 留着）
const VIEW_CHAR: Record<View, string> = { paper: '报', covers: '刊', list: '架' }
const VIEW_NAME: Record<View, string> = { paper: '报纸视图', covers: '杂志视图', list: '列表视图' }
const NEXT: Record<View, View> = { paper: 'covers', covers: 'list', list: 'paper' }
const pad = (n: number) => String(n).padStart(2, '0')

function group(papers: PaperT[]): Section[] {
  const out: Section[] = []
  for (const p of papers) {
    const last = out.at(-1)
    if (last && last.category.id === p.category.id) last.papers.push(p)
    else out.push({ category: p.category, papers: [p] })
  }
  return out
}

export function Shelf() {
  const { data, error } = useShelf()
  useEffect(() => { if (data || error) markReady() }, [data, error])
  useEffect(() => { if (data) autoAround(data.feeds) }, [data])   // 被拦的源静默换路（0.27）
  const meta = useMeta()
  const idx = usePapers()
  const navigate = useNavigate()
  const [view, setView] = useState<View>(() => { const v = load(VIEW_KEY); return v === 'list' || v === 'paper' ? v : 'covers' })

  const opmlInput = useRef<HTMLInputElement>(null)
  const choose = (next: View) => { setView(next); save(VIEW_KEY, next) }
  // 类别能折叠（0.29.2，2026-10-26 Hana 定）：三种视图共用，每个类别各记各的，记在这台设备上
  const [folded, setFolded] = useState<Set<number>>(() => { try { return new Set(JSON.parse(load(FOLD_KEY) ?? '[]')) } catch { return new Set() } })
  const toggleFold = (id: number) => setFolded((f) => { const n = new Set(f); if (n.has(id)) n.delete(id); else n.add(id); save(FOLD_KEY, JSON.stringify([...n])); return n })

  const [editing, setEditing] = useState<Editing | null>(null)
  // 从别的 app 分享网址进来、或设置页「添加信源」：报刊架打开时直接弹出加源面板
  const location = useLocation()
  useEffect(() => {
    const s = location.state as { addUrl?: string } | null
    if (s && typeof s.addUrl === 'string') navigate('/settings/sources/add', { replace: true, state: { depth: 0, root: '/shelf', addUrl: s.addUrl } })
  }, [location.state]) // eslint-disable-line react-hooks/exhaustive-deps
  const closeEditor = useCallback(() => setEditing(null), [])

  const sections = data ? group(idx.papers) : []
  const [columnsOf, setColumnsOf] = useState<{ paper: PaperT; anchor: HTMLElement } | null>(null)
  // 类别是整份报刊的：换类别就把各栏一起搬过去
  const [moving, setMoving] = useState(false)
  const movePaper = async (p: PaperT, cat: number) => {
    setMoving(true)
    try {
      for (const f of p.feeds) if (f.category.id !== cat) await api.updateFeed(f.id, { category_id: cat })
      await loadShelf()
      setColumnsOf(null)
      toast('换好类别了。')
    } catch (e) { toastError((e as Error).message) } finally { setMoving(false) }
  }
  // 长按：一栏的直接改这个源；多栏的先列出栏目
  const hold = (p: PaperT) => (anchor: HTMLElement) => (p.feeds.length > 1 ? setColumnsOf({ paper: p, anchor }) : setEditing({ mode: 'edit', feed: p.lead, anchor }))

  return (
    <>
      {/* 顶栏贴顶、刊头随滚动收成一行，和信息流一样（0.24，Hana：内容长了滚上去不好看）。顶栏一排按钮（0.23，2026-10-24 Hana 定）：视图（显示当前是「报」「刊」「架」哪个，点一下换下一个）、添加信源、报刊管理 */}
      <PageHeader title="报刊架" subtitle="The Newsstand" collapsible actions={<>
        <button className="icon-btn shelf-view-btn" aria-label={`视图：${VIEW_NAME[view]}，点一下换成${VIEW_NAME[NEXT[view]]}`} title={VIEW_NAME[view]}
          onClick={() => choose(NEXT[view])}>{VIEW_CHAR[view]}</button>
        <button className="icon-btn" aria-label="添加信源" title="添加信源" onClick={() => navigate('/settings/sources/add', { state: { depth: 1, root: '/shelf' } })}><IconPlus /></button>
        <button className="icon-btn" aria-label="报刊管理" title="报刊管理" onClick={() => navigate('/shelf/manage', { state: { depth: 1 } })}><IconTree /></button>
      </>} />

      <div className="shelf">
        {error && !data && <BirdNote bird="departing">信没送到。{error}</BirdNote>}
        {!data && !error && <LoadingNote />}
        {data && sections.length === 0 && (
          // 鸟 05 去掉了檐角，站在一个空封面的上沿，头从右上角探出来：封面的边框接替了檐角
          <div className="shelf-empty">
            <div className="shelf-empty-cover"><Bird name="peeking" /></div>
            <p className="page-note">还没有刊物。</p>
            {/* 5c 朋友第一次进来：两个按钮，去接诊或导入 OPML（Hana 定） */}
            <div className="shelf-empty-actions">
              <button onClick={() => navigate('/settings/sources/add', { state: { depth: 1, root: '/shelf' } })}>添加信源</button>
              <button onClick={() => opmlInput.current?.click()}>导入 OPML</button>
            </div>
            <input ref={opmlInput} type="file" accept=".opml,.xml,text/xml,text/x-opml" hidden onChange={(e) => { importOpmlFile(e.target.files?.[0]); e.target.value = '' }} />
          </div>
        )}
        {sections.map((s) => {
          const latin = categoryLatin(meta, s.category.id)
          return (
            <section key={s.category.id} className={folded.has(s.category.id) ? 'shelf-section folded' : 'shelf-section'}>
              <button className="shelf-section-head" aria-expanded={!folded.has(s.category.id)} onClick={() => toggleFold(s.category.id)}>
                <span className="shelf-section-name" role="heading" aria-level={2}><CategoryIcon name={categoryIcon(meta, s.category.id)} size={15} />{categoryName(meta, s.category, data!.categories)}</span>
                <span className="mono-label">{latin && <><span className={aliasClass('alias', latin)}>{latin}</span> · </>}{pad(s.papers.length)}<span className="shelf-fold" aria-hidden="true">›</span></span>
              </button>
              {folded.has(s.category.id) ? null : view === 'paper'
                ? <div className="papers">{s.papers.map((p) => (
                  <Paper key={p.key} paper={p} meta={meta} no={paperNumber(idx, p)}
                    category={categoryName(meta, s.category, data!.categories)} onHold={hold(p)} />
                ))}</div>
                : view === 'covers'
                ? <div className="covers">{s.papers.map((p) => (
                  <Cover key={p.key} paper={p} meta={meta} onHold={hold(p)} />
                ))}</div>
                : <div className="shelf-list">{s.papers.map((p, i) => (
                  <Row key={p.key} paper={p} no={i + 1} meta={meta} onHold={hold(p)} />
                ))}</div>}
            </section>
          )
        })}
      </div>

      {columnsOf && (
        <Sheet title={columnsOf.paper.name} placement="anchor" anchor={columnsOf.anchor} onClose={() => setColumnsOf(null)}>
          <div className="sheet-rows">
            <span className="sheet-label">栏目</span>
            <div className="sheet-col-list">
              {columnsOf.paper.feeds.map((f) => (
                <button key={f.id} className="sheet-col" onClick={() => { const a = columnsOf.anchor; setColumnsOf(null); setEditing({ mode: 'edit', feed: f, anchor: a }) }}>
                  {columnsOf.paper.columns.get(f.id)}<span className="set-row-go" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </div>
          <div className="sheet-rows">
            <span className="sheet-label">类别</span>
            <div className="sheet-choices wrap">
              {orderedCategories(meta, data!.categories).map((c) => {
                const on = columnsOf.paper.category.id === c.id
                return (
                  <button key={c.id} className={on ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={on} disabled={moving}
                    onClick={() => !on && movePaper(columnsOf.paper, c.id)}>
                    {categoryName(meta, c, data!.categories)}
                  </button>
                )
              })}
            </div>
          </div>
          {columnsOf.paper.site && (
            <div className="sheet-actions">
              <button className="sheet-action" onClick={() => { const id = columnsOf.paper.site!; setColumnsOf(null); navigate(`/settings/sources/site/${encodeURIComponent(id)}`, { state: { depth: 1 } }) }}>加栏目</button>
            </div>
          )}
        </Sheet>
      )}

      {editing && data && (
        <FeedEditor mode={editing.mode} feed={editing.mode === 'edit' ? editing.feed : undefined}
          no={editing.mode === 'edit' ? feedNumber(data, editing.feed.id) : null}
          categories={data.categories} anchor={editing.mode === 'edit' ? editing.anchor : null}
          initialUrl={editing.mode === 'add' ? editing.url : undefined}
          onClose={closeEditor} />
      )}
    </>
  )
}

type ItemProps = { paper: PaperT; meta: Meta; onHold: (anchor: HTMLElement) => void }
// 多栏的报刊：封面底下小字「4 栏」；一栏的不标
const cols = (p: PaperT) => (p.feeds.length > 1 ? `${p.feeds.length} 栏` : '')

// 封面刊名装不下就缩小（2026-10-20 Hana 定；名字太长她自己改名）：一档档缩，最小到七成
function useFitTitle(title: string) {
  const box = useRef<HTMLDivElement>(null)
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const b = box.current, t = el.current
    if (!b || !t) return
    const fit = () => {
      let s = 1
      t.style.setProperty('--fit', '1')
      const room = () => b.clientWidth - (b.firstElementChild as HTMLElement).offsetWidth - 6
      while (s > 0.7 && (t.scrollWidth > room() + 0.5 || t.scrollHeight > t.clientHeight + 0.5)) {
        s = Math.round((s - 0.06) * 100) / 100
        t.style.setProperty('--fit', String(s))
      }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(b)
    document.fonts?.ready.then(fit)
    // 字体分片后到的，ready 等不到：每到一批字就重新量一次
    document.fonts?.addEventListener('loadingdone', fit)
    return () => { ro.disconnect(); document.fonts?.removeEventListener('loadingdone', fit) }
  }, [title])
  return { box, el }
}

function Cover({ paper, meta, onHold }: ItemProps) {
  const ref = useRef<HTMLAnchorElement>(null)
  const { pressing, bind } = useLongPress(() => ref.current && onHold(ref.current))
  const fit = useFitTitle(paper.name)
  const n = cols(paper)
  return (
    <Link ref={ref} to={`/shelf/feed/${paper.lead.id}`} state={{ depth: 1 }} draggable={false} {...bind}
      className={pressing ? 'cover pressing' : 'cover'}>
      <div className="cover-top" ref={fit.box}>
        <span className="cover-icon"><CategoryIcon name={categoryIcon(meta, paper.category.id)} /></span>
        <div className="cover-title" ref={fit.el} aria-label={paper.name}>
          {splitTitle(shortTitle(paper.name)).map((p, i) => (
            <span key={i} className={p.latin ? 'cover-part latin' : 'cover-part'} aria-hidden="true">{p.text}</span>
          ))}
        </div>
      </div>
      <span className="cover-foot">
        <span className={aliasClass('cover-latin', paper.latin)}>{paper.latin}</span>
        {n && <span className="mono-label cover-cols">{n}</span>}
      </span>
    </Link>
  )
}

function Row({ paper, no, onHold }: ItemProps & { no: number }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const { pressing, bind } = useLongPress(() => ref.current && onHold(ref.current))
  const latin = paper.latin, n = cols(paper)
  return (
    <Link ref={ref} to={`/shelf/feed/${paper.lead.id}`} state={{ depth: 1 }} draggable={false} {...bind}
      className={pressing ? 'shelf-row pressing' : 'shelf-row'}>
      <span className="shelf-row-no">{pad(no)}</span>
      <div className="shelf-row-text">
        <span className="shelf-row-title">{paper.name}</span>
        {(latin || n) && <span className="shelf-row-sub">{latin && <span className={aliasClass('shelf-row-latin', latin)}>{latin}</span>}{n && <span className="mono-label">{latin ? ' · ' : ''}{n}</span>}</span>}
      </div>
    </Link>
  )
}

// 刊名换一个固定的数：同一个源每次分到同一种版面
function hash(s: string) { let h = 0; for (const c of s) h = (h * 31 + c.codePointAt(0)!) >>> 0; return h }

// 报头装不下就缩：一行放下为止，最小到一半
function useFitMast(title: string) {
  const el = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const t = el.current
    if (!t) return
    const fit = () => {
      let s = 1
      t.style.setProperty('--fit', '1')
      while (s > 0.5 && t.scrollWidth > t.clientWidth + 0.5) { s = Math.round((s - 0.05) * 100) / 100; t.style.setProperty('--fit', String(s)) }
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(t)
    document.fonts?.ready.then(fit)
    return () => ro.disconnect()
  }, [title])
  return el
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

// 报纸视图（3f）：每个信源一份头版。不抓图、不抓头条，只拿刊名做版面：
// 顶上一条细线印分类 / 日期 / 期号，刊名做报头，双线下一条窄栏印别名，再下面是固定的版面纹理
// （灰条代表正文、浅色块代表图片位，不放假字），四种排法按刊名固定分配
function Paper({ paper, no, category, onHold }: ItemProps & { no: number; category: string }) {
  const ref = useRef<HTMLAnchorElement>(null)
  const { pressing, bind } = useLongPress(() => ref.current && onHold(ref.current))
  const name = shortTitle(paper.name)
  const mast = useFitMast(name)
  const latin = paper.latin, n = cols(paper)
  const layout = hash(paper.name) % 4
  const d = new Date()
  const first = [...name.replace(/^[\s《「“"]+/, '')][0] ?? ''
  return (
    <Link ref={ref} to={`/shelf/feed/${paper.lead.id}`} state={{ depth: 1 }} draggable={false} {...bind}
      className={pressing ? 'paper pressing' : 'paper'} aria-label={paper.name}>
      <div className="paper-dateline" aria-hidden="true">
        <span>{category}</span><span>{d.getDate()} {MONTHS[d.getMonth()]}</span><span>{n ? `${n} · ` : ''}NO. {pad(no)}</span>
      </div>
      <div className="paper-mast" ref={mast} aria-hidden="true">{name}</div>
      <div className={aliasClass('paper-motto', latin)} aria-hidden="true">{latin || '\u00a0'}</div>
      <div className={`paper-body l${layout}`} aria-hidden="true">
        {layout === 0 && <><span className="pg-img" /><span className="pg-text" /><span className="pg-text wide" /></>}
        {layout === 1 && <><span className="pg-head" /><span className="pg-drop">{first}</span><span className="pg-text" /><span className="pg-text" /></>}
        {layout === 2 && <><span className="pg-head" /><span className="pg-text" /><span className="pg-text" /><span className="pg-text" /></>}
        {layout === 3 && <><span className="pg-img" /><span className="pg-head" /><span className="pg-text" /><span className="pg-text" /></>}
      </div>
    </Link>
  )
}

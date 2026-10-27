// 报刊管理（阶段 6 第 4 步，2026-10-24 Hana 定；草图：草图/报刊管理 草图 v1.html）。从报刊架顶栏、设置 · 信源进来。
//   顶上：类别（照原来，一排类别块：点一个编辑名称 / 别名 / 图标 / 删除，最后「新建」）
//   下面：三层树 分类 → 报刊 → 栏目，都能折叠（折叠记在本机）；报刊默认收起，一栏的没有展开这一层
//   手机上不拖拽，每行一个「…」；宽屏能把报刊拖到分类上（分类展开、收起都能放）。栏目不拖，纠错走「…」
//   报刊从信源长出来，不能新建空白报刊；只能拆开、并入（规则见 lib/paperOps.ts）
//   多选只在报刊这一层：换类别、退订整本
//   健康不在这里：归源医生（Hana：报刊管理只管策展）
//   排序：分类照原来（无类别最后），报刊、栏目按名字（lib/papers.ts）
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { loadShelf, type Category, type Feed } from '../api/miniflux'
import { categoryIcon, categoryName, ensureUncategorized, orderedCategories, uncategorizedId, useMeta } from '../api/meta'
import { load, save } from '../api/storage'
import { CategoryEditor } from '../components/CategoryEditor'
import { CategoryIcon } from '../components/CategoryIcon'
import { FeedEditor } from '../components/FeedEditor'
import { IconBack } from '../components/Icons'
import { Sheet } from '../components/Sheet'
import { depthOf, useBack } from '../hooks/useDeepNav'
import { BirdNote, LoadingNote } from '../components/Bird'
import { toast, toastError } from '../components/Toast'
import { markReady } from '../components/Welcome'
import { usePapers, type Paper } from '../lib/papers'
import { canMerge, mergeInto, mergeTargets, movePaper, renameColumn, renamePaper, splitColumn, unsubscribeColumn, unsubscribePaper } from '../lib/paperOps'
import { instanceLabel, rsshubRoute } from '../lib/doctor'
import { ensureHub } from '../lib/hub'
import { aliasClass } from '../lib/title'

const FOLD_KEY = 'mediarium.manageFold'
const DRAG_TYPE = 'application/x-mediarium-paper'
type Fold = { cats: number[]; papers: string[] }   // 收起的分类、展开的报刊
const readFold = (): Fold => { try { const f = JSON.parse(load(FOLD_KEY) ?? ''); return { cats: f.cats ?? [], papers: f.papers ?? [] } } catch { return { cats: [], papers: [] } } }
const pad = (n: number) => String(n).padStart(2, '0')
const fromLabel = (f: Feed) => (rsshubRoute(f.feed_url) ? instanceLabel(f.feed_url) : '官方 RSS')
const canDrag = () => window.matchMedia('(min-width: 720px) and (pointer: fine)').matches

type Menu =
  | { kind: 'paper'; paper: Paper; anchor: HTMLElement }
  | { kind: 'column'; paper: Paper; feed: Feed; anchor: HTMLElement }
  | { kind: 'rename'; paper: Paper; anchor: HTMLElement }
  | { kind: 'column-name'; paper: Paper; feed: Feed; anchor: HTMLElement }
  | { kind: 'category'; paper: Paper; anchor: HTMLElement }
  | { kind: 'merge'; paper: Paper; feeds: Feed[]; anchor: HTMLElement }
  | { kind: 'drop-paper'; paper: Paper; anchor: HTMLElement }
  | { kind: 'drop-column'; paper: Paper; feed: Feed; anchor: HTMLElement }
  | { kind: 'feed'; feed: Feed; anchor: HTMLElement }
  | { kind: 'cat-edit'; category?: Category; anchor: HTMLElement | null }
  | { kind: 'batch-cat'; anchor: HTMLElement }
  | { kind: 'batch-drop'; anchor: HTMLElement }

export function Manage() {
  const back = useBack('/shelf')
  const navigate = useNavigate()
  const { state } = useLocation()
  const idx = usePapers()
  const { data } = idx
  const meta = useMeta()
  const [error] = useState('')
  const [menu, setMenu] = useState<Menu | null>(null)
  const [busy, setBusy] = useState(false)
  const [fold, setFold] = useState<Fold>(readFold)
  const [selecting, setSelecting] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [dropOn, setDropOn] = useState<number | null>(null)
  const newCatBtn = useRef<HTMLButtonElement>(null)
  const batchCatBtn = useRef<HTMLButtonElement>(null)
  const batchDropBtn = useRef<HTMLButtonElement>(null)

  useEffect(() => { document.title = '报刊管理'; markReady(); ensureHub().catch(() => {}) }, [])
  // 进来时把「无类别」认好（没有就建一个），删类别、移动都要用到
  useEffect(() => { if (data) ensureUncategorized(meta, data.categories).then(() => loadShelf()).catch(() => {}) }, [!!data]) // eslint-disable-line react-hooks/exhaustive-deps
  const close = useCallback(() => setMenu(null), [])
  const setF = (f: Fold) => { setFold(f); save(FOLD_KEY, JSON.stringify(f)) }

  const categories = data ? orderedCategories(meta, data.categories) : []
  const uncat = data ? uncategorizedId(meta, data.categories) : null
  const papersOf = (cid: number) => idx.papers.filter((p) => p.category.id === cid)
  const catName = (c: Category) => categoryName(meta, c, data!.categories)
  const isOpenCat = (cid: number) => !fold.cats.includes(cid)
  const isOpenPaper = (p: Paper) => p.feeds.length > 1 && fold.papers.includes(p.key)
  const multi = idx.papers.filter((p) => p.feeds.length > 1)
  const allOpen = categories.every((c) => isOpenCat(c.id)) && multi.every((p) => fold.papers.includes(p.key))
  const toggleAll = () => setF(allOpen ? { cats: categories.map((c) => c.id), papers: [] } : { cats: [], papers: multi.map((p) => p.key) })

  // 一件事：做完刷新、收面板、出提示；出错就说
  const run = async (f: () => Promise<void>, ok: string) => {
    setBusy(true)
    try { await f(); setMenu(null); toast(ok) } catch (e) { toastError((e as Error).message) } finally { setBusy(false) }
  }

  // ——— 多选（只在报刊这一层）———
  const picked = idx.papers.filter((p) => selected.has(p.key + '|' + p.category.id))
  const keyOf = (p: Paper) => p.key + '|' + p.category.id
  const toggle = (p: Paper) => setSelected((s) => { const n = new Set(s); if (n.has(keyOf(p))) n.delete(keyOf(p)); else n.add(keyOf(p)); return n })
  const stopSelecting = () => { setSelecting(false); setSelected(new Set()) }

  // ——— 宽屏拖拽：报刊拖到分类上 ———
  const onDragStart = (p: Paper, e: DragEvent) => {
    const keys = selecting && selected.has(keyOf(p)) ? [...selected] : [keyOf(p)]
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(keys))
    e.dataTransfer.effectAllowed = 'move'
  }
  const dropProps = (cid: number) => ({
    onDragOver: (e: DragEvent) => { if (e.dataTransfer.types.includes(DRAG_TYPE)) { e.preventDefault(); setDropOn(cid) } },
    onDragLeave: () => setDropOn((d) => (d === cid ? null : d)),
    onDrop: (e: DragEvent) => {
      e.preventDefault(); setDropOn(null)
      let keys: string[] = []
      try { keys = JSON.parse(e.dataTransfer.getData(DRAG_TYPE)) } catch { return }
      const list = idx.papers.filter((p) => keys.includes(keyOf(p)) && p.category.id !== cid)
      if (!list.length) return
      const name = data?.categories.find((c) => c.id === cid)
      run(async () => { for (const p of list) await movePaper(p, cid) }, `已把 ${list.length} 本移到「${name ? catName(name) : ''}」。`)
    },
  })

  const deeper = { ...(state as object ?? {}), depth: depthOf(state) + 1 }
  const anchorOf = (e: MouseEvent<HTMLElement>) => e.currentTarget

  return (
    <div className="manage">
      <div className="deep-bar">
        <button className="icon-btn manage-back" aria-label="返回" onClick={back}><IconBack /></button>
      </div>
      <header className="manage-head"><h1 className="mag-title">报刊管理</h1></header>

      {error && !data && <div className="manage-note"><BirdNote bird="departing">信没送到。{error}</BirdNote></div>}
      {!data && <div className="manage-note"><LoadingNote /></div>}

      {data && (
        <div className="manage-body">
          {/* 类别：照原来 */}
          <section className="manage-block" aria-labelledby="mb-cats">
            <div className="manage-block-head">
              <h2 id="mb-cats" className="shelf-section-name block-title">类别</h2>
              <span className="mono-label">CATEGORIES · {pad(categories.length)}</span>
            </div>
            <div className="tag-list">
              {categories.map((c) => (
                <button key={c.id} {...dropProps(c.id)} className={dropOn === c.id ? 'tag drop' : 'tag'}
                  onClick={(e) => setMenu({ kind: 'cat-edit', category: c, anchor: anchorOf(e) })}>
                  <CategoryIcon name={categoryIcon(meta, c.id)} /><span>{catName(c)}</span><span className="tag-count">{papersOf(c.id).length}</span>
                </button>
              ))}
              <button ref={newCatBtn} className="tag new" onClick={() => setMenu({ kind: 'cat-edit', anchor: newCatBtn.current })}>新建</button>
            </div>
          </section>

          {/* 报刊 */}
          <section className="manage-block" aria-labelledby="mb-papers">
            <div className="manage-block-head">
              <h2 id="mb-papers" className="shelf-section-name block-title">报刊</h2>
              <span className="pm-tools">
                <button className="manage-edit" onClick={toggleAll}>{allOpen ? '全部收起' : '全部展开'}</button>
                <button className="manage-edit" onClick={() => (selecting ? stopSelecting() : setSelecting(true))}>{selecting ? '完成' : '多选'}</button>
              </span>
            </div>

            {categories.map((c) => {
              const list = papersOf(c.id), open = isOpenCat(c.id)
              return (
                <div key={c.id} className="pm-cat">
                  <button className={dropOn === c.id ? 'pm-cat-head drop' : 'pm-cat-head'} {...dropProps(c.id)} aria-expanded={open}
                    onClick={() => setF({ ...fold, cats: open ? [...fold.cats, c.id] : fold.cats.filter((x) => x !== c.id) })}>
                    <span className="pm-tw" aria-hidden="true">{open ? '⌄' : '›'}</span>
                    <span className="manage-cat-icon"><CategoryIcon name={categoryIcon(meta, c.id)} /></span>
                    <span className="manage-group-name">{catName(c)}</span>
                    <span className="mono-label pm-count">{pad(list.length)}</span>
                  </button>
                  {open && list.length === 0 && <p className="page-note manage-empty">还没有报刊。</p>}
                  {open && (
                    <ul className="manage-list">
                      {list.map((p) => {
                        const po = isOpenPaper(p), on = selected.has(keyOf(p))
                        return (
                          <li key={keyOf(p)}>
                            <div className={['pm-paper', on && 'on'].filter(Boolean).join(' ')} draggable={canDrag()} onDragStart={(e) => onDragStart(p, e)}>
                              <button className="pm-paper-main" aria-expanded={p.feeds.length > 1 ? po : undefined}
                                onClick={() => (selecting ? toggle(p) : p.feeds.length > 1 && setF({ ...fold, papers: po ? fold.papers.filter((k) => k !== p.key) : [...fold.papers, p.key] }))}>
                                <span className="pm-tw" aria-hidden="true">{selecting ? <span className="manage-check" /> : p.feeds.length > 1 ? (po ? '⌄' : '›') : ''}</span>
                                <span className="shelf-row-text">
                                  <span className="shelf-row-title">{p.name}</span>
                                  {p.latin && <span className={aliasClass('shelf-row-latin', p.latin)}>{p.latin}</span>}
                                </span>
                              </button>
                              <span className="mono-label pm-cols">{p.feeds.length > 1 ? `${p.feeds.length} 栏` : ''}</span>
                              {!selecting && <button className="pm-dots" aria-label={`${p.name} 的操作`} onClick={(e) => setMenu({ kind: 'paper', paper: p, anchor: anchorOf(e) })}>…</button>}
                            </div>
                            {po && !selecting && (
                              <ul className="pm-columns">
                                {p.feeds.map((f) => (
                                  <li key={f.id} className="pm-col">
                                    <span className="pm-col-name">{p.columns.get(f.id)}</span>
                                    <span className="mono-label pm-from">{fromLabel(f)}</span>
                                    <button className="pm-dots" aria-label={`${p.columns.get(f.id)} 的操作`} onClick={(e) => setMenu({ kind: 'column', paper: p, feed: f, anchor: anchorOf(e) })}>…</button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </div>
              )
            })}
          </section>
        </div>
      )}

      {selecting && (
        <div className="manage-bar">
          <span className="mono-label">已选 {picked.length} 本</span>
          <button ref={batchCatBtn} className="manage-bar-btn" disabled={!picked.length} onClick={() => setMenu({ kind: 'batch-cat', anchor: batchCatBtn.current! })}>换类别</button>
          <button ref={batchDropBtn} className="manage-bar-btn danger" disabled={!picked.length} onClick={() => setMenu({ kind: 'batch-drop', anchor: batchDropBtn.current! })}>退订</button>
        </div>
      )}

      {/* ——— 报刊的「…」 ——— */}
      {menu?.kind === 'paper' && (
        <Sheet title={menu.paper.name} placement="anchor" anchor={menu.anchor} onClose={close}>
          <div className="sheet-actions">
            <button className="sheet-action" onClick={() => setMenu({ kind: 'rename', paper: menu.paper, anchor: menu.anchor })}>改刊名和别名</button>
            <button className="sheet-action" onClick={() => setMenu({ kind: 'category', paper: menu.paper, anchor: menu.anchor })}>换类别</button>
            {menu.paper.feeds.length === 1 && <button className="sheet-action" onClick={() => setMenu({ kind: 'feed', feed: menu.paper.lead, anchor: menu.anchor })}>信源设置</button>}
            {menu.paper.site && <button className="sheet-action" onClick={() => { const id = menu.paper.site!; close(); navigate(`/settings/sources/site/${encodeURIComponent(id)}`, { state: deeper }) }}>加栏目</button>}
            <button className="sheet-action" onClick={() => setMenu({ kind: 'merge', paper: menu.paper, feeds: menu.paper.feeds, anchor: menu.anchor })}>并入别的报刊…</button>
            <button className="sheet-action danger" onClick={() => setMenu({ kind: 'drop-paper', paper: menu.paper, anchor: menu.anchor })}>退订整本</button>
          </div>
        </Sheet>
      )}
      {/* ——— 栏目的「…」 ——— */}
      {menu?.kind === 'column' && (
        <Sheet title={menu.paper.columns.get(menu.feed.id) ?? menu.feed.title} placement="anchor" anchor={menu.anchor} onClose={close}>
          <div className="sheet-actions">
            <button className="sheet-action" onClick={() => setMenu({ kind: 'column-name', paper: menu.paper, feed: menu.feed, anchor: menu.anchor })}>改栏目名</button>
            <button className="sheet-action" onClick={() => setMenu({ kind: 'feed', feed: menu.feed, anchor: menu.anchor })}>信源设置</button>
            <button className="sheet-action" disabled={busy} onClick={() => run(() => splitColumn(menu.paper, menu.feed), '拆出来了。')}>拆成单独一本</button>
            <button className="sheet-action" onClick={() => setMenu({ kind: 'merge', paper: menu.paper, feeds: [menu.feed], anchor: menu.anchor })}>并入别的报刊…</button>
            <button className="sheet-action danger" onClick={() => setMenu({ kind: 'drop-column', paper: menu.paper, feed: menu.feed, anchor: menu.anchor })}>退订</button>
          </div>
        </Sheet>
      )}
      {menu?.kind === 'rename' && <RenameSheet paper={menu.paper} others={idx.papers.filter((p) => p !== menu.paper).map((p) => p.name)} anchor={menu.anchor} busy={busy} onClose={close}
        onSave={(n, l) => run(() => renamePaper(menu.paper, n, l), '改好了。')} />}
      {menu?.kind === 'column-name' && <ColumnSheet paper={menu.paper} feed={menu.feed} anchor={menu.anchor} busy={busy} onClose={close}
        onSave={(c) => run(() => renameColumn(menu.paper, menu.feed, c), '改好了。')} />}
      {menu?.kind === 'category' && data && (
        <Sheet title={`把「${menu.paper.name}」放进`} placement="anchor" anchor={menu.anchor} onClose={close}>
          <div className="sheet-actions">
            {categories.map((c) => (
              <button key={c.id} className={c.id === menu.paper.category.id ? 'sheet-action with-icon on' : 'sheet-action with-icon'} disabled={busy || c.id === menu.paper.category.id}
                onClick={() => run(() => movePaper(menu.paper, c.id), `移到「${catName(c)}」了。`)}>
                <CategoryIcon name={categoryIcon(meta, c.id)} />{catName(c)}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {menu?.kind === 'merge' && <MergeSheet paper={menu.paper} feeds={menu.feeds} papers={idx.papers} anchor={menu.anchor} busy={busy} onClose={close}
        onMerge={(t) => run(() => mergeInto(menu.paper, menu.feeds, t), `并进《${t.name}》了。`)} />}
      {menu?.kind === 'drop-paper' && (
        <Sheet title={`退订「${menu.paper.name}」？`} placement="anchor" anchor={menu.anchor} onClose={close}>
          <p className="sheet-note">{menu.paper.feeds.length > 1 ? `${menu.paper.feeds.length} 栏一起退订，` : ''}文章和收藏一起删掉，不能恢复。</p>
          <div className="sheet-actions">
            <button className="sheet-action danger" disabled={busy} onClick={() => run(() => unsubscribePaper(menu.paper), '退订了。')}>退订</button>
            <button className="sheet-action quiet" onClick={close}>取消</button>
          </div>
        </Sheet>
      )}
      {menu?.kind === 'drop-column' && (
        <Sheet title={`退订「${menu.paper.columns.get(menu.feed.id)}」？`} placement="anchor" anchor={menu.anchor} onClose={close}>
          <p className="sheet-note">文章和收藏一起删掉，不能恢复。</p>
          <div className="sheet-actions">
            <button className="sheet-action danger" disabled={busy} onClick={() => run(() => unsubscribeColumn(menu.paper, menu.feed), '退订了。')}>退订</button>
            <button className="sheet-action quiet" onClick={close}>取消</button>
          </div>
        </Sheet>
      )}
      {menu?.kind === 'batch-cat' && data && (
        <Sheet title={`把 ${picked.length} 本放进`} placement="bottom" anchor={menu.anchor} inset={0} onClose={close}>
          <div className="sheet-actions">
            {categories.map((c) => (
              <button key={c.id} className="sheet-action with-icon" disabled={busy}
                onClick={() => run(async () => { for (const p of picked) await movePaper(p, c.id); setSelected(new Set()) }, `已把 ${picked.length} 本移到「${catName(c)}」。`)}>
                <CategoryIcon name={categoryIcon(meta, c.id)} />{catName(c)}
              </button>
            ))}
          </div>
        </Sheet>
      )}
      {menu?.kind === 'batch-drop' && (
        <Sheet title={`退订 ${picked.length} 本？`} placement="bottom" anchor={menu.anchor} inset={0} onClose={close}>
          <p className="sheet-note">一共 {picked.reduce((a, p) => a + p.feeds.length, 0)} 栏，文章和收藏一起删掉，不能恢复。</p>
          <div className="sheet-actions">
            <button className="sheet-action danger" disabled={busy} onClick={() => run(async () => { for (const p of picked) await unsubscribePaper(p); setSelected(new Set()) }, '退订了。')}>退订</button>
            <button className="sheet-action quiet" onClick={close}>取消</button>
          </div>
        </Sheet>
      )}
      {menu?.kind === 'feed' && data && (
        <FeedEditor mode="edit" feed={menu.feed} categories={data.categories} anchor={menu.anchor} onClose={close} />
      )}
      {menu?.kind === 'cat-edit' && data && (
        <CategoryEditor category={menu.category} uncategorized={!!menu.category && menu.category.id === uncat}
          feeds={menu.category ? data.feeds.filter((f) => f.category.id === menu.category!.id) : []} categories={data.categories}
          anchor={menu.anchor} onClose={close} />
      )}
    </div>
  )
}

// 改刊名和别名：小面板（和长按面板同一种）
// 和别的报刊同名：允许（碰巧同名的报刊是有的），只提醒一句，改名不会顺带合并（2026-10-24 Hana 问）
function RenameSheet({ paper, others, anchor, busy, onClose, onSave }: { paper: Paper; others: string[]; anchor: HTMLElement; busy: boolean; onClose: () => void; onSave: (name: string, latin: string) => void }) {
  const [name, setName] = useState(paper.name)
  const [latin, setLatin] = useState(paper.latin)
  const clash = !!name.trim() && name.trim() !== paper.name && others.includes(name.trim())
  return (
    <Sheet title="改刊名" placement="anchor" anchor={anchor} form focusInput onClose={onClose}>
      <div className="form-rows">
        <label className="sheet-label" htmlFor="pm-name">刊名</label>
        <input id="pm-name" className="form-input serif strong" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="sheet-label" htmlFor="pm-latin">别名</label>
        <input id="pm-latin" className={aliasClass('form-input mono faint', latin)} value={latin} autoCorrect="off" placeholder="可不填" onChange={(e) => setLatin(e.target.value)} />
      </div>
      {clash && <p className="sheet-note">已经有一本叫这个名字了，要合在一起用「并入」。</p>}
      <div className="form-actions"><span /><button className="form-submit" disabled={busy || !name.trim()} onClick={() => onSave(name, latin)}>保存</button></div>
    </Sheet>
  )
}
function ColumnSheet({ paper, feed, anchor, busy, onClose, onSave }: { paper: Paper; feed: Feed; anchor: HTMLElement; busy: boolean; onClose: () => void; onSave: (c: string) => void }) {
  const [col, setCol] = useState(paper.columns.get(feed.id) ?? '')
  return (
    <Sheet title="改栏目名" placement="anchor" anchor={anchor} form focusInput onClose={onClose}>
      <div className="form-rows">
        <label className="sheet-label" htmlFor="pm-col">栏目名</label>
        <input id="pm-col" className="form-input serif" value={col} placeholder={`在「${paper.name}」里叫什么`} onChange={(e) => setCol(e.target.value)} />
      </div>
      <div className="form-actions"><span /><button className="form-submit" disabled={busy || !col.trim()} onClick={() => onSave(col)}>保存</button></div>
    </Sheet>
  )
}

// 并入：可能是这本（几本）排前面；目录里认得、又不是同一家的灰掉
function MergeSheet({ paper, feeds, papers, anchor, busy, onClose, onMerge }: { paper: Paper; feeds: Feed[]; papers: Paper[]; anchor: HTMLElement; busy: boolean; onClose: () => void; onMerge: (t: Paper) => void }) {
  const srcName = feeds.length === 1 && paper.feeds.length > 1 ? `${paper.name} · ${paper.columns.get(feeds[0].id)}` : paper.name
  const { near, other } = useMemo(() => mergeTargets({ feeds, name: srcName }, papers), [feeds, srcName, papers])
  // 只有「同一个网站」才替你先选上；名字相近的要自己点（猜错了一点「并入」就并错了）
  const [pick, setPick] = useState<Paper | null>(() => near.find((r) => r.ok && r.why.startsWith('同一个网站'))?.paper ?? null)
  const row = (r: { paper: Paper; why: string; ok: boolean }) => (
    <button key={r.paper.key + r.paper.category.id} className={['pm-pick', pick === r.paper && 'on', !r.ok && 'off'].filter(Boolean).join(' ')}
      disabled={!r.ok} aria-pressed={pick === r.paper} onClick={() => setPick(r.paper)}>
      <span>{r.paper.name}</span>
      {!r.ok ? <span className="pm-why">和这本不是同一家</span> : r.why && <span className="pm-why">{r.why}</span>}
    </button>
  )
  return (
    <Sheet title={`把「${srcName}」并入`} placement="bottom" anchor={anchor} onClose={onClose}>
      <div className="pm-merge">
        {near.length > 0 && <><span className="sheet-label">{near.length > 1 ? '可能是这几本' : '可能是这本'}</span>{near.map(row)}</>}
        {other.length > 0 && <><span className="sheet-label">其他报刊</span>{other.map(row)}</>}
        {!near.length && !other.length && <p className="sheet-note">没有别的报刊。</p>}
      </div>
      <div className="form-actions"><button className="form-text-btn" onClick={onClose}>算了</button><button className="form-text-btn" disabled={busy || !pick || !canMerge(feeds, pick)} onClick={() => pick && onMerge(pick)}>并入</button></div>
    </Sheet>
  )
}

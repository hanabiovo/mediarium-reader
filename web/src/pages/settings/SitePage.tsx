// 添加信源 · 站点页（阶段 6，草图 v3，2026-10-23 Hana 定）：一个站点 = 一份报刊。
//   顶上：刊名 / 别名 / 放进类别（已经有这份报刊时默认折起）；官方 RSS 源（按站点域名找）
//   路由：点一行原地展开 → 参数 →「检索信源」→ 各实例（灵媒自建置顶）→ 信源选项 →「加入」
//   栏目：已订的（哪台在拉、换实例、退订）、新加入的；页底一个「保存」，报刊信息和栏目增减一起生效
import { markReady } from '../../components/Welcome'
import { useEffect, useMemo, useState } from 'react'
import { useLocation, useParams } from 'react-router-dom'
import { api, loadShelf, type Feed } from '../../api/miniflux'
import { useMeta } from '../../api/meta'
import { useShelf } from '../../hooks/useShelf'
import { useBack } from '../../hooks/useDeepNav'
import { LoadingNote } from '../../components/Bird'
import { IconBack } from '../../components/Icons'
import { toast, toastError } from '../../components/Toast'
import { Candidates, OptionChips, PaperFields, defaultCat, defaultOpts, type PaperForm, type Picked, type SourceOpts } from '../../components/SourcePick'
import { ensureHub } from '../../lib/hub'
import { changeFeedUrl, checkup, instanceLabel, original, retarget, routeOn, rsshubRoute, usable, verdictLine, type Checkup } from '../../lib/doctor'
import { buildPath, feedsOfSite, flag, matchTemplate, paramInfo, paramNames, routeKey, routeNeeds, routeRank, routeTitle, siteDetail, type Route, type SiteDetail } from '../../lib/catalog'
import { savePaper, type Add } from '../../lib/subscribe'

type Staged = Add & { label: string; error?: string; check?: Checkup | null | 'busy' }
const checkLine = (c: Checkup | null | 'busy' | undefined) => (c === 'busy' ? '体检中…' : c === null ? '体检不了' : c ? (usable(c) ? `能取到 · ${verdictLine(c)}` : verdictLine(c)) : '')

// ——— 一条路由的展开区 ———
function RouteEditor({ site, route, preset, auto, feeds, taken, staged, onAdd }: {
  site: string; route: Route; preset?: Record<string, string>; auto?: boolean
  feeds: Feed[]; taken: Map<string, string>; staged: Map<string, Staged>; onAdd: (a: Staged) => void
}) {
  const info = useMemo(() => paramInfo(route, site), [route, site])
  const names = paramNames(route.path)
  // 收起来的参数（附加设置之类，0.29.1）：放在「附加参数」里
  const main = names.filter((n) => !info[n].fold), folded = names.filter((n) => info[n].fold)
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...preset }))
  const [extra, setExtra] = useState(preset?.__extra ?? '')
  const [more, setMore] = useState(!!preset?.__extra || names.some((n) => info[n].fold && !!preset?.[n]))
  const [own, setOwn] = useState<Record<string, boolean>>({})
  const [filter, setFilter] = useState<Record<string, string>>({})
  const built = buildPath(site, route.path, values, extra)
  const [cands, setCands] = useState<string[] | null>(null)
  const [picked, setPicked] = useState<Picked | null>(null)
  const [opts, setOpts] = useState<SourceOpts>(defaultOpts(null))
  useEffect(() => { setCands(null); setPicked(null) }, [built])
  const look = () => { if (built) { setCands(routeOn(built, feeds, 6)); setPicked(null) } }
  useEffect(() => { if (auto && built) look() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const dupOf = built ? taken.get(built.replace(/\/$/, '')) : undefined
  const mine = built ? staged.get(built.replace(/\/$/, '')) : undefined   // 已经加入、还没保存的：照样能重新检索、换一台（0.21.2）

  const label = () => {
    for (const n of names) { const o = info[n].options.find((x) => x.value === values[n]); if (o) return o.label }
    const v = names.map((n) => values[n]).filter(Boolean).join(' · ')
    return v ? `${route.name} · ${v}` : route.name
  }

  const param = (n: string) => {
        const { options, label, hint } = info[n]
        const optional = /:\w+(\{[^}]*\})?\?/.test(route.path.split('/').find((s) => s.startsWith(':' + n)) ?? '')
        const f = (filter[n] ?? '').trim()
        const shown = f ? options.filter((o) => o.label.includes(f) || o.value.includes(f)) : options
        const free = own[n] || !options.length
        const set = (v: string) => setValues((x) => ({ ...x, [n]: v }))
        return (
          <div key={n} className="sp-param">
            <span className="sheet-label">{label}</span>
            <div className="sp-param-in">
              {!free ? (
                <>
                  {options.length > 16 && <input className="form-input sp-filter" placeholder="搜一下" value={filter[n] ?? ''} onChange={(e) => setFilter((x) => ({ ...x, [n]: e.target.value }))} />}
                  <div className={`sheet-choices wrap sp-opts${options.length > 16 ? ' long' : ''}`}>
                    {optional && <button className={!values[n] ? 'sheet-choice on' : 'sheet-choice'} onClick={() => set('')}>默认</button>}
                    {shown.map((o) => (
                      <button key={o.value} className={values[n] === o.value ? 'sheet-choice on' : 'sheet-choice'} onClick={() => set(o.value)}>
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <button className="form-text-btn sp-own" onClick={() => setOwn((x) => ({ ...x, [n]: true }))}>列表里没有？手动填</button>
                </>
              ) : (
                <>
                  <input className="form-input mono" value={values[n] ?? ''} placeholder={optional ? '可不填' : '必填'} autoCapitalize="off" autoCorrect="off" onChange={(e) => set(e.target.value)} />
                  {hint && <p className="form-hint sp-desc">{hint}</p>}
                  {own[n] && <button className="form-text-btn sp-own" onClick={() => setOwn((x) => ({ ...x, [n]: false }))}>回到列表</button>}
                </>
              )}
            </div>
          </div>
        )
  }

  return (
    <div className="sp-route-body">
      {main.map(param)}

      <button className="form-text-btn sp-more" onClick={() => setMore((v) => !v)}>{more ? '附加参数 ⌃' : '附加参数 ›'}</button>
      {more && folded.map(param)}
      {more && (
        <div className="sp-param">
          <span className="sheet-label">附加参数</span>
          <div className="sp-param-in">
            <input className="form-input mono" value={extra} placeholder="如 old=yes，看不懂可以不填" autoCapitalize="off" autoCorrect="off" onChange={(e) => setExtra(e.target.value)} />
            {route.description && <details className="sp-fold"><summary>路由说明</summary><pre className="sp-pre">{route.description.replace(/`/g, '')}</pre></details>}
          </div>
        </div>
      )}

      {dupOf ? <p className="form-hint sp-dup">已订（{dupOf}）。要换实例，去底下栏目列表。</p> : (
        <div className="sp-look">
          <span className="form-hint">{mine ? `已加入（${instanceLabel(mine.url)}），保存后生效。` : built ? '' : `先${main.filter((n) => !values[n]).map((n) => (info[n].options.length && !own[n] ? '选' : '填') + info[n].label)[0] ?? '填好参数'}`}</span>
          <button className="form-text-btn" disabled={!built} onClick={look}>{mine ? '重新检索信源' : '检索信源'}</button>
        </div>
      )}
      {cands && !dupOf && (
        <>
          <Candidates list={cands.map((url) => ({ url }))} kind="instance" picked={picked?.url ?? ''} onPick={(p) => { setPicked(p); setOpts(defaultOpts(p.check)) }} />
          {picked && (
            <>
              <div className="sp-param"><span className="sheet-label">选项</span><OptionChips value={opts} onChange={setOpts} /></div>
              <div className="form-actions"><span /><button className="form-text-btn sp-add" onClick={() => { onAdd({ key: built!, url: picked.url, column: label(), label: label(), opts, check: picked.check }); setCands(null); setPicked(null) }}>{mine ? '换成这个 ↓' : '加入 ↓'}</button></div>
            </>
          )}
        </>
      )}
    </div>
  )
}

// ——— 新加入、还没保存的栏目「换实例」：只换这一条要订的地址（0.21.2） ———
function MoveStaged({ item, feeds, onPick, onDone }: { item: Staged; feeds: Feed[]; onPick: (p: Picked) => void; onDone: () => void }) {
  const [picked, setPicked] = useState<Picked | null>(null)
  return (
    <div className="sp-move">
      <Candidates list={routeOn(item.key, feeds, 6, item.url).map((url) => ({ url }))} kind="instance" picked={picked?.url ?? ''} onPick={setPicked} />
      <div className="form-actions"><button className="form-text-btn" onClick={onDone}>算了</button><button className="form-text-btn" disabled={!picked} onClick={() => { onPick(picked!); onDone() }}>换到这台</button></div>
    </div>
  )
}

// ——— 已订栏目的「换实例」 ———
function Move({ feed, feeds, onDone }: { feed: Feed; feeds: Feed[]; onDone: () => void }) {
  const route = rsshubRoute(feed.feed_url)!
  const [picked, setPicked] = useState<Picked | null>(null)
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!picked) return
    setBusy(true)
    try { await changeFeedUrl(feed.id, await retarget(feed.feed_url, picked.url)); await api.refreshFeed(feed.id).catch(() => {}); await loadShelf(); toast(`换到${instanceLabel(picked.url)}了。`); onDone() }
    catch (e) { toastError((e as Error).message) } finally { setBusy(false) }
  }
  return (
    <div className="sp-move">
      <Candidates list={routeOn(route, feeds, 6, original(feed.feed_url)).map((url) => ({ url }))} kind="instance" picked={picked?.url ?? ''} onPick={setPicked} />
      <div className="form-actions"><button className="form-text-btn" onClick={onDone}>算了</button><button className="form-text-btn" disabled={!picked || busy} onClick={go}>换到这台</button></div>
    </div>
  )
}

export function SitePage() {
  const { id = '' } = useParams()
  const { state } = useLocation()
  const st = (state ?? {}) as { route?: string; matched?: string[] }
  const backTo = useBack('/settings/sources/add')
  const { data } = useShelf()
  const meta = useMeta()
  const [site, setSite] = useState<SiteDetail | null>(null)
  const [err, setErr] = useState('')
  useEffect(() => { ensureHub().then(() => siteDetail(id)).then(setSite).catch((e) => setErr((e as Error).message)) }, [id])
  useEffect(() => { if (site) document.title = site.name }, [site])
  useEffect(() => { markReady() }, [])

  const existing = useMemo(() => (site && data ? feedsOfSite(meta, data.feeds, { id, url: site.url }) : []), [site, data, meta, id])
  const known = !!meta.papers?.[id] || existing.length > 0

  // 报刊信息
  const [form, setForm] = useState<PaperForm | null>(null)
  const [form0, setForm0] = useState('')
  const [paperOpen, setPaperOpen] = useState(false)
  useEffect(() => {
    if (!site || !data || form) return
    const p = meta.papers?.[id]
    const f: PaperForm = { name: p?.name ?? site.name, latin: p?.latin ?? '', cat: existing[0]?.category.id ?? defaultCat(meta, data.categories), newCat: '' }
    setForm(f); setForm0(JSON.stringify(f)); setPaperOpen(!known)
  }, [site, data]) // eslint-disable-line react-hooks/exhaustive-deps

  // 官方 RSS 源：按站点域名找一次
  const [official, setOfficial] = useState<{ url: string; title: string }[] | null>(null)
  useEffect(() => {
    if (!site?.url) { setOfficial([]); return }
    api.discover(`https://${site.url}/`).then((l) => setOfficial(l.map((d) => ({ url: d.url, title: d.title && !/^https?:\/\//.test(d.title) ? d.title : '' })))).catch(() => setOfficial([]))
  }, [site])
  const [offPicked, setOffPicked] = useState<Picked | null>(null)
  const [offOpts, setOffOpts] = useState<SourceOpts>(defaultOpts(null))

  // 栏目增减
  const [adds, setAdds] = useState<Staged[]>([])
  const [removes, setRemoves] = useState<Set<number>>(new Set())
  const [moving, setMoving] = useState<number | null>(null)
  const taken = useMemo(() => {
    const m = new Map<string, string>()
    for (const f of existing) { const k = routeKey(f.feed_url); if (k) m.set(k, instanceLabel(f.feed_url)); m.set(original(f.feed_url), '官方 RSS') }
    return m
  }, [existing])
  const staged = useMemo(() => new Map(adds.map((a) => [a.key.replace(/\/$/, ''), a])), [adds])
  const add = (a: Staged) => {
    const again = adds.some((x) => x.key === a.key)
    setAdds((l) => [...l.filter((x) => x.key !== a.key), a])
    toast(again ? `「${a.label}」换成${instanceLabel(a.url)}了，记得保存。` : `「${a.label}」加入了，记得保存。`)
  }
  const [movingNew, setMovingNew] = useState<string | null>(null)
  const patch = (key: string, p: Partial<Staged>) => setAdds((l) => l.map((x) => (x.key === key ? { ...x, ...p } : x)))
  // 新加入的都换到同一台：换完挨个体检一次，结果写在各自那一行
  const hubAdds = adds.filter((a) => rsshubRoute(a.url))
  const moveAll = async (host: string) => {
    const list = hubAdds.map((a) => ({ key: a.key, url: host + a.key }))
    setAdds((l) => l.map((x) => { const n = list.find((y) => y.key === x.key); return n ? { ...x, url: n.url, error: undefined, check: 'busy' } : x }))
    for (const n of list) patch(n.key, { check: await checkup(n.url) })
  }

  // 路由排序：贴进来 / 认出来的排前面
  const [open, setOpen] = useState<string | null>(null)
  const preset = useMemo(() => {
    if (!site || !st.route) return null
    for (const r of site.routes) { const v = matchTemplate(id, r.path, st.route); if (v) return { path: r.path, values: v } }
    return null
  }, [site]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (preset) setOpen(preset.path) }, [preset])
  const routes = useMemo(() => {
    if (!site) return []
    const first = new Set([...(st.matched ?? []), ...(preset ? [preset.path] : [])])
    const rest = site.routes.filter((r) => !first.has(r.path)).map((r, i) => ({ r, i })).sort((a, b) => routeRank(a.r) - routeRank(b.r) || a.i - b.i).map((x) => x.r)
    return [...site.routes.filter((r) => first.has(r.path)), ...rest]
  }, [site, preset]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = adds.length > 0 || removes.size > 0 || (!!form && JSON.stringify(form) !== form0 && known)
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])
  const back = () => { if (dirty && !window.confirm('还没保存，离开吗？')) return; backTo() }

  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (!form || !data || !site) return
    setSaving(true)
    try {
      const r = await savePaper({ paperId: id, site: id, domain: site.url, form, meta, categories: data.categories, existing, adds, removes: [...removes] })
      const bad = new Map(r.failed.map((f) => [f.key, f.why]))
      const fails = new Map(r.failed.map((f) => [f.key, f]))
      setAdds((l) => l.filter((a) => bad.has(a.key)).map((a) => ({ ...a, error: bad.get(a.key), check: fails.get(a.key)?.check })))
      setRemoves(new Set())
      setForm0(JSON.stringify(form))
      // 进度、成败都写在底部的日志浮层里（0.29）
    } catch { /* 原因写在日志浮层里了 */ } finally { setSaving(false) }
  }

  const head = (
    <div className="deep-bar"><button className="icon-btn manage-back" aria-label="返回" onClick={back}><IconBack /></button></div>
  )
  if (err) return <div className="manage set-page">{head}<div className="manage-body"><p className="page-error">{err}</p></div></div>
  if (!site || !data || !form) return <div className="manage set-page">{head}<div className="manage-body"><LoadingNote /></div></div>

  const catName = data.categories.find((c) => c.id === form.cat)
  const news = adds.length, gone = removes.size
  return (
    <div className="manage set-page">
      {head}
      <header className="manage-head"><h1 className="mag-title">{site.name}</h1><span className="mono-label sp-domain">{site.url}</span></header>
      <div className="manage-body sp-site-page">
        {/* 报刊：刊名、别名、放进类别 */}
        {known && !paperOpen ? (
          <button className="sp-paper-sum" onClick={() => setPaperOpen(true)}>
            <span>{form.name}{form.latin && <span className="mono-label"> · {form.latin}</span>}</span>
            <span className="mono-label">{catName ? (catName.title.toLowerCase() === 'all' ? '无类别' : catName.title) : ''} · 已订 {existing.length} 栏 ›</span>
          </button>
        ) : <PaperFields value={form} onChange={setForm} meta={meta} categories={data.categories} />}

        <section className="sp-block">
          <h2 className="sp-lab">官方 RSS 源</h2>
          {official === null ? <p className="page-note">找着呢…</p> : official.filter((o) => !taken.has(o.url)).length === 0
            ? <p className="page-note">{official.length ? '已订。' : '网站没提供。'}</p> : (
            <>
              <Candidates list={official.filter((o) => !taken.has(o.url))} kind="feed" picked={offPicked?.url ?? ''} onPick={(p) => { setOffPicked(p); setOffOpts(defaultOpts(p.check)) }} />
              {offPicked && (
                <>
                  <div className="sp-param"><span className="sheet-label">选项</span><OptionChips value={offOpts} onChange={setOffOpts} /></div>
                  <div className="form-actions"><span /><button className="form-text-btn sp-add" onClick={() => { add({ key: offPicked.url, url: offPicked.url, column: offPicked.title || '官方 RSS', label: offPicked.title || '官方 RSS', opts: offOpts }); setOffPicked(null) }}>加入 ↓</button></div>
                </>
              )}
            </>
          )}
        </section>

        <section className="sp-block">
          <h2 className="sp-lab">路由</h2>
          <ul className="sp-routes">
            {routes.map((r) => {
              const fl = flag(r), on = open === r.path
              const subs = existing.filter((f) => { const k = routeKey(f.feed_url); return !!k && !!matchTemplate(id, r.path, k) }).length
              return (
                <li key={r.path} className={`sp-route${on ? ' on' : ''}${fl.off ? ' off' : ''}`}>
                  <button className="sp-route-head" disabled={!!fl.off} onClick={() => setOpen(on ? null : r.path)} aria-expanded={on}>
                    <span className="sp-route-name">{routeTitle(r, site.name)}</span>
                    <span className="mono-label">{[fl.off, fl.warn, subs ? `已订 ${subs}` : ''].filter(Boolean).join(' · ')}</span>
                    {!fl.off && <span className="sp-route-needs">{routeNeeds(r, site.id)}{r.url && site.url && !r.url.replace(/^www\./, '').startsWith(site.url) ? ` · ${r.url.replace(/\/$/, '')}` : ''}</span>}
                  </button>
                  {on && <RouteEditor site={id} route={r} feeds={data.feeds} taken={taken} staged={staged} onAdd={add}
                    preset={preset?.path === r.path ? preset.values : undefined} auto={preset?.path === r.path} />}
                </li>
              )
            })}
          </ul>
        </section>

        <section className="sp-block">
          <h2 className="sp-lab">栏目 · {existing.length - gone + news}</h2>
          {existing.length + adds.length === 0 ? <p className="page-note">还没有。</p> : (
            <ul className="sp-cols">
              {existing.map((f) => {
                const rm = removes.has(f.id)
                return (
                  <li key={f.id} className={rm ? 'sp-col rm' : 'sp-col'}>
                    <span className="sp-col-name">{meta.feeds[f.id]?.column || f.title}</span>
                    <span className="sp-col-acts">
                      {rm ? <><span className="sp-danger">将退订（文章和收藏一起删掉）</span><button onClick={() => setRemoves((s) => { const n = new Set(s); n.delete(f.id); return n })}>撤销</button></>
                        : <>
                          <span className="mono-label">{rsshubRoute(f.feed_url) ? instanceLabel(f.feed_url) : '官方 RSS'}</span>
                          {rsshubRoute(f.feed_url) && <button onClick={() => setMoving(moving === f.id ? null : f.id)}>换实例</button>}
                          <button onClick={() => setRemoves((s) => new Set(s).add(f.id))}>退订</button>
                        </>}
                    </span>
                    {moving === f.id && <Move feed={f} feeds={data.feeds} onDone={() => setMoving(null)} />}
                  </li>
                )
              })}
              {adds.map((a) => (
                <li key={a.key} className="sp-col new">
                  <span className="sp-col-name">{a.label} <span className="mono-label sp-new">新加入</span></span>
                  <span className="sp-col-acts">
                    <span className="mono-label">{rsshubRoute(a.url) ? instanceLabel(a.url) : '官方 RSS'}</span>
                    {rsshubRoute(a.url) && <button onClick={() => setMovingNew(movingNew === a.key ? null : a.key)}>换实例</button>}
                    <button onClick={() => setAdds((l) => l.filter((x) => x.key !== a.key))}>移出</button>
                  </span>
                  {a.error && <span className="page-error sp-col-err">没订上：{a.error}{a.check !== undefined && a.check !== 'busy' ? `。再体检一次：${checkLine(a.check)}` : ''}</span>}
                  {!a.error && a.check !== undefined && <span className="form-hint sp-col-err">{checkLine(a.check)}</span>}
                  {movingNew === a.key && <MoveStaged item={a} feeds={data.feeds} onDone={() => setMovingNew(null)}
                    onPick={(p) => { patch(a.key, { url: p.url, check: p.check, error: undefined }); toast(`换到${instanceLabel(p.url)}了，记得保存。`) }} />}
                </li>
              ))}
            </ul>
          )}
          {hubAdds.length >= 2 && (
            <div className="sp-batch">
              <span className="form-hint">这 {hubAdds.length} 个都换到</span>
              <div className="sheet-choices wrap">
                {routeOn('', data.feeds, 6).map((h) => (
                  <button key={h} className="sheet-choice" onClick={() => moveAll(h)}>{instanceLabel(h + '/')}</button>
                ))}
              </div>
            </div>
          )}
        </section>

        {site.description && <details className="sp-fold sp-site-desc"><summary>站点说明</summary><pre className="sp-pre">{site.description}</pre></details>}

        <div className="form-actions sp-save">
          <span className="page-note">{[news ? `新加入 ${news} 栏` : '', gone ? `将退订 ${gone} 栏` : ''].filter(Boolean).join('，')}</span>
          <button className="form-submit" disabled={saving || !dirty} onClick={save}>{saving ? '保存中' : '保存'}</button>
        </div>
      </div>
    </div>
  )
}

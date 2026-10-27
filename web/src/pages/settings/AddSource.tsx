// 添加信源 · 结果页（阶段 6，草图 v3，2026-10-23 Hana 定）：一个框，站点名（汉字）、网址、订阅地址、路由都能输。
//   结果两块：「官方 RSS 源」（贴网址时才有）、「站点」（来自路由目录，和用哪台实例拉取无关）
//   贴路由 → 直接进站点页、展开那一条、自动检索信源
//   只有官方 RSS、目录里没有的站点 → 就在这一页选候选、填刊名类别、保存，成一份只有一栏的报刊
import { markReady } from '../../components/Welcome'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { api, type Discovered } from '../../api/miniflux'
import { useMeta } from '../../api/meta'
import { useShelf } from '../../hooks/useShelf'
import { depthOf } from '../../hooks/useDeepNav'
import { BirdNote, LoadingNote } from '../../components/Bird'
import { Candidates, OptionChips, PaperFields, defaultCat, defaultOpts, type PaperForm, type Picked, type SourceOpts } from '../../components/SourcePick'
import { DISCOVER_LINKS, normalizeInput } from '../../lib/sources'
import { ensureHub, hubBase } from '../../lib/hub'
import { original, rsshubRoute } from '../../lib/doctor'
import { feedsOfSite, matchUrl, searchSites, siteOfRoute, type Match, type Site } from '../../lib/catalog'
import { savePaper, shortColumn } from '../../lib/subscribe'
import { commonHead, isPlatformHost, usePapers, type Paper } from '../../lib/papers'
import { nearPaper } from '../../lib/paperOps'
import { SubPage } from './frame'

type Result = { official: Discovered[] | null; sites: (Site & { matched?: number })[]; matches: Match[]; host: string; note?: string }
const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase().replace(/^(www|m)\./, '') } catch { return '' } }

export function AddSource() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const { state } = useLocation()
  const { data } = useShelf()
  const meta = useMeta()
  const initial = params.get('q') ?? (state as { addUrl?: string } | null)?.addUrl ?? ''
  const [q, setQ] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [res, setRes] = useState<Result | null>(null)
  const [error, setError] = useState('')

  const deeper = (extra: object) => ({ ...(state as object ?? {}), depth: depthOf(state) + 1, ...extra })
  const toSite = (id: string, route?: string, matched?: string[]) => navigate(`/settings/sources/site/${encodeURIComponent(id)}`, { state: deeper({ route, matched }) })

  const find = async (raw = q) => {
    const s = raw.trim()
    if (!s) return
    setParams({ q: s }, { replace: true, state })   // 带上 state：不然返回就不知道从哪来的（0.21.2）
    setBusy(true); setError(''); setRes(null)
    try {
      await ensureHub()
      if (/^(https?:\/\/)?mp\.weixin\.qq\.com\//i.test(s)) { setRes({ official: null, sites: [], matches: [], host: '', note: '公众号没有订阅源。去底下的 Wechat2RSS 列表里找找。' }); return }
      const n = normalizeInput(s, data?.feeds ?? [])
      // 路由：直接进站点页
      const route = rsshubRoute(n.url)
      if (route && hubBase()) { toSite(siteOfRoute(route), route); return }
      const urlish = /^https?:\/\//i.test(n.url) && n.kind !== 'RSSHub 路由'
      if (urlish) {
        const host = hostOf(n.url)
        const [official, matches, byDomain] = await Promise.all([
          api.discover(n.url).catch(() => null),
          hubBase() ? matchUrl(n.url).catch(() => [] as Match[]) : Promise.resolve([] as Match[]),
          hubBase() && host ? searchSites(host).catch(() => [] as Site[]) : Promise.resolve([] as Site[]),
        ])
        const sites = new Map<string, Site & { matched?: number }>()
        for (const st of byDomain) if (st.url === host || host.endsWith('.' + st.url)) sites.set(st.id, st)
        for (const m of matches) {
          const cur = sites.get(m.site) ?? { id: m.site, name: m.siteName, url: '', lang: '', n: 0 }
          sites.set(m.site, { ...cur, matched: (cur.matched ?? 0) + 1 })
        }
        // Miniflux 没找到（或出错）：直接把贴进来的地址当候选体检一遍——它本身可能就是订阅源，取不到也能看到原因（2026-10-24：itainews 的 .rdf 被拦，原来只说「没找到」）
        const list = official?.length ? official : official === null || n.kind === '订阅源地址' ? [{ url: n.url, title: '', type: 'rss' } as Discovered] : []
        setRes({ official: list, sites: [...sites.values()], matches, host })
      } else {
        setRes({ official: null, sites: hubBase() ? await searchSites(s) : [], matches: [], host: '' })
      }
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }
  useEffect(() => { if (initial) find(initial) }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { markReady() }, [])

  // 只有官方 RSS 的：就在这里订
  const [picked, setPicked] = useState<Picked | null>(null)
  const [form, setForm] = useState<PaperForm | null>(null)
  const [opts, setOpts] = useState<SourceOpts>(defaultOpts(null))
  const [saving, setSaving] = useState(false)
  // 认出已有的报刊（0.23）：同一个 RSSHub 站点、或同一个网站 → 默认归进去，沿用刊名别名类别；名字像、网站不同 → 只提示
  const papers = usePapers()
  const [join, setJoin] = useState<Paper | null>(null)
  const [apart, setApart] = useState(false)
  const [column, setColumn] = useState('')
  useEffect(() => { setPicked(null); setForm(null); setJoin(null); setApart(false) }, [res])
  const pickedHost = picked ? hostOf(original(picked.url)) || res?.host || '' : ''
  const site = res?.sites.find((s) => s.url && (res.host === s.url || res.host.endsWith('.' + s.url)))
  const strongKey = site ? site.id : pickedHost && !isPlatformHost(pickedHost) ? 'd:' + pickedHost : ''
  const strong = strongKey ? papers.papers.find((p) => p.key === strongKey) ?? null : null
  const near = !strong && picked ? nearPaper(pickedHost, picked.title, papers.papers) : null
  const target = apart ? null : join ?? strong
  // 并进一栏的报刊：它就变成多栏了，刊名取两边源名共有的开头（「LOW←TECH MAGAZINE English」+「… Español」→「LOW←TECH MAGAZINE」）
  const joinName = target ? (target.feeds.length === 1 && picked ? commonHead([target.lead.title, picked.title]) || target.name : target.name) : ''
  useEffect(() => { if (target && picked) setColumn(shortColumn(picked.title || '', joinName) || picked.title) }, [target?.key, picked?.url, joinName]) // eslint-disable-line react-hooks/exhaustive-deps
  const pick = (p: Picked) => {
    setPicked(p)
    setOpts(defaultOpts(p.check))
    setForm((f) => f ?? { name: p.title, latin: '', cat: data ? defaultCat(meta, data.categories) : 'new', newCat: '' })
    setForm((f) => (f && !f.name && p.title ? { ...f, name: p.title } : f))
  }
  const saveOfficial = async () => {
    if (!picked || !form || !data || !res) return
    setSaving(true)
    try {
      const r = target
        ? await savePaper({ paperId: target.key, site: target.site, domain: site?.url || pickedHost, form: { name: joinName, latin: target.latin, cat: target.category.id, newCat: '' },
          meta, categories: data.categories, existing: target.feeds, removes: [], adds: [{ key: picked.url, url: picked.url, column: column.trim() || picked.title, opts }] })
        : await savePaper({ paperId: apart && strongKey ? 'u:' + Date.now().toString(36) : strongKey || 'd:' + pickedHost, site: site?.id, domain: site?.url || pickedHost, form, meta, categories: data.categories,
          existing: [], removes: [], adds: [{ key: picked.url, url: picked.url, column: '', opts }] })
      // 进度、成败都写在底部的日志浮层里（0.29），这里只管订上以后清空页面
      if (!r.failed.length) { setRes(null); setQ(''); setParams({}, { replace: true, state }) }
    } catch { /* 原因写在日志浮层里了 */ } finally { setSaving(false) }
  }

  const official = res?.official ?? null
  return (
    <SubPage title="添加信源" parent={(state as { root?: string } | null)?.root ?? '/settings/sources'}>
      <div className="form-inline sp-search">
        <input className="form-input" value={q} autoComplete="off" autoCapitalize="off" autoCorrect="off" inputMode="search" name="mediarium-source"
          placeholder="站点名、网页或订阅地址" onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') find() }} />
        <button className="form-text-btn" onClick={() => find()} disabled={busy || !q.trim()}>{busy ? '查找中…' : '查找'}</button>
      </div>
      {error && <p className="page-error">{error}</p>}
      {busy && <LoadingNote />}

      {res && (
        <>
          {res.note && <p className="page-note sp-note">{res.note}</p>}
          {official !== null && (
            <section className="sp-block">
              <h2 className="sp-lab">官方 RSS 源</h2>
              {official.length === 0 ? <p className="page-note">网站没提供。</p> : (
                <>
                  <Candidates list={official.map((d) => ({ url: d.url, title: d.title && d.title !== d.url && !/^https?:\/\//.test(d.title) ? d.title : '' }))}
                    kind="feed" picked={picked?.url ?? ''} onPick={pick} />
                  {picked && form && data && (
                    <>
                      {target ? (
                        <>
                          <div className="sp-into"><span>归到《{joinName}》</span><button className="form-text-btn" onClick={() => { setApart(true); setJoin(null) }}>另起一本</button></div>
                          <div className="form-rows">
                            <label className="sheet-label" htmlFor="sp-col">栏目名</label>
                            <input id="sp-col" className="form-input serif" value={column} onChange={(e) => setColumn(e.target.value)} />
                          </div>
                        </>
                      ) : (
                        <>
                          {near && !apart && <button className="form-text-btn sp-near" onClick={() => setJoin(near)}>可能是《{near.name}》的栏目 · 并进去</button>}
                          {apart && strong && <button className="form-text-btn sp-near" onClick={() => setApart(false)}>还是归到《{strong.name}》</button>}
                          <PaperFields value={form} onChange={setForm} meta={meta} categories={data.categories} />
                        </>
                      )}
                      <div className="form-rows"><span className="sheet-label">选项</span><OptionChips value={opts} onChange={setOpts} /></div>
                      <div className="form-actions"><span /><button className="form-submit" disabled={saving} onClick={saveOfficial}>{saving ? '保存中' : '保存'}</button></div>
                    </>
                  )}
                </>
              )}
            </section>
          )}
          {(res.sites.length > 0 || official === null) && !res.note && (
            <section className="sp-block">
              <h2 className="sp-lab">站点</h2>
              {res.sites.length === 0 ? <BirdNote bird="puzzled">没找到。</BirdNote> : (
                <ul className="sp-sites">
                  {res.sites.map((s) => {
                    const subs = data ? feedsOfSite(meta, data.feeds, s).length : 0
                    const matched = res.matches.filter((m) => m.site === s.id).map((m) => m.route)
                    return (
                      <li key={s.id}>
                        <button className="sp-site" onClick={() => toSite(s.id, undefined, matched)}>
                          <span className="sp-site-name">{s.name}</span><span className="set-row-go" aria-hidden="true">›</span>
                          <span className="mono-label sp-site-meta">{[s.url, s.matched ? `认出 ${s.matched} 条路由` : s.n ? `收录 ${s.n} 条路由` : '', subs ? `已订 ${subs} 栏` : ''].filter(Boolean).join(' · ')}</span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          )}
        </>
      )}

      <section className="sp-block sp-out">
        <h2 className="sp-lab">{res ? '没找到想要的' : '去找源'}</h2>
        <div className="form-links">
          {DISCOVER_LINKS.map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" title={l.note}>{l.label} ↗</a>)}
        </div>
      </section>
    </SubPage>
  )
}

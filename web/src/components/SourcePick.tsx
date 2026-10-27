// 添加信源（阶段 6）共用的几块：实例 / 候选列表（都体检，可用 / 推荐）、信源选项、报刊信息（刊名、别名、类别）
import { useEffect, useRef, useState } from 'react'
import type { Category, FeedOptions } from '../api/miniflux'
import { categoryName, orderedCategories, uncategorizedId, type Meta } from '../api/meta'
import { checkup, checkupAround, flaky, instanceLabel, onHub, recommend, showUrl, usable, verdictLine, type Checkup } from '../lib/doctor'
import { looksForeign } from '../lib/translate'
import { IconPick } from './IconPick'

export type Cand = { url: string; title?: string }
export type Picked = { url: string; check: Checkup | null; title: string }

// 候选列表：一次体检三个；体检完自动选推荐的（用户先点了别的就不替他改）。kind=instance 时名字写实例（灵媒自建 / 主机名）
// 订阅源候选只给摘要时，体检会顺手在同一个网站上找给全文的版本，找到就悄悄加进列表（0.21.2，Hana 要的「隐藏补丁」）
export function Candidates({ list: given, kind, picked, onPick }: { list: Cand[]; kind: 'instance' | 'feed'; picked: string; onPick: (p: Picked) => void }) {
  const [checks, setChecks] = useState<Record<string, Checkup | null | undefined>>({})
  const [extra, setExtra] = useState<Cand[]>([])
  const [best, setBest] = useState('')
  const [showBad, setShowBad] = useState(given.length === 1)   // 只有一个候选时，不能用也直接摊开，原因看得到
  const touched = useRef(false)
  const key = given.map((c) => c.url).join('|')
  const list = [...given, ...extra]
  useEffect(() => {
    let alive = true
    touched.current = false
    setChecks({}); setBest(''); setExtra([])
    const queue = [...given]
    const results: (Checkup | null)[] = []
    let next = 0
    Promise.all([0, 1, 2].map(async () => {
      while (next < queue.length) {
        const k = next++
        const exam = () => (kind === 'feed' ? checkupAround(queue[k].url) : checkup(queue[k].url))
        let c = await exam()
        if (flaky(c)) { await new Promise((ok) => setTimeout(ok, 1500)); c = await exam() }   // 一时没取到的，先悄悄再试一次
        results[k] = c
        if (!alive) return
        setChecks((m) => ({ ...m, [queue[k].url]: c }))
        if (kind === 'feed' && c?.fuller && !queue.some((q) => q.url === c.fuller)) { queue.push({ url: c.fuller }); setExtra((e) => [...e, { url: c.fuller! }]) }
      }
    })).then(() => {
      if (!alive) return
      const i = recommend(results, queue.map((c) => c.url))
      const at = i >= 0 ? i : queue.length === 1 ? 0 : -1
      if (i >= 0) setBest(queue[i].url)
      if (at >= 0 && !touched.current) onPick({ url: queue[at].url, check: results[at], title: queue[at].title || results[at]?.title || '' })
    })
    return () => { alive = false }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps

  const bad = (u: string) => { const c = checks[u]; return !!c && !usable(c) }
  // 一时没取到的：给「重试」，只重新体检这一个
  const [again, setAgain] = useState('')
  const retry = async (u: string) => {
    setAgain(u)
    const c = kind === 'feed' ? await checkupAround(u) : await checkup(u)
    setChecks((m) => ({ ...m, [u]: c }))
    setAgain('')
    if (picked === u) onPick({ url: u, check: c, title: list.find((x) => x.url === u)?.title || c?.title || '' })
  }
  const badCount = list.filter((c) => bad(c.url)).length
  return (
    <div className="form-found sp-cands">
      {list.filter((c) => showBad || !bad(c.url) || picked === c.url).map((c) => {
        const ck = checks[c.url], done = c.url in checks
        const name = kind === 'instance' ? instanceLabel(c.url) : (c.title || ck?.title || showUrl(c.url))
        return (
          <button key={c.url} className={`cand${picked === c.url ? ' on' : ''}${bad(c.url) ? ' bad' : ''}`} aria-pressed={picked === c.url}
            onClick={() => { touched.current = true; onPick({ url: c.url, check: ck ?? null, title: c.title || ck?.title || '' }) }}>
            <span className="cand-name">
              {name}
              {usable(ck) && <span className="cand-ok">{ck!.via ? ' 已中转' : ' 可用'}</span>}
              {best === c.url && <span className="cand-best"> 推荐</span>}
              
            </span>
            {kind === 'feed' && (c.title || ck?.title) && <span className="cand-url">{showUrl(c.url)}</span>}
            <span className="cand-check">{!done || again === c.url ? '体检中…' : ck === null ? '体检不了' : verdictLine(ck!)}
              {done && again !== c.url && flaky(ck) && <span role="button" tabIndex={0} className="cand-retry" onClick={(e) => { e.stopPropagation(); retry(c.url) }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); retry(c.url) } }}>重试</span>}</span>
          </button>
        )
      })}
      {badCount > 0 && (
        <button className="form-text-btn cand-fold" onClick={() => setShowBad((v) => !v)}>
          {showBad ? '收起不能用的' : `${badCount === list.length ? '都' : `另有 ${badCount} 个`}试过不能用，展开看`}
        </button>
      )}
    </div>
  )
}

// 信源选项：抓取全文 / 翻译标题 / 不进信息流
export type SourceOpts = { crawler: boolean; trTitle: boolean; hide_globally: boolean; proxy?: boolean }   // proxy：体检要绕道才取得到的，订的时候也绕道（不显示成选项）
export const defaultOpts = (c: Checkup | null | undefined): SourceOpts => ({
  crawler: !!c && c.ok && c.content !== 'full' && !!c.crawlerHelps,
  trTitle: !!c?.titles && looksForeign(c.titles),
  hide_globally: false,
  proxy: c?.via === 'proxy',
})
export const minifluxOpts = (o: SourceOpts): FeedOptions => ({ crawler: o.crawler, disabled: false, hide_globally: o.hide_globally, ...(o.proxy ? { fetch_via_proxy: true } : {}) })
export function OptionChips({ value, onChange }: { value: SourceOpts; onChange: (v: SourceOpts) => void }) {
  const items: ['crawler' | 'trTitle' | 'hide_globally', string][] = [['crawler', '抓取全文'], ['trTitle', '翻译标题'], ['hide_globally', '不进信息流']]
  return (
    <div className="sheet-choices wrap">
      {items.map(([k, label]) => (
        <button key={k} className={value[k] ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={value[k]} onClick={() => onChange({ ...value, [k]: !value[k] })}>
          {label}
        </button>
      ))}
    </div>
  )
}

// 报刊信息：刊名、别名、放进类别（新建类别当场起名）
export type PaperForm = { name: string; latin: string; cat: number | 'new'; newCat: string; newIcon?: string }   // newIcon：新建类别的符号（0.29.2）
export function defaultCat(m: Meta, categories: Category[]): number | 'new' {
  return uncategorizedId(m, categories) ?? categories[0]?.id ?? 'new'
}
export function PaperFields({ value, onChange, meta, categories }: { value: PaperForm; onChange: (v: PaperForm) => void; meta: Meta; categories: Category[] }) {
  return (
    <div className="form-rows sp-paper">
      <label className="sheet-label" htmlFor="sp-name">刊名</label>
      <input id="sp-name" className="form-input serif strong" value={value.name} onChange={(e) => onChange({ ...value, name: e.target.value })} />
      <label className="sheet-label" htmlFor="sp-latin">别名</label>
      <input id="sp-latin" className="form-input mono faint" value={value.latin} autoCorrect="off" placeholder="可不填" onChange={(e) => onChange({ ...value, latin: e.target.value })} />
      <span className="sheet-label">放进类别</span>
      <div className="sheet-choices wrap">
        {orderedCategories(meta, categories).map((c) => (
          <button key={c.id} className={value.cat === c.id ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={value.cat === c.id} onClick={() => onChange({ ...value, cat: c.id })}>
            {categoryName(meta, c, categories)}
          </button>
        ))}
        <button className={value.cat === 'new' ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={value.cat === 'new'} onClick={() => onChange({ ...value, cat: 'new' })}>
          新建
        </button>
      </div>
      {value.cat === 'new' && (
        <>
          <label className="sheet-label" htmlFor="sp-newcat">新类别</label>
<div className="form-inline newcat-row">          <input id="sp-newcat" className="form-input serif" value={value.newCat} placeholder="类别名" onChange={(e) => onChange({ ...value, newCat: e.target.value })} /><IconPick value={value.newIcon} onChange={(k) => onChange({ ...value, newIcon: k })} /></div>
        </>
      )}
    </div>
  )
}

export const isHubUrl = onHub

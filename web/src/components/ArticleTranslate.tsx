// 文章页的翻译（阶段 4，2026-10-22；2026-10-23 Hana 重定按钮逻辑）：
//   · 一篇文章每个渠道各留一份译文（key：mt:volcano / mt:deepl / ai:<预设 id>），页面上一次只看一份
//   · 「译」面板：主按钮跟默认渠道走（翻译全文 / 翻译剩下的 N 段 / 全文已译）；「译文」一行切换看哪份（不发请求）；
//     「重译」弹出渠道列表：没译过的就译，译过的只是切过去看；正在看的 AI 译文可以「强制重译」（点两次，不读缓存、覆盖旧的）；
//     机翻同一段每次结果一样，没有强制重译
//   · 规矩：每次 AI 请求都由一次点击触发；全文按预设单次上限切好，分 N 次的先写在按钮上；不自动重试
//   · 流式：译文一段段填到原文下面；断了，已到的保留，「重试」只补没译完的段；强制重译时旧译文先留着，新的到一段换一段
//   · 等待：读书的鸟（等第一段）→ 送信的鸟（逐段到）→ 飞走的鸟（失败，附「重试」「改用机翻」）
import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import type { Entry } from '../api/miniflux'
import { Bird } from './Bird'
import { Sheet } from './Sheet'
import { toast, toastError } from './Toast'
import { depthOf } from '../hooks/useDeepNav'
import { typesetTranslation } from '../typo/typeset'
import { allKeys, chInfo, defaultKey, failText, keepTitles, mtIsDeepl, planChunks, putTrConfig, translateStream, TrError, useTrConfig, type ChKey, type TrFail } from '../lib/translate'

type Show = 'off' | 'bi' | 'only'
type Phase =
  | { k: 'idle' }
  | { k: 'run'; got: number; total: number; part: number; parts: number; since: number; arrived: boolean; label: string }
  | { k: 'fail'; fail: TrFail; left: number[]; key: ChKey; fresh: boolean; label: string }

// 每篇文章的译文记在内存里：每个渠道一份（按段号），cur 是正在看哪份；正文重排后再贴回去
type Memo = { v: Record<ChKey, Record<number, string>>; cur: ChKey | null; show: Show }
const memo = new Map<number, Memo>()

const BLOCKS = 'p, h1, h2, h3, h4, h5, h6, li, figcaption, blockquote, td, th, dt, dd'
function collect(root: HTMLElement): HTMLElement[] {
  wrapLoose(root)
  const all = Array.from(root.querySelectorAll<HTMLElement>(BLOCKS + ', .prose-run'))
  return all.filter((el) =>
    !el.closest('.prose-tr, .prose-fold, .prose-tail, pre, code') &&
    !el.querySelector(BLOCKS) &&                                   // 只取最里层（li 里套 p 就取 p）
    /\p{L}/u.test(textOf(el)))
}
// 没包在段落里的字（2026-10-24 痛いニュース：livedoor 的正文是一整块 <b>，段与段之间只用 <br><br> 隔开，
// 原来只认得出里面引的那条推文，全文翻译只翻了一段）：按空行切开，每段包一层 <span class="prose-run">，样子不变，当一段来翻。
// 没有空行的，按单个换行切。只动不在任何段落里的字
const OUTSIDE = BLOCKS + ', .prose-tr, .prose-fold, .prose-tail, .prose-run, pre, code, figure, table, button, ' + 'svg, script, style'
const INLINE = /^(B|STRONG|I|EM|SPAN|FONT|A|U|S|SMALL|BIG|SUB|SUP|MARK|ABBR|CITE|Q|TIME|INS|DEL)$/
export function wrapLoose(root: HTMLElement) {
  const holders = new Set<HTMLElement>()
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode(); n; n = walk.nextNode()) {
    if (!/\p{L}/u.test(n.textContent ?? '')) continue
    let p = n.parentElement
    if (!p || p.closest(OUTSIDE)) continue
    // 往上找到「字和换行并排放着」的那一层：一路上的 <b>、<a> 这类，自己里面没有换行的，当成一个整体
    while (p !== root && INLINE.test(p.tagName) && !p.querySelector(':scope > br')) p = p.parentElement!
    if (p.closest(OUTSIDE)) continue
    holders.add(p)
  }
  for (const p of holders) {
    const kids = Array.from(p.childNodes)
    const isBr = (k: Node) => k.nodeName === 'BR'
    const blank = (k: Node) => k.nodeType === Node.TEXT_NODE && !k.textContent!.trim()
    // 有没有空行（两个换行之间只有空白）
    let double = false
    for (let i = 0, run = 0; i < kids.length; i++) { if (isBr(kids[i])) { if (++run >= 2) { double = true; break } } else if (!blank(kids[i])) run = 0 }
    const segs: Node[][] = []
    let cur: Node[] = [], lastBr = false
    const flush = () => { if (cur.length) segs.push(cur); cur = [] }
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]
      if (isBr(k)) {
        let j = i + 1
        while (j < kids.length && blank(kids[j])) j++
        // 没有空行时每个换行都切；有空行时只在空行处切，段里的单个换行留在段里
        if (!double || lastBr || (j < kids.length && isBr(kids[j]))) flush()
        else if (cur.length) cur.push(k)
        lastBr = true
        continue
      }
      if (blank(k)) { if (cur.length) cur.push(k); continue }
      lastBr = false
      if (k.nodeType === Node.ELEMENT_NODE && ((k as Element).matches(OUTSIDE) || (k as Element).querySelector(BLOCKS + ', br'))) { flush(); continue }
      cur.push(k)
    }
    flush()
    for (const seg of segs) {
      const text = seg.map((k) => k.textContent ?? '').join('').trim()
      if (!/\p{L}/u.test(text) || /^https?:\/\/\S+$/.test(text)) continue   // 只有一个网址的不算
      const span = document.createElement('span')
      span.className = 'prose-run'
      seg[0].parentNode!.insertBefore(span, seg[0])
      for (const k of seg) span.appendChild(k)
    }
  }
}

// 要翻的字：只取人看得见的。图形（svg）、公式、脚本里藏的东西不算——
// 2026-10-24：Low-tech Magazine 段末一个小鸟图标，svg 里夹着一大段图片来历的编码（C2PA），整段被当成文字送去翻
const HIDDEN = 'svg, math, script, style, noscript, template, object, canvas, [hidden], [aria-hidden="true"]'
function textOf(el: HTMLElement): string {
  if (!el.querySelector(HIDDEN)) return (el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const c = el.cloneNode(true) as HTMLElement
  c.querySelectorAll(HIDDEN).forEach((n) => n.remove())
  return (c.textContent ?? '').replace(/\s+/g, ' ').trim()
}

function place(el: HTMLElement, i: number, t: string) {
  const inside = /^(LI|FIGCAPTION|TD|TH|DT|DD)$/.test(el.tagName)
  let tr = (inside ? el.querySelector(`:scope > .prose-tr`) : el.nextElementSibling?.classList.contains('prose-tr') ? el.nextElementSibling : null) as HTMLElement | null
  if (!tr) {
    tr = document.createElement(inside ? 'div' : /^H\d$/.test(el.tagName) ? el.tagName.toLowerCase() : 'p')
    tr.className = /^H\d$/.test(el.tagName) ? 'prose-tr prose-tr-head' : 'prose-tr'
    tr.lang = 'zh-CN'
    if (inside) {
      // 格子、列表项里：原文包一层，「只看译文」时好藏
      if (!el.querySelector(':scope > .prose-orig')) {
        const orig = document.createElement('span')
        orig.className = 'prose-orig'
        while (el.firstChild) orig.appendChild(el.firstChild)
        el.appendChild(orig)
      }
      el.appendChild(tr)
    } else el.after(tr)
  }
  tr.dataset.trI = String(i)
  tr.classList.remove('wait')
  tr.textContent = t
  typesetTranslation(tr)
  if (!inside) el.dataset.trHas = '1'
}

// 占位：先放一行「译文在路上…」，到了再换成译文；没到的在失败时收掉
function hold(el: HTMLElement, i: number) {
  place(el, i, '译文在路上…')
  const inside = /^(LI|FIGCAPTION|TD|TH|DT|DD)$/.test(el.tagName)
  const tr = (inside ? el.querySelector(':scope > .prose-tr') : el.nextElementSibling) as HTMLElement | null
  tr?.classList.add('wait')
  delete el.dataset.trHas   // 还没译好，「只看译文」时原文别藏
}
function unhold(root: HTMLElement | null) { root?.querySelectorAll('.prose-tr.wait').forEach((n) => n.remove()) }

export function useArticleTranslation(entry: Entry | null, proseEl: React.RefObject<HTMLDivElement | null>) {
  const cfg = useTrConfig()
  const id = entry?.id ?? 0
  const [show, setShowState] = useState<Show>(() => memo.get(id)?.show ?? 'off')
  const [phase, setPhase] = useState<Phase>({ k: 'idle' })
  const [picking, setPicking] = useState(false)
  const [, bump] = useState(0)
  const [total, setTotal] = useState(0)
  const abort = useRef<AbortController | null>(null)
  const blocks = useRef<HTMLElement[]>([])

  const state = (): Memo => { let s = memo.get(id); if (!s) { s = { v: {}, cur: null, show: 'off' }; memo.set(id, s) } return s }
  const setShow = (v: Show) => { state().show = v; setShowState(v) }
  const dkey = defaultKey(cfg)
  const ch = chInfo(cfg, dkey)
  const cur = memo.get(id)?.cur ?? null
  const shown = cur ?? dkey                                     // 正在看（或将要看）的那份
  const doneOf = (key: ChKey) => Object.keys(memo.get(id)?.v[key] ?? {}).length
  const versions = allKeys(cfg).filter((k) => doneOf(k) > 0)
  const all = () => blocks.current.map((_, i) => i)
  const missing = (key: ChKey) => blocks.current.map((_, i) => i).filter((i) => !(i in (state().v[key] ?? {})))

  // 把某一份译文贴到正文里（先撤掉别的）
  const paint = useCallback((key: ChKey | null) => {
    const root = proseEl.current
    if (!root) return
    root.querySelectorAll('.prose-tr').forEach((n) => n.remove())
    root.querySelectorAll<HTMLElement>('[data-tr-has]').forEach((n) => delete n.dataset.trHas)
    const tr = key ? memo.get(id)?.v[key] : null
    if (tr) for (const [i, t] of Object.entries(tr)) { const el = blocks.current[Number(i)]; if (el) place(el, Number(i), t) }
  }, [id, proseEl])
  const view = (key: ChKey) => { const s = state(); if (s.cur !== key) { s.cur = key; paint(key) } if (show === 'off') setShow('bi'); bump((n) => n + 1) }

  // 正文挂上 / 重排后：重新认段落，把正在看的那份贴回去
  const refresh = useCallback(() => {
    const root = proseEl.current
    if (!root || !id) return
    blocks.current = collect(root)
    paint(memo.get(id)?.cur ?? null)
    setTotal(blocks.current.length)
  }, [id, proseEl, paint])
  useEffect(() => {
    setShowState(memo.get(id)?.show ?? 'off'); setPhase({ k: 'idle' }); setPicking(false)
    const t = window.setTimeout(refresh, 50)   // 等排版模块排完
    return () => { window.clearTimeout(t); abort.current?.abort() }
  }, [id, entry?.content]) // eslint-disable-line react-hooks/exhaustive-deps

  // 显示方式写在正文的 class 上
  useEffect(() => {
    const root = proseEl.current
    if (!root) return
    root.classList.toggle('tr-bi', show === 'bi')
    root.classList.toggle('tr-only', show === 'only')
  }, [show, proseEl, total])

  // 某个渠道翻这些段要分几次请求
  const partsFor = (key: ChKey, idx: number[]) => {
    const c = chInfo(cfg, key)
    const titleLen = c.type === 'ai' ? (entry?.title.length ?? 0) : 0
    return planChunks(idx.map((i) => textOf(blocks.current[i])), c.chunk, titleLen).length
  }

  // 用某个渠道跑一串段落（idx），按单次上限切块，一块一次请求，顺序发；fresh = 强制重译（只 AI）
  const run = async (idx: number[], key: ChKey, fresh = false) => {
    if (!entry || !idx.length) return
    const c = chInfo(cfg, key)
    fresh = fresh && c.type === 'ai'
    const titleLen = c.type === 'ai' ? entry.title.length : 0
    const chunks = planChunks(idx.map((i) => textOf(blocks.current[i])), c.chunk, titleLen).map((k) => k.map((j) => idx[j]))
    abort.current?.abort()
    const ac = new AbortController(); abort.current = ac
    view(key)
    const s = state()
    const tr = (s.v[key] ??= {})
    let got = 0
    const total = idx.length
    for (let part = 0; part < chunks.length; part++) {
      const chunk = chunks[part]
      setPhase({ k: 'run', got, total, part: part + 1, parts: chunks.length, since: Date.now(), arrived: false, label: c.label })
      for (const i of chunk) if (!(i in tr) && blocks.current[i]) hold(blocks.current[i], i)   // 强制重译：旧译文先留着
      const done = new Set<number>()
      try {
        const r = await translateStream(chunk.map((i) => textOf(blocks.current[i])), part === 0 && c.type === 'ai' ? entry.title : undefined, key, (e) => {
          if (e.title && c.type === 'ai') keepTitles({ [entry.id]: e.title })
          if (e.i === undefined || e.t === undefined) return
          const gi = chunk[e.i]
          if (gi === undefined) return
          tr[gi] = e.t; done.add(gi)
          const el = blocks.current[gi]
          if (el && s.cur === key) place(el, gi, e.t)
          got++
          setPhase((p) => (p.k === 'run' ? { ...p, got, arrived: true } : p))
          bump((n) => n + 1)
        }, ac.signal, fresh)
        if (r.missing.length) {
          const rest = [...r.missing.map((k) => chunk[k]), ...chunks.slice(part + 1).flat()]
          const fail = { explain: `有 ${r.missing.length} 段模型没返回` }
          unhold(proseEl.current)
          setPhase({ k: 'fail', fail, left: rest, key, fresh, label: c.label }); toastError(failText(fail))
          return
        }
      } catch (err) {
        unhold(proseEl.current)
        if (ac.signal.aborted) return
        const fail = err instanceof TrError ? err.fail : { explain: '连接中途断了' }
        const miss = (err as { missing?: number[] | null }).missing
        const rest = [...(miss ? miss.map((k) => chunk[k]) : chunk.filter((i) => !done.has(i))), ...chunks.slice(part + 1).flat()]
        setPhase({ k: 'fail', fail, left: rest, key, fresh, label: c.label })
        toastError(failText(fail))
        return
      }
    }
    setPhase({ k: 'idle' })
    if (got) toast({ text: `译好了 · ${c.label}`, bird: 'done' })
  }

  // 点段落翻译：点哪段翻哪段（一段一次请求），用正在看的那份的渠道补，免得一篇里混着两种风格。
  // 电脑上：按住 Ctrl（Mac 上 ⌘）临时进入，单击段落就翻，松开就退出（2026-10-22 Hana 提）
  // 段落模式下点到链接也不跳转，当成点这一段（Hana：会误点文内外链）
  const [held, setHeld] = useState(false)
  useEffect(() => {
    if (!window.matchMedia('(pointer: fine)').matches) return
    const down = (e: KeyboardEvent) => { if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat) setHeld(true) }
    const up = (e: KeyboardEvent) => { if (e.key === 'Control' || e.key === 'Meta') setHeld(false) }
    const blur = () => setHeld(false)
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur) }
  }, [])
  const active = picking || held
  useEffect(() => { proseEl.current?.classList.toggle('tr-pick', active) }, [active, proseEl, total])
  useEffect(() => {
    const root = proseEl.current
    if (!root) return
    const on = (e: MouseEvent) => {
      const byKey = e.ctrlKey || e.metaKey
      if (!picking && !byKey) return
      if (!cfg || (e.target as HTMLElement).closest('.prose-tr')) return
      const el = blocks.current.find((b) => b.contains(e.target as Node))
      if (!el) return
      e.preventDefault(); e.stopPropagation()   // 链接不跳、Ctrl+点击也不开新标签页
      const i = blocks.current.indexOf(el)
      if (!chInfo(cfg, shown).ok || i in (state().v[shown] ?? {}) || phase.k === 'run') return
      run([i], shown)
    }
    root.addEventListener('click', on, true)
    return () => root.removeEventListener('click', on, true)
  }) // 每次渲染都换，拿到最新的 phase

  return { cfg, ch, dkey, shown, cur, versions, show, setShow, phase, picking, setPicking, total, doneOf, all, missing, partsFor, run, view }
}

export type ArticleTr = ReturnType<typeof useArticleTranslation>

// 进度条：鸟 + 一行字
export function TrProgress({ tr }: { tr: ArticleTr }) {
  const [, tick] = useState(0)
  const p = tr.phase
  useEffect(() => { if (p.k !== 'run') return; const t = window.setInterval(() => tick((n) => n + 1), 1000); return () => window.clearInterval(t) }, [p.k])
  if (p.k === 'idle') return null
  if (p.k === 'run') {
    const part = p.parts > 1 ? `第 ${p.part} / ${p.parts} 次 · ` : ''
    return (
      <div className="tr-progress" role="status">
        <Bird name={p.arrived ? 'messenger' : 'reading'} className="tr-progress-bird" />
        <span>{p.arrived ? `${part}已译 ${p.got} / ${p.total} 段` : `${part}翻译中 · 已等 ${Math.round((Date.now() - p.since) / 1000)} 秒`}</span>
        <span className="mono-label">{p.label}</span>
      </div>
    )
  }
  const mtKey = mtIsDeepl(tr.cfg) ? 'mt:deepl' : 'mt:volcano'
  return (
    <div className="tr-progress fail" role="alert">
      <Bird name="departing" className="tr-progress-bird" />
      <span>{failText(p.fail)}</span>
      <span className="tr-progress-actions">
        <button onClick={() => tr.run(p.left, p.key, p.fresh)}>重试</button>
        {p.key.startsWith('ai:') && chInfo(tr.cfg, mtKey).ok ? <button onClick={() => tr.run(tr.missing(mtKey), mtKey)}>改用机翻</button> : <span className="page-note">换个渠道试试</span>}
      </span>
    </div>
  )
}

// 「译」面板
export function TrSheet({ tr, anchor, onClose }: { tr: ArticleTr; anchor: HTMLElement | null; onClose: () => void }) {
  const navigate = useNavigate()
  const { state } = useLocation()
  const { cfg, ch, dkey, total } = tr
  const running = tr.phase.k === 'run'
  const [redo, setRedo] = useState(false)              // 「重译」的渠道列表
  const [force, setForce] = useState(false)            // 强制重译：点两次
  const dLeft = tr.missing(dkey)
  const dDone = total > 0 && dLeft.length === 0
  const dParts = tr.partsFor(dkey, dLeft)
  const builtinOff = dkey === 'mt:volcano' && !ch.ok
  // 在文章里直接换默认渠道（2026-10-22 Hana：设置里点错了还得出去改，很怪）。没填密钥的灰着，去「渠道设置」填
  const [switching, setSwitching] = useState(false)
  const pickDefault = async (key: ChKey) => {
    setSwitching(true)
    const change = key.startsWith('ai:') ? { mode: 'ai' as const, ai: key.slice(3) } : { mode: 'mt' as const, mt: key.slice(3) as 'volcano' | 'deepl' }
    try { await putTrConfig(change) } catch (e) { toastError(e instanceof TrError ? failText(e.fail) : '没换成') } finally { setSwitching(false) }
  }
  const keys = allKeys(cfg)
  const goSettings = () => { onClose(); navigate('/settings/translate', { state: { ...(state as object ?? {}), depth: depthOf(state) + 1, root: '/settings' } }) }
  const go = (idx: number[], key: ChKey, fresh = false) => { onClose(); tr.run(idx, key, fresh) }

  if (cfg === null) return <Sheet title="翻译" placement="dock" anchor={anchor} onClose={onClose}><p className="page-note">翻译服务没接上。</p></Sheet>

  // 重译：渠道列表
  if (redo) return (
    <Sheet title="重译" label="选渠道" placement="dock" anchor={anchor} onClose={onClose}>
      <ul className="tr-redo">
        {keys.map((k) => {
          const c = chInfo(cfg, k)
          const left = tr.missing(k)
          const has = tr.doneOf(k) > 0
          const viewing = tr.cur === k
          const parts = c.type === 'ai' ? tr.partsFor(k, left) : 0
          const note = !c.ok ? '还没设置好'
            : !has ? (parts > 1 ? `未译 · 需 ${parts} 次请求` : '未译')
            : left.length ? `已译 ${total - left.length} / ${total} 段` : viewing ? '正在看' : '已有译文'
          return (
            <li key={k} className={viewing ? 'tr-redo-row on' : 'tr-redo-row'}>
              <button className="tr-redo-pick" disabled={!c.ok || running || (viewing && !left.length)}
                onClick={() => (left.length ? go(left, k) : (tr.view(k), onClose()))}>
                <span className="tr-redo-name">{c.label}</span>
                <span className="mono-label">{note}</span>
              </button>
              {viewing && has && c.type === 'ai' && (
                <button className={force ? 'form-text-btn tr-force on' : 'form-text-btn tr-force'} disabled={running}
                  onClick={() => (force ? go(tr.all(), k, true) : setForce(true))}>
                  {force ? '再点一次，重新请求' : '强制重译'}
                </button>
              )}
            </li>
          )
        })}
      </ul>
      <div className="sheet-actions"><button className="sheet-action quiet" onClick={() => { setRedo(false); setForce(false) }}>返回</button></div>
    </Sheet>
  )

  return (
    <Sheet title="翻译" label={ch.label} placement="dock" anchor={anchor} onClose={onClose}>
      <div className="sheet-actions">
        <button className="sheet-action" disabled={running || dDone || !ch.ok || !total}
          onClick={() => go(dLeft, dkey)}>
          {dDone ? `全文已译 · ${ch.label}` : tr.doneOf(dkey) > 0 ? `翻译剩下的 ${dLeft.length} 段 · ${ch.label}` : `翻译全文 · ${ch.label}`}
        </button>
        {!dDone && dParts > 1 && <p className="page-note tr-sheet-note">需拆分为 {dParts} 次请求</p>}
        {!ch.ok && <p className="page-note">{builtinOff ? '内置机翻还没开。' : '这个渠道还没填密钥。'}</p>}
        {tr.versions.length > 0 && <button className="sheet-action quiet" disabled={running} onClick={() => setRedo(true)}>重译</button>}
        <label className="set-check tr-sheet-switch">
          <input type="checkbox" checked={tr.picking} disabled={!chInfo(cfg, tr.shown).ok}
            onChange={(e) => { tr.setPicking(e.target.checked); if (e.target.checked) { if (tr.show === 'off') tr.setShow('bi'); onClose() } }} />
          <span>段落翻译模式</span>
        </label>
        <p className="page-note tr-sheet-note">开着时点哪段翻哪段{typeof window !== 'undefined' && window.matchMedia('(pointer: fine)').matches ? `；也可以不开，按住 ${/Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'} 单击段落` : ''}</p>
      </div>
      {tr.versions.length > 0 && (
        <>
          <span className="sheet-label">译文</span>
          <div className="sheet-choices wrap">
            {tr.versions.map((k) => (
              <button key={k} className={tr.cur === k ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={tr.cur === k} disabled={running}
                onClick={() => tr.view(k)}>
                {chInfo(cfg, k).label}
              </button>
            ))}
          </div>
          <span className="sheet-label">显示</span>
          <div className="sheet-choices">
            {([['off', '原文'], ['bi', '双语'], ['only', '只看译文']] as const).map(([v, l]) => (
              <button key={v} className={tr.show === v ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={tr.show === v} onClick={() => tr.setShow(v)}>
                {l}
              </button>
            ))}
          </div>
        </>
      )}
      <span className="sheet-label">默认渠道</span>
      <div className="sheet-choices wrap">
        {keys.map((k) => {
          const c = chInfo(cfg, k), on = k === dkey
          return (
            <button key={k} className={on ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={on}
              disabled={switching || running || (!c.ok && !on)} title={c.ok ? undefined : '还没设置好'}
              onClick={() => !on && pickDefault(k)}>
              {c.label}
            </button>
          )
        })}
      </div>
      <div className="sheet-actions"><button className="sheet-action quiet" onClick={goSettings}>渠道设置</button></div>
    </Sheet>
  )
}

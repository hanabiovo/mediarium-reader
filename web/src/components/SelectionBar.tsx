// 划词工具栏（阶段 5a）：在正文里选中文字，选区下方浮出一条小工具栏。
// 手机上系统自己的复制 / 搜索菜单通常在选区上方，所以我们放在下方，避免叠在一起；
// iPhone 的系统菜单关不掉，只能共存（2026-10-21 Hana：能做到哪步算哪步）。
// 选中的文字在工具栏出现时就记下来：手机上一点按钮，选区可能先被系统收掉了
import { copyText } from '../lib/native'
import { useEffect, useRef, useState } from 'react'
import { toast, toastError } from './Toast'
import { deliver, quoteMarkdown, quoteText, shareOut, touch, type Doc } from '../lib/exporter'
import { Sheet } from './Sheet'
import { CARD_MAX, renderCard } from '../lib/card'
import { failText, mtIsDeepl, translateBatch, TrError, useTrConfig } from '../lib/translate'

type Pos = { x: number; y: number; below: boolean }

export function SelectionBar({ root, doc }: { root: React.RefObject<HTMLElement | null>; doc: Doc | null }) {
  const [pos, setPos] = useState<Pos | null>(null)
  const text = useRef('')
  const [sharing, setSharing] = useState('')
  const [translating, setTranslating] = useState('')

  useEffect(() => {
    let t = 0
    const on = () => {
      window.clearTimeout(t)
      t = window.setTimeout(() => {
        const sel = document.getSelection()
        const r = root.current
        if (!sel || sel.isCollapsed || !r || !sel.rangeCount) { setPos(null); return }
        const range = sel.getRangeAt(0)
        if (!r.contains(range.commonAncestorContainer)) { setPos(null); return }
        const s = sel.toString().trim()
        if (!s) { setPos(null); return }
        text.current = s
        const rect = range.getBoundingClientRect()
        const vh = window.innerHeight
        const below = rect.bottom + 64 < vh - 80
        setPos({ x: Math.min(Math.max(rect.left + rect.width / 2, 120), window.innerWidth - 120), y: below ? rect.bottom + 14 : rect.top - 14, below })
      }, 220)   // 拖动选区手柄时别跟着闪
    }
    document.addEventListener('selectionchange', on)
    const hide = () => setPos(null)
    window.addEventListener('scroll', hide, { passive: true })
    return () => { document.removeEventListener('selectionchange', on); window.removeEventListener('scroll', hide); window.clearTimeout(t) }
  }, [root])

  if (!doc) return null
  const done = () => { setPos(null); document.getSelection()?.removeAllRanges() }
  const copy = async () => {
    try { await copyText(text.current.trim()); toast('已复制。') }
    catch { toastError('没能写进剪贴板。') }
    done()
  }
  // 按下时不让焦点离开正文，电脑上选区才不会被按钮吃掉
  const keep = (e: React.PointerEvent | React.MouseEvent) => e.preventDefault()
  return (
    <>
      {pos && (
        // 手机上系统自己的菜单贴着选区，我们的就停到屏幕底部，两条分开（2026-10-21：一上一下挤在一起）
        <div className={touch() ? 'selbar docked' : pos.below ? 'selbar below' : 'selbar above'} style={touch() ? undefined : { left: pos.x, top: pos.y }}
          onPointerDown={keep} onMouseDown={keep} role="toolbar" aria-label="选中的文字">
          <button onClick={copy}>复制</button>
          {/* 翻译（阶段 4）：划词一律走机翻（Hana 定：查词不需要大模型，也不占 AI 请求） */}
          <button onClick={() => { setTranslating(text.current); done() }}>翻译</button>
          <button onClick={() => { setSharing(text.current); done() }}>分享</button>
        </div>
      )}
      {sharing && <PieceShare text={sharing} doc={doc} onClose={() => setSharing('')} />}
      {translating && <PieceTranslate text={translating} onClose={() => setTranslating('')} />}
    </>
  )
}

// 片段分享面板：纯文本（含出处）/ Markdown 引用（给 Obsidian）/ 阅读卡片（先预览）。手机走系统分享，电脑直接复制
function PieceShare({ text, doc, onClose }: { text: string; doc: Doc; onClose: () => void }) {
  const [card, setCard] = useState<{ blob: Blob; src: string } | null>(null)
  const [making, setMaking] = useState(false)
  useEffect(() => () => { if (card) URL.revokeObjectURL(card.src) }, [card])
  const out = async (t: string, copied: string) => {
    const r = await shareOut(t, doc.title)
    if (r === 'copied') toast(copied)
    if (r !== 'cancel') onClose()
  }
  const makeCard = async () => {
    if ([...text].length > CARD_MAX) { toast({ text: `超过 ${CARD_MAX} 字了，卡片放不下，换纯文本吧。`, bird: 'alert' }); return }
    setMaking(true)
    try { const blob = await renderCard(text, doc); setCard({ blob, src: URL.createObjectURL(blob) }) }
    catch (e) { toastError(`卡片没生成：${(e as Error).message}`) }
    setMaking(false)
  }
  // 保存和分享分开（2026-10-21：小米的分享菜单里没有「保存到相册」）。保存 = 下载，安卓下载的图片会进相册
  const saveCard = async (how: 'save' | 'share') => {
    if (!card) return
    const r = await deliver(`灵媒卡片 ${new Date().toISOString().slice(0, 10)}.png`, card.blob, how)
    if (r === 'saved') toast('卡片已保存。')
    if (r !== 'cancel') onClose()
  }
  return (
    <Sheet title="分享片段" placement="dock" anchor={null} onClose={onClose}>
      {!card ? (
        <div className="sheet-actions">
          <button className="sheet-action" onClick={() => out(quoteText(text, doc, true), '已复制，带出处。')}>纯文本 · 含出处</button>
          <button className="sheet-action" onClick={() => out(quoteMarkdown(text, doc), '已复制成 Markdown 引用。')}>Markdown 引用</button>
          <button className="sheet-action" onClick={makeCard} disabled={making}>{making ? '卡片生成中…' : '阅读卡片'}</button>
        </div>
      ) : (
        <>
          <img className="card-preview" src={card.src} alt="卡片预览" />
          <div className="sheet-actions">
            <button className="sheet-action" onClick={() => saveCard('save')}>保存</button>
            {touch() && 'canShare' in navigator && <button className="sheet-action" onClick={() => saveCard('share')}>分享</button>}
            <button className="sheet-action quiet" onClick={() => setCard(null)}>返回</button>
          </div>
        </>
      )}
    </Sheet>
  )
}

// 划词翻译：机翻（用户在设置里选的那家：内置火山或 DeepL）
function PieceTranslate({ text, onClose }: { text: string; onClose: () => void }) {
  const cfg = useTrConfig()
  const [out, setOut] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const label = mtIsDeepl(cfg) ? 'DeepL' : '火山机翻'
  const go = async () => {
    setErr(''); setOut(null)
    try { setOut((await translateBatch([text.slice(0, 3000)], 'selection', 'mt')).out[0] ?? '') }
    catch (e) { setErr(e instanceof TrError ? failText(e.fail) : '没翻成') }
  }
  useEffect(() => { go() }, []) // eslint-disable-line react-hooks/exhaustive-deps
  const copy = async () => { try { await copyText(out ?? ''); toast('已复制译文。'); onClose() } catch { toastError('没能写进剪贴板。') } }
  return (
    <Sheet title="译文" label={label} placement="dock" anchor={null} onClose={onClose}>
      <p className="tr-piece-src">{text}</p>
      {out === null && !err && <p className="page-note">翻译中…</p>}
      {out !== null && <p className="tr-piece-out" lang="zh-CN">{out}</p>}
      {err && <p className="page-error">{err}</p>}
      <div className="sheet-actions">
        {out !== null && <button className="sheet-action" onClick={copy}>复制译文</button>}
        {err && <button className="sheet-action" onClick={go}>重试</button>}
      </div>
    </Sheet>
  )
}

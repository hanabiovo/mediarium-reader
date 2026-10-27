// 全文分享面板（阶段 5a）：文章页顶栏和信息流长按菜单共用。
// getProse：拿到排好版的正文。文章页直接用页面上的；信息流里文章还没排过，后台先排一遍
import { Sheet } from './Sheet'
import { toast, toastError } from './Toast'
import { cleanProse, deliver, epubFile, mdFile, shareLink, type Doc } from '../lib/exporter'

export function ShareSheet({ doc, anchor, getProse, onClose }: {
  doc: Doc; anchor: HTMLElement | null; getProse: () => HTMLElement | null; onClose: () => void
}) {
  const run = async (kind: 'link' | 'md' | 'epub') => {
    onClose()
    try {
      if (kind === 'link') {
        const r = await shareLink(doc)
        if (r === 'copied') toast(doc.url ? '已复制标题、刊名和链接。' : '已复制标题和刊名。')
        return
      }
      const raw = getProse()
      if (!raw) return
      const prose = cleanProse(raw)
      const f = kind === 'md' ? mdFile(doc, prose) : await epubFile(doc, prose)
      const r = await deliver(f.name, f.blob)
      if (r === 'saved') toast(`已导出「${f.name}」。`)
    } catch (e) { toastError(`没成功：${(e as Error).message}`) }
  }
  return (
    <Sheet title="分享" placement="dock" anchor={anchor} onClose={onClose}>
      <div className="sheet-actions">
        <button className="sheet-action" onClick={() => run('link')}>{doc.url ? '分享链接' : '分享标题和刊名'}</button>
        <button className="sheet-action" onClick={() => run('md')}>导出 Markdown</button>
        <button className="sheet-action" onClick={() => run('epub')}>导出 EPUB</button>
      </div>
      {!doc.url && <p className="page-note">这篇拿不到原文地址，分享时只带标题和刊名。</p>}
      <p className="page-note">EPUB 会带上图片。</p>
    </Sheet>
  )
}

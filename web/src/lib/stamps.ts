// 节目单里的时间点（0.27，Hana 定）：一行开头是时间（03:36、102:59、1:02:03）的，时间变成能点的，点了跳过去播。
// 只在这篇带音频时做。以时间开头的段落不缩进，时间等宽、强调色、统一宽度，排成齐的一列
import { parseStamp } from './player'

const STAMP = /^(\s*)(\d{1,3}:\d{2}(?::\d{2})?)(?![\d:])/
const BLOCK = new Set(['P', 'LI', 'DIV', 'BLOCKQUOTE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'SECTION', 'TD', 'DD', 'DT'])

// 这段文字前面（到段首或上一个换行）有没有别的字
function lineStart(t: Text, root: HTMLElement): { block: HTMLElement; first: boolean } | null {
  let n: Node = t
  for (;;) {
    let p = n.previousSibling
    while (p && p.nodeType === Node.TEXT_NODE && !p.textContent!.trim()) p = p.previousSibling
    if (p) {
      if (p.nodeName === 'BR') { const b = blockOf(n, root); return b && { block: b, first: false } }
      return null
    }
    const up = n.parentElement
    if (!up || up === root) return null
    if (BLOCK.has(up.tagName)) return { block: up, first: true }
    n = up
  }
}
function blockOf(n: Node, root: HTMLElement): HTMLElement | null {
  for (let e = n.parentElement; e && e !== root; e = e.parentElement) if (BLOCK.has(e.tagName)) return e
  return null
}

// 返回找到几个
export function linkStamps(root: HTMLElement): number {
  if (root.dataset.stamps) return root.querySelectorAll('.prose-ts').length
  const hits: { t: Text; m: RegExpExecArray; block: HTMLElement; first: boolean }[] = []
  const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    const m = STAMP.exec(n.data)
    if (!m || parseStamp(m[2]) == null || n.parentElement?.closest('a, button, pre, code')) continue
    const at = lineStart(n, root)
    if (at) hits.push({ t: n, m, ...at })
  }
  // 一两个零星的时间（比如正文里提到「9:30 开门」）不算节目单
  if (hits.length < 2) return 0
  let widest = 0
  for (const { t, m, block, first } of hits) {
    const rest = t.splitText(m[1].length)
    const tail = rest.splitText(m[2].length)
    tail.data = tail.data.replace(/^[\s\u3000]+/, '')   // 时间后面的空格去掉，靠统一宽度对齐
    const b = document.createElement('button')
    b.type = 'button'
    b.className = 'prose-ts'
    b.dataset.t = String(parseStamp(m[2]))
    b.textContent = m[2]
    rest.replaceWith(b)
    widest = Math.max(widest, m[2].length)
    block.classList.add(first ? 'prose-tsline' : 'prose-tslines')
  }
  // 用换行隔开的几行（一段里好几个时间）：只取消缩进，不做悬挂
  for (const b of root.querySelectorAll('.prose-tslines')) b.classList.remove('prose-tsline')
  // 等宽数字约 0.6 个字宽，再留一点空
  root.style.setProperty('--ts-w', `${(widest * 0.6 + 0.9).toFixed(2)}em`)
  root.dataset.stamps = '1'
  return hits.length
}

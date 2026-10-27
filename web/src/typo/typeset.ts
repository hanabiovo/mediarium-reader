// 正文排版的处理函数（3d 排版模块）：文章 HTML 放进页面之后跑一遍，只动结构上的小地方。
// 规则见「阶段3 阅读器骨架.md」3d 部分（2026-10-20 Hana 定）：
//   · 英文片段标上 lang="en"，浏览器才肯按英文规则断词（两端对齐不再把汉字拉开）
//   · 图注只在有把握时认：figcaption 一定认；紧跟图片、很短、带记号的段落才认，其余当正文
//   · 原文的 <hr> 换成鸟分隔记号；最后一段末尾放鸟文末标记
//   · 功能性图片「不删，只降级」：又宽又矮的细条换成分隔记号；文末二维码连同推广文字收成「文末推广」
// 2026-10-21 对照真实信源补的（见文档「内文格式识别」例一至例四）：
//   · 普通段落当小标题的（公众号常见）：分两档认，仍是宁可漏认
//   · 文中插的推荐块（有「跳到结尾」链接和「End of …」结尾）收成一行，点开可看
//   · 图片框里的文字都算图注；列表项里只套一个内层列表时不画记号；表格里短内容的列不折行
//   · 公众号文末尾巴（作者、投稿、版权、求三连、跳转微信打开……）合成「文末附注」，文末的鸟停在它前面
//   · 少数大站的专门规则放在 SITE_RULES 里（只服务 Hana 自己，不进界面）
// 不依赖 React，将来分页器、或别的阅读器也能直接用。
import { BIRDS } from '../components/Bird'

const SKIP = new Set(['PRE', 'CODE', 'KBD', 'SAMP', 'SCRIPT', 'STYLE', 'SVG', 'TEXTAREA'])
const LATIN_RUN = /[A-Za-z][A-Za-z0-9'’\-]*(?:[  ,.;:!?&()'’"“”/\-–—]+[A-Za-z0-9][A-Za-z0-9'’\-]*)*/g
const LONG_WORD = /[A-Za-z]{6,}/
const CAPTION_MARK = /^\s*(?:[▲△↑▼↓]|图[\s：:\d一二三四五六七八九十]|圖[\s：:\d]|上图|下图|左图|右图|图片|图源|图\/|摄影|攝影|来源|來源|photo|image|source|credit|courtesy)/i
const CAPTION_ANYWHERE = /(?:图片来源|图源|图片：|摄影：|來源：|来源：|photo:|credit:|image:)/i
const PROMO = /长按|扫码|扫描|二维码|识别|关注|公众号|订阅号|添加微信|微信号|加入.{0,6}群/

const HEAD_NUM = /^(?:[一二三四五六七八九十百]+[、.．]|[0-9]{1,2}[、.．]\s*|[（(][一二三四五六七八九十0-9]+[）)]|第[一二三四五六七八九十0-9]+[章节部分篇]|Part\s*\d+)/i
const HEAD_WORD = /^(?:前言|引言|导语|结语|尾声|后记|写在最后|写在前面|总结|小结)$/
const END_PUNCT = /[。！？；：…,.!?;:、，]$/
const TAIL = /作者\s*[:：]|投稿|转载|授权|联系|邮箱|THE END|点赞|在看|转发|星标|跳转微信打开|原文链接|阅读原文|版权|编辑\s*[:：]|责编|排版\s*[:：]|校对\s*[:：]|审核\s*[:：]|视觉\s*[:：]/i
const SOURCE_LINE = /^.{0,16}(?:发布|出品|原创|编辑部)$|\d{4}-\d{2}-\d{2}\s+\d{1,2}:\d{2}/
const BLOCKISH = new Set(['P', 'DIV', 'SECTION', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'BLOCKQUOTE', 'UL', 'OL'])

const text = (el: Element) => (el.textContent ?? '').replace(/\s+/g, ' ').trim()

function svg(name: keyof typeof BIRDS, cls: string) {
  const t = document.createElement('template')
  t.innerHTML = BIRDS[name].trim()
  const el = t.content.firstElementChild as SVGElement
  el.setAttribute('class', cls); el.setAttribute('aria-hidden', 'true')
  return el
}
function divider() {
  const d = document.createElement('div')
  d.className = 'prose-divider'; d.setAttribute('role', 'separator')
  d.appendChild(svg('messenger', 'prose-divider-bird'))
  return d
}

// 只有图片、没有文字的段落
function isMedia(el: Element) {
  if (el.tagName === 'IMG') return true
  if (!['P', 'DIV', 'FIGURE', 'A', 'SPAN'].includes(el.tagName)) return false
  return !!el.querySelector('img, video, picture') && text(el) === ''
}

// 强调里的英文要单独认出来：中文强调只加粗，英文保留斜体
const inEm = (n: Node) => !!n.parentElement?.closest('em, i, cite')

// 以西文为主的段落（整段英文引文之类）：整段标英文，左对齐——英文在窄栏里两端对齐只会撑出大空洞
function markLatinBlocks(root: HTMLElement) {
  for (const el of Array.from(root.querySelectorAll('p, li, blockquote, h1, h2, h3, h4, h5, h6, figcaption'))) {
    const t = text(el)
    if (t.length < 20) continue
    const latin = (t.match(/[A-Za-z]/g) || []).length
    const han = (t.match(/[\u3400-\u9fff]/g) || []).length
    if (han === 0 && latin / t.length > 0.6) { el.setAttribute('lang', 'en'); el.classList.add('prose-latin') }
  }
}

// 表格套一层可横向滚动的框，表格本身铺满栏宽（三线表的三条线才一样长）
function wrapTables(root: HTMLElement) {
  for (const t of Array.from(root.querySelectorAll('table'))) {
    if (t.parentElement?.classList.contains('prose-table')) continue
    const w = document.createElement('div'); w.className = 'prose-table'
    t.before(w); w.appendChild(t)
  }
}

// 英文片段标上 lang="en"：只标带长单词的片段，短词断不断都一样（强调里的英文例外，全标）
function markLatin(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      for (let p = n.parentElement; p && p !== root; p = p.parentElement) {
        if (SKIP.has(p.tagName.toUpperCase()) || (p.getAttribute('lang') === 'en' && !p.classList.contains('prose-latin'))) return NodeFilter.FILTER_REJECT
      }
      const v = n.nodeValue ?? ''
      return LONG_WORD.test(v) || (/[A-Za-z]/.test(v) && inEm(n)) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
    },
  })
  const nodes: Text[] = []
  while (walker.nextNode()) nodes.push(walker.currentNode as Text)
  for (const node of nodes) {
    const s = node.nodeValue ?? ''
    const frag = document.createDocumentFragment()
    let last = 0
    const em = inEm(node)
    for (const m of s.matchAll(LATIN_RUN)) {
      if (!em && !LONG_WORD.test(m[0])) continue
      const at = m.index ?? 0
      if (at > last) frag.appendChild(document.createTextNode(s.slice(last, at)))
      const span = document.createElement('span')
      span.lang = 'en'; span.textContent = m[0]
      frag.appendChild(span)
      last = at + m[0].length
    }
    if (last === 0) continue
    if (last < s.length) frag.appendChild(document.createTextNode(s.slice(last)))
    node.replaceWith(frag)
  }
}

function markMediaAndCaptions(root: HTMLElement) {
  for (const el of Array.from(root.querySelectorAll('p, div, figure'))) if (isMedia(el)) el.classList.add('prose-media')
  for (const fc of Array.from(root.querySelectorAll('figcaption'))) fc.classList.add('prose-caption')
  // 图片框里的文字段落都算图注那一类；带「来源」「摄影」「Getty」之类的是图片版权，排得更小更淡
  for (const p of Array.from(root.querySelectorAll('figure p'))) {
    p.classList.add('prose-caption')
    if (/来源|來源|摄影|攝影|版权|getty|reuters|afp|ap photo|epa|credit/i.test(text(p))) p.classList.add('prose-credit')
  }
  for (const media of Array.from(root.querySelectorAll('.prose-media, :scope > img'))) {
    const next = media.nextElementSibling
    if (!next || next.tagName !== 'P' || next.classList.contains('prose-media')) continue
    const t = text(next)
    if (t.length === 0 || t.length > 80) continue
    if (CAPTION_MARK.test(t) || CAPTION_ANYWHERE.test(t)) next.classList.add('prose-caption')
  }
}

// 普通段落当小标题（公众号用居中加粗样式做小标题，样式被 Miniflux 删掉后只剩一个普通段落）。两档，宁可漏认：
//   一档 → 当小标题排：很短、句末无标点，并且整段加粗或以「一、」「1.」「（一）」「第×章」这类编号开头，或就是「结语」这类词；
//          紧跟在它后面的同样很短的一行算副标题，一起当小标题
//   二档 → 只是不缩进：很短、句末无标点，但够不上一档
function markSubheads(root: HTMLElement) {
  let prevHead = false
  for (const el of Array.from(root.children)) {
    if (el.tagName !== 'P' || el.classList.length) { prevHead = /^H[1-6]$/.test(el.tagName); continue }
    const t = text(el)
    const short = t.length > 0 && t.length <= 26 && !END_PUNCT.test(t) && !el.querySelector('img')
    if (!short) { prevHead = false; continue }
    const bold = el.querySelectorAll('strong, b').length > 0 && Array.from(el.querySelectorAll('strong, b')).map(text).join('') === t
    if (bold || HEAD_NUM.test(t) || HEAD_WORD.test(t) || prevHead) { el.classList.add('prose-subhead'); prevHead = true }
    else { el.classList.add('prose-short'); prevHead = false }
  }
}

// 开头那行「机器之心 2026-10-20 17:35 北京」「机器之心发布」这类出处说明：小字
function markSourceNotes(root: HTMLElement) {
  for (const el of Array.from(root.children).slice(0, 4)) {
    if (el.tagName !== 'P') continue
    const t = text(el)
    if (t && t.length <= 40 && SOURCE_LINE.test(t)) { el.classList.remove('prose-short', 'prose-subhead'); el.classList.add('prose-note') }
  }
}

// 文中插的推荐块：从「跳到…结尾」的链接开始，到「End of …」那一行为止，收成一行
function foldSkipBlocks(root: HTMLElement) {
  for (const a of Array.from(root.querySelectorAll('a[href^="#end-of"], a[href^="#skip"]'))) {
    let start: ChildNode = a
    while (start.parentNode && start.parentNode !== root) start = start.parentNode as unknown as ChildNode
    const nodes: ChildNode[] = [start]
    let n = start.nextSibling, found = false
    for (let i = 0; n && i < 12; i++, n = n.nextSibling) {
      nodes.push(n)
      if (/^End of\b/i.test((n.textContent ?? '').trim())) { found = true; break }
    }
    if (!found) continue
    const label = (nodes.find((x) => x.nodeName === 'STRONG' || x.nodeName === 'B' || /^H[1-6]$/.test(x.nodeName))?.textContent ?? '推荐阅读').trim()
    const fold = document.createElement('details')
    fold.className = 'prose-fold'
    const sum = document.createElement('summary')
    sum.textContent = `${label} · 展开`
    fold.addEventListener('toggle', () => { sum.textContent = `${label} · ${fold.open ? '收起' : '展开'}` })
    fold.appendChild(sum)
    start.before(fold)
    for (const x of nodes) fold.appendChild(x)
  }
}

// 列表项里只套着一个内层列表：外层不画记号
function markWrapperItems(root: HTMLElement) {
  for (const li of Array.from(root.querySelectorAll('li'))) {
    const kids = Array.from(li.childNodes).filter((x) => x.nodeType === 1 || (x.textContent ?? '').trim())
    if (kids.length === 1 && (kids[0].nodeName === 'UL' || kids[0].nodeName === 'OL')) li.classList.add('prose-li-wrap')
  }
}

// 表格：最长内容不超过二十来个字的列不折行（BBC「格隆汇」那种短列不会被挤成一字一行）
function tidyTables(root: HTMLElement) {
  for (const table of Array.from(root.querySelectorAll('table'))) {
    const rows = Array.from(table.rows)
    const cols = Math.max(0, ...rows.map((r) => r.cells.length))
    for (let c = 0; c < cols; c++) {
      const cells = rows.map((r) => r.cells[c]).filter(Boolean)
      if (cells.every((td) => text(td).length <= 20)) cells.forEach((td) => td.classList.add('prose-nowrap'))
    }
  }
}

// 公众号文末尾巴：从末尾往前连续认，遇到一段正经正文就停；合成一块「文末附注」
function markTail(root: HTMLElement) {
  const kids = Array.from(root.children)
  const group: Element[] = []
  for (let i = kids.length - 1; i >= 0; i--) {
    const el = kids[i]
    if (el.classList.contains('prose-fold') || el.classList.contains('prose-divider') || el.classList.contains('prose-end-line')) {
      if (group.length) group.unshift(el)
      continue
    }
    const t = text(el)
    if (t === '' && !el.querySelector('img')) { if (group.length) group.unshift(el); continue }
    if (!BLOCKISH.has(el.tagName) && el.tagName !== 'A') break
    if (t.length <= 90 && TAIL.test(t)) { group.unshift(el); continue }
    break
  }
  while (group.length && !TAIL.test(text(group[0]))) group.shift()
  if (!group.length) return
  const box = document.createElement('div')
  box.className = 'prose-tail'
  group[0].before(box)
  for (const el of group) box.appendChild(el)
}

function replaceRules(root: HTMLElement) {
  for (const hr of Array.from(root.querySelectorAll('hr'))) hr.replaceWith(divider())
}

// 文末标记：放在最后一段有字的地方，和最后一个字黏在一起
function placeEnd(root: HTMLElement) {
  root.querySelectorAll('.prose-end, .prose-end-line').forEach((el) => {
    if (el.classList.contains('prose-end-line')) el.remove()
    else {
      const wrap = el.parentElement
      el.remove()
      if (wrap?.classList.contains('prose-end-wrap')) wrap.replaceWith(...Array.from(wrap.childNodes))
    }
  })
  // 正文是空的（文章页会放一只挠头的鸦说「没拉到正文」）：不再放文末那只，免得一页两只鸟（0.29.5）
  if (!(root.textContent ?? '').trim() && !root.querySelector('img, video, audio, iframe, picture, svg:not(.prose-end)')) return
  const kids = Array.from(root.children).filter((el) => !el.classList.contains('prose-fold') && !el.classList.contains('prose-tail'))
  let target: Element | null = null
  for (let i = kids.length - 1; i >= 0; i--) {
    const el = kids[i]
    if (el.classList.contains('prose-divider') || text(el) === '') continue
    if (el.classList.contains('prose-media') || el.classList.contains('prose-caption') || el.tagName === 'FIGURE' || el.tagName === 'TABLE' || el.tagName === 'PRE' || el.classList.contains('prose-table')) break
    target = el.tagName === 'UL' || el.tagName === 'OL' ? el.lastElementChild : el
    break
  }
  const bird = svg('perched', 'prose-end')
  bird.setAttribute('data-ts', '1')
  if (target) {
    // 找到最后一个有字的文本节点
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT)
    let lastText: Text | null = null
    while (walker.nextNode()) if ((walker.currentNode.nodeValue ?? '').trim()) lastText = walker.currentNode as Text
    if (lastText) {
      const s = (lastText.nodeValue ?? '').replace(/\s+$/, '')
      const wrap = document.createElement('span')
      wrap.className = 'prose-end-wrap'
      wrap.append(s.slice(-1), bird)
      lastText.nodeValue = s.slice(0, -1)
      lastText.after(wrap)
      return
    }
  }
  const line = document.createElement('p')
  line.className = 'prose-end-line'
  line.appendChild(bird)
  const tail = root.querySelector(':scope > .prose-tail')
  if (tail) tail.before(line); else root.appendChild(line)
}

// 最外层的那一块（图片所在的段落）
function topBlock(root: HTMLElement, el: Element): Element {
  let b: Element = el
  while (b.parentElement && b.parentElement !== root) b = b.parentElement
  return b
}

function classifyImage(root: HTMLElement, img: HTMLImageElement) {
  const w = img.naturalWidth, h = img.naturalHeight
  if (!w || !h || !root.contains(img)) return false
  const block = topBlock(root, img)
  const mediaOnly = block === img || isMedia(block)
  if (Math.max(w, h) < 160) img.classList.add('prose-small')
  if (h / w >= 3) img.classList.add('prose-long')
  // 又宽又矮的细条：装饰分隔图，换成灵媒的分隔记号
  if (mediaOnly && w / h >= 8 && h <= 80) {
    block.replaceWith(divider())
    return false
  }
  // 誊写服务把「分隔图 + 下一行居中小字」认成了图 + 图注（机器之心的「Minds in AI.」+「编辑|杜伟」，2026-10-22）：
  // 拆开——图换成分隔记号，图注还原成普通的一段
  const fig = img.closest('figure')
  if (fig && w / h >= 8 && h <= 80 && fig.querySelectorAll('img').length === 1) {
    const cap = fig.querySelector('figcaption')
    const p = document.createElement('p')
    p.textContent = cap?.textContent ?? ''
    if (fig === block) block.replaceWith(divider(), ...(p.textContent ? [p] : []))
    else { fig.replaceWith(...(p.textContent ? [p] : [])); block.before(divider()) }
    return false
  }
  // 方形、在文章后段、附近有「长按识别」「扫码」「关注」：文末二维码，连同推广文字收起来
  if (mediaOnly && Math.abs(w / h - 1) <= 0.12 && Math.min(w, h) >= 100) {
    const kids = Array.from(root.children)
    const at = kids.indexOf(block)
    if (at >= 0 && at >= kids.length * 0.6 && !block.closest('.prose-fold')) {
      const near = kids.slice(Math.max(0, at - 2), at + 3).filter((el) => el !== block && !el.classList.contains('prose-fold'))
      const promo = near.filter((el) => text(el).length <= 120 && PROMO.test(text(el)))
      if (promo.length || PROMO.test(img.alt)) {
        const group = [block, ...promo].sort((a, b) => kids.indexOf(a) - kids.indexOf(b))
        const fold = document.createElement('details')
        fold.className = 'prose-fold'
        const sum = document.createElement('summary')
        sum.textContent = '文末推广 · 展开'
        fold.addEventListener('toggle', () => { sum.textContent = fold.open ? '文末推广 · 收起' : '文末推广 · 展开' })
        fold.appendChild(sum)
        group[0].before(fold)
        for (const el of group) fold.appendChild(el)
        return true
      }
    }
  }
  return false
}

// 少数大站的专门规则（2026-10-21：只服务 Hana 自己，不进界面；以后也许做成用户自己维护的组件）
type SiteRule = { match: RegExp; run: (root: HTMLElement) => void }
const SITE_RULES: SiteRule[] = [
  {
    // BBC 中文网：图注前缀是写给读屏软件的；开头的 Article Information 压成一行作者署名，发表时间和阅读时间页面上已有，不重复
    match: /(^|\.)bbc\.(com|co\.uk)$/,
    run(root) {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const strip: Text[] = []
      while (walker.nextNode()) if (/^(?:图像来源|图像加注文字|圖像來源|圖像加註文字)[，,]/.test((walker.currentNode.nodeValue ?? '').trimStart())) strip.push(walker.currentNode as Text)
      for (const t of strip) t.nodeValue = (t.nodeValue ?? '').replace(/^\s*(?:图像来源|图像加注文字|圖像來源|圖像加註文字)[，,]\s*/, '')
      for (const st of Array.from(root.querySelectorAll(':scope > strong, :scope > b, :scope > p > strong, :scope > p'))) {
        if (text(st) !== 'Article Information') continue
        const block = st.parentElement === root ? st : st.parentElement!
        if (!block.isConnected) continue
        const list = block.nextElementSibling
        const items = list && /^(UL|OL)$/.test(list.tagName) ? Array.from(list.querySelectorAll('li')).filter((li) => !li.querySelector('ul, ol')).map(text) : []
        const who = items.filter((t) => /^(Author|Role|作者|职务|職務)[,，\s]/i.test(t)).map((t) => t.replace(/^(Author|Role|作者|职务|職務)[,，\s]+/i, '').trim())
        const line = document.createElement('p')
        line.className = 'prose-note prose-byline'
        line.textContent = who.join(' · ')
        block.before(line)
        block.remove(); list?.remove()
        if (!who.length) line.remove()
      }
      // 不带标签的「Published 2026年10月20日阅读时间: 3 分钟」
      for (const n of Array.from(root.childNodes)) {
        if (n.nodeName === 'P' && /^\s*(?:Published\s*(?:\S*\s*阅读时间[:：].*)?|阅读时间[:：].*)$/.test(n.textContent ?? '')) { n.remove(); continue }
        if ((n.nodeType === 3 && /^\s*Published\s*$|阅读时间[:：]/.test(n.textContent ?? '')) || (n.nodeName === 'TIME' && /Published\s*$/.test(n.previousSibling?.textContent ?? ''))) n.remove()
      }
    },
  },
]

// 不换行空格（&nbsp;）换成普通空格：源里成串的 &nbsp; 会把一长段粘成一个整体，放不下就整段掉到下一行，
// 上一行剩下的空全摊进字距（两端对齐被拉开，2026-10-21 Hana 截到）。代码里的不动
function normalizeSpaces(root: HTMLElement) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) {
    const n = w.currentNode as Text
    if (!n.nodeValue?.includes('\u00a0') || n.parentElement?.closest('pre, code')) continue
    n.nodeValue = n.nodeValue.replace(/\u00a0/g, ' ')
  }
}

// 拉得太开的段落改成左对齐（2026-10-24 Hana）：两端对齐碰上放不进上一行的英文词（「Utopia，」），
// 浏览器会把这一行的字硬拉开，CSS 没有「最多拉开多少」的开关。所以排完量一遍：先按左对齐量出每一行的空白，
// 哪一行（段落最后一行不算）空出的超过这一行宽度的 STRETCH，这一整段就左对齐，别的段照样两端对齐
const STRETCH = 0.18
function measureStretch(p: HTMLElement): boolean {
  const box = p.getBoundingClientRect()
  if (!box.width) return false
  const cs = getComputedStyle(p)
  const left = box.left + parseFloat(cs.paddingLeft), right = box.right - parseFloat(cs.paddingRight)
  const range = document.createRange()
  range.selectNodeContents(p)
  const lines = new Map<number, { l: number; r: number }>()
  for (const rc of Array.from(range.getClientRects())) {
    if (!rc.width) continue
    const k = Math.round(rc.top + rc.height / 2)
    const key = [...lines.keys()].find((x) => Math.abs(x - k) < rc.height / 2) ?? k
    const cur = lines.get(key)
    lines.set(key, cur ? { l: Math.min(cur.l, rc.left), r: Math.max(cur.r, rc.right) } : { l: rc.left, r: rc.right })
  }
  const rows = [...lines.entries()].sort((a, b) => a[0] - b[0]).slice(0, -1)   // 最后一行本来就不拉
  return rows.some(([, v]) => { const w = right - Math.max(left, v.l); return w > 0 && (right - v.r) / w > STRETCH })
}
function fixStretch(root: HTMLElement) {
  const ps = Array.from(root.querySelectorAll<HTMLElement>('p')).filter((p) => !p.closest('pre, code, table, .prose-tr, .prose-poem') && !p.querySelector('br'))   // 有手动换行的段不量（换行前那行本来就不拉）
  for (const p of ps) { p.classList.remove('prose-ragged'); p.classList.add('prose-measure') }
  const bad = ps.filter(measureStretch)
  for (const p of ps) p.classList.remove('prose-measure')
  for (const p of bad) p.classList.add('prose-ragged')
}
function watchStretch(root: HTMLElement): () => void {
  let raf = 0, w = 0
  const run = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => fixStretch(root)) }
  const ro = new ResizeObserver(() => { if (root.clientWidth !== w) { w = root.clientWidth; run() } })
  ro.observe(root)
  document.fonts?.ready.then(run)
  document.fonts?.addEventListener('loadingdone', run)
  return () => { ro.disconnect(); cancelAnimationFrame(raf); document.fonts?.removeEventListener('loadingdone', run) }
}

// 正文开头又写一遍标题（0.29.8）：抓全文时把网页上的标题一起抠下来了（Blogger 的 h3.post-title 等）。和文章标题一样就去掉
// 0.29.9：聚合源（Hacker News 等）的标题常和原文差几个字（A / The），正文开头是 h1–h6 的，很像也算
const sameTitle = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
const HEADING = /^H[1-6]$/
const WRAPPER = new Set(['DIV', 'SECTION', 'ARTICLE', 'HEADER', 'MAIN', 'HGROUP'])
// 两串字有多像：相邻两字的重合比例（0–1），中英文都适用
function alike(a: string, b: string): number {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const pairs = new Map<string, number>()
  for (let i = 0; i < a.length - 1; i++) { const k = a.slice(i, i + 2); pairs.set(k, (pairs.get(k) ?? 0) + 1) }
  let hit = 0
  for (let i = 0; i < b.length - 1; i++) { const k = b.slice(i, i + 2), n = pairs.get(k) ?? 0; if (n) { hit++; pairs.set(k, n - 1) } }
  return (2 * hit) / (a.length + b.length - 2)
}
function dropLeadTitle(root: HTMLElement, title?: string) {
  const want = title ? sameTitle(title) : ''
  if (!want) return
  // 从头往里走：每层取第一个有字的子元素，看哪层的文字是标题
  let el: Element | null = root
  for (let depth = 0; el && depth < 6; depth++) {
    // 第一个有字或是图的子节点（裸文字也算，裸文字在前就说明开头不是单独一行标题）
    const first = Array.from(el.childNodes).find((c) => c.nodeType === 1 ? text(c as Element) || isMedia(c as Element) : (c.textContent ?? '').trim())
    if (!first || first.nodeType !== 1) return
    const next = first as Element
    if (isMedia(next)) return
    const t = sameTitle(text(next))
    if (t === want || (HEADING.test(next.tagName) && alike(t, want) >= 0.8)) {
      let gone: Element = next
      while (gone.parentElement && gone.parentElement !== root && !text(gone.parentElement).replace(text(gone), '').trim()) gone = gone.parentElement
      // 只删单独成行的块（标题、段落）；句子里的书名斜体之类不动。带图的、删完正文就空了的也不动
      if (!BLOCKISH.has(gone.tagName) || gone.querySelector('img, video, audio, iframe')) return
      if (!text(root).replace(text(gone), '').trim()) return
      gone.remove()
      return
    }
    // 外面套的一层 div 之类：往里走；第一段既不是标题、也不以标题开头：不动
    if (!WRAPPER.has(next.tagName) && !t.startsWith(want)) return
    el = next
  }
}

// 处理一遍；结构上的改动只做一次（文末标记在就说明做过了），图片则每次都补上监听，直到认完为止。返回清理函数
export function typeset(root: HTMLElement, opts: { url?: string; title?: string } = {}): () => void {
  // 排过的标记放在正文第一个元素上：换文章时 React 重设整块正文，标记跟着没了，就会再排
  const done = (root.firstElementChild as HTMLElement | null)?.dataset.tsRoot
  if (!done) {
    let host = ''
    try { host = opts.url ? new URL(opts.url).hostname : '' } catch { /* 无 */ }
    for (const r of SITE_RULES) if (host && r.match.test(host)) r.run(root)
    dropLeadTitle(root, opts.title)
    normalizeSpaces(root)
    foldSkipBlocks(root)
    markLatinBlocks(root)
    markLatin(root)
    replaceRules(root)
    wrapTables(root)
    tidyTables(root)
    markWrapperItems(root)
    markMediaAndCaptions(root)
    markSubheads(root)
    markSourceNotes(root)
    markTail(root)
    placeEnd(root)
    const first = root.firstElementChild as HTMLElement | null
    if (first) first.dataset.tsRoot = '1'
  }
  const offs: (() => void)[] = [watchStretch(root)]
  const check = (img: HTMLImageElement) => {
    if (img.dataset.ts) return
    img.dataset.ts = '1'
    if (classifyImage(root, img)) placeEnd(root)
  }
  for (const img of Array.from(root.querySelectorAll('img'))) {
    if (img.dataset.ts) continue
    if (img.complete && img.naturalWidth) { check(img); continue }
    const on = () => check(img)
    img.addEventListener('load', on, { once: true })
    offs.push(() => img.removeEventListener('load', on))
  }
  return () => offs.forEach((f) => f())
}

// 译文（阶段 4）：插进正文的译文段落也过一遍空格与中西文处理，和正文一个样子
export function typesetTranslation(el: HTMLElement) {
  normalizeSpaces(el)
  markLatin(el)
}

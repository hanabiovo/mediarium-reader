// 全文分享与导出（阶段 5a，2026-10-21 Hana 定）。
//   分享链接：标题 + 刊名 + 原文地址；拿不到原文地址时只给标题和刊名（不分享灵媒自己的链接——别人打不开）。
//   导出 md：开头一段 Obsidian 认得的属性（标题、刊名、作者、发表日期、原文、导出日期），正文用排版模块处理过的那一版。
//   导出 epub：封面用报纸视图的版式加读书的鸟；图片经誊写服务（5b）取回打包进去，取不到的去掉、图注保留。
// 自托管全文外链不做（版权与服务器风险，Hana：「安全合法是第一位的」）。
import { copyText, nativeSave } from './native'
import { strToU8, zipSync } from 'fflate'
import { BIRDS } from '../components/Bird'
import { fetchImage } from './scribe'

export type Doc = { title: string; source: string; author?: string; published: string; url?: string; html: string }

const date = (iso: string) => iso.slice(0, 10)
const safeName = (s: string) => s.replace(/[\\/:*?"<>|\n\r]+/g, ' ').trim().slice(0, 80) || '灵媒文章'

// 从页面上排好的正文拿一份干净的副本：装饰（鸟、分隔记号）、折起来的推广块、隐藏元素都去掉
export function cleanProse(prose: HTMLElement): HTMLElement {
  const c = prose.cloneNode(true) as HTMLElement
  c.querySelectorAll('.prose-fold, .prose-end, svg, script, style, iframe').forEach((n) => n.remove())
  c.querySelectorAll('.prose-divider').forEach((n) => n.replaceWith(document.createElement('hr')))
  c.querySelectorAll('[data-ts], [data-ts-root]').forEach((n) => { n.removeAttribute('data-ts'); n.removeAttribute('data-ts-root') })
  return c
}

// ——— 分享链接 ———
export function shareText(d: Doc) {
  return [d.title, `—— ${d.source}`, d.url].filter(Boolean).join('\n')
}
// 手机：系统分享，标题、刊名、链接拼成一整段交出去（分开交的话，有的 app 只收链接）。
// 电脑：直接复制整段（Windows 的分享菜单里「复制链接」只取链接，2026-10-21 Hana 发现）
export const touch = () => matchMedia('(pointer: coarse)').matches
export async function shareOut(text: string, title?: string): Promise<'shared' | 'copied' | 'cancel'> {
  if (navigator.share && touch()) {
    try { await navigator.share({ title, text }); return 'shared' }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancel' }
  }
  await copyText(text)
  return 'copied'
}
export const shareLink = (d: Doc) => shareOut(shareText(d), d.title)

// 原网页地址。BBC 的源把文章链接写成 rel="self"，Miniflux 认不出，拿订阅源地址顶上；这时当作没有（补地址归 5b 转写服务）
export function originOf(e: { url?: string; feed?: { feed_url: string; site_url: string } }) {
  return e.url && e.url !== e.feed?.feed_url && e.url !== e.feed?.site_url ? e.url : ''
}

// 片段：Markdown 引用（给 Obsidian）
export function quoteMarkdown(text: string, d: Doc) {
  const body = text.trim().split(/\n+/).map((l) => `> ${l}`).join('\n>\n')
  const title = d.url ? `[《${d.title}》](${d.url})` : `《${d.title}》`
  return `${body}\n>\n> —— ${title}，${d.source}`
}

// 片段：带出处的写法
export function quoteText(text: string, d: Doc, withSource: boolean) {
  const t = text.trim()
  if (!withSource) return t
  return [`「${t}」`, `—— 《${d.title}》，${d.source}`, d.url].filter(Boolean).join('\n')
}

// ——— Markdown ———
function md(node: Node, ctx: { list: string[] } = { list: [] }): string {
  if (node.nodeType === 3) return (node.nodeValue ?? '').replace(/\s+/g, ' ')
  if (node.nodeType !== 1) return ''
  const el = node as HTMLElement
  const kids = () => Array.from(el.childNodes).map((n) => md(n, ctx)).join('')
  const head = () => kids().replace(/\*\*/g, '').trim()   // 标题里本来就是粗的，不再套加粗
  const tag = el.tagName
  if (el.classList.contains('prose-subhead')) return `\n\n### ${head()}\n\n`
  if (el.classList.contains('prose-caption')) return `\n\n*${kids().trim()}*\n\n`
  switch (tag) {
    case 'H1': case 'H2': return `\n\n## ${head()}\n\n`
    case 'H3': case 'H4': case 'H5': case 'H6': return `\n\n### ${head()}\n\n`
    case 'P': case 'FIGCAPTION': case 'DIV': case 'SECTION': case 'FIGURE': { const t = kids().trim(); return t ? `\n\n${t}\n\n` : '' }
    case 'BR': return '  \n'
    case 'HR': return '\n\n---\n\n'
    case 'STRONG': case 'B': { const t = kids().trim(); return t ? `**${t}**` : '' }
    case 'EM': case 'I': case 'CITE': { const t = kids().trim(); return t ? `*${t}*` : '' }
    case 'CODE': return el.closest('pre') ? kids() : `\`${el.textContent ?? ''}\``
    case 'PRE': return `\n\n\`\`\`\n${el.textContent ?? ''}\n\`\`\`\n\n`
    case 'A': { const t = kids().trim(); const h = el.getAttribute('href') ?? ''; return h && !h.startsWith('#') ? `[${t || h}](${h})` : t }
    // 图片：写成网址引用（公众号的图有防盗链，在别处打开可能裂；等 5b 图片中转再改成可靠的地址）
    case 'IMG': { const s = el.getAttribute('src'); return s ? `\n\n![${el.getAttribute('alt') ?? ''}](${s})\n\n` : '' }
    case 'BLOCKQUOTE': return '\n\n' + kids().trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n'
    case 'UL': case 'OL': {
      ctx.list.push(tag)
      const items = Array.from(el.children).filter((c) => c.tagName === 'LI').map((li, i) => {
        const pad = '  '.repeat(ctx.list.length - 1)
        const mark = tag === 'OL' ? `${i + 1}.` : '-'
        return `${pad}${mark} ${md(li, ctx).trim().replace(/\n\n+/g, '\n')}`
      })
      ctx.list.pop()
      return `\n\n${items.join('\n')}\n\n`
    }
    case 'LI': return kids()
    case 'TABLE': {
      const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((td) => (td.textContent ?? '').trim().replace(/\|/g, '\\|')))
      if (!rows.length) return ''
      const n = Math.max(...rows.map((r) => r.length))
      const line = (r: string[]) => `| ${Array.from({ length: n }, (_, i) => r[i] ?? '').join(' | ')} |`
      return `\n\n${line(rows[0])}\n| ${Array(n).fill('---').join(' | ')} |\n${rows.slice(1).map(line).join('\n')}\n\n`
    }
    default: return kids()
  }
}

const yaml = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

export function toMarkdown(d: Doc, prose: HTMLElement): string {
  const front = [
    '---',
    `title: ${yaml(d.title)}`,
    `source: ${yaml(d.source)}`,
    d.author ? `author: ${yaml(d.author)}` : '',
    `published: ${date(d.published)}`,
    d.url ? `url: ${yaml(d.url)}` : '',
    `exported: ${new Date().toISOString().slice(0, 10)}`,
    'from: 灵媒 Mediarium',
    '---',
  ].filter(Boolean).join('\n')
  const body = md(prose).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return `${front}\n\n# ${d.title}\n\n${body}\n`
}

// ——— 下载 / 分享文件 ———
// how：'auto' 手机上能分享文件就走系统分享、否则下载；'save' 一定下载；'share' 一定走系统分享（不支持就下载）
export async function deliver(name: string, blob: Blob, how: 'auto' | 'save' | 'share' = 'auto'): Promise<'shared' | 'saved' | 'cancel'> {
  // 墨水屏 APK：网页框不会下载，交给壳存进「下载」文件夹
  if (await nativeSave(name, blob).catch(() => false)) return 'saved'
  const file = new File([blob], name, { type: blob.type })
  if (how !== 'save' && navigator.canShare?.({ files: [file] }) && (how === 'share' || matchMedia('(pointer: coarse)').matches)) {
    try { await navigator.share({ files: [file], title: name }); return 'shared' }
    catch (e) { if ((e as Error).name === 'AbortError') return 'cancel' }
  }
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob); a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(a.href), 4000)
  return 'saved'
}
export const mdFile = (d: Doc, prose: HTMLElement) =>
  ({ name: `${safeName(d.title)}.md`, blob: new Blob([toMarkdown(d, prose)], { type: 'text/markdown;charset=utf-8' }) })

// ——— EPUB ———
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// 正文转成 XHTML：图片先去掉（只留图注），其余标签交给 XMLSerializer 写成合规的 XHTML
// 图片经誊写服务取回、打包进 epub（5b-2）。取不到的就去掉，图注保留。最多 60 张、合计 40MB
const IMG_EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/svg+xml': 'svg', 'image/avif': 'avif' }
async function packImages(c: HTMLElement): Promise<{ name: string; type: string; data: Uint8Array }[]> {
  const out: { name: string; type: string; data: Uint8Array }[] = []
  let total = 0
  for (const img of Array.from(c.querySelectorAll('img'))) {
    const src = img.getAttribute('src') ?? ''
    const blob = out.length < 60 && total < 40 * 1024 * 1024 ? await fetchImage(src) : null
    const ext = blob ? IMG_EXT[blob.type] : undefined
    if (!blob || !ext) { img.remove(); continue }
    const name = `images/${out.length + 1}.${ext}`
    const data = new Uint8Array(await blob.arrayBuffer())
    total += data.length
    out.push({ name, type: blob.type, data })
    for (const a of Array.from(img.attributes)) img.removeAttribute(a.name)
    img.setAttribute('src', name); img.setAttribute('alt', '')
  }
  return out
}

function xhtmlBody(prose: HTMLElement): string {
  const c = prose.cloneNode(true) as HTMLElement
  c.querySelectorAll('picture source, video, audio, source').forEach((n) => n.remove())
  c.querySelectorAll('*').forEach((el) => {
    for (const a of Array.from(el.attributes)) if (!['href', 'class', 'lang', 'colspan', 'rowspan', 'src', 'alt'].includes(a.name)) el.removeAttribute(a.name)
    if (el.tagName === 'A' && el.getAttribute('href')?.startsWith('#')) el.removeAttribute('href')
  })
  c.querySelectorAll('p, div, figure').forEach((el) => { if (!el.textContent?.trim() && !el.querySelector('hr, img')) el.remove() })
  const s = new XMLSerializer()
  return Array.from(c.childNodes).map((n) => s.serializeToString(n)).join('\n').replace(/ xmlns="http:\/\/www\.w3\.org\/1999\/xhtml"/g, '')
}

// 封面：报纸视图的版式——细线、刊名做报头、双线，下面文章标题，再下面读书的鸟。用页面上已加载的字体画
async function cover(d: Doc): Promise<Uint8Array> {
  const W = 1200, H = 1680, cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')!
  const css = getComputedStyle(document.documentElement)
  const ink = css.getPropertyValue('--ink').trim() || '#1a1a18'
  const mid = '#6b6960'
  const paper = '#f7f5f0'   // 封面固定用纸本浅色：导进书架里要像一本纸书
  const fDisplay = css.getPropertyValue('--font-ui-display').trim() || 'serif'
  const fTitle = css.getPropertyValue('--font-title').trim() || 'serif'
  const fMono = css.getPropertyValue('--font-mono').trim() || 'monospace'
  const dark = ink.toLowerCase() !== '#1a1a18' ? '#1a1a18' : ink
  g.fillStyle = paper; g.fillRect(0, 0, W, H)
  g.fillStyle = dark; g.strokeStyle = dark
  const M = 96
  // 顶上的日期线
  g.font = `30px ${fMono}`; g.fillStyle = mid
  const dl = date(d.published).replace(/-/g, '.')
  g.textBaseline = 'alphabetic'
  g.textAlign = 'left'; g.fillText('MEDIARIUM', M, 150)
  g.textAlign = 'right'; g.fillText(dl, W - M, 150)
  g.fillStyle = dark; g.fillRect(M, 172, W - 2 * M, 3)
  // 报头
  g.textAlign = 'center'
  let size = 150
  do { g.font = `700 ${size}px ${fDisplay}`; size -= 6 } while (g.measureText(d.source).width > W - 2 * M && size > 50)
  g.fillText(d.source, W / 2, 172 + 70 + size)
  const y2 = 172 + 70 + size + 50
  g.fillRect(M, y2, W - 2 * M, 3); g.fillRect(M, y2 + 10, W - 2 * M, 3)
  // 文章标题：自动折行
  g.font = `700 64px ${fTitle}`
  const lines: string[] = []
  let cur = ''
  for (const ch of [...d.title]) {
    if (g.measureText(cur + ch).width > W - 2 * M - 40) { lines.push(cur); cur = ch } else cur += ch
  }
  if (cur) lines.push(cur)
  lines.slice(0, 5).forEach((l, i) => g.fillText(l, W / 2, y2 + 170 + i * 92))
  // 读书的鸟
  const svg = BIRDS.reading.replace(/currentColor/g, dark)
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode().catch(() => {})
  if (img.naturalWidth) { const bh = 240, bw = bh * img.naturalWidth / img.naturalHeight; g.drawImage(img, (W - bw) / 2, H - 230 - bh, bw, bh) }
  g.font = `28px ${fMono}`; g.fillStyle = mid
  g.fillText('灵媒 · 一个人的书报亭', W / 2, H - 120)
  const blob: Blob = await new Promise((r) => cv.toBlob((b) => r(b!), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

export async function epubFile(d: Doc, proseIn: HTMLElement) {
  const prose = proseIn.cloneNode(true) as HTMLElement
  const images = await packImages(prose)
  const id = `urn:mediarium:${Date.now().toString(36)}`
  const lang = 'zh-CN'
  const title = esc(d.title)
  const chapter = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>${title}</title><link rel="stylesheet" href="style.css"/></head>
<body>
<h1>${title}</h1>
<p class="meta">${esc(d.source)}${d.author ? ` · ${esc(d.author)}` : ''} · ${date(d.published)}</p>
${xhtmlBody(prose)}
${d.url ? `<p class="meta">原文：<a href="${esc(d.url)}">${esc(d.url)}</a></p>` : ''}
</body></html>`
  const coverPage = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>封面</title><style>body{margin:0;text-align:center}img{max-width:100%;max-height:100vh}</style></head>
<body epub:type="cover"><img src="cover.png" alt="${title}"/></body></html>`
  const nav = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="${lang}" lang="${lang}">
<head><meta charset="utf-8"/><title>目录</title></head>
<body><nav epub:type="toc"><ol><li><a href="chapter.xhtml">${title}</a></li></ol></nav></body></html>`
  const opf = `<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
<metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
<dc:identifier id="bookid">${id}</dc:identifier>
<dc:title>${title}</dc:title>
<dc:creator>${esc(d.author || d.source)}</dc:creator>
<dc:publisher>${esc(d.source)}</dc:publisher>
<dc:language>${lang}</dc:language>
<dc:date>${date(d.published)}</dc:date>
${d.url ? `<dc:source>${esc(d.url)}</dc:source>` : ''}
<meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
<meta name="cover" content="cover-img"/>
</metadata>
<manifest>
<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
<item id="cover-img" href="cover.png" media-type="image/png" properties="cover-image"/>
<item id="cover" href="cover.xhtml" media-type="application/xhtml+xml"/>
<item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/>
<item id="css" href="style.css" media-type="text/css"/>
${images.map((im, i) => `<item id="img${i + 1}" href="${im.name}" media-type="${im.type}"/>`).join('\n')}
</manifest>
<spine><itemref idref="cover" linear="no"/><itemref idref="chapter"/></spine>
</package>`
  const style = `img{max-width:100%;height:auto;display:block;margin:1em auto}body{line-height:1.8;text-align:justify}h1{font-size:1.5em;line-height:1.4;text-align:left}h2,h3,.prose-subhead{font-weight:bold;text-align:left;margin-top:1.6em}
.meta,.prose-note,.prose-tail{font-size:.85em;color:#666}.prose-caption,figcaption{font-size:.85em;color:#666;text-align:center}blockquote{margin-left:1em;padding-left:1em;border-left:1px solid #ccc;color:#555}table{border-collapse:collapse}td,th{padding:.3em .8em}`
  const files: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`),
    'OEBPS/content.opf': strToU8(opf),
    'OEBPS/nav.xhtml': strToU8(nav),
    'OEBPS/cover.xhtml': strToU8(coverPage),
    'OEBPS/chapter.xhtml': strToU8(chapter),
    'OEBPS/style.css': strToU8(style),
    'OEBPS/cover.png': await cover(d),
  }
  for (const im of images) files[`OEBPS/${im.name}`] = im.data
  // mimetype 必须是压缩包里第一个、且不压缩
  const zip = zipSync(files as never)
  return { name: `${safeName(d.title)}.epub`, blob: new Blob([zip as unknown as BlobPart], { type: 'application/epub+zip' }) }
}

// 文章正文 HTML → Markdown（MCP 读全文用，2026-10-27）。给 AI 读，不求排版好看，求干净、完整、省字：
//   标题、段落、列表、引用、链接、图（写成 ![图注](地址)）、代码、表格（简单的）；脚本、样式、表单之类整个丢掉。
//   开头又写一遍文章标题的（抓全文时连网页标题一起抠下来了），去掉（同网页端 typeset.ts 的 dropLeadTitle）。
import * as cheerio from 'cheerio'

const DROP = new Set(['script', 'style', 'noscript', 'iframe', 'form', 'button', 'input', 'select', 'textarea', 'svg', 'canvas', 'nav', 'template'])
const BLOCK = new Set(['p', 'div', 'section', 'article', 'header', 'footer', 'main', 'aside', 'figure', 'figcaption', 'blockquote', 'ul', 'ol', 'li', 'pre', 'table', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'dl', 'dt', 'dd'])
const sameTitle = (s) => String(s).normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '')
function alike(a, b) {
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0
  const pairs = new Map()
  for (let i = 0; i < a.length - 1; i++) { const k = a.slice(i, i + 2); pairs.set(k, (pairs.get(k) ?? 0) + 1) }
  let hit = 0
  for (let i = 0; i < b.length - 1; i++) { const k = b.slice(i, i + 2), n = pairs.get(k) ?? 0; if (n) { hit++; pairs.set(k, n - 1) } }
  return (2 * hit) / (a.length + b.length - 2)
}
const squash = (s) => s.replace(/\s+/g, ' ')

export function htmlToMarkdown(html, { title, base } = {}) {
  const $ = cheerio.load(String(html ?? ''), null, false)
  const abs = (u) => { if (!u) return ''; try { return new URL(u, base || undefined).href } catch { return u } }

  // 开头重复的标题
  if (title) {
    const want = sameTitle(title)
    const first = $.root().find('h1,h2,h3,h4,h5,h6,p').filter((_, el) => $(el).text().trim()).first()
    if (first.length && !first.find('img').length) {
      const t = sameTitle(first.text())
      const before = $.root().text().indexOf(first.text().trim())
      const lead = before >= 0 && !$.root().text().slice(0, before).trim()
      if (lead && (t === want || (/^h[1-6]$/.test(first[0].tagName) && alike(t, want) >= 0.8))) first.remove()
    }
  }

  const inline = (node) => {
    let out = ''
    $(node).contents().each((_, c) => { out += render(c, true) })
    return out
  }
  function render(node, inInline = false) {
    if (node.type === 'text') return inInline ? squash(node.data ?? '') : squash(node.data ?? '')
    if (node.type !== 'tag') return ''
    const tag = node.tagName.toLowerCase()
    if (DROP.has(tag)) return ''
    const el = $(node)
    switch (tag) {
      case 'br': return '\n'
      case 'hr': return '\n\n---\n\n'
      case 'h1': case 'h2': case 'h3': case 'h4': case 'h5': case 'h6': {
        const t = inline(node).trim()
        return t ? `\n\n${'#'.repeat(Number(tag[1]))} ${t}\n\n` : ''
      }
      case 'strong': case 'b': { const t = inline(node).trim(); return t ? `**${t}**` : '' }
      case 'em': case 'i': case 'cite': { const t = inline(node).trim(); return t ? `*${t}*` : '' }
      case 'code': return el.parents('pre').length ? el.text() : '`' + el.text() + '`'
      case 'pre': return '\n\n```\n' + el.text().replace(/\n+$/, '') + '\n```\n\n'
      case 'a': {
        const t = inline(node).trim()
        const href = el.attr('href')
        if (!t) return ''
        if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return t
        return `[${t}](${abs(href)})`
      }
      case 'img': {
        const src = el.attr('src') || el.attr('data-src') || ''
        if (!src || src.startsWith('data:')) return ''
        return `![${squash(el.attr('alt') ?? '').trim()}](${abs(src)})`
      }
      case 'figure': {
        const img = el.find('img').first()
        const cap = el.find('figcaption').first().text().trim()
        const src = img.attr('src') || img.attr('data-src') || ''
        if (src && !src.startsWith('data:')) return `\n\n![${squash(cap || img.attr('alt') || '').trim()}](${abs(src)})\n\n`
        return '\n\n' + inline(node).trim() + '\n\n'
      }
      case 'blockquote': {
        const t = block(node).trim()
        return t ? '\n\n' + t.split('\n').map((l) => (l ? '> ' + l : '>')).join('\n') + '\n\n' : ''
      }
      case 'ul': case 'ol': {
        let i = 0
        const items = el.children('li').map((_, li) => {
          i++
          const t = block(li).trim().replace(/\n{2,}/g, '\n').split('\n').join('\n   ')
          return t ? `${tag === 'ol' ? i + '.' : '-'} ${t}` : ''
        }).get().filter(Boolean)
        return items.length ? '\n\n' + items.join('\n') + '\n\n' : ''
      }
      case 'table': {
        const rows = el.find('tr').map((_, tr) => [$(tr).children('th,td').map((_, c) => squash($(c).text()).trim().replace(/\|/g, '\\|')).get()]).get()
        if (!rows.length) return ''
        const w = Math.max(...rows.map((r) => r.length))
        const line = (r) => '| ' + Array.from({ length: w }, (_, k) => r[k] ?? '').join(' | ') + ' |'
        return '\n\n' + [line(rows[0]), '|' + ' --- |'.repeat(w), ...rows.slice(1).map(line)].join('\n') + '\n\n'
      }
      default:
        if (BLOCK.has(tag)) { const t = block(node).trim(); return t ? `\n\n${t}\n\n` : '' }
        return inline(node)
    }
  }
  function block(node) {
    let out = ''
    $(node).contents().each((_, c) => { out += render(c) })
    return tidy(out)
  }
  const tidy = (s) => s.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n').replace(/\n{3,}/g, '\n\n')

  let out = ''
  $.root().contents().each((_, c) => { out += render(c) })
  return tidy(out).trim()
}

// 长文章分节：按 ## / ### 标题切；没有小标题就按字数切（约 6000 字一节）
export function sections(md, size = 6000) {
  const parts = []
  const lines = md.split('\n')
  let cur = { title: '开头', lines: [] }
  for (const l of lines) {
    const m = l.match(/^(#{1,3}) (.+)$/)
    if (m && cur.lines.join('\n').trim()) { parts.push(cur); cur = { title: m[2].trim(), lines: [l] } }
    else { if (m && !cur.lines.join('').trim()) cur.title = m[2].trim(); cur.lines.push(l) }
  }
  parts.push(cur)
  const out = []
  for (const p of parts) {
    const text = p.lines.join('\n').trim()
    if (!text) continue
    if (text.length <= size * 1.5) { out.push({ title: p.title, text }); continue }
    const paras = text.split(/\n\n/)
    let buf = '', n = 1
    for (const para of paras) {
      if (buf && buf.length + para.length > size) { out.push({ title: `${p.title}（${n++}）`, text: buf.trim() }); buf = '' }
      buf += para + '\n\n'
    }
    if (buf.trim()) out.push({ title: n > 1 ? `${p.title}（${n}）` : p.title, text: buf.trim() })
  }
  return out
}

// 片段卡片（阶段 5a）：选中的文字排进一张卡片，跟着当前主题的颜色；字多卡片就变长（长图），不缩字号。
// 卡片里只有字，没有图，所以现在就能做（带图的整篇长图等 5b 图片中转）。
import { BIRDS } from '../components/Bird'
import type { Doc } from './exporter'

export const CARD_MAX = 1200   // 再长就提示改用复制：卡片适合金句，太长的一张图读起来也累

export async function renderCard(text: string, d: Doc): Promise<Blob> {
  const css = getComputedStyle(document.documentElement)
  const v = (k: string, f: string) => css.getPropertyValue(k).trim() || f
  const bg = v('--surface', '#fcfaf6'), ink = v('--ink-body', '#2b2b29'), mid = v('--ink-mid', '#6b6960'), accent = v('--accent', '#6b5b53'), rule = v('--ink-ghost', '#dedad4')
  const fBody = v('--font-body', 'serif'), fMono = v('--font-mono', 'monospace'), fTitle = v('--font-title', 'serif')
  const W = 1080, M = 96, size = 40, lh = Math.round(size * 1.85)
  const meas = document.createElement('canvas').getContext('2d')!
  const lines = layout(meas, text, `${size}px ${fBody}`, size, W - 2 * M)
  const src = layout(meas, `《${d.title}》`, `30px ${fTitle}`, 30, W - 2 * M)
  const from = layout(meas, d.source, `26px ${fBody}`, 26, W - 2 * M)
  const top = 150, textH = lines.length * lh, H = top + textH + 80 + src.length * 46 + (from.length - 1) * 38 + 40 + 220
  const cv = document.createElement('canvas')
  cv.width = W; cv.height = H
  const g = cv.getContext('2d')!
  g.fillStyle = bg; g.fillRect(0, 0, W, H)
  g.textBaseline = 'alphabetic'
  // 顶上：一枚强调色小方块（灵媒的版块记号）+ MEDIARIUM
  g.fillStyle = accent; g.fillRect(M, 88, 10, 10)
  g.fillStyle = mid; g.font = `24px ${fMono}`; g.fillText('MEDIARIUM', M + 28, 99)
  g.fillStyle = ink; g.font = `${size}px ${fBody}`
  lines.forEach((l, i) => draw(g, l, M, top + size + i * lh))
  let y = top + textH + 80
  g.fillStyle = rule; g.fillRect(M, y - 40, 120, 2)
  g.fillStyle = ink; g.font = `30px ${fTitle}`
  src.forEach((l, i) => draw(g, l, M, y + i * 46))
  y += src.length * 46 + 8
  g.fillStyle = mid; g.font = `26px ${fBody}`
  from.forEach((l, i) => draw(g, l, M, y + 30 + i * 38))
  // 右下：停着的鸟
  const svg = BIRDS.perched.replace(/currentColor/g, accent)
  const img = new Image()
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg)
  await img.decode().catch(() => {})
  if (img.naturalWidth) { const bh = 64, bw = bh * img.naturalWidth / img.naturalHeight; g.drawImage(img, W - M - bw, H - 80 - bh, bw, bh) }
  g.fillStyle = mid; g.font = `22px ${fMono}`; g.fillText('灵媒 · 一个人的书报亭', M, H - 88)
  return new Promise((r) => cv.toBlob((b) => r(b!), 'image/png'))
}

// ——— 卡片排版（2026-10-24 Hana：中英混排在卡片上排得糟）：尽量和文章页一个规矩 ———
//   · 英文按整个词折行（连着后面的标点），只有一个词长到一行放不下才拆开、加连字符
//   · 汉字和英文、数字之间留四分之一个字宽
//   · 避头尾：逗号句号这类不放行首，开引号开括号这类不放行尾
//   · 两端对齐（段落最后一行除外）；哪一行要拉开太多（每个空隙超过四分之一个字宽）就不拉，左对齐
type Tok = { t: string; w: number; latin: boolean; space: boolean }
type Line = { toks: { t: string; x: number }[] }
const NO_HEAD = /^[，。、；：？！）」』》〉”’,.;:?!)\]%…—]/
const NO_TAIL = /[（「『《〈“‘(\[]$/
const LATIN = /[A-Za-z0-9À-ɏ]/
const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff]/   // 只有汉字（和假名）与英文之间留空；箭头、符号两边不加
function tokens(meas: CanvasRenderingContext2D, para: string): Tok[] {
  const raw = para.match(/\s+|[A-Za-z0-9À-ɏ][A-Za-z0-9À-ɏ'’\-_./@#&+]*|./gu) ?? []
  const out: Tok[] = []
  for (const r of raw) {
    const space = /^\s+$/.test(r)
    const t = space ? ' ' : r
    const prev = out.at(-1)
    // 不放行首的标点粘在前一个上；前一个是不放行尾的开标点，就把自己粘上去
    if (prev && !space && !prev.space && (NO_HEAD.test(t) || NO_TAIL.test(prev.t))) { prev.t += t; prev.w = meas.measureText(prev.t).width; continue }
    out.push({ t, w: meas.measureText(t).width, latin: LATIN.test(t[0]), space })
  }
  return out
}
export function layout(meas: CanvasRenderingContext2D, text: string, font: string, size: number, maxW: number): Line[] {
  meas.font = font
  const gapHanLatin = size * 0.25, out: Line[] = []
  const paras = text.trim().split(/\n+/)
  paras.forEach((para, pi) => {
    const toks = tokens(meas, para)
    let cur: Tok[] = []
    const widthOf = (list: Tok[]) => list.reduce((a, t, i) => a + t.w + (i && joint(list[i - 1], t) ? gapHanLatin : 0), 0)
    const flush = (last: boolean) => {
      while (cur.length && cur.at(-1)!.space) cur.pop()
      if (cur.length) out.push(place(cur, last))
      cur = []
    }
    const place = (list: Tok[], last: boolean): Line => {
      const natural = widthOf(list), gaps = list.length - 1, extra = maxW - natural
      const spread = !last && gaps > 0 && extra / gaps <= size * 0.25 ? extra / gaps : 0
      let x = 0
      return { toks: list.map((t, i) => { if (i) x += (joint(list[i - 1], t) ? gapHanLatin : 0) + spread; const at = x; x += t.w; return { t: t.space ? '' : t.t, x: at } }) }
    }
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]
      if (!cur.length && t.space) continue
      if (widthOf([...cur, t]) <= maxW) { cur.push(t); continue }
      // 一个词长到一行都放不下：拆开，前半截加连字符
      if (t.latin && t.w > maxW * 0.6) {
        let head = ''
        for (const ch of t.t) { if (widthOf([...cur, { ...t, t: head + ch + '-', w: meas.measureText(head + ch + '-').width }]) > maxW) break; head += ch }
        if (head.length >= 2) {
          cur.push({ ...t, t: head + '-', w: meas.measureText(head + '-').width }); flush(false)
          const rest = t.t.slice(head.length)
          toks.splice(k + 1, 0, { ...t, t: rest, w: meas.measureText(rest).width }); continue
        }
      }
      flush(false)
      if (!t.space) cur.push(t)
    }
    flush(true)
    if (pi < paras.length - 1) out.push({ toks: [] })   // 段与段之间空一行
  })
  return out
}
const joint = (a: Tok, b: Tok) => !a.space && !b.space && ((a.latin && CJK.test(b.t[0])) || (b.latin && CJK.test(a.t.at(-1)!))) && !NO_HEAD.test(b.t) && !/[，。、；：？！）」』》“”‘’「」（]$/.test(a.t) && !/^[（「『《“‘]/.test(b.t)
function draw(g: CanvasRenderingContext2D, l: Line, x0: number, y: number) { for (const t of l.toks) if (t.t) g.fillText(t.t, x0 + t.x, y) }

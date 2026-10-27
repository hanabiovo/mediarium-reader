// 寒鸦衔色（随机配色，2026-10-24 Hana 定；草图：草图/随机配色 草图 v1.html）
// 一个色调 H 定一组：一明一暗两套，同一色调——纸色色相 = H，墨色 H ± 15°，强调色 H ± 40° 以内。
// 范围取自现在的四套预设（OKLCH 记）；其余颜色照 3e 的配色规范推导；正文 ≥ 7:1、中灰 / 链接 / 危险红 ≥ 4.5:1，
// 明暗两套都过校验才算数，不过就重 roll（用户看不到失败的）。高对比主题不参与
import type { Palette } from './themes'

const s2l = (c: number) => ((c /= 255) <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
const l2s = (c: number) => { c = Math.max(0, Math.min(1, c)); const v = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055; return Math.round(Math.max(0, Math.min(1, v)) * 255) }
export function ok2hex(L: number, C: number, H: number): string {
  const a = C * Math.cos((H * Math.PI) / 180), b = C * Math.sin((H * Math.PI) / 180)
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s
  return '#' + [r, g, bl].map((x) => l2s(x).toString(16).padStart(2, '0')).join('')
}
const lum = (h: string) => { const [r, g, b] = [1, 3, 5].map((i) => s2l(parseInt(h.slice(i, i + 2), 16))); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
export const contrast = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => p - q); return (y + 0.05) / (x + 0.05) }
const rand = (a: number, b: number) => a + Math.random() * (b - a)
const wrap = (h: number) => ((h % 360) + 360) % 360

export type Pair = { light: Palette; dark: Palette }
export type Rolled = Pair & { name: string }

function once(): (Pair & { H: number; bgC: number; bgL: number }) | null {
  const H = rand(0, 360)
  const bgL = rand(0.86, 0.97), bgC = 0.004 + 0.016 * Math.random() ** 1.6
  const inkH = wrap(H + rand(-15, 15)), inkL = rand(0.21, 0.29), inkC = rand(0.004, 0.03)
  const accH = wrap(H + rand(-40, 40)), accC = rand(0.05, 0.1)
  const bg = ok2hex(bgL, bgC, H)
  let accL = 0.5, accent = ok2hex(accL, accC, accH)
  while (contrast(accent, bg) < 4.5 && accL > 0.3) accent = ok2hex((accL -= 0.01), accC, accH)
  let bodyL = inkL + 0.07, body = ok2hex(bodyL, inkC, inkH)
  while (contrast(body, bg) < 7 && bodyL > 0.15) body = ok2hex((bodyL -= 0.01), inkC, inkH)
  const midC = Math.min(0.03, bgC + 0.008)
  let midL = bgL - 0.44, mid = ok2hex(midL, midC, H)
  while (contrast(mid, bg) < 4.5 && midL > 0.3) mid = ok2hex((midL -= 0.01), midC, H)
  const light: Palette = {
    bg, ink: ok2hex(inkL, inkC, inkH), body, mid, faint: ok2hex(bgL - 0.2, bgC + 0.003, H),
    ghost: ok2hex(bgL - 0.075, bgC + 0.002, H), rule: ok2hex(bgL - 0.048, bgC + 0.002, H), accent,
    muted: ok2hex((midL + bgL - 0.2) / 2, bgC + 0.005, H), surface: ok2hex(Math.min(0.995, bgL + 0.016), bgC, H), danger: '#b5432c',
  }
  // 深色版：照预设的换算——色相不变、明度反向映射、不出纯黑纯白、强调色提亮
  const c = Math.min
  const dark: Palette = {
    bg: ok2hex(0.2, c(bgC, 0.012) * 0.8, H), ink: ok2hex(0.91, c(inkC, 0.012) + 0.006, H), body: ok2hex(0.84, c(inkC, 0.012) + 0.006, H),
    mid: ok2hex(0.7, c(bgC + 0.008, 0.02), H), faint: ok2hex(0.5, c(bgC + 0.006, 0.018), H), ghost: ok2hex(0.31, c(bgC, 0.012), H),
    rule: ok2hex(0.27, c(bgC, 0.012), H), accent: ok2hex(0.74, c(accC, 0.09), accH), muted: ok2hex(0.6, c(bgC + 0.006, 0.018), H),
    surface: ok2hex(0.225, c(bgC, 0.012) * 0.8, H), danger: ok2hex(0.68, 0.14, 32),
  }
  const ok = (p: Palette) => contrast(p.body, p.bg) >= 7 && contrast(p.ink, p.bg) >= 7 && contrast(p.mid, p.bg) >= 4.5 && contrast(p.accent, p.bg) >= 4.5 && contrast(p.danger, p.bg) >= 4.5
  return ok(light) && ok(dark) ? { light, dark, H, bgC, bgL } : null
}

// ——— 起名：一个词，2–5 个字，按色调挑；不和存下的、最近 roll 过的重名（Hana：抽象一点也行，别老重复） ———
const WORDS: [number, string[]][] = [
  // 色调上限（度）→ 词
  [40, ['晚照', '旧信', '窑变', '柿子', '炉边', '胭脂', '朱砂旧', '落日', '红豆', '海棠']],
  [75, ['茶烟', '秋分', '杏雨', '琥珀', '麦芒', '旧藤椅', '桂子', '晒书', '蜜蜡', '暖灯下']],
  [110, ['陈皮', '芦花', '稻香', '黄昏前', '故纸', '砚边', '小满', '槐序', '午后', '糙米']],
  [165, ['竹影', '苔痕', '新茶', '林间', '青梅', '惊蛰', '雨后', '蕨叶', '谷雨', '松风']],
  [215, ['寒潭', '雨前', '远山', '晨雾', '青瓷', '霜降', '湖心', '薄荷', '清明', '浅滩']],
  [265, ['夜航', '蓝调', '海盐', '靛青', '冬至', '深巷', '潮声', '星槎', '月下', '冷泉']],
  [320, ['紫藤', '暮色', '梦回', '丁香', '鸢尾', '霁色', '余音', '夜来', '烟雨', '葡萄']],
  [361, ['樱前', '藕荷', '桃夭', '晚霞', '绯色', '花信', '春寒', '蔷薇', '流萤', '醉颜']],
]
const PALE = ['素笺', '留白', '白露', '旧纸', '初雪', '宣纸', '无题', '空山', '月白', '清白']
let recent: string[] = []
export function nameFor(H: number, bgC: number, taken: string[]): string {
  const pool = bgC < 0.007 ? PALE : WORDS.find(([max]) => H < max)![1]
  const avoid = new Set([...taken, ...recent])
  const fresh = pool.filter((w) => !avoid.has(w))
  const pick = (fresh.length ? fresh : pool.filter((w) => !taken.includes(w)))
  const w = pick.length ? pick[Math.floor(Math.random() * pick.length)] : pool[Math.floor(Math.random() * pool.length)]
  recent = [w, ...recent].slice(0, 20)
  return w
}

// roll 一组（一明一暗），名字避开 taken（已存下的名字）
export function rollTheme(taken: string[] = []): Rolled {
  for (let i = 0; i < 400; i++) { const r = once(); if (r) return { light: r.light, dark: r.dark, name: nameFor(r.H, r.bgC, taken) } }
  throw new Error('roll 不出来')   // 实际不会到这里：约三分之一的组能过校验
}

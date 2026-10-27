// 字体系统（3d；2026-10-21 Hana 重新梳理）。分两组，各管各的地盘：
//   界面组 —— 页名、类别名、按钮、面板、提示、表单，以及列表里出现的刊名和文章标题。
//            只给灵媒自己设计的几套预设，整套切换，不单独设西文，本机字体不进界面（「界面是产品的」）。
//   文章组 —— 点进文章之后的一切：大标题、正文、小标题、引用、图注。正文、标题、西文各自可换（「文章是读者的」）。
// 固定不给换：等宽小标签（IBM Plex Mono，里面的汉字用思源黑体 350）、刊头大日期（EB Garamond）。
// 中文字体从 zeoseven 按字分片加载（页面用到哪些字才下哪些块）；西文字体小，跟灵媒一起打包。
// 字体库 = 预设 + 外链（贴一个字体样式表地址）+ 本机（导入文件，只存在这台设备上，见 localFonts.ts）。

export type CjkFont = {
  id: string; label: string
  family: string            // CSS 里的字体名
  css?: string              // 字体样式表（zeoseven 或外链）；本机字体没有
  multiWeight: boolean      // 有没有真粗体。没有时：正文里的加粗由浏览器描粗（Hana 接受）；大字不描粗，只靠字号
  source?: 'preset' | 'link' | 'local'
}
export type LatinFont = { id: string; label: string; family: string | null }

const zs = (n: number) => `https://fontsapi.zeoseven.com/${n}/main/result.css`
const p = (id: string, label: string, family: string, n: number, multiWeight = false): CjkFont =>
  ({ id, label, family, css: zs(n), multiWeight, source: 'preset' })

// 字体库里的预设，顺序照 Hana 定的（2026-10-20 / 21）：她的九款在前，汇文明朝排在京华老宋前面，后补的寒蝉一族在后
export const CJK_FONTS: CjkFont[] = [
  p('siyuan-song', '思源宋体', 'Noto Serif CJK', 285, true),
  p('siyuan-hei', '思源黑体', 'Noto Sans CJK', 69, true),
  p('neo-zhisong', '霞鹜新致宋', 'LXGW Neo ZhiSong', 22),
  p('clear-han', '屏显臻宋', 'Clear Han Serif', 79),
  p('mizuki-gothic', '水木黑体', 'Mizuki-Gothic', 224),
  p('wenkai', '霞鹜文楷', 'LXGW WenKai', 292),
  p('huiwen-fangsong', '汇文仿宋', 'Huiwen-Fangsong', 440),
  p('huiwen-mincho', '汇文明朝', 'Huiwen-mincho', 256),
  p('jinghua', '京华老宋', 'KingHwaOldSong', 309),
  p('hanchan', '寒蝉点阵', '寒蝉点阵体 16px', 359),
  p('zhuque', '朱雀仿宋', 'Zhuque Fangsong (technical preview)', 7),
  p('chill-huosong', '寒蝉活宋', 'ChillHuoSong_F', 875),
  p('chill-huofangkai', '寒蝉活仿楷', 'ChillHuoFangKai_F', 872),
  p('chill-huohei', '寒蝉活黑', '寒蝉活黑体_復 Bold', 873),
  p('chill-gsans', '寒蝉高黑', 'Chill G Sans Medium', 300),
  p('chill-duanheisong', '寒蝉端黑宋', '寒蝉端黑宋Pro', 366),
]

// 文章组的西文；「跟随中文字体」= 正文里的英文用正文字体自带的，标题里的用标题字体自带的
export const LATIN_FONTS: LatinFont[] = [
  { id: 'builtin', label: '跟随中文字体', family: null },
  { id: 'source-serif', label: 'Source Serif 4', family: 'Source Serif 4' },
  { id: 'eb-garamond', label: 'EB Garamond', family: 'EB Garamond' },
  { id: 'newsreader', label: 'Newsreader', family: 'Newsreader' },
  { id: 'literata', label: 'Literata', family: 'Literata' },
  { id: 'source-sans', label: 'Source Sans 3', family: 'Source Sans 3' },
  { id: 'jost', label: 'Jost', family: 'Jost' },
  { id: 'atkinson', label: 'Atkinson Hyperlegible Next', family: 'Atkinson Hyperlegible Next' },
]

// 界面预设（2026-10-21 Hana 认可）：每套里页名用的大字和按钮、列表用的小字可以是两款字
// vertical：封面竖排刊名单独用的字（不写就跟 small）。书宋方案的霞鹜新致宋，字体文件里竖排度量写错了
// （vhea 左右 2.4 / 1.2 个字宽，不对称），iPhone 的 Safari 照着排，字往右偏、被裁掉一截；Chrome 自己居中所以看不出来。
// 换成长相相近、竖排度量正常的屏显臻宋（2026-10-23 Hana 定）
export type UiPreset = { id: string; label: string; note: string; display: string; small: string; latin: string; vertical?: string }
export const UI_PRESETS: UiPreset[] = [
  { id: 'shusong', label: '书宋', note: '老派书刊，有铅字感', display: 'huiwen-mincho', small: 'neo-zhisong', latin: 'eb-garamond', vertical: 'clear-han' },
  { id: 'hei', label: '黑', note: '现代杂志', display: 'chill-gsans', small: 'mizuki-gothic', latin: 'jost' },
  { id: 'wenkai', label: '文楷', note: '温和，有手写气', display: 'wenkai', small: 'wenkai', latin: 'builtin' },
  { id: 'fangsong', label: '仿宋', note: '古籍、公文那一路', display: 'chill-huosong', small: 'zhuque', latin: 'eb-garamond' },
  { id: 'pixel', label: '点阵', note: '复古屏幕，字号对齐 16px 网格', display: 'hanchan', small: 'hanchan', latin: 'builtin' },
]
export const DEFAULT_UI = 'shusong'

export type ArticleFonts = { body: string; title: string; latin: string }
// 默认（2026-10-20 Hana 定）：正文新致宋 + 跟随中文字体；文章大标题思源宋 700
export const DEFAULT_ARTICLE: ArticleFonts = { body: 'neo-zhisong', title: 'siyuan-song', latin: 'builtin' }

// 等宽小标签里的汉字固定用思源黑体（字重 350 在 CSS 里给）
const MONO_HAN = CJK_FONTS[1]

const q = (f: string) => `'${f.replace(/'/g, "\\'")}'`

// 只插一次样式表；中文字体的块是按页面上出现的字才下载的
const loaded = new Set<string>()
export function ensureCss(url?: string) {
  if (!url || loaded.has(url) || typeof document === 'undefined') return
  loaded.add(url)
  const link = document.createElement('link')
  link.rel = 'stylesheet'; link.href = url
  document.head.appendChild(link)
}

const latinOf = (id: string) => LATIN_FONTS.find((f) => f.id === id) ?? LATIN_FONTS[0]

export function stackFor(cjk: CjkFont, latin: LatinFont) {
  const parts: string[] = []
  if (latin.family) parts.push(q(latin.family))
  parts.push(q(cjk.family))
  // 兜底：字体还没到时先用系统字体顶一下
  parts.push("'Noto Serif CJK'", "'Songti SC'", "'SimSun'", /hei|gothic|gsans/.test(cjk.id) ? 'sans-serif' : 'serif')
  return [...new Set(parts)].join(', ')
}

export function applyFonts(uiId: string, article: ArticleFonts, all: CjkFont[]) {
  const find = (id: string, fallback: string) => all.find((f) => f.id === id) ?? all.find((f) => f.id === fallback)!
  const ui = UI_PRESETS.find((x) => x.id === uiId) ?? UI_PRESETS[0]
  const uiDisplay = find(ui.display, 'siyuan-song'), uiSmall = find(ui.small, 'siyuan-song'), uiLatin = latinOf(ui.latin)
  const uiVertical = ui.vertical ? find(ui.vertical, ui.small) : uiSmall
  const body = find(article.body, DEFAULT_ARTICLE.body), title = find(article.title, DEFAULT_ARTICLE.title)
  const latin = latinOf(article.latin)
  for (const f of [uiDisplay, uiSmall, uiVertical, body, title, MONO_HAN]) ensureCss(f.css)
  const root = document.documentElement
  root.style.setProperty('--font-ui-display', stackFor(uiDisplay, uiLatin))
  root.style.setProperty('--font-ui', stackFor(uiSmall, uiLatin))
  root.style.setProperty('--font-ui-vertical', stackFor(uiVertical, uiLatin))
  root.style.setProperty('--font-body', stackFor(body, latin))
  root.style.setProperty('--font-title', stackFor(title, latin))
  root.style.setProperty('--font-mono', `'Mediarium Mono', ${q(MONO_HAN.family)}, ui-monospace, monospace`)
  root.dataset.ui = ui.id
}

// 刊名按文字种类拆段（视觉规则 1）：封面竖排时，每段单独占一列。
// 中文正排、字号 16；西文一段整体侧转、字号 14。数字和英文算一段。
export type TitlePart = { text: string; latin: boolean }

export function splitTitle(title: string): TitlePart[] {
  return (title.match(/[A-Za-z0-9][A-Za-z0-9 .'&-]*|[^A-Za-z0-9 ]+/g) || [])
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => ({ text: t, latin: /^[A-Za-z0-9]/.test(t) }))
}

// 别名按文字排、不按栏位排（3d，2026-10-20）：含汉字的别名不用等宽大写、不用斜体，换正文字体
const HAN = /[\u3400-\u9fff\uf900-\ufaff]/
export const hasHan = (s: string) => HAN.test(s)
export const aliasClass = (base: string, s: string) => (hasHan(s) ? `${base} han` : base)

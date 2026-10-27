// 配色（3e，2026-10-21 Hana 定）。五套主题，每套一明一暗。浅色照 3b 视觉稿「预设配色」画板；
// 深色按配色规范换算（色相不变、明度反向映射、不出纯黑纯白、强调色提亮），夜墨改作纸本的深色版，珊瑚换成冷调灰。
// 数值由一次性脚本按规范算出并核过对比度：正文对底 ≥ 7:1，中灰、强调（链接）、危险红 ≥ 4.5:1。高对比不走公式。
// 以后的随机配色走同一套规范：三个种子 → 推导 → 校验（见「阶段3 阅读器骨架.md」3e 讨论记录）。
export type Palette = Record<'bg' | 'ink' | 'body' | 'mid' | 'faint' | 'ghost' | 'rule' | 'accent' | 'muted' | 'surface' | 'danger', string>
export type Theme = { id: string; label: string; note: string; light: Palette; dark: Palette }
export const THEMES: Theme[] = [
  { id: 'paper', label: '纸本', note: '默认 · 冷棕',
    light: { bg: '#f7f5f0', ink: '#1a1a18', body: '#2b2b29', mid: '#6b6960', faint: '#b8b5ae', ghost: '#dedad4', rule: '#e8e5de', accent: '#6b5b53', muted: '#908e85', surface: '#fcfaf5', danger: '#b5432c' },
    dark: { bg: '#161615', ink: '#dbdbd5', body: '#bebeb8', mid: '#a19f95', faint: '#65635a', ghost: '#32302c', rule: '#282623', accent: '#b9a79e', muted: '#828077', surface: '#1f1e1c', danger: '#e17460' } },
  { id: 'newsprint', label: '新闻纸', note: '冷灰 · 靛',
    light: { bg: '#ecede9', ink: '#1d2328', body: '#2e343a', mid: '#5d6670', faint: '#a9b0b6', ghost: '#d5d9db', rule: '#dde0e0', accent: '#2f4a6b', muted: '#818a95', surface: '#f1f2ee', danger: '#b5432c' },
    dark: { bg: '#161614', ink: '#d2dce5', body: '#b5bfc7', mid: '#96a0aa', faint: '#5c646d', ghost: '#30312e', rule: '#262724', accent: '#8faed4', muted: '#79818b', surface: '#1b1c1a', danger: '#e17460' } },
  { id: 'kraft', label: '牛皮', note: '暖褐 · 赭',
    light: { bg: '#d8cfbf', ink: '#2a241c', body: '#3c352d', mid: '#5e5446', faint: '#9a8e7c', ghost: '#c6bba8', rule: '#cbc1ae', accent: '#8a3b1e', muted: '#7b7062', surface: '#ddd4c4', danger: '#a13019' },
    dark: { bg: '#181611', ink: '#e1d9cf', body: '#c4bcb3', mid: '#a69d91', faint: '#696258', ghost: '#33302a', rule: '#292620', accent: '#d29c8a', muted: '#877f75', surface: '#1e1b17', danger: '#e17460' } },
  { id: 'moss', label: '苔', note: '低饱和绿 · 橄榄',
    light: { bg: '#e4e8dc', ink: '#26301f', body: '#384230', mid: '#5b6650', faint: '#9ea791', ghost: '#cdd3c3', rule: '#d3d9c9', accent: '#4f6b2a', muted: '#7b866f', surface: '#e9ede1', danger: '#b24029' },
    dark: { bg: '#151712', ink: '#d7ddd2', body: '#bac0b6', mid: '#9aa194', faint: '#60655b', ghost: '#2f312b', rule: '#252721', accent: '#9db485', muted: '#7d8277', surface: '#1b1c18', danger: '#e17460' } },
  { id: 'contrast', label: '高对比', note: '黑白分明 · 墨水屏',
    light: { bg: '#ffffff', ink: '#000000', body: '#000000', mid: '#333333', faint: '#5c5c5c', ghost: '#000000', rule: '#000000', accent: '#000000', muted: '#333333', surface: '#ffffff', danger: '#a3000b' },
    dark: { bg: '#000000', ink: '#ffffff', body: '#ffffff', mid: '#cccccc', faint: '#a3a3a3', ghost: '#ffffff', rule: '#ffffff', accent: '#ffffff', muted: '#cccccc', surface: '#000000', danger: '#ff6b6b' } },
]

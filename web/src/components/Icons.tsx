// 线性图标，统一 1.3 描边，颜色跟随文字色。装饰性图标一律 aria-hidden。
type P = { size?: number }
const base = (size: number) => ({
  width: size, height: size, viewBox: '0 0 24 24', fill: 'none',
  stroke: 'currentColor', strokeWidth: 1.3, 'aria-hidden': true as const,
})

export const IconShelf = ({ size = 20 }: P) => (
  <svg {...base(size)}><rect x="4" y="4" width="4" height="16" /><rect x="10" y="4" width="4" height="16" /><path d="M16.5 5.2l3.4-.9 3.1 15.2-3.4.9z" /></svg>
)
export const IconStream = ({ size = 20 }: P) => (
  <svg {...base(size)}><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="11" x2="16" y2="11" /><line x1="4" y1="16" x2="20" y2="16" /><line x1="4" y1="21" x2="12" y2="21" /></svg>
)
export const IconSettings = ({ size = 20 }: P) => (
  <svg {...base(size)}><line x1="4" y1="7" x2="20" y2="7" /><line x1="4" y1="17" x2="20" y2="17" /><circle cx="9" cy="7" r="2.2" fill="var(--bg)" /><circle cx="15" cy="17" r="2.2" fill="var(--bg)" /></svg>
)
export const IconList = ({ size = 18 }: P) => (
  <svg {...base(size)}><line x1="5" y1="7" x2="19" y2="7" /><line x1="5" y1="12" x2="19" y2="12" /><line x1="5" y1="17" x2="19" y2="17" /></svg>
)
export const IconCovers = ({ size = 18 }: P) => (
  <svg {...base(size)}><rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" /></svg>
)
export const IconMore = ({ size = 18 }: P) => (
  <svg {...base(size)}><circle cx="6" cy="12" r="0.9" /><circle cx="12" cy="12" r="0.9" /><circle cx="18" cy="12" r="0.9" /></svg>
)
export const IconBack = ({ size = 18 }: P) => (
  <svg {...base(size)}><polyline points="15 5 8 12 15 19" /></svg>
)
export const IconBookmark = ({ size = 18, filled = false }: P & { filled?: boolean }) => (
  <svg {...base(size)}><path d="M6 4h12v16l-6-4-6 4z" fill={filled ? 'currentColor' : 'none'} /></svg>
)
export const IconPlay = ({ size = 12 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
)
export const IconPause = ({ size = 12 }: P) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6.5" y="5" width="3.6" height="14" /><rect x="13.9" y="5" width="3.6" height="14" /></svg>
)
export const IconClose = ({ size = 16 }: P) => (
  <svg {...base(size)}><line x1="6" y1="6" x2="18" y2="18" /><line x1="18" y1="6" x2="6" y2="18" /></svg>
)
export const IconChevronDown = ({ size = 16 }: P) => (
  <svg {...base(size)}><polyline points="6 9 12 15 18 9" /></svg>
)
// 眼睛（0.28）：睁着 = 在看；闭着 = 不爱看
export const IconEye = ({ size = 18, closed = false }: P & { closed?: boolean }) => (
  closed
    ? <svg {...base(size)}><path d="M2.5 10c2.6 3.4 5.8 5.1 9.5 5.1s6.9-1.7 9.5-5.1" /><path d="M5.6 13.4 4 15.6" /><path d="M9.6 15 9 17.6" /><path d="M14.4 15l.6 2.6" /><path d="M18.4 13.4l1.6 2.2" /></svg>
    : <svg {...base(size)}><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" /><circle cx="12" cy="12" r="2.8" /></svg>
)
export const IconNews = ({ size = 15 }: P) => (
  <svg {...base(size)}><path d="M4 5h13v14H6a2 2 0 0 1-2-2z" /><path d="M17 9h3v8a2 2 0 0 1-2 2" /><line x1="7" y1="9" x2="14" y2="9" /><line x1="7" y1="12.5" x2="14" y2="12.5" /></svg>
)
export const IconBook = ({ size = 15 }: P) => (
  <svg {...base(size)}><path d="M3 5.5c3-1.5 6-1.5 9 0v14c-3-1.5-6-1.5-9 0z" /><path d="M21 5.5c-3-1.5-6-1.5-9 0v14c3-1.5 6-1.5 9 0z" /></svg>
)
export const IconRefresh = ({ size = 16 }: P) => (
  <svg {...base(size)}><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" /><polyline points="19.8 4.2 19.8 7.6 16.4 7.6" /></svg>
)
export const IconShare = ({ size = 18 }: P) => (
  <svg {...base(size)}><path d="M12 15V4" /><polyline points="8 8 12 4 16 8" /><path d="M6 12v8h12v-8" /></svg>
)
// 添加信源（报刊架顶栏，0.23）
export const IconPlus = ({ size = 18 }: P) => (
  <svg {...base(size)}><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
)
// 报刊管理：分类 → 报刊 → 栏目，三层缩进
export const IconTree = ({ size = 18 }: P) => (
  <svg {...base(size)}><line x1="4" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="12" y1="18" x2="20" y2="18" /></svg>
)
// 信息流卡片视图
export const IconCards = ({ size = 18 }: P) => (
  <svg {...base(size)}><rect x="5" y="4.5" width="14" height="6.5" /><rect x="5" y="13" width="14" height="6.5" /></svg>
)

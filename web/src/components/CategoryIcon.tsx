// 分类图标：灵媒自己的两枚（报纸、书）+ Lucide 挑出的一小套。颜色跟随文字色。
import { IconBook, IconNews } from './Icons'
import { LIB_ICONS } from './iconLibrary'

export const OWN_ICONS = [{ key: 'news', label: '新闻' }, { key: 'book', label: '阅读' }]
export const DEFAULT_ICON = 'news'

export function CategoryIcon({ name, size = 15 }: { name?: string; size?: number }) {
  const key = name || DEFAULT_ICON
  if (key === 'news') return <IconNews size={size} />
  if (key === 'book') return <IconBook size={size} />
  const icon = LIB_ICONS.find((i) => i.key === key)
  if (!icon) return <IconNews size={size} />
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" dangerouslySetInnerHTML={{ __html: icon.svg }} />
  )
}

export const ALL_ICONS = [...OWN_ICONS, ...LIB_ICONS.map(({ key, label }) => ({ key, label }))]

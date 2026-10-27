import { useEffect, useRef } from 'react'
// 主导航：手机是底部三图标（上沿一条线）；720px 以上变成左侧竖栏，顶端放 logo。
// 返回手势的约定（照手机 app 的习惯）：
// 从报刊架去别的标签 → 记一步历史，返回会回到报刊架；
// 在信息流和设置之间切换 → 替换当前这一步，不堆历史；
// 在报刊架首页再返回 → 离开灵媒。
// 在二级页面（杂志目录、文章）点所在标签 → 回到这个标签的首页；已经在信息流首页 → 回顶。
import { useLocation, useNavigate } from 'react-router-dom'
import { IconSettings, IconShelf, IconStream } from './Icons'
import { EggLogo } from './EggLogo'
import { depthOf } from '../hooks/useDeepNav'
import { ink } from '../lib/native'

const TABS = [
  { path: '/shelf', label: '报刊架', Icon: IconShelf },
  { path: '/stream', label: '信息流', Icon: IconStream },
  { path: '/settings', label: '设置', Icon: IconSettings },
]

// root：这一串二级页是从哪个标签点进来的（设置页的「信源」会跳进 /shelf/manage，它属于设置这一串）
type TabState = { fromShelf?: boolean; root?: string } | null

export function TabBar() {
  const location = useLocation()
  const navigate = useNavigate()
  const current = TABS.find((t) => location.pathname.startsWith(t.path))?.path ?? '/shelf'
  const fromShelf = (location.state as TabState)?.fromShelf === true

  // 一次跳转还没落地时，后面的点击一律不算（2026-10-21 查出：快点两下时第二下还拿着旧的历史深度再退一遍，
  // 退过了头，落到更早的设置页、甚至退出 app）
  const busy = useRef(false)
  // 点了报刊架就一定落在报刊架（2026-10-22 Hana：「不是无条件切到报刊架」）：
  // 按历史深度往回退可能退错地方（深度记录不准、中途换过标签），退完一看不在 /shelf，就直接换成 /shelf
  const wantShelf = useRef(false)
  useEffect(() => {
    busy.current = false
    if (wantShelf.current) { wantShelf.current = false; if (location.pathname !== '/shelf') navigate('/shelf', { replace: true }) }
  }, [location.key]) // eslint-disable-line react-hooks/exhaustive-deps
  const go = (path: string) => {
    if (busy.current) return
    busy.current = true
    window.setTimeout(() => { busy.current = false }, 600)   // 万一这一下没跳成，也别把按钮锁死
    const root = (location.state as TabState)?.root
    // 从别的标签点进来的页面（设置 → 信源管理）：点所在的标签不是「回到首页」，而是真去那个标签
    if (path === current && root && root !== path) { navigate(path, { replace: true }); return }
    if (path === current) {
      // 已经在信息流的列表上：点一下回到顶上（照手机 SNS 的习惯；刷新靠下拉，0.29.3）
      if (location.pathname === path) { busy.current = false; if (path === '/stream') window.scrollTo({ top: 0, behavior: ink ? 'instant' as ScrollBehavior : 'smooth' }); return }
      const depth = depthOf(location.state)
      if (depth > 0) { if (path === '/shelf') wantShelf.current = true; navigate(-depth) }
      else navigate(path, { replace: true })
      return
    }
    if (path === '/shelf') {
      // 从报刊架切过来的，又往里点了几层：一次退到报刊架（2026-10-21 修：原来只退一步，停在设置首页）
      if (fromShelf) { wantShelf.current = true; navigate(-(depthOf(location.state) + 1)) }
      else navigate('/shelf', { replace: true })
      return
    }
    if (current === '/shelf') navigate(path, { state: { fromShelf: true } })
    else navigate(path, { replace: true, state: { fromShelf } })
  }

  return (
    <nav className="mainnav" aria-label="主导航">
      <span className="mainnav-logo"><EggLogo size={30} onTap={() => go('/shelf')} /></span>
      {TABS.map(({ path, label, Icon }) => (
        <button key={path} className={path === current ? 'tab active' : 'tab'}
          aria-label={label} aria-current={path === current ? 'page' : undefined} onClick={() => go(path)}>
          <Icon />
          <span className="tab-dot" aria-hidden="true" />
        </button>
      ))}
    </nav>
  )
}

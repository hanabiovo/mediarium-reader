import { useEffect, useState } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { getToken } from './api/miniflux'
import { TabBar } from './components/TabBar'
import { useEdgeSwipeBack } from './hooks/useEdgeSwipeBack'
import { Login } from './pages/Login'
import { Join } from './pages/Join'
import { Shelf } from './pages/Shelf'
import { Settings } from './pages/Settings'
import { StreamLayout } from './pages/Stream'
import { FeedLayout } from './pages/FeedLayout'
import { Article } from './pages/Article'
import { Manage } from './pages/Manage'
import { ToastHost } from './components/Toast'
import { Welcome } from './components/Welcome'
import { RollGuard } from './components/ThemeRoll'
import { FloatPlayer } from './components/Player'
import { SaveLog } from './components/SaveLog'
import { inkFlash } from './lib/native'

export default function App() {
  const [authed, setAuthed] = useState(() => !!getToken())
  useEffect(() => {
    // 换账号时内存里还留着上一位的报刊架、文章：整页重载最干净
    const out = () => { setAuthed(false); window.location.replace('/') }
    window.addEventListener('mediarium:signed-out', out)
    return () => window.removeEventListener('mediarium:signed-out', out)
  }, [])
  const { pathname } = useLocation()
  // 二级页面（杂志目录、文章）：手机上隐藏底栏，允许边缘右滑返回
  const deep = pathname.startsWith('/shelf/') || pathname.startsWith('/stream/') || pathname.startsWith('/settings/')
  useEdgeSwipeBack(authed && deep)
  // 墨水屏 APK：换页面时闪一下黑，整屏刷新清残影（lib/native.ts；第一次打开不闪）
  const [firstPath] = useState(pathname)
  useEffect(() => { if (pathname !== firstPath) inkFlash() }, [pathname]) // eslint-disable-line react-hooks/exhaustive-deps

  // 受邀注册（5d）：没登录时打开 /join#邀请码
  if (!authed && pathname === '/join') return <><Welcome /><Join onDone={() => setAuthed(true)} /></>
  if (!authed) return <><Welcome /><Login onDone={() => setAuthed(true)} /></>

  return (
    <div className="shell">
      <Welcome />
      <ToastHost />
      <RollGuard />
      <SaveLog />
      <div className={deep ? 'pl-slot deep' : 'pl-slot'}><FloatPlayer /></div>
      <main className={deep ? 'content deep' : 'content'}>
        <Routes>
          <Route path="/" element={<Navigate to="/shelf" replace />} />
          <Route path="/shelf" element={<Shelf />} />
          <Route path="/shelf/manage" element={<Manage />} />
          <Route path="/shelf/feed/:fid" element={<FeedLayout />}>
            <Route index element={null} />
            <Route path=":eid" element={<Article />} />
          </Route>
          <Route path="/stream" element={<StreamLayout />}>
            <Route index element={null} />
            <Route path=":eid" element={<Article />} />
          </Route>
          <Route path="/settings/*" element={<Settings onLogout={() => setAuthed(false)} />} />
          <Route path="/share-target" element={<ShareTarget />} />
          <Route path="*" element={<Navigate to="/shelf" replace />} />
        </Routes>
      </main>
      <div className={deep ? 'nav-slot deep' : 'nav-slot'}><TabBar /></div>
    </div>
  )
}

// 系统分享进来（安卓，灵媒装到桌面后，浏览器里「分享」→ 灵媒）：取出网址，打开设置里的添加信源页
function ShareTarget() {
  const q = new URLSearchParams(useLocation().search)
  const raw = [q.get('url'), q.get('text'), q.get('title')].filter(Boolean).join(' ')
  const url = raw.match(/https?:\/\/[^\s"'<>，。]+/)?.[0] ?? raw
  return <Navigate to="/settings/sources/add" replace state={{ addUrl: url }} />
}

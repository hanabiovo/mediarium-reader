// 登录（5c，2026-10-22）：默认用户名 + 密码；底下一行小字「用密钥登录」，给懂行的人和排查时用。
// 用户名密码只用这一次：请 Miniflux 给这台设备开一把密钥，之后只用密钥（见 api/miniflux.ts loginWithPassword）。
import { useEffect, useState } from 'react'
import { api, setToken, AuthError, ApiError, loginWithPassword } from '../api/miniflux'
import { Logo } from '../components/Logo'
import { markReady } from '../components/Welcome'

export function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<'password' | 'key'>('password')
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { markReady(); document.title = '登录' }, [])

  const ready = mode === 'key' ? !!key.trim() : !!user.trim() && !!pass

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true); setError('')
    try {
      if (mode === 'key') { await api.me(key.trim()); setToken(key.trim()) }
      else await loginWithPassword(user.trim(), pass)
      onDone()
    } catch (err) {
      setError(err instanceof AuthError ? (mode === 'key' ? '密钥不对' : '用户名或密码不对')
        : err instanceof ApiError && err.status === 429 ? '试得太频繁了，过几分钟再来'
        : '连不上服务器，稍后再试')
    } finally { setBusy(false) }
  }

  const switchMode = () => { setMode((m) => (m === 'key' ? 'password' : 'key')); setError('') }

  return (
    <main className="login">
      <span className="login-mark"><Logo size={56} /></span>
      <h1 className="login-title">灵媒</h1>
      <span className="mono-label" style={{ marginTop: 10 }}>MEDIARIUM</span>
      <form onSubmit={submit} className="login-form">
        {mode === 'password' ? (
          <>
            <label htmlFor="user" className="mono-label">用户名</label>
            <input id="user" name="username" autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false}
              value={user} onChange={(e) => setUser(e.target.value)} />
            <label htmlFor="pass" className="mono-label">密码</label>
            <input id="pass" name="password" type="password" autoComplete="current-password"
              value={pass} onChange={(e) => setPass(e.target.value)} />
          </>
        ) : (
          <>
            <label htmlFor="key" className="mono-label">访问密钥</label>
            <input id="key" type="password" autoComplete="off" value={key}
              onChange={(e) => setKey(e.target.value)} placeholder="Miniflux 的 API 密钥" />
          </>
        )}
        {error && <p className="page-error">{error}</p>}
        <div className="login-actions">
          <button type="button" className="login-switch" onClick={switchMode}>{mode === 'key' ? '用密码登录' : '用密钥登录'}</button>
          <button type="submit" className="login-submit" disabled={busy || !ready}>{busy ? '验证中' : '进入'}</button>
        </div>
      </form>
    </main>
  )
}

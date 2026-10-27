// 受邀注册（5d，2026-10-22）：朋友打开 /join#邀请码，自己起用户名、设密码，注册完直接登录进来。
// 码在 # 后面（不发给服务器、不进日志），进来后马上从地址栏抹掉
import { useEffect, useState } from 'react'
import { ApiError, AuthError, loginWithPassword } from '../api/miniflux'
import { Logo } from '../components/Logo'
import { markReady } from '../components/Welcome'
import { acceptInvite, checkInvite } from '../lib/admin'

const grabCode = () => {
  const c = window.location.hash.slice(1)
  if (c) history.replaceState(null, '', '/join')
  return c
}

export function Join({ onDone }: { onDone: () => void }) {
  const [code] = useState(grabCode)
  const [valid, setValid] = useState<boolean | null>(null)
  const [user, setUser] = useState('')
  const [pass, setPass] = useState('')
  const [pass2, setPass2] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    markReady(); document.title = '加入灵媒'
    if (!code) { setValid(false); return }
    checkInvite(code).then(setValid).catch((e) => { setValid(true); setError((e as Error).message) })   // 查不了就先让填，提交时再判
  }, [code])

  const ready = !!user.trim() && pass.length >= 8 && pass === pass2
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setBusy(true); setError('')
    try {
      const r = await acceptInvite(code, user.trim(), pass)
      try { await loginWithPassword(r.username, pass) }
      catch (err) {
        // 账号已经建好了，只是这一下没登进去（比如限频）：去登录页
        setError(err instanceof AuthError || err instanceof ApiError ? '注册好了，去登录页用刚设的密码登录' : '注册好了，去登录页登录')
        setTimeout(() => window.location.replace('/'), 2500)
        return
      }
      window.location.replace('/'); onDone()
    } catch (err) {
      const s = (err as { status?: number }).status
      if (s === 410) setValid(false)
      setError((err as Error).message)
    } finally { setBusy(false) }
  }

  return (
    <main className="login">
      <span className="login-mark"><Logo size={56} /></span>
      <h1 className="login-title">灵媒</h1>
      <span className="mono-label" style={{ marginTop: 10 }}>MEDIARIUM</span>
      {valid === false ? (
        <p className="login-hint">邀请链接无效或已过期，找发给你的人要一条新的。</p>
      ) : valid === null ? null : (
        <form onSubmit={submit} className="login-form">
          <label htmlFor="user" className="mono-label">用户名</label>
          <input id="user" name="username" autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} maxLength={32}
            value={user} onChange={(e) => setUser(e.target.value)} />
          <label htmlFor="pass" className="mono-label">密码（至少 8 位）</label>
          <input id="pass" name="new-password" type="password" autoComplete="new-password" maxLength={128}
            value={pass} onChange={(e) => setPass(e.target.value)} />
          <label htmlFor="pass2" className="mono-label">再输一次</label>
          <input id="pass2" type="password" autoComplete="new-password" maxLength={128}
            value={pass2} onChange={(e) => setPass2(e.target.value)} />
          {pass2 && pass !== pass2 && <p className="page-error">两次密码不一样</p>}
          {error && <p className="page-error">{error}</p>}
          <div className="login-actions">
            <span />
            <button type="submit" className="login-submit" disabled={busy || !ready}>{busy ? '注册中' : '加入'}</button>
          </div>
        </form>
      )}
    </main>
  )
}

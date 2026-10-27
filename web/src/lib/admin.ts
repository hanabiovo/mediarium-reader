// 邀请注册（5d，2026-10-22）：管理员生成 / 作废邀请；朋友拿链接查码、自己注册。真正建号的是服务器上的誊写服务
import { getToken } from '../api/miniflux'

export type Invite = { id: string; note: string; created: number; expires: number; state: 'open' | 'used' | 'expired' | 'revoked'; used: { at: number; username: string } | null }

async function call<T>(path: string, init: RequestInit = {}, auth = true): Promise<T> {
  let r: Response
  try {
    r = await fetch('/scribe' + path, { ...init, headers: { 'Content-Type': 'application/json', ...(auth ? { 'X-Auth-Token': getToken() ?? '' } : {}) } })
  } catch { throw Object.assign(new Error('连不上服务器，稍后再试'), { status: 0 }) }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw Object.assign(new Error(typeof j.error === 'string' ? j.error : r.status === 429 ? '试得太频繁了，过一会儿再来' : '服务器出错了，稍后再试'), { status: r.status })
  return j as T
}

export const listInvites = () => call<{ on: boolean; invites: Invite[] }>('/admin/invites')
export const createInvite = (note: string) => call<{ invite: Invite & { code: string } }>('/admin/invites', { method: 'POST', body: JSON.stringify({ note }) }).then((r) => r.invite)
export const revokeInvite = (id: string) => call<{ invites: Invite[] }>(`/admin/invites?id=${encodeURIComponent(id)}`, { method: 'DELETE' }).then((r) => r.invites)

// 码放在网址的 # 后面：不会发给服务器，不进访问日志
export const inviteLink = (code: string) => `${window.location.origin}/join#${code}`
export const checkInvite = (code: string) => call<{ ok: boolean }>('/invite/check', { method: 'POST', body: JSON.stringify({ code }) }, false).then((r) => r.ok)
export const acceptInvite = (code: string, username: string, password: string) =>
  call<{ ok: true; username: string }>('/invite/accept', { method: 'POST', body: JSON.stringify({ code, username, password }) }, false)

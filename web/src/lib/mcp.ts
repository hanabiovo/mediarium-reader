// 接入 AI 助手（MCP，2026-10-27 Hana 定）：专属链接的生成、列出、作废；每日巡诊的提醒。真正干活的在誊写服务（server/scribe/src/mcp.js）
import { useEffect, useState } from 'react'
import { getToken } from '../api/miniflux'
import { load, save } from '../api/storage'

export type Scope = 'read' | 'manage'
export type McpLink = { id: string; scope: Scope; created: string; used: string | null }

async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try { r = await fetch('/scribe' + path, { ...init, headers: { 'Content-Type': 'application/json', 'X-Auth-Token': getToken() ?? '' } }) }
  catch { throw new Error('连不上服务器，稍后再试') }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(typeof j.error === 'string' ? j.error : r.status === 401 ? '登录过期了，重新登录再试' : '服务器出错了，稍后再试')
  return j as T
}

export const listLinks = () => call<{ on: boolean; links: McpLink[] }>('/mcp/links')
export const createLink = (scope: Scope) => call<McpLink & { secret: string }>('/mcp/links', { method: 'POST', body: JSON.stringify({ scope }) })
export const revokeLink = (id: string) => call<{ ok: boolean }>(`/mcp/links?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
export const linkUrl = (secret: string) => `${window.location.origin}/scribe/mcp/${secret}`
export const SCOPE_NAME: Record<Scope, string> = { read: '只读', manage: '可管理订阅' }

// ——— 每日巡诊的提醒：服务器上新冒出来的问题，比这台设备上次看源医生的时间晚，就在入口上点一个小点 ———
export type Alert = { feed: number; title: string; kind: string; text: string; since: string }
const SEEN = 'mediarium.alertsSeen'
let cache: { at: number; issues: Alert[] } | null = null
export function markAlertsSeen() { save(SEEN, new Date().toISOString()); listeners.forEach((f) => f(0)) }
const listeners = new Set<(n: number) => void>()
const fresh = (list: Alert[]) => { const seen = load(SEEN); return list.filter((i) => !seen || i.since > seen).length }
export function useNewAlerts(): number {
  const [n, setN] = useState(() => (cache ? fresh(cache.issues) : 0))
  useEffect(() => {
    listeners.add(setN)
    if (!cache || Date.now() - cache.at > 10 * 60e3) {
      call<{ issues: Alert[] }>('/doctor/alerts').then((r) => { cache = { at: Date.now(), issues: r.issues ?? [] }; const k = fresh(cache.issues); listeners.forEach((f) => f(k)) }).catch(() => {})
    }
    return () => { listeners.delete(setN) }
  }, [])
  return n
}

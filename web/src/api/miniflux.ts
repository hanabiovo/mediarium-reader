// Miniflux 数据接口。灵媒和 Miniflux 同域名，接口在 /miniflux/v1 下，没有跨域问题。
import { load, save, remove } from './storage'

const API = '/miniflux/v1'
const TOKEN_KEY = 'mediarium.token'

export class AuthError extends Error {}
export class ApiError extends Error {
  status: number; detail: string
  constructor(status: number, detail: string) {
    super(`接口出错：${status}${detail ? `（${detail}）` : ''}`)
    this.status = status; this.detail = detail
  }
}

export function getToken(): string | null { return load(TOKEN_KEY) }
export function setToken(t: string): void { save(TOKEN_KEY, t) }
export function clearToken(): void { remove(TOKEN_KEY); remove(KEY_ID) }

// ——— 账户（5c，2026-10-22）———
// 用户名 + 密码登录：拿密码请 Miniflux 给这台设备单开一把 API 密钥，之后只用这把；密码不存（Miniflux ≥ 2.2.9 才有 /v1/api-keys，查过官方文档）。
// 退出时把这台设备的那把作废。用旧办法（直接贴密钥）登录的，没有 KEY_ID，退出时不作废。
const KEY_ID = 'mediarium.keyId'
export interface ApiKey { id: number; description: string; created_at: string; last_used_at?: string | null }
export const myKeyId = (): number | null => { const v = load(KEY_ID); return v ? Number(v) : null }

function deviceName(): string {
  const ua = navigator.userAgent
  if (/iPhone/i.test(ua)) return 'iPhone'
  if (/iPad/i.test(ua)) return 'iPad'
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? '安卓手机' : '安卓平板'
  if (/Windows/i.test(ua)) return 'Windows 电脑'
  if (/Macintosh/i.test(ua)) return 'Mac'
  return '设备'
}
const basic = (u: string, p: string) => 'Basic ' + btoa(String.fromCharCode(...new TextEncoder().encode(`${u}:${p}`)))

export async function loginWithPassword(username: string, password: string): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const res = await fetch(API + '/api-keys', {
    method: 'POST',
    headers: { Authorization: basic(username, password), 'Content-Type': 'application/json' },
    body: JSON.stringify({ description: `灵媒 · ${deviceName()} · ${stamp}` }),
  })
  if (res.status === 401 || res.status === 403) throw new AuthError('用户名或密码不对')
  if (res.status === 429) throw new ApiError(429, '试得太频繁了，过几分钟再来')
  if (!res.ok) { let d = ''; try { d = (await res.json()).error_message ?? '' } catch { /* 无 */ } throw new ApiError(res.status, d) }
  const key = (await res.json()) as ApiKey & { token: string }
  setToken(key.token)
  save(KEY_ID, String(key.id))
}

export async function logout(): Promise<void> {
  const id = myKeyId()
  if (id) await request<void>(`/api-keys/${id}`, { method: 'DELETE' }).catch(() => { /* 作废不了也照样退出 */ })
  clearToken()
}

export async function request<T>(path: string, init: RequestInit = {}, token = getToken()): Promise<T> {
  if (!token) throw new AuthError('未登录')
  const res = await fetch(API + path, {
    ...init,
    headers: { 'X-Auth-Token': token, 'Content-Type': 'application/json', ...(init.headers || {}) },
  })
  // 密钥失效（比如在别的设备上被作废了）：清掉，回登录页（5c）
  if (res.status === 401) { clearToken(); window.dispatchEvent(new Event('mediarium:signed-out')); throw new AuthError('密钥无效') }
  if (res.status === 403) throw new AuthError('没有权限')
  if (!res.ok) {
    // Miniflux 出错时会带一句英文说明，留着给排查用
    let detail = ''
    try { detail = ((await res.json()) as { error_message?: string }).error_message ?? '' } catch { /* 无 */ }
    throw new ApiError(res.status, detail)
  }
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export interface Me { id: number; username: string }
export interface Category { id: number; title: string }
export interface Feed {
  id: number; title: string; site_url: string; feed_url: string
  category: Category; parsing_error_count: number
  crawler?: boolean; disabled?: boolean; hide_globally?: boolean; fetch_via_proxy?: boolean   // 绕道：经另一台服务器上的代理去取（0.26）
  parsing_error_message?: string; checked_at?: string
}
// 信源的三个开关：抓取全文 / 暂停更新 / 不进信息流
export type FeedOptions = { crawler: boolean; disabled: boolean; hide_globally: boolean; fetch_via_proxy?: boolean }
export interface Discovered { url: string; title: string; type: string }

export interface Enclosure { id: number; url: string; mime_type: string; size: number }
export interface Entry {
  id: number; feed_id: number; status: 'unread' | 'read' | 'removed'
  title: string; url: string; published_at: string; content: string; author: string
  starred: boolean; reading_time: number; enclosures: Enclosure[] | null; tags: string[] | null
  feed?: Feed
}
export interface EntryPage { total: number; entries: Entry[] }

// 文章查询条件，对应 Miniflux 的接口参数（时间是秒级 Unix 时间戳，前后都不含边界）
export type EntryQuery = {
  limit?: number; direction?: 'asc' | 'desc'
  published_after?: number; published_before?: number
  status?: ('unread' | 'read')[]   // 不写就是已读未读都要
  starred?: boolean
  category?: number   // 只要这个类别的（0.28）
  visible?: boolean   // 只要「进信息流」的源（Miniflux 2.2 起的 globally_visible；源上勾了「不进信息流」的不要）
}

function entryParams(q: EntryQuery): string {
  const p = new URLSearchParams({ order: 'published_at', direction: q.direction ?? 'desc', limit: String(q.limit ?? 100) })
  for (const st of q.status ?? ['unread', 'read']) p.append('status', st)
  if (q.starred) p.set('starred', 'true')
  if (q.visible) p.set('globally_visible', 'true')
  if (q.category) p.set('category_id', String(q.category))
  if (q.published_after !== undefined) p.set('published_after', String(q.published_after))
  if (q.published_before !== undefined) p.set('published_before', String(q.published_before))
  return p.toString()
}

export const api = {
  me: (token?: string) => request<Me>('/me', {}, token ?? getToken()),
  categories: () => request<Category[]>('/categories'),
  feeds: () => request<Feed[]>('/feeds'),
  feedEntries: (feedId: number, q: EntryQuery) => request<EntryPage>(`/feeds/${feedId}/entries?${entryParams(q)}`),
  entries: (q: EntryQuery) => request<EntryPage>(`/entries?${entryParams(q)}`),
  entry: (id: number) => request<Entry>(`/entries/${id}`),
  // 每个源的已读 / 未读篇数（键是源 id 的字符串）
  counters: () => request<{ reads: Record<string, number>; unreads: Record<string, number> }>('/feeds/counters'),
  setStatus: (ids: number[], status: 'read' | 'unread') =>
    request<void>('/entries', { method: 'PUT', body: JSON.stringify({ entry_ids: ids, status }) }),
  // 全部未读标为已读（Miniflux 按用户整体处理，要先知道自己的用户 id）
  markAllRead: async () => {
    const me = await request<Me>('/me')
    await request<void>(`/users/${me.id}/mark-all-as-read`, { method: 'PUT' })
  },
  discover: (url: string) => request<Discovered[]>('/discover', { method: 'POST', body: JSON.stringify({ url }) }),
  createFeed: (feed_url: string, category_id: number, opts: FeedOptions) =>
    request<{ feed_id: number }>('/feeds', { method: 'POST', body: JSON.stringify({ feed_url, category_id, ...opts }) }),
  updateFeed: (id: number, change: Partial<FeedOptions> & { title?: string; category_id?: number }) =>
    request<Feed>(`/feeds/${id}`, { method: 'PUT', body: JSON.stringify(change) }),
  refreshAll: () => request<void>('/feeds/refresh', { method: 'PUT' }),
  refreshFeed: (id: number) => request<void>(`/feeds/${id}/refresh`, { method: 'PUT' }),
  deleteFeed: (id: number) => request<void>(`/feeds/${id}`, { method: 'DELETE' }),
  createCategory: (title: string) => request<Category>('/categories', { method: 'POST', body: JSON.stringify({ title }) }),
  updateCategory: (id: number, title: string) =>
    request<Category>(`/categories/${id}`, { method: 'PUT', body: JSON.stringify({ title }) }),
  deleteCategory: (id: number) => request<void>(`/categories/${id}`, { method: 'DELETE' }),
  // 设备（API 密钥）列表：不取 token 字段给界面
  apiKeys: async () => (await request<(ApiKey & { token?: string })[]>('/api-keys')).map(({ token: _t, ...k }) => k as ApiKey),
  deleteApiKey: (id: number) => request<void>(`/api-keys/${id}`, { method: 'DELETE' }),
  toggleStar: (id: number) => request<void>(`/entries/${id}/bookmark`, { method: 'PUT' }),
  // OPML（阶段 5a）：Miniflux 自己就有导入导出，只是返回的是 XML 不是 JSON
  exportOpml: async () => {
    const res = await fetch(API + '/export', { headers: { 'X-Auth-Token': getToken() ?? '' } })
    if (!res.ok) throw new ApiError(res.status, '')
    return res.text()
  },
  importOpml: async (xml: string) => {
    const res = await fetch(API + '/import', { method: 'POST', headers: { 'X-Auth-Token': getToken() ?? '', 'Content-Type': 'application/xml' }, body: xml })
    if (!res.ok) { let d = ''; try { d = (await res.json()).error_message ?? '' } catch { /* 无 */ } throw new ApiError(res.status, d) }
  },
}

// 报刊架数据（分类 + 信源）在报刊架、杂志目录之间共用：先给上次的，后台再刷新。
export type ShelfData = { categories: Category[]; feeds: Feed[] }
// 信源增删改之后再调一次 loadShelf()，所有用到报刊架数据的页面（useShelf）一起更新。
let shelfCache: ShelfData | null = null
const shelfListeners = new Set<(d: ShelfData) => void>()
export function cachedShelf(): ShelfData | null { return shelfCache }
export async function loadShelf(): Promise<ShelfData> {
  const [categories, feeds] = await Promise.all([api.categories(), api.feeds()])
  shelfCache = { categories, feeds }
  shelfListeners.forEach((f) => f(shelfCache!))
  return shelfCache
}
export function subscribeShelf(f: (d: ShelfData) => void): () => void {
  shelfListeners.add(f)
  return () => { shelfListeners.delete(f) }
}

// 刊物在报刊架上的编号：分类内第几本（报刊架列表视图的 01、02…）
export function feedNumber(data: ShelfData, feedId: number): number | null {
  const feed = data.feeds.find((f) => f.id === feedId)
  if (!feed) return null
  return data.feeds.filter((f) => f.category.id === feed.category.id).findIndex((f) => f.id === feedId) + 1
}

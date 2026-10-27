// 以某个账号的身份调 Miniflux（MCP 用，2026-10-27）。密钥是这个账号自己的 API 密钥，只能看、改这个账号的东西。
// Miniflux 设了带路径的 BASE_URL 时接口在 /miniflux/v1 下，不在 /v1 下：两个都试，记住问得通的那个（同 index.js 的 askMe）
const MINIFLUX = (process.env.MINIFLUX_URL || 'http://mediarium-miniflux:8080').replace(/\/$/, '')
const PATHS = [process.env.MINIFLUX_API_PATH, '/v1', '/miniflux/v1'].filter(Boolean)
let apiPath = null

export class MfError extends Error {
  constructor(status, message) { super(message); this.status = status }
}

// 拿用户的密钥调一个接口；path 形如 '/feeds'。返回解析好的 JSON（204 返回 null）
export async function mf(key, path, init = {}) {
  let last = null
  for (const p of apiPath ? [apiPath] : PATHS) {
    let r
    try {
      r = await fetch(`${MINIFLUX}${p}${path}`, {
        ...init,
        headers: { 'X-Auth-Token': key, 'content-type': 'application/json', ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(init.timeout ?? 15000),
      })
    } catch (e) { last = new MfError(502, 'Miniflux 没回话：' + (e?.message ?? '')); continue }
    if (r.status === 404 && !apiPath) { last = new MfError(404, 'not found'); continue }   // 路径不对，换一条
    apiPath = p
    if (r.status === 204) return null
    const text = await r.text()
    let body = null
    try { body = text ? JSON.parse(text) : null } catch { /* 不是 JSON */ }
    if (!r.ok) throw new MfError(r.status, body?.error_message || text.slice(0, 200) || `Miniflux 回了 ${r.status}`)
    return body
  }
  throw last ?? new MfError(502, 'Miniflux 没回话')
}

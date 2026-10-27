// 安全护栏（5b，2026-10-21 定）：誊写服务会替别人去取网址，不能被拿去当跳板。
//   · 只取 http / https；
//   · 解析出的 IP 不能是内网、本机、链路本地这些地址（否则可能被诱导去碰同机的 Miniflux、OB、atmosphere）；
//   · 每次取都有超时和大小上限；跳转也逐跳检查。
import { lookup } from 'node:dns/promises'
import net from 'node:net'
import { ProxyAgent, fetch as viaFetch } from 'undici'

// 绕道（0.8，2026-10-24）：有的站拦服务器所在机房的 IP（livedoor 回 503），这些源经另一台服务器上的代理去取。
// 地址（含用户名密码）来自服务器配置 FETCH_PROXY，和 Miniflux 的 HTTP_CLIENT_PROXY 是同一个；不配就没有这条路。
// 只在明确要绕道时用（via: 'proxy'），平时照旧直连
const PROXY = process.env.FETCH_PROXY || ''
let agent = null
export const proxyOn = () => !!PROXY

const PRIVATE_V4 = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
  ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
]
const v4num = (ip) => ip.split('.').reduce((a, b) => (a << 8) + Number(b), 0) >>> 0
function privateV4(ip) {
  const n = v4num(ip)
  return PRIVATE_V4.some(([base, bits]) => (n >>> (32 - bits)) === (v4num(base) >>> (32 - bits)))
}
function privateIp(ip) {
  if (net.isIPv4(ip)) return privateV4(ip)
  const v = ip.toLowerCase()
  if (v === '::' || v === '::1') return true
  if (v.startsWith('::ffff:')) return privateV4(v.slice(7))
  return /^(fc|fd|fe8|fe9|fea|feb|ff)/.test(v)
}

export class Blocked extends Error {}

// 例外：本站自己的 RSSHub（阶段 6，2026-10-23）。它在 docker 内网，按规矩会被拦；只放行这一个地址（协议 + 主机 + 端口完全一致），
// 别的内网地址照样拦。地址来自服务器配置 RSSHUB_URL，不来自用户输入
const trusted = new Set()
export function trustOrigin(raw) { try { if (raw) trusted.add(new URL(raw).origin) } catch { /* 配错了就不放行 */ } }

export async function checkUrl(raw) {
  let u
  try { u = new URL(raw) } catch { throw new Blocked('地址不对') }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Blocked('只取 http / https')
  if (u.username || u.password) throw new Blocked('地址里不能带账号密码')
  if (trusted.has(u.origin)) return u
  const host = u.hostname.replace(/^\[|\]$/g, '')
  const addrs = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => { throw new Blocked('域名解析不了') })
  if (!addrs.length || addrs.some((a) => privateIp(a.address))) throw new Blocked('不取内网地址')
  return u
}

// 取一个网址：逐跳检查跳转，超时，超过上限就断开
export async function safeFetch(raw, { maxBytes = 10 * 1024 * 1024, timeout = 20000, headers = {}, via } = {}) {
  if (via === 'proxy' && !PROXY) throw new Blocked('没有配绕道')
  let url = await checkUrl(raw)
  const proxied = via === 'proxy' && !trusted.has(url.origin)
  for (let hop = 0; hop < 5; hop++) {
    const res = proxied
      ? await viaFetch(url, { redirect: 'manual', headers, signal: AbortSignal.timeout(timeout), dispatcher: (agent ??= new ProxyAgent(PROXY)) })
      : await fetch(url, { redirect: 'manual', headers, signal: AbortSignal.timeout(timeout) })
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      url = await checkUrl(new URL(res.headers.get('location'), url).href)
      continue
    }
    const len = Number(res.headers.get('content-length') || 0)
    if (len > maxBytes) throw new Blocked('太大了')
    const chunks = []
    let size = 0
    for await (const c of res.body ?? []) {
      size += c.length
      if (size > maxBytes) throw new Blocked('太大了')
      chunks.push(c)
    }
    return { status: res.status, headers: res.headers, body: Buffer.concat(chunks), url: url.href }
  }
  throw new Blocked('跳转太多次')
}

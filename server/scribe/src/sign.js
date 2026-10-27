// 灵媒自建上的源，给 Miniflux 订的地址带一个签名（0.7，2026-10-24，见 index.js 的 /feed 一节）。
//   签名 = HMAC(服务器密钥, 这一个地址)：只对这一个地址有效；只签本站 RSSHub 上的地址
import { createHmac, timingSafeEqual } from 'node:crypto'

export const signFeed = (key, url) => createHmac('sha256', key).update('feed\u0000' + url).digest('base64url').slice(0, 32)
export const onHub = (hub, url) => !!hub && typeof url === 'string' && url.startsWith(hub + '/') && !/\/\.\.?(\/|$|\?)/.test(url.slice(hub.length))
export function sigOk(key, hub, url, sig) {
  if (!key || !onHub(hub, url) || typeof sig !== 'string') return false
  const want = signFeed(key, url)
  return sig.length === want.length && timingSafeEqual(Buffer.from(sig), Buffer.from(want))
}

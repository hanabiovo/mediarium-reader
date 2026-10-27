// 加源（阶段 5a，2026-10-21 Hana 定）：网页地址、RSS 地址、RSSHub 路由都贴进同一个框，灵媒判断是什么。
// 「找源」不造轮子：发现页只放外链，找到了贴回来。
import type { Feed } from '../api/miniflux'
import { hubBase } from './hub'

// 去哪里找源。随时往这里加 Hana 常用的地方
export const DISCOVER_LINKS: { label: string; note: string; url: string }[] = [
  { label: 'RSSHub 路由', note: '按网站查现成的路由，复制路由贴回来', url: 'https://docs.rsshub.app/zh/routes/' },
  // 2026-10-22 查过：Wechat2RSS 公开服务收了三百多个号，偏安全、技术类；不在列表里的号订不了
  { label: '公众号 · Wechat2RSS', note: '列表里有的号可以直接订', url: 'https://wechat2rss.xlab.app/list/all/' },
  // Folo 发现去掉（2026-10-21 Hana：要登录 Folo，等于在 Folo 网页版里操作 Folo，导不进灵媒）
]

// 现有信源里用过的 RSSHub 服务器：贴路由时就补这一台（没有就用官方的）
// 官方实例 rsshub.app 有 Cloudflare 人机验证，服务器去抓会被拦（403），所以优先用 Hana 自己在用的那台
const OFFICIAL = /^https?:\/\/rsshub\.app$/i
// 从已有订阅里猜「在用的那台 RSSHub」（没有灵媒自建时的老办法；灵媒自建那台不算在内）
export function guessHost(feeds: Feed[]): string {
  const hub = hubBase()
  for (const f of feeds) {
    const m = f.feed_url.match(/^(https?:\/\/[^/]*rsshub[^/]*)\//i)
    if (m && !OFFICIAL.test(m[1]) && m[1] !== hub) return m[1]
  }
  return 'https://rsshub.app'
}
// 贴进来的路由补哪台：有灵媒自建就用它，没有再按老办法猜
export function rsshubHost(feeds: Feed[]): string {
  return hubBase() || guessHost(feeds)
}

// 把贴进来的东西变成 Miniflux 能查的地址
export function normalizeInput(raw: string, feeds: Feed[]): { url: string; kind: string } {
  let s = raw.trim()
  // 分享进来的常是「标题 网址」一整段：取第一个网址
  const inText = s.match(/https?:\/\/[^\s"'<>，。]+/)
  if (inText) s = inText[0]
  if (/^rsshub:\/\//i.test(s)) return { url: rsshubHost(feeds) + '/' + s.replace(/^rsshub:\/\/\/?/i, ''), kind: 'RSSHub 路由' }
  if (/^\/[a-z0-9]/i.test(s)) return { url: rsshubHost(feeds) + s, kind: 'RSSHub 路由' }
  if (!/^https?:\/\//i.test(s) && /^[\w-]+(\.[\w-]+)+(\/|$)/.test(s)) s = 'https://' + s
  // RSSHub 文档里的例子都写官方实例（rsshub.app），从那边分享 / 复制过来的换成自己那台（2026-10-21：被 Cloudflare 拦了）
  const off = s.match(/^https?:\/\/rsshub\.app(\/.*)$/i)
  if (off) { const host = rsshubHost(feeds); if (!OFFICIAL.test(host)) return { url: host + off[1], kind: (hubBase() ? 'RSSHub 路由（换成了灵媒自建）' : 'RSSHub 路由（换成了你在用的那台 RSSHub）') } }
  const kind = /rsshub/i.test(s) ? 'RSSHub 路由' : /(\.xml|\.rss|\.rdf|\.atom|\.json|\/feed\/?|\/rss\/?|\/atom\/?|feedburner)(\?|$)/i.test(s) ? '订阅源地址' : '网页地址'
  return { url: s, kind }
}


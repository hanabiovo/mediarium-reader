// 源医生 · 体检（5b-3，2026-10-22）：从服务器这边真的取一次，像 Miniflux 那样看这个源。
// 不用 AI，全是量得出来的东西：取不取得到、是不是订阅源、有几篇、多久更新、正文多长、有没有图；
// 再取第一篇的原网页比一比字数，判断源里给的是全文还是摘要、开「抓取全文」有没有用。
// 原则同排版模块：认不准就说「说不准」，不硬判。
import * as cheerio from 'cheerio'
import { Blocked, safeFetch } from './guard.js'

const UA = 'Mozilla/5.0 (compatible; Miniflux; +https://miniflux.app) mediarium-scribe/0.2'
const ACCEPT_FEED = 'application/rss+xml, application/atom+xml, application/feed+json, application/xml, text/xml, */*'

// 正文字数：去掉空白后的字符数（中文一个字算一个，英文一个字母算一个，粗略但够比）
export const chars = (s) => s.replace(/\s+/g, '').length
const htmlText = (html) => { try { return cheerio.load(html, null, false).text() } catch { return html.replace(/<[^>]+>/g, '') } }

// 解析订阅源：RSS 的 item / Atom 的 entry。认不出来返回 null
// JSON Feed（jsonfeed.org，0.9：Miniflux 认、体检原来不认，2026-10-24 测出）
function parseJsonFeed(text) {
  let j
  try { j = JSON.parse(text) } catch { return null }
  if (!j || typeof j !== 'object' || !/jsonfeed\.org\/version/i.test(String(j.version ?? '')) || !Array.isArray(j.items)) return null
  const items = j.items.map((i) => ({
    title: String(i.title ?? '').trim(), link: String(i.url ?? i.external_url ?? ''),
    date: Date.parse(i.date_published ?? i.date_modified ?? ''), html: String(i.content_html ?? i.content_text ?? i.summary ?? ''),
    video: (i.attachments ?? []).some((a) => /^video\//i.test(a?.mime_type ?? '')),
    audio: (i.attachments ?? []).some((a) => /^audio\//i.test(a?.mime_type ?? '')),
  }))
  return { title: String(j.title ?? '').trim(), site: String(j.home_page_url ?? ''), items }
}
// 视频条目：YouTube（yt:videoId）、media:content 是视频、enclosure 是视频、链接指向视频站（0.9）
const VIDEO_LINK = /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch|shorts)|youtu\.be\/|vimeo\.com\/\d|bilibili\.com\/video\/)/i

export function parseFeed(xml) {
  if (/^\s*\{/.test(xml.slice(0, 200))) return parseJsonFeed(xml)
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 3000))) return null
  const $ = cheerio.load(xml, { xml: { xmlMode: true } })
  const atom = $('feed').length > 0 && !$('rss').length
  const title = $(atom ? 'feed > title' : 'channel > title').first().text().trim()
  const site = atom
    ? ($('feed > link[rel="alternate"]').attr('href') || $('feed > link:not([rel])').attr('href') || '')
    : $('channel > link').first().text().trim()
  const items = $(atom ? 'entry' : 'item').toArray().map((it) => {
    const e = $(it)
    const link = atom
      ? (e.children('link[rel="alternate"]').attr('href') || e.children('link:not([rel])').attr('href') || e.children('link').first().attr('href') || '')
      : (e.children('link').first().text().trim() || e.children('guid[isPermaLink!="false"]').text().trim())
    const date = e.children('pubDate, published, updated, dc\\:date').first().text().trim()
    const body = e.children('content\\:encoded').text() || e.children('content').text() || e.children('description').text() || e.children('summary').text() || ''
    const video = e.find('yt\\:videoId').length > 0 || e.find('media\\:content[medium="video"], media\\:content[type^="video/"], enclosure[type^="video/"]').length > 0 || VIDEO_LINK.test(link)
    const audio = e.find('enclosure[type^="audio/"], media\\:content[type^="audio/"]').length > 0
    return { title: e.children('title').first().text().trim(), link, date: date ? Date.parse(date) : NaN, html: body, video, audio }
  })
  return { title, site, items }
}

// 原网页里「抓取全文」抽得出来的正文字数：找 article / 正文容器，只数像样的段落（≥ 20 字的 <p>）。
// 整页的零碎文字（导航、推荐、页脚）不算；靠脚本画出来的页面原始 HTML 里没有段落，就是 0——
// 这种页开「抓取全文」只会抽空（2026-10-24：知乎日报体检说能补全文，开了反而一片空白）
export function pageChars(html) {
  const $ = cheerio.load(html)
  $('script, style, noscript, nav, header, footer, aside, form, iframe, svg, template').remove()
  const box = ['[itemprop="articleBody"]', 'article', '#js_content', '.rich_media_content', 'main', '.article-content', '.post-content', '.entry-content']
    .map((s) => $(s).first()).find((b) => b.length && chars(b.text()) > 200)
  const ps = (box ?? $('body')).find('p').toArray().map((p) => $(p).text()).filter((t) => chars(t) >= 20)
  if (ps.length) return chars(ps.join(''))
  return box ? chars(box.text()) : 0
}

function looksLikeChallenge(status, body) {
  return (status === 403 || status === 503 || status === 429) && /cloudflare|cf-chl|challenge|just a moment|captcha|ddos/i.test(body.slice(0, 20000))
}

// 判全文 / 摘要
export function verdict(contentChars, page) {
  if (page && page > 300) {
    if (contentChars >= page * 0.7) return 'full'
    if (contentChars < page * 0.4) return 'summary'
  }
  if (contentChars >= 1200) return 'full'
  if (contentChars < 300) return 'summary'
  return 'unsure'
}

// 一次体检。返回给灵媒的都是中文说明能直接显示的字段
export async function checkFeed(url, { probe = true, via } = {}) {
  const out = { url, ok: false, ...(via ? { via } : {}) }
  let r
  try {
    r = await safeFetch(url, { timeout: 15000, headers: { 'user-agent': UA, accept: ACCEPT_FEED }, via })
  } catch (e) {
    out.problem = e instanceof Blocked ? e.message : /timeout|abort/i.test(String(e?.name) + e?.message) ? '服务器取不到：超时了' : '服务器取不到：连不上'
    return out
  }
  const body = r.body.toString('utf8')
  out.status = r.status
  if (looksLikeChallenge(r.status, body)) { out.problem = '对方开了人机验证（Cloudflare 之类），服务器取不到'; return out }
  if (r.status !== 200) { out.problem = `服务器取不到：对方回了 ${r.status}`; return out }
  const feed = parseFeed(body)
  if (!feed) {
    out.problem = /<html[\s>]/i.test(body.slice(0, 3000)) ? '取回来的是网页，不是订阅源' : '取回来的东西认不出是订阅源'
    return out
  }
  out.ok = true
  out.title = feed.title
  out.site = feed.site
  out.count = feed.items.length
  out.titles = feed.items.slice(0, 8).map((i) => i.title).filter(Boolean)   // 给灵媒判断是不是外文源（阶段 4）
  if (!feed.items.length) { out.problem = '订阅源是空的，一篇文章都没有'; return out }

  // 更新：最新一篇多久以前、最近十篇平均几天一篇
  const dates = feed.items.map((i) => i.date).filter((d) => !Number.isNaN(d)).sort((a, b) => b - a)
  if (dates.length) {
    out.latest = new Date(dates[0]).toISOString()
    // 频率用整份源的时间跨度算；RSSHub 常给一批文章打同一个时间，跨度不到一天就不报（2026-10-22：澎湃算出「每天 415 篇」）
    const span = (dates[0] - dates.at(-1)) / 864e5
    if (dates.length > 1 && span >= 1) out.perWeek = Math.round(((dates.length - 1) / span) * 7 * 10) / 10
  }
  // 视频源 / 播客：正文本来就是简介，不按字数判摘要，也不推荐抓取全文（0.9）
  const head = feed.items.slice(0, 8)
  if (head.filter((i) => i.video).length >= Math.ceil(head.length / 2)) out.kind = 'video'
  else if (head.filter((i) => i.audio).length >= Math.ceil(head.length / 2)) out.kind = 'audio'
  // 正文：前五篇的平均字数、有图的比例
  const sample = feed.items.slice(0, 5)
  out.avgChars = Math.round(sample.reduce((a, i) => a + chars(htmlText(i.html)), 0) / sample.length)
  out.imageShare = Math.round((sample.filter((i) => /<img[\s>]/i.test(i.html)).length / sample.length) * 100) / 100

  if (out.kind) return out
  // 第一篇的原网页：服务器取不取得到、正文多长
  const first = feed.items.find((i) => /^https?:\/\//i.test(i.link))
  if (first) {
    out.sample = { title: first.title, link: first.link, chars: chars(htmlText(first.html)) }
    try {
      const p = await safeFetch(first.link, { maxBytes: 4 * 1024 * 1024, timeout: 10000, headers: { 'user-agent': UA, accept: 'text/html,*/*' }, via })
      const html = p.body.toString('utf8')
      if (looksLikeChallenge(p.status, html)) out.sample.page = { problem: '原网页有人机验证' }
      else if (p.status !== 200) out.sample.page = { problem: `原网页回了 ${p.status}` }
      else out.sample.page = { chars: pageChars(html) }
    } catch (e) {
      out.sample.page = { problem: e instanceof Blocked ? e.message : '原网页取不到' }
    }
  }
  const page = out.sample?.page?.chars
  out.content = verdict(out.sample?.chars ?? out.avgChars, page)
  // 摘要源：原网页抽得出正文、明显比源里给的长 → 开「抓取全文」大概率有用
  if (out.content !== 'full') out.crawlerHelps = !!(page && page > 500 && page > (out.sample?.chars ?? out.avgChars) * 1.5)
  // 只给摘要：去同一个网站常见的栏目路径找找有没有给全文的（Hugo 一类：/index.xml 是全站摘要，/posts/index.xml 是全文；2026-10-24 Hana 要的）
  if (out.content === 'summary' && probe && !via) out.fuller = await findFuller(url, out.avgChars)
  return out
}

// 同一个网站上可能的栏目订阅源：只对 /xxx.xml 这种（静态博客）试，WordPress 的 /feed/ 本身就给全文
export function siblingFeeds(url) {
  let u
  try { u = new URL(url) } catch { return [] }
  const m = u.pathname.match(/^(.*\/)([^/]+\.(xml|rss|atom))$/i)
  if (!m) return []
  return ['posts', 'blog', 'articles', 'post'].map((d) => new URL(m[1] + d + '/' + m[2], u).href).filter((h) => h !== u.href && !u.pathname.includes('/' + h.split('/').at(-2) + '/'))
}
async function findFuller(url, avg) {
  for (const next of siblingFeeds(url)) {
    try {
      const r = await safeFetch(next, { timeout: 8000, headers: { 'user-agent': UA, accept: ACCEPT_FEED } })
      if (r.status !== 200) continue
      const f = parseFeed(r.body.toString('utf8'))
      if (!f?.items.length) continue
      const s = f.items.slice(0, 5)
      const a = s.reduce((x, i) => x + chars(htmlText(i.html)), 0) / s.length
      if (verdict(a) === 'full' || a > Math.max(600, avg * 3)) return next
    } catch { /* 下一个 */ }
  }
  return undefined
}

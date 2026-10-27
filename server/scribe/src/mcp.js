// 灵媒的 MCP（2026-10-27 Hana 定）：让 AI 助手以某个账号的身份看订阅、找源体检、读文章、看源医生，管理档还能添加、修改、退订。
// 协议：MCP Streamable HTTP 的无状态用法——每个 POST 是一条（或一批）JSON-RPC，直接回 JSON；不开 SSE、不发会话号。
// 认人：路径里的专属链接（links.js），对上了就拿那把 Miniflux 密钥办事。权限档见 links.js。
import { checkFeed } from './doctor.js'
import { proxyOn } from './guard.js'
import { HUB, getIndex, hubOn, matchUrl, searchSites } from './hub.js'
import { htmlToMarkdown, sections } from './markdown.js'
import { mf, MfError } from './mfclient.js'
import { examineFeed, patrolUser, readReport } from './patrol.js'
import { signFeed } from './sign.js'
import { readMeta, updateMeta, withNote } from './usermeta.js'

const VERSION = '1.0.0'
const PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']
const HUB_LABEL = '灵媒自建'
// 公开的 RSSHub 实例（同网页端 web/src/lib/doctor.ts 的 RSSHUB_PUBLIC）
const RSSHUB_PUBLIC = [
  'https://rsshub.rssforever.com', 'https://hub.slarker.me', 'https://rsshub.pseudoyu.com', 'https://rsshub.rss.tips',
  'https://rsshub.ktachibana.party', 'https://rss.owo.nz', 'https://rsshub.henry.wang', 'https://rsshub.cups.moe',
]

const INSTRUCTIONS = `这是「灵媒」（一个自部署的 RSS 阅读器）的工具，以当前用户的身份办事，只能碰这个用户自己的订阅和文章。
- 用户提到读过的文章：先 search_articles 找，再 get_article 读。长文章会分节，按需要取某一节。
- 推荐新信源：先用 find_sources 实测（从服务器真的取一次），只推荐能用的；告诉用户全文还是摘要、要不要开抓取全文。
- 添加、修改、退订会改用户的订阅：先把要做的事列给用户确认，再调用。退订会连同这个源的文章（包括收藏）一起删掉，unsubscribe 先不带 confirm 调一次看清楚，再请用户确认。
- 用户的习惯（类别、是否翻译标题）可以从 list_subscriptions 里看出来，添加时照着建议默认值。
- 源出问题：source_health 看原始材料，check_source 现场体检，refresh_source 让 Miniflux 立刻重抓一次。`

// ——— 小工具 ———
const DAY = 864e5
const ago = (iso) => {
  if (!iso) return ''
  const d = Math.floor((Date.now() - Date.parse(iso)) / DAY)
  return d <= 0 ? '今天' : d === 1 ? '昨天' : d < 30 ? `${d} 天前` : d < 365 ? `${Math.floor(d / 30)} 个月前` : `${Math.floor(d / 365)} 年前`
}
const day = (iso) => (iso ? iso.slice(0, 10) : '')
// 订阅地址 → 给人看的样子：经誊写服务转的取出原地址；灵媒自建写成「hub:/路由」
function plainUrl(feedUrl) {
  let u = feedUrl
  const m = /\/scribe\/feed\?(.*)$/.exec(u)
  if (m) u = new URLSearchParams(m[1]).get('url') ?? u
  if (HUB && u.startsWith(HUB + '/')) return 'hub:' + u.slice(HUB.length)
  return u
}
// hub:/路由 → 内部地址；别的原样
const hubInner = (u) => (u.startsWith('hub:/') ? HUB + u.slice(4) : u)
const sameFeed = (a, b) => plainUrl(a).replace(/\/$/, '').toLowerCase() === plainUrl(b).replace(/\/$/, '').toLowerCase()
const rate = (w) => (w >= 14 ? `每天约 ${Math.round(w / 7)} 篇` : w >= 1 ? `每周约 ${Math.round(w)} 篇` : w > 0 ? `每月约 ${Math.max(1, Math.round(w * 4.3))} 篇` : '')
function verdictLine(c) {
  if (!c.ok) return c.problem ?? '取不到'
  if (c.problem) return c.problem
  return [
    c.kind === 'video' ? '视频' : c.kind === 'audio' ? '播客' : c.content === 'full' ? '全文' : c.content === 'summary' ? (c.crawlerHelps ? '摘要（开抓取全文能补全）' : '摘要') : '不确定是否全文',
    (c.imageShare ?? 0) >= 0.4 ? '有图' : '',
    c.perWeek ? rate(c.perWeek) : '',
    c.latest ? `最新 ${ago(c.latest)}` : '',
    c.via ? '要绕道（经代理）才取得到' : '',
  ].filter(Boolean).join(' · ')
}
const usable = (c) => !!c && c.ok && !c.problem
const blocked = (c) => !!c && !c.ok && (c.status === 403 || c.status === 429 || c.status === 451 || c.status === 503 || /人机验证|连不上|超时/.test(c.problem ?? ''))
function score(c) {
  if (!usable(c)) return -1
  let s = 10
  if (c.kind || c.content === 'full') s += 6
  else if (c.crawlerHelps) s += 4
  else if (c.content === 'unsure') s += 2
  if (c.latest) { const d = (Date.now() - Date.parse(c.latest)) / DAY; s += d < 3 ? 3 : d < 14 ? 2 : d < 60 ? 1 : -2 }
  if ((c.imageShare ?? 0) >= 0.4) s += 1
  return s
}
async function pool(items, n, f) {
  const out = new Array(items.length)
  let i = 0
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; out[k] = await f(items[k], k) } }))
  return out
}
class UserError extends Error {}
const need = (v, what) => { if (v === undefined || v === null || v === '') throw new UserError(`缺少 ${what}`); return v }
const intArg = (v, what) => { const n = Number(v); if (!Number.isInteger(n) || n <= 0) throw new UserError(`${what} 应该是正整数`); return n }

// 体检：先直接取，像是被拦了再绕道（配了代理才有）。灵媒自建的直接取内网地址
async function examine(url) {
  const c = await checkFeed(hubInner(url)).catch((e) => ({ url, ok: false, problem: e.message }))
  if (blocked(c) && proxyOn() && !url.startsWith('hub:/')) {
    const p = await checkFeed(url, { via: 'proxy' }).catch(() => null)
    if (usable(p)) return p
  }
  return c
}
function checkupText(url, c) {
  const lines = [`${url}`, `  结论：${verdictLine(c)}`]
  if (c.title) lines.push(`  源名：${c.title}`)
  if (c.status) lines.push(`  状态码：${c.status}`)
  if (c.ok) {
    lines.push(`  篇数：${c.count ?? '?'}；最新：${day(c.latest) || '?'}；前 5 篇平均 ${c.avgChars ?? '?'} 字；有图比例 ${c.imageShare ?? 0}`)
    if (c.sample) lines.push(`  第一篇：源里 ${c.sample.chars} 字；原网页${c.sample.page?.chars ? ` ${c.sample.page.chars} 字` : `：${c.sample.page?.problem ?? '没取'}`}`)
    if (c.fuller) lines.push(`  同一网站上找到给全文的源：${c.fuller}`)
    if (c.titles?.length) lines.push(`  最近标题：${c.titles.slice(0, 4).join(' / ')}`)
  }
  return lines.join('\n')
}

async function feedsAndCats(key) {
  const [feeds, cats] = await Promise.all([mf(key, '/feeds'), mf(key, '/categories')])
  return { feeds: feeds ?? [], cats: cats ?? [] }
}
const findCat = (cats, name) => cats.find((c) => c.title.trim().toLowerCase() === String(name).trim().toLowerCase())

// ——— 工具 ———
const TOOLS = [
  {
    name: 'list_subscriptions', scope: 'read',
    description: '列出用户的全部订阅：按类别分组，每个源带 id、名字、订阅地址、设置（抓取全文、翻译标题、暂停、不进信息流、绕道）、报刊归属和最近是否报错。',
    inputSchema: { type: 'object', properties: {} },
    run: async ({ key }) => {
      const [{ feeds, cats }, meta] = await Promise.all([feedsAndCats(key), readMeta(key)])
      const out = [`共 ${feeds.length} 个源，${cats.length} 个类别。`]
      for (const c of cats) {
        const list = feeds.filter((f) => f.category?.id === c.id)
        out.push(`\n## ${c.title}（${list.length}）`)
        for (const f of list) {
          const m = meta.feeds?.[f.id] ?? {}
          const flags = [f.crawler && '抓取全文', m.trTitle && '翻译标题', f.disabled && '暂停', f.hide_globally && '不进信息流', f.fetch_via_proxy && '绕道',
            f.parsing_error_count > 0 && `报错×${f.parsing_error_count}`].filter(Boolean)
          const paper = m.paper ? `；报刊 ${meta.papers?.[m.paper]?.name ?? m.paper}${m.column ? ' · ' + m.column : ''}` : ''
          out.push(`- #${f.id} ${f.title} — ${plainUrl(f.feed_url)}${flags.length ? '｜' + flags.join('、') : ''}${paper}`)
        }
      }
      return out.join('\n')
    },
  },
  {
    name: 'find_sources', scope: 'read',
    description: '找订阅源并当场体检（从服务器真的取一次）。query 可以是网站地址、订阅源地址、RSSHub 路由（/开头）或站点名。返回每个候选能不能用、全文还是摘要、更新频率、要不要开抓取全文，并标出推荐的那个和已经订过的。添加时把候选的「地址」原样交给 add_sources。',
    inputSchema: { type: 'object', properties: { query: { type: 'string', description: '网址、订阅地址、RSSHub 路由或站点名' } }, required: ['query'] },
    run: async ({ key }, { query }) => {
      const q = String(need(query, 'query')).trim()
      const { feeds } = await feedsAndCats(key)
      const idx = hubOn() ? await getIndex().catch(() => null) : null
      let cands = []   // { url, title, from }
      const notes = []
      if (q.startsWith('/') || q.startsWith('hub:/')) {
        const route = q.replace(/^hub:/, '')
        if (HUB) cands.push({ url: 'hub:' + route, from: HUB_LABEL })
        for (const h of RSSHUB_PUBLIC.slice(0, 3)) cands.push({ url: h + route, from: new URL(h).host })
      } else if (/^https?:\/\//i.test(q) || /^[\w-]+(\.[\w-]+)+(\/|$)/.test(q)) {
        const url = /^https?:\/\//i.test(q) ? q : 'https://' + q
        const found = await mf(key, '/discover', { method: 'POST', body: JSON.stringify({ url }) }).catch(() => [])
        for (const d of found ?? []) cands.push({ url: d.url, title: d.title, from: '官方' })
        if (!cands.length) cands.push({ url, from: '原地址' })
        if (idx) for (const r of matchUrl(idx, url)) {
          if (r.needsInput || !r.path) { notes.push(`RSSHub 路由 ${r.siteName} · ${r.name}（${r.route}）要填参数，没自动体检`); continue }
          if (HUB) cands.push({ url: 'hub:' + r.path, title: `${r.siteName} · ${r.name}`, from: HUB_LABEL })
        }
      } else {
        if (!idx) return '这台灵媒没接 RSSHub，按名字找不了。请给网站地址。'
        const sites = searchSites(idx, q).slice(0, 10)
        if (!sites.length) return `RSSHub 目录里没有叫「${q}」的站点。请给网站地址，我直接去找官方订阅源。`
        return [`RSSHub 目录里和「${q}」有关的站点（还没体检）：`, ...sites.map((s) => `- ${s.name}（站点 id ${s.id}${s.url ? '，' + s.url : ''}，${s.n} 条路由）`),
          '要体检的话，用网站地址或具体路由（如 /thepaper/featured）再调一次 find_sources。'].join('\n')
      }
      cands = cands.filter((c, i, a) => a.findIndex((x) => x.url === c.url) === i).slice(0, 8)
      const checks = await pool(cands, 3, (c) => examine(c.url))
      // 只给摘要、同一网站上找到给全文的：也列进来
      for (let i = 0; i < checks.length; i++) {
        const f = checks[i]?.fuller
        if (f && !cands.some((c) => c.url === f) && cands.length < 10) { cands.push({ url: f, from: '同网站全文版' }); checks.push(await examine(f)) }
      }
      const hubFirst = cands.findIndex((c, i) => c.url.startsWith('hub:/') && usable(checks[i]))
      let best = hubFirst
      if (best < 0) { let s = 0; checks.forEach((c, i) => { const v = score(c); if (v > s) { s = v; best = i } }) }
      const out = [`「${q}」找到 ${cands.length} 个候选：`]
      cands.forEach((c, i) => {
        const ck = checks[i]
        const had = feeds.find((f) => sameFeed(f.feed_url, c.url))
        out.push(`\n${i === best ? '★ 推荐 ' : ''}${c.title || ck?.title || ''}（${c.from}）${had ? `【已订阅：#${had.id} ${had.title}】` : ''}`)
        out.push(`  地址：${c.url}`)
        out.push(`  ${verdictLine(ck)}`)
        if (ck?.ok && ck.content === 'summary' && ck.crawlerHelps) out.push('  建议：开抓取全文（crawler）')
        if (ck?.via) out.push('  建议：开绕道（proxy）')
      })
      if (notes.length) out.push('', ...notes)
      return out.join('\n')
    },
  },
  {
    name: 'search_articles', scope: 'read',
    description: '找文章。可以按关键词（标题和正文）、最近几天、已读/未读、收藏、某个源来找。返回文章 id、标题、来源、时间、状态；用 get_article 读全文。',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '关键词，可省' },
        days: { type: 'number', description: '只看最近几天发布的，可省' },
        status: { type: 'string', enum: ['any', 'unread', 'read'], description: '默认 any' },
        starred: { type: 'boolean', description: '只看收藏' },
        feed_id: { type: 'number', description: '只看某个源' },
        limit: { type: 'number', description: '最多几篇，默认 15，最多 50' },
      },
    },
    run: async ({ key }, a) => {
      const p = new URLSearchParams({ order: 'published_at', direction: 'desc', limit: String(Math.min(50, Math.max(1, Number(a.limit) || 15))) })
      if (a.query) p.set('search', String(a.query))
      if (a.days) p.set('published_after', String(Math.floor((Date.now() - Number(a.days) * DAY) / 1000)))
      if (a.starred) p.set('starred', 'true')
      const st = a.status === 'unread' ? ['unread'] : a.status === 'read' ? ['read'] : ['unread', 'read']
      for (const s of st) p.append('status', s)
      const path = a.feed_id ? `/feeds/${intArg(a.feed_id, 'feed_id')}/entries` : '/entries'
      const r = await mf(key, `${path}?${p}`)
      const list = r?.entries ?? []
      if (!list.length) return '没找到。'
      return [`共 ${r.total} 篇，列出 ${list.length} 篇：`,
        ...list.map((e) => `- [${e.id}] ${e.title} — ${e.feed?.title ?? ''}，${day(e.published_at)}${e.status === 'read' ? '，已读' : '，未读'}${e.starred ? '，★收藏' : ''}`)].join('\n')
    },
  },
  {
    name: 'get_article', scope: 'read',
    description: '读一篇文章的全文（灵媒整理过的 Markdown，图写成 ![图注](地址)）。很长的文章先给目录和第一节，用 section 取后面的节。',
    inputSchema: { type: 'object', properties: { id: { type: 'number', description: '文章 id（search_articles 给的）' }, section: { type: 'number', description: '第几节，从 1 开始，可省' } }, required: ['id'] },
    run: async ({ key }, a) => {
      const e = await mf(key, `/entries/${intArg(a.id, 'id')}`)
      const md = htmlToMarkdown(e.content, { title: e.title, base: e.url })
      const head = [`# ${e.title}`, `来源：${e.feed?.title ?? ''}${e.author ? '｜作者：' + e.author : ''}｜${day(e.published_at)}｜${e.status === 'read' ? '已读' : '未读'}${e.starred ? '｜★收藏' : ''}`, `原文：${e.url}`]
      const audio = (e.enclosures ?? []).filter((x) => /^audio\//.test(x.mime_type ?? ''))
      if (audio.length) head.push(`音频：${audio.map((x) => x.url).join('、')}`)
      if (!md.trim()) return head.join('\n') + '\n\n（正文是空的，内容可能只在原网页上）'
      const parts = sections(md)
      if (md.length <= 15000 && !a.section) return head.join('\n') + '\n\n' + md
      const n = a.section ? intArg(a.section, 'section') : 1
      if (n > parts.length) throw new UserError(`只有 ${parts.length} 节`)
      const toc = parts.map((p, i) => `${i + 1}. ${p.title}（${p.text.length} 字）`).join('\n')
      return `${head.join('\n')}\n\n全文 ${md.length} 字，分 ${parts.length} 节：\n${toc}\n\n——— 第 ${n} 节 ———\n\n${parts[n - 1].text}`
    },
  },
  {
    name: 'source_health', scope: 'read',
    description: '源医生：看信源健康状况的原始材料。给 feed_id 看一个源的详情（Miniflux 抓取报错原文、上次检查时间、最近 5 篇的日期和字数、平时多久更新、不爱看的比例、病历）；不给就巡一遍全部，列出有问题的源，并附上每日巡诊记下的问题从哪天开始。',
    inputSchema: { type: 'object', properties: { feed_id: { type: 'number', description: '某个源的 id，可省' } } },
    run: async ({ key, uid }, a) => {
      if (a.feed_id) {
        const id = intArg(a.feed_id, 'feed_id')
        const [feed, meta] = await Promise.all([mf(key, `/feeds/${id}`), readMeta(key)])
        const { facts, issues } = await examineFeed(key, feed, meta)
        const lines = [`#${facts.id} ${facts.title}（${facts.category ?? ''}）`, `订阅地址：${plainUrl(feed.feed_url)}`, `网站：${feed.site_url}`,
          `设置：${[facts.crawler && '抓取全文', facts.proxy && '绕道', facts.paused && '暂停'].filter(Boolean).join('、') || '默认'}`,
          `Miniflux：上次检查 ${facts.checkedAt ?? '?'}；连续出错 ${facts.errors} 次${facts.errorMessage ? `；报错原文：${facts.errorMessage}` : ''}`,
          `最新一篇：${day(facts.latest) || '无'}；平时间隔约 ${facts.typicalGapDays ?? '?'} 天${facts.avgChars !== undefined ? `；最近几篇平均 ${facts.avgChars} 字` : ''}${facts.kind === 'media' ? '；视频/播客源' : ''}`]
        if (facts.recent?.length) lines.push('最近几篇：', ...facts.recent.map((r) => `  - ${day(r.published)} ${r.title}（${r.chars} 字）`))
        if (facts.muted30d) lines.push(`近 30 天划掉「不爱看」${facts.muted30d} 篇${facts.entries30d ? `，这段时间共 ${facts.entries30d} 篇` : ''}`)
        lines.push(issues.length ? `规则判出的问题：${issues.map((i) => i.text).join('；')}` : '规则判出的问题：没有')
        if (facts.notes?.length) lines.push('病历：', ...facts.notes.map((n) => `  - ${day(n.t)} ${n.what}`))
        return lines.join('\n')
      }
      const [round, report] = await Promise.all([patrolUser(key), readReport(uid)])
      const since = new Map((report?.issues ?? []).map((i) => [`${i.feed}|${i.kind}`, i.since]))
      const sick = round.wards.filter((w) => w.issues.length)
      const out = [`巡了 ${round.total} 个源，${sick.length} 个要看看。${report ? `（每日巡诊上次在 ${report.at.slice(0, 16).replace('T', ' ')}）` : ''}`]
      for (const w of sick) {
        out.push(`- #${w.facts.id} ${w.facts.title}：${w.issues.map((i) => { const s = since.get(`${w.facts.id}|${i.kind}`); return i.text + (s ? `（${day(s)} 起）` : '') }).join('；')}`)
        if (w.facts.errorMessage) out.push(`  报错原文：${w.facts.errorMessage}`)
      }
      return out.join('\n')
    },
  },
  {
    name: 'check_source', scope: 'read',
    description: '现场体检：从服务器真的去取一次这个源（被拦时自动试绕道），量出状态码、篇数、更新时间、全文还是摘要、原网页能不能取到。给 feed_id 体检已订的源，或给 url 体检任意地址。',
    inputSchema: { type: 'object', properties: { feed_id: { type: 'number' }, url: { type: 'string' } } },
    run: async ({ key }, a) => {
      let url = a.url ? String(a.url) : ''
      if (a.feed_id) url = plainUrl((await mf(key, `/feeds/${intArg(a.feed_id, 'feed_id')}`)).feed_url)
      need(url, 'feed_id 或 url')
      return checkupText(url, await examine(url))
    },
  },
  {
    name: 'refresh_source', scope: 'read',
    description: '让 Miniflux 立刻重新抓一次这个源（不改任何设置），然后报告抓取结果。',
    inputSchema: { type: 'object', properties: { feed_id: { type: 'number' } }, required: ['feed_id'] },
    run: async ({ key }, a) => {
      const id = intArg(a.feed_id, 'feed_id')
      await mf(key, `/feeds/${id}/refresh`, { method: 'PUT', timeout: 60000 })
      const f = await mf(key, `/feeds/${id}`)
      return f.parsing_error_count > 0 ? `重抓了，还是出错（连续 ${f.parsing_error_count} 次）：${f.parsing_error_message}` : `重抓好了，没有报错。上次检查：${f.checked_at}`
    },
  },
  {
    name: 'add_sources', scope: 'manage',
    description: '批量添加订阅源（会改用户的订阅：先和用户确认要加哪些、放哪个类别、怎么设置）。url 用 find_sources 给的地址（灵媒自建的写成 hub:/路由）。类别不存在就新建。',
    inputSchema: {
      type: 'object',
      properties: {
        sources: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              url: { type: 'string' },
              category: { type: 'string', description: '类别名' },
              title: { type: 'string', description: '源名，可省（省了用源自己的名字）' },
              translate_title: { type: 'boolean', description: '翻译标题' },
              crawler: { type: 'boolean', description: '抓取全文' },
              proxy: { type: 'boolean', description: '绕道（经代理）抓取' },
              hide_from_stream: { type: 'boolean', description: '不进信息流' },
            },
            required: ['url', 'category'],
          },
        },
      },
      required: ['sources'],
    },
    run: async (ctx, a) => {
      const { key } = ctx
      const list = need(a.sources, 'sources')
      if (!Array.isArray(list) || !list.length || list.length > 20) throw new UserError('sources 要 1–20 个')
      let { feeds, cats } = await feedsAndCats(key)
      const results = [], trIds = []
      for (const s of list) {
        const url = String(s.url ?? '').trim()
        try {
          need(url, 'url'); need(s.category, 'category')
          const had = feeds.find((f) => sameFeed(f.feed_url, url))
          if (had) { results.push(`- ${url}：已经订过了（#${had.id} ${had.title}），没重复加`); continue }
          let cat = findCat(cats, s.category)
          if (!cat) { cat = await mf(key, '/categories', { method: 'POST', body: JSON.stringify({ title: String(s.category).trim() }) }); cats = [...cats, cat] }
          const feedUrl = url.startsWith('hub:/') ? ctx.wrapHub(hubInner(url)) : url
          const r = await mf(key, '/feeds', { method: 'POST', timeout: 60000, body: JSON.stringify({ feed_url: feedUrl, category_id: cat.id, crawler: !!s.crawler, fetch_via_proxy: !!s.proxy, hide_globally: !!s.hide_from_stream }) })
          const id = r.feed_id
          if (s.title) await mf(key, `/feeds/${id}`, { method: 'PUT', body: JSON.stringify({ title: String(s.title).trim() }) }).catch(() => {})
          if (s.translate_title) trIds.push(id)
          feeds = [...feeds, { id, feed_url: feedUrl, title: s.title || url }]
          results.push(`- ✓ #${id} ${s.title || url} → ${cat.title}${[s.crawler && '抓取全文', s.translate_title && '翻译标题', s.proxy && '绕道', s.hide_from_stream && '不进信息流'].filter(Boolean).map((x) => '、' + x).join('')}`)
        } catch (e) { results.push(`- ✗ ${url}：${e.message}`) }
      }
      if (trIds.length) await updateMeta(key, (m) => { const feedsM = { ...m.feeds }; for (const id of trIds) feedsM[id] = { ...feedsM[id], trTitle: true }; return { ...m, feeds: feedsM } }).catch((e) => results.push(`（翻译标题没设上：${e.message}）`))
      return results.join('\n') + '\n\n用户刷新一下灵媒就能看到；报刊架会按规则自动归到报刊里。'
    },
  },
  {
    name: 'update_source', scope: 'manage',
    description: '修改一个已订的源（会改用户的订阅：先和用户确认）。可以改类别、名字、抓取全文、绕道、不进信息流、暂停、翻译标题，或换订阅地址（比如换 RSSHub 实例、换成 hub:/路由）。改动会记进源医生的病历。',
    inputSchema: {
      type: 'object',
      properties: {
        feed_id: { type: 'number' }, category: { type: 'string' }, title: { type: 'string' }, url: { type: 'string', description: '新的订阅地址' },
        crawler: { type: 'boolean' }, proxy: { type: 'boolean' }, hide_from_stream: { type: 'boolean' }, paused: { type: 'boolean' }, translate_title: { type: 'boolean' },
      },
      required: ['feed_id'],
    },
    run: async (ctx, a) => {
      const { key } = ctx
      const id = intArg(a.feed_id, 'feed_id')
      const feed = await mf(key, `/feeds/${id}`)
      const change = {}, did = []
      if (a.category !== undefined) {
        const { cats } = await feedsAndCats(key)
        let cat = findCat(cats, a.category)
        if (!cat) cat = await mf(key, '/categories', { method: 'POST', body: JSON.stringify({ title: String(a.category).trim() }) })
        change.category_id = cat.id; did.push(`类别改成「${cat.title}」`)
      }
      if (a.title) { change.title = String(a.title).trim(); did.push(`改名「${change.title}」`) }
      if (a.url) { const u = String(a.url).trim(); change.feed_url = u.startsWith('hub:/') ? ctx.wrapHub(hubInner(u)) : u; did.push(`地址换成 ${u}`) }
      if (a.crawler !== undefined) { change.crawler = !!a.crawler; did.push(`抓取全文${a.crawler ? '开' : '关'}`) }
      if (a.proxy !== undefined) { change.fetch_via_proxy = !!a.proxy; did.push(`绕道${a.proxy ? '开' : '关'}`) }
      if (a.hide_from_stream !== undefined) { change.hide_globally = !!a.hide_from_stream; did.push(a.hide_from_stream ? '不进信息流' : '回到信息流') }
      if (a.paused !== undefined) { change.disabled = !!a.paused; did.push(a.paused ? '暂停更新' : '恢复更新') }
      if (Object.keys(change).length) await mf(key, `/feeds/${id}`, { method: 'PUT', body: JSON.stringify(change) })
      if (a.translate_title !== undefined) did.push(`翻译标题${a.translate_title ? '开' : '关'}`)
      if (!did.length) return '没给要改的东西。'
      await updateMeta(key, (m) => {
        let next = withNote(m, id, `AI 助手：${did.join('，')}`)
        if (a.translate_title !== undefined) next = { ...next, feeds: { ...next.feeds, [id]: { ...next.feeds[id], trTitle: a.translate_title ? true : undefined } } }
        return next
      }).catch(() => {})
      return `#${id} ${feed.title}：${did.join('，')}。${change.feed_url || change.crawler !== undefined || change.fetch_via_proxy !== undefined ? '可以用 refresh_source 马上重抓一次看看。' : ''}`
    },
  },
  {
    name: 'unsubscribe', scope: 'manage',
    description: '退订一个源。注意：Miniflux 退订会把这个源的文章（包括收藏）一起删掉，不能恢复。不带 confirm 只试算（告诉你有多少篇、几篇收藏）；用户明确同意后再带 confirm: true 调用。想保留文章可以改用 update_source 暂停更新或不进信息流。',
    inputSchema: { type: 'object', properties: { feed_id: { type: 'number' }, confirm: { type: 'boolean' } }, required: ['feed_id'] },
    run: async ({ key }, a) => {
      const id = intArg(a.feed_id, 'feed_id')
      const feed = await mf(key, `/feeds/${id}`)
      const any = 'status=unread&status=read'
      const [all, starred] = await Promise.all([
        mf(key, `/feeds/${id}/entries?limit=1&${any}`).then((r) => r?.total ?? 0),
        mf(key, `/feeds/${id}/entries?limit=50&starred=true&${any}`),
      ])
      const stars = starred?.entries ?? []
      if (!a.confirm) {
        return [`试算：退订 #${id} ${feed.title}（${feed.category?.title ?? ''}）会删掉 ${all} 篇文章，其中收藏 ${starred?.total ?? 0} 篇。`,
          ...stars.slice(0, 10).map((e) => `  ★ ${e.title}`),
          '还没退。用户确认后带 confirm: true 再调用；想留着文章可以改成暂停更新。'].join('\n')
      }
      await mf(key, `/feeds/${id}`, { method: 'DELETE' })
      await updateMeta(key, (m) => { const feeds = { ...m.feeds }; delete feeds[id]; return { ...m, feeds } }).catch(() => {})
      return `已退订 #${id} ${feed.title}，删掉了 ${all} 篇（含收藏 ${starred?.total ?? 0} 篇）。`
    },
  },
]

// 服务器的名字和图标（图标：停着的寒鸦，2026-10-27 Hana 选；浅色背景用深色鸦，深色背景用浅色鸦）。
// 图标放在灵媒网站的 /icons/ 下（web/public/icons/mcp-crow-*）；按 MCP 规范，客户端都认 PNG，SVG 认不认看客户端
function serverInfo(origin) {
  const info = { name: 'mediarium', title: '灵媒', version: VERSION }
  if (!origin) return info
  const icon = (theme, ext, mimeType, sizes) => ({ src: `${origin}/icons/mcp-crow-${theme}.${ext}`, mimeType, sizes, theme })
  return {
    ...info, websiteUrl: origin,
    icons: [icon('light', 'png', 'image/png', ['192x192']), icon('dark', 'png', 'image/png', ['192x192']), icon('light', 'svg', 'image/svg+xml', ['any']), icon('dark', 'svg', 'image/svg+xml', ['any'])],
  }
}

// ——— JSON-RPC ———
const ok = (id, result) => ({ jsonrpc: '2.0', id, result })
const fail = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })

export function toolsFor(scope) {
  return TOOLS.filter((t) => scope === 'manage' || t.scope === 'read').map((t) => ({
    name: t.name, description: t.description, inputSchema: t.inputSchema,
    annotations: { readOnlyHint: t.scope === 'read' && t.name !== 'refresh_source', destructiveHint: t.name === 'unsubscribe', openWorldHint: ['find_sources', 'check_source', 'refresh_source'].includes(t.name) },
  }))
}

// ctx：{ key, uid, scope, origin, signKey, log }
async function one(msg, ctx) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return fail(msg?.id, -32600, 'Invalid Request')
  const { id, method, params = {} } = msg
  const isNote = id === undefined || id === null
  if (method.startsWith('notifications/')) return null
  if (isNote) return null
  if (method === 'initialize') {
    const v = PROTOCOLS.includes(params.protocolVersion) ? params.protocolVersion : PROTOCOLS[0]
    return ok(id, { protocolVersion: v, capabilities: { tools: { listChanged: false } }, serverInfo: serverInfo(ctx.origin), instructions: INSTRUCTIONS })
  }
  if (method === 'ping') return ok(id, {})
  if (method === 'tools/list') return ok(id, { tools: toolsFor(ctx.scope) })
  if (method === 'tools/call') {
    const t = TOOLS.find((x) => x.name === params.name)
    if (!t || (t.scope === 'manage' && ctx.scope !== 'manage')) {
      return ok(id, { content: [{ type: 'text', text: t ? '这条链接是只读的，不能改订阅。要改的话，请用户在灵媒「设置 › 接入 AI 助手」里开一条「可管理订阅」的链接。' : `没有这个工具：${params.name}` }], isError: true })
    }
    try {
      const text = await t.run(ctx, params.arguments ?? {})
      return ok(id, { content: [{ type: 'text', text }] })
    } catch (e) {
      const why = e instanceof UserError ? e.message : e instanceof MfError ? (e.status === 401 ? '这条链接的密钥已经作废了（可能在「登录过的设备」里删掉了），请重新生成链接' : `Miniflux：${e.message}`) : '出错了：' + (e?.message ?? e)
      ctx.log?.('mcp tool', t.name, e?.message)
      return ok(id, { content: [{ type: 'text', text: why }], isError: true })
    }
  }
  return fail(id, -32601, `Method not found: ${method}`)
}

// 处理一个 POST 体：单条或一批。返回 { status, body }（body 为 null 时回 202）
export async function handleRpc(body, ctx) {
  ctx.wrapHub = (inner) => `${ctx.origin}/scribe/feed?url=${encodeURIComponent(inner)}&s=${signFeed(ctx.signKey, inner)}`
  if (!ctx.signKey) ctx.wrapHub = () => { throw new UserError('服务器没配签名密钥，订不了灵媒自建的源') }
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.map((m) => one(m, ctx)))).filter(Boolean)
    return { status: out.length ? 200 : 202, body: out.length ? out : null }
  }
  const r = await one(body, ctx)
  return { status: r ? 200 : 202, body: r }
}

export const _tools = TOOLS   // 测试用

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'

// ——— 假 Miniflux：一个账号（hana），两个类别，三个源，几篇文章 ———
const USER_TOKEN = 'user-login-token'
const day = (n) => new Date(Date.now() - n * 864e5).toISOString()
const state = {
  keys: new Map([[USER_TOKEN, 1]]),
  nextKey: 9,
  stylesheet: 'body{} /* mediarium-meta:{"v":1,"feeds":{"2":{"trTitle":true,"notes":[]}},"categories":{},"papers":{"x":{"name":"X"}},"themes":[{"id":"u:1"}]}:mediarium-meta */',
  cats: [{ id: 1, title: '新闻' }, { id: 2, title: '杂志' }],
  feeds: [
    { id: 1, title: '澎湃新闻 · 思想市场', feed_url: 'https://rsshub.rss.tips/thepaper/list/25483', site_url: 'https://m.thepaper.cn', category: { id: 1, title: '新闻' }, crawler: false, disabled: false, parsing_error_count: 0 },
    { id: 2, title: 'The New Yorker', feed_url: 'https://www.newyorker.com/feed/everything', site_url: 'https://www.newyorker.com', category: { id: 2, title: '杂志' }, crawler: true, disabled: false, parsing_error_count: 0 },
    { id: 3, title: '旧博客', feed_url: 'https://old.example.com/rss', site_url: 'https://old.example.com', category: { id: 2, title: '杂志' }, crawler: false, disabled: false, parsing_error_count: 3, parsing_error_message: 'status 503' },
  ],
  entries: [
    { id: 11, feed_id: 2, title: 'A Man from the Future', url: 'https://www.newyorker.com/a', published_at: day(1), status: 'read', starred: true, content: '<h3>The Man from the Future</h3><p>Johnny was <b>brilliant</b>.</p><figure><img src="/i.jpg"><figcaption>Von Neumann</figcaption></figure>' },
    { id: 12, feed_id: 2, title: 'Short one', url: 'https://www.newyorker.com/b', published_at: day(3), status: 'unread', starred: false, content: '<p>tiny</p>' },
    { id: 13, feed_id: 3, title: 'Old post', url: 'https://old.example.com/p', published_at: day(200), status: 'read', starred: false, content: '<p>' + 'x'.repeat(50) + '</p>' },
  ],
  created: [], deleted: [], puts: [],
  titles: [],   // 下一个订上的源叫什么（Miniflux 从源里读名字）
}
// ——— 假 RSSHub：目录两个站点，一个小订阅源 ———
const NS = {
  cctv: { name: '央视新闻', url: 'news.cctv.com', routes: {
    '/:category': { name: '专题', example: '/cctv/world', parameters: { category: '分类名' }, description: '| 新闻 | 国际 | 科技 |\n| ---- | ---- | ---- |\n| news | world | tech |' },
    '/lm/:id?': { name: '栏目', example: '/cctv/lm/xwzk', parameters: { id: '栏目 id，默认为 xwzk 即 新闻周刊' }, features: { requirePuppeteer: true } },
  } },
  thepaper: { name: '澎湃新闻', url: 'thepaper.cn', routes: { '/list/:id': { name: '栏目', example: '/thepaper/list/25462' } } },
}
function fakeHub(req, res) {
  const u = new URL(req.url, 'http://x')
  if (u.pathname === '/api/namespace') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(NS)) }
  const m = u.pathname.match(/^\/api\/namespace\/(.+)$/)
  if (m) { const ns = NS[decodeURIComponent(m[1])]; res.writeHead(ns ? 200 : 404, { 'content-type': 'application/json' }); return res.end(JSON.stringify(ns ?? { error: 'no' })) }
  if (u.pathname.startsWith('/page')) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html><body><article><p>' + '正文'.repeat(400) + '</p></article></body></html>') }
  const items = [1, 2, 3].map((i) => `<item><title>国际新闻 ${i}</title><link>http://${req.headers.host}/page${i}</link><pubDate>${new Date(Date.now() - i * 864e5).toUTCString()}</pubDate><description>${'内容'.repeat(300)}</description></item>`).join('')
  res.writeHead(200, { 'content-type': 'application/rss+xml' })
  res.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>央视新闻 - 国际</title><link>https://news.cctv.com</link>${items}</channel></rss>`)
}
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
    if (req.url.startsWith('/api/namespace') || req.url.startsWith('/cctv/') || req.url.startsWith('/page')) return fakeHub(req, res)
    const uid = state.keys.get(req.headers['x-auth-token'])
    if (!uid) return send(401, { error_message: 'Access Unauthorized' })
    const u = new URL(req.url, 'http://x'), p = u.pathname.replace(/^\/v1/, ''), m = req.method
    const body = b ? JSON.parse(b) : {}
    const feedOf = (id) => state.feeds.find((f) => f.id === Number(id))
    let mm
    if (p === '/me') return send(200, { id: 1, username: 'hana', stylesheet: state.stylesheet })
    if (p === '/users/1' && m === 'PUT') { state.stylesheet = body.stylesheet; return send(201, {}) }
    if (p === '/api-keys' && m === 'POST') { const id = state.nextKey++; const token = 'mf-key-' + id; state.keys.set(token, 1); return send(201, { id, token, description: body.description }) }
    if ((mm = p.match(/^\/api-keys\/(\d+)$/)) && m === 'DELETE') { state.keys.delete('mf-key-' + mm[1]); return send(204) }
    if (p === '/categories' && m === 'GET') return send(200, state.cats)
    if (p === '/categories' && m === 'POST') { const c = { id: state.cats.length + 1, title: body.title }; state.cats.push(c); return send(201, c) }
    if (p === '/feeds' && m === 'GET') return send(200, state.feeds)
    if (p === '/feeds' && m === 'POST') { const id = 100 + state.created.length; state.created.push({ id, ...body }); state.feeds.push({ id, title: state.titles.shift() ?? body.feed_url, feed_url: body.feed_url, category: state.cats.find((c) => c.id === body.category_id), parsing_error_count: 0, crawler: !!body.crawler }); return send(201, { feed_id: id }) }
    if ((mm = p.match(/^\/feeds\/(\d+)$/))) {
      if (m === 'GET') return feedOf(mm[1]) ? send(200, feedOf(mm[1])) : send(404, { error_message: 'not found' })
      if (m === 'PUT') { state.puts.push({ id: Number(mm[1]), ...body }); Object.assign(feedOf(mm[1]), body, body.category_id ? { category: state.cats.find((c) => c.id === body.category_id) } : {}); return send(201, feedOf(mm[1])) }
      if (m === 'DELETE') { state.deleted.push(Number(mm[1])); state.feeds = state.feeds.filter((f) => f.id !== Number(mm[1])); return send(204) }
    }
    if ((mm = p.match(/^\/feeds\/(\d+)\/refresh$/))) return send(204)
    if ((mm = p.match(/^\/(feeds\/(\d+)\/)?entries$/))) {
      let list = state.entries.filter((e) => !mm[2] || e.feed_id === Number(mm[2]))
      if (u.searchParams.get('starred') === 'true') list = list.filter((e) => e.starred)
      const q = u.searchParams.get('search'); if (q) list = list.filter((e) => e.title.toLowerCase().includes(q.toLowerCase()))
      list = list.map((e) => ({ ...e, feed: feedOf(e.feed_id) }))
      return send(200, { total: list.length, entries: list.slice(0, Number(u.searchParams.get('limit') || 100)) })
    }
    if ((mm = p.match(/^\/entries\/(\d+)$/))) { const e = state.entries.find((x) => x.id === Number(mm[1])); return e ? send(200, { ...e, feed: feedOf(e.feed_id) }) : send(404, {}) }
    send(404, { error_message: 'no route ' + p })
  })
})
await new Promise((ok) => srv.listen(0, ok))
after(() => srv.close())

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'scribe-mcp-'))
process.env.SCRIBE_SECRET = 'test-secret'
process.env.MINIFLUX_URL = `http://127.0.0.1:${srv.address().port}`
process.env.RSSHUB_URL = `http://127.0.0.1:${srv.address().port}`
const HUB_ENC = encodeURIComponent(process.env.RSSHUB_URL)
const links = await import('../src/links.js')
const { handleRpc } = await import('../src/mcp.js')
const { htmlToMarkdown, sections } = await import('../src/markdown.js')
const { parseMeta } = await import('../src/usermeta.js')
const { patrolUser, saveReport, readReport } = await import('../src/patrol.js')

const call = async (link, name, args = {}) => {
  const r = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { ...link, origin: 'https://reader.example.com', signKey: 'sig' })
  return { text: r.body.result.content[0].text, error: !!r.body.result.isError }
}

let readLink, manageLink
const meta0 = () => parseMeta(state.stylesheet)
test('专属链接：生成、认出、权限档', async () => {
  const a = await links.createLink(1, USER_TOKEN, 'read')
  const b = await links.createLink(1, USER_TOKEN, 'manage')
  assert.ok(a.secret.length >= 40)
  readLink = await links.resolveLink(a.secret)
  manageLink = await links.resolveLink(b.secret)
  assert.equal(readLink.scope, 'read')
  assert.equal(manageLink.scope, 'manage')
  assert.equal(await links.resolveLink('x'.repeat(43)), null)
  assert.equal((await links.listLinks(1)).length, 2)
  assert.equal((await links.listLinks(2)).length, 0)   // 别人看不到
})

test('MCP 握手与工具清单：只读档看不到管理工具', async () => {
  const init = await handleRpc({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: '2025-06-18' } }, { ...readLink, origin: 'https://reader.example.com' })
  assert.equal(init.body.result.protocolVersion, '2025-06-18')
  assert.equal(init.body.result.serverInfo.name, 'mediarium')
  const icons = init.body.result.serverInfo.icons
  assert.equal(icons.length, 4)
  assert.deepEqual(icons[0], { src: 'https://reader.example.com/icons/mcp-crow-light.png', mimeType: 'image/png', sizes: ['192x192'], theme: 'light' })
  assert.ok(icons.some((i) => i.theme === 'dark' && i.mimeType === 'image/png'))
  assert.equal((await handleRpc({ jsonrpc: '2.0', method: 'notifications/initialized' }, { ...readLink })).status, 202)
  const ro = (await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { ...readLink })).body.result.tools.map((t) => t.name)
  const rw = (await handleRpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' }, { ...manageLink })).body.result.tools.map((t) => t.name)
  assert.ok(ro.includes('get_article') && !ro.includes('add_sources') && !ro.includes('unsubscribe'))
  assert.ok(rw.includes('add_sources') && rw.includes('unsubscribe'))
  const denied = await call(readLink, 'unsubscribe', { feed_id: 1, confirm: true })
  assert.ok(denied.error && /只读/.test(denied.text))
  assert.equal(state.deleted.length, 0)
})

test('看订阅：带设置和报错', async () => {
  const { text } = await call(readLink, 'list_subscriptions')
  assert.match(text, /#2 《The New Yorker》 — .*抓取全文、翻译标题/)
  assert.match(text, /#3 《旧博客》 — .*报错×3/)
})

test('找文章、读全文：去掉开头重复标题，图写成 Markdown', async () => {
  const s = await call(readLink, 'search_articles', { query: 'future' })
  assert.match(s.text, /\[11\] A Man from the Future/)
  const a = await call(readLink, 'get_article', { id: 11 })
  assert.doesNotMatch(a.text, /The Man from the Future\n/)
  assert.match(a.text, /Johnny was \*\*brilliant\*\*\./)
  assert.match(a.text, /!\[Von Neumann\]\(https:\/\/www\.newyorker\.com\/i\.jpg\)/)
})

test('源医生：巡诊找出报错和久不更新，记下从哪天起', async () => {
  const r = await call(readLink, 'source_health')
  assert.match(r.text, /#3 旧博客：抓取连续出错 3 次/)
  assert.match(r.text, /200 天没有新文章/)
  const one = await call(readLink, 'source_health', { feed_id: 3 })
  assert.match(one.text, /报错原文：status 503/)
  const round = await patrolUser(manageLink.key)
  const rep = await saveReport(round)
  assert.ok(rep.issues.some((i) => i.feed === 3 && i.kind === 'error'))
  const again = await saveReport({ ...round, at: '2099-01-01T00:00:00.000Z' })
  assert.equal(again.issues.find((i) => i.feed === 3 && i.kind === 'error').since, rep.issues.find((i) => i.feed === 3 && i.kind === 'error').since)   // 第一次出现的时间不变
  assert.equal((await readReport(1)).at, '2099-01-01T00:00:00.000Z')
})

test('批量添加：新建类别、灵媒自建换成签名地址、翻译标题写进灵媒设置、不重复加', async () => {
  const r = await call(manageLink, 'add_sources', { sources: [
    { url: 'hub:/harpers/latest', category: '长文', translate_title: true, title: "Harper's" },
    { url: 'https://www.theatlantic.com/feed/all/', category: '杂志', crawler: true },
    { url: 'https://www.newyorker.com/feed/everything', category: '杂志' },
  ] })
  assert.match(r.text, /✓ #100 《Harper's》 → 长文、翻译标题/)
  assert.match(r.text, /✓ #101 .* → 杂志、抓取全文/)
  assert.ok(meta0().feeds['100'].added)                // 记下添加时间
  assert.match(meta0().feeds['100'].notes[0].what, /AI 助手：添加/)
  assert.match(r.text, /已经订过了（#2/)
  assert.equal(state.created.length, 2)
  assert.ok(state.created[0].feed_url.startsWith(`https://reader.example.com/scribe/feed?url=${HUB_ENC}%2Fharpers%2Flatest&s=`))
  assert.equal(state.created[1].crawler, true)
  assert.ok(state.cats.some((c) => c.title === '长文'))
  const meta = parseMeta(state.stylesheet)
  assert.equal(meta.feeds['100'].trTitle, true)
  assert.equal(meta.feeds['2'].trTitle, true)        // 原有的没被盖掉
  assert.equal(meta.themes[0].id, 'u:1')              // 认不得的字段也原样留着
  assert.match(state.stylesheet, /^body\{\} /)        // 用户自己的样式还在
})

test('修改：换类别、开抓取全文，记进病历', async () => {
  const r = await call(manageLink, 'update_source', { feed_id: 3, crawler: true, category: '新闻' })
  assert.match(r.text, /类别改成「新闻」，抓取全文开/)
  assert.equal(state.puts.at(-1).crawler, true)
  assert.match(parseMeta(state.stylesheet).feeds['3'].notes[0].what, /^AI 助手：/)
})

test('报刊：新建一本两栏的刊，刊名、别名、栏目名写进灵媒设置', async () => {
  state.titles.push('央视新闻 - 国际', '央视新闻 - 科技')
  const r = await call(manageLink, 'add_sources', { sources: [
    { url: 'hub:/cctv/world', category: '新闻', paper: '央视新闻', alias: 'CCTV', column: '国际' },
    { url: 'hub:/cctv/tech', category: '新闻', crawler: true },
  ] })
  assert.match(r.text, /✓ #102 《央视新闻》栏目「国际」 → 新闻/)
  assert.match(r.text, /✓ #103 《央视新闻》栏目「科技」 → 新闻、抓取全文/)
  const m = meta0()
  assert.deepEqual([m.feeds['102'].paper, m.feeds['102'].column, m.feeds['103'].column], ['cctv', '国际', '科技'])
  assert.equal(m.papers.cctv.name, '央视新闻')
  assert.equal(m.papers.cctv.latin, 'CCTV')
  assert.equal(state.feeds.find((f) => f.id === 102).title, '央视新闻 · 国际')
  const list = await call(readLink, 'list_subscriptions', { category: '新闻' })
  assert.match(list.text, /《央视新闻》（别名 CCTV），2 栏/)
  assert.match(list.text, /#103 栏目「科技」 — hub:\/cctv\/tech｜抓取全文｜添加于/)
})

test('报刊：同一网站的新栏目并进已有的那本，类别跟着报刊', async () => {
  state.titles.push('澎湃新闻 - 有数')
  const r = await call(manageLink, 'add_sources', { sources: [{ url: 'hub:/thepaper/list/25462', category: '杂志' }] })
  assert.match(r.text, /✓ #104 《澎湃新闻》栏目「有数」 → 新闻/)
  assert.match(r.text, /类别跟着报刊，放在「新闻」/)
  assert.equal(state.created.at(-1).category_id, 1)
  assert.equal(state.feeds.find((f) => f.id === 1).title, '澎湃新闻 · 思想市场')
  const m = meta0()
  assert.deepEqual([m.feeds['1'].paper, m.feeds['1'].column, m.feeds['104'].column], ['thepaper', '思想市场', '有数'])
})

test('报刊：栏目不能单独改类别、刊名、别名，只能改栏目名和选项', async () => {
  const bad = await call(manageLink, 'update_source', { feed_id: 103, category: '杂志' })
  assert.ok(bad.error && /属于整本报刊/.test(bad.text))
  const bad2 = await call(manageLink, 'update_source', { feed_id: 103, alias: 'x' })
  assert.ok(bad2.error)
  const ok = await call(manageLink, 'update_source', { feed_id: 103, column: '科学', crawler: false })
  assert.match(ok.text, /栏目名改成「科学」，抓取全文关/)
  assert.equal(state.feeds.find((f) => f.id === 103).title, '央视新闻 · 科学')
  assert.equal(meta0().feeds['103'].column, '科学')
})

test('报刊：update_paper 整本搬类别、改别名、改刊名', async () => {
  const r = await call(manageLink, 'update_paper', { feed_id: 103, category: '杂志', alias: '中央电视台' })
  assert.match(r.text, /类别改成「杂志」（2 栏一起搬），别名改成「中央电视台」/)
  assert.deepEqual([102, 103].map((id) => state.feeds.find((f) => f.id === id).category.id), [2, 2])
  assert.equal(meta0().papers.cctv.latin, '中央电视台')
  await call(manageLink, 'update_paper', { feed_id: 102, name: 'CCTV 新闻' })
  assert.equal(state.feeds.find((f) => f.id === 103).title, 'CCTV 新闻 · 科学')
  assert.equal(meta0().papers.cctv.name, 'CCTV 新闻')
  // 一栏的报刊：别名也写在源上（网页端单栏报刊读这里）
  await call(manageLink, 'update_paper', { feed_id: 3, alias: '老博客' })
  assert.equal(meta0().feeds['3'].latin, '老博客')
})

test('找源：按站点列全部路由、标出已订的；一次体检几条', async () => {
  const s = await call(readLink, 'find_sources', { site: 'cctv' })
  assert.match(s.text, /央视新闻（站点 id cctv/)
  assert.match(s.text, /已订 2 条，在报刊《CCTV 新闻》里/)
  assert.match(s.text, /- 专题：\/cctv\/:category/)
  assert.match(s.text, /新闻=news、国际=world、科技=tech/)
  assert.match(s.text, /栏目：\/cctv\/lm\/:id\?【用不了（要浏览器）】/)
  const b = await call(readLink, 'find_sources', { urls: ['/cctv/world', '/cctv/news'] })
  assert.match(b.text, /体检了 2 条/)
  assert.match(b.text, /【已订阅：#102/)
  assert.match(b.text, /最近标题：国际新闻 1/)
})

test('报刊：退订一栏，只剩一栏时源名回到刊名', async () => {
  await call(manageLink, 'unsubscribe', { feed_id: 102, confirm: true })
  assert.equal(state.feeds.find((f) => f.id === 103).title, 'CCTV 新闻')
  assert.equal(meta0().feeds['102'], undefined)
  assert.equal(meta0().feeds['103'].paper, 'cctv')
})

test('排障：AI 判定、只忽略某种报错、藏起来的照样列出、撤销', async () => {
  const miss = await call(manageLink, 'triage_source', { feed_id: 3, verdict: '只是偶尔超时', ignore: { kind: 'error', match: 'Client.Timeout' } })
  assert.match(miss.text, /忽略「报错」（只忽略报错原文里含「Client.Timeout」的），到 /)
  let h = await call(readLink, 'source_health')
  assert.match(h.text, /#3 .*抓取连续出错 3 次/)            // 503 不含 Client.Timeout，照样报
  await call(manageLink, 'triage_source', { feed_id: 3, verdict: '对方服务器常年 503 一阵就好', ignore: { kind: 'error', match: '503', days: 999 } })
  const rule = meta0().feeds['3'].ignore.error
  assert.equal(rule.match, '503')
  assert.ok(Date.parse(rule.until) - Date.now() < 181 * 864e5)   // 最多 180 天
  h = await call(readLink, 'source_health')
  assert.doesNotMatch(h.text.split('藏起来的')[0], /#3 .*抓取连续出错|status 503/)
  assert.match(h.text, /藏起来的[\s\S]*#3 .*抓取连续出错 3 次（AI 判定忽略：对方服务器常年 503 一阵就好）/)
  const one = await call(readLink, 'source_health', { feed_id: 3 })
  assert.match(one.text, /忽略规则：忽略「报错」/)
  assert.match(meta0().feeds['3'].notes[0].what, /^AI 助手：判定：对方服务器常年 503/)
  const bad = await call(manageLink, 'triage_source', { feed_id: 3, verdict: 'x', ignore: { kind: 'stale', match: 'y' } })
  assert.ok(bad.error)
  await call(manageLink, 'triage_source', { feed_id: 3, verdict: '对方修好了', unignore: 'error' })
  assert.equal(meta0().feeds['3'].ignore, undefined)
})

test('源医生：点了「它没事」的也列出来；带朗读音频的长文不算播客', async () => {
  const m = meta0(); m.feeds['3'] = { ...m.feeds['3'], fine: { error: new Date().toISOString() } }
  state.stylesheet = state.stylesheet.replace(/\/\* mediarium-meta:.*:mediarium-meta \*\//s, `/* mediarium-meta:${JSON.stringify(m)}:mediarium-meta */`)
  const h = await call(readLink, 'source_health')
  assert.match(h.text, /#3 .*抓取连续出错 3 次（用户 .* 点了「它没事」，6 小时内不提）/)
  const long = '<p>' + '长'.repeat(3000) + '</p>'
  for (const i of [1, 2, 3]) state.entries.push({ id: 900 + i, feed_id: 1, title: '长文 ' + i, url: 'https://m.thepaper.cn/' + i, published_at: day(i), status: 'read', starred: false, content: long, enclosures: [{ mime_type: 'audio/mpeg' }] })
  const one = await call(readLink, 'source_health', { feed_id: 1 })
  assert.doesNotMatch(one.text, /视频\/播客源/)
  assert.match(one.text, /平均 3000 字/)
})

test('退订：先试算不删，确认了才删', async () => {
  const before = state.deleted.length
  const dry = await call(manageLink, 'unsubscribe', { feed_id: 2 })
  assert.match(dry.text, /试算.*2 篇文章，其中收藏 1 篇/)
  assert.match(dry.text, /★ A Man from the Future/)
  assert.equal(state.deleted.length, before)
  const done = await call(manageLink, 'unsubscribe', { feed_id: 2, confirm: true })
  assert.match(done.text, /已退订 #2/)
  assert.equal(state.deleted.at(-1), 2)
  assert.equal(parseMeta(state.stylesheet).feeds['2'], undefined)
})

test('作废链接：Miniflux 那把密钥一起作废，链接认不出了', async () => {
  const id = (await links.listLinks(1)).find((l) => l.scope === 'read').id
  assert.equal(await links.revokeLink(2, id), false)   // 别人作废不了
  assert.equal(await links.revokeLink(1, id), true)
  assert.equal(state.keys.has(readLink.key), false)
  const r = await call(readLink, 'list_subscriptions')
  assert.ok(r.error && /作废/.test(r.text))
})

test('Markdown：列表、引用、链接、表格、分节', () => {
  const md = htmlToMarkdown('<blockquote><p>quote <i>it</i></p></blockquote><ul><li>a</li><li><a href="/x">b</a></li></ul><table><tr><th>k</th><th>v</th></tr><tr><td>1</td><td>2</td></tr></table><script>bad()</script>', { base: 'https://e.com/p' })
  assert.match(md, /^> quote \*it\*/)
  assert.match(md, /- a\n- \[b\]\(https:\/\/e\.com\/x\)/)
  assert.match(md, /\| k \| v \|\n\| --- \| --- \|\n\| 1 \| 2 \|/)
  assert.doesNotMatch(md, /bad/)
  const long = Array.from({ length: 5 }, (_, i) => `## 第${i + 1}部分\n\n` + 'y'.repeat(5000)).join('\n\n')
  const parts = sections(long)
  assert.equal(parts.length, 5)
  assert.equal(parts[2].title, '第3部分')
})

test('归刊规则：视频、播客、社媒账号一个一本；同站不同类别的没记过的不并', async () => {
  const { buildPapers } = await import('../src/papers.js')
  const cat = (id) => ({ id, title: 'c' + id })
  const feeds = [
    { id: 1, title: '澎湃新闻 - 思想市场', feed_url: 'https://rsshub.app/thepaper/list/1', category: cat(1) },
    { id: 2, title: '澎湃新闻 - 有数', feed_url: 'https://rsshub.app/thepaper/list/2', category: cat(1) },
    { id: 3, title: '澎湃新闻 - 美数课', feed_url: 'https://rsshub.app/thepaper/list/3', category: cat(2) },
    { id: 4, title: 'BANTAN TV', feed_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=a', site_url: 'https://www.youtube.com/channel/a', category: cat(1) },
    { id: 5, title: 'Veritasium', feed_url: 'https://www.youtube.com/feeds/videos.xml?channel_id=b', site_url: 'https://www.youtube.com/channel/b', category: cat(1) },
    { id: 6, title: '小宇宙 · 别的电波', feed_url: 'https://rsshub.app/xiaoyuzhou/podcast/1', category: cat(1) },
    { id: 7, title: '小宇宙 · 忽左忽右', feed_url: 'https://rsshub.app/xiaoyuzhou/podcast/2', category: cat(1) },
  ]
  const m = { feeds: { 6: { paper: 'xiaoyuzhou' }, 7: { paper: 'xiaoyuzhou' } }, papers: { xiaoyuzhou: { name: '小宇宙' } }, categories: {} }
  const ps = buildPapers(feeds, [cat(1), cat(2)], m)
  const names = ps.map((p) => `${p.name}:${p.feeds.map((f) => f.id).join(',')}`)
  assert.ok(names.includes('澎湃新闻:1,2'))           // 栏目按名字（拼音）排：思想市场、有数
  assert.ok(names.includes('澎湃新闻 - 美数课:3'))     // 别的类别里的，没记过，不并
  assert.ok(names.includes('BANTAN TV:4') && names.includes('Veritasium:5'))
  assert.ok(names.includes('别的电波:6') && names.includes('忽左忽右:7'))
  assert.equal(ps.find((p) => p.feeds.length === 2).columns.get(2), '有数')
})

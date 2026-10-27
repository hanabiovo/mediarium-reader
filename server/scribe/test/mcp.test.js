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
}
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(obj === undefined ? '' : JSON.stringify(obj)) }
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
    if (p === '/feeds' && m === 'POST') { const id = 100 + state.created.length; state.created.push({ id, ...body }); state.feeds.push({ id, title: body.feed_url, feed_url: body.feed_url, category: state.cats.find((c) => c.id === body.category_id), parsing_error_count: 0 }); return send(201, { feed_id: id }) }
    if ((mm = p.match(/^\/feeds\/(\d+)$/))) {
      if (m === 'GET') return feedOf(mm[1]) ? send(200, feedOf(mm[1])) : send(404, { error_message: 'not found' })
      if (m === 'PUT') { state.puts.push({ id: Number(mm[1]), ...body }); Object.assign(feedOf(mm[1]), body); return send(201, feedOf(mm[1])) }
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
process.env.RSSHUB_URL = 'http://mediarium-rsshub:1200'
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
  assert.match(text, /#2 The New Yorker .*抓取全文、翻译标题/)
  assert.match(text, /#3 旧博客 .*报错×3/)
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
  assert.match(r.text, /✓ #100 Harper's → 长文、翻译标题/)
  assert.match(r.text, /✓ #101 .* → 杂志、抓取全文/)
  assert.match(r.text, /已经订过了（#2/)
  assert.equal(state.created.length, 2)
  assert.match(state.created[0].feed_url, /^https:\/\/reader\.example\.com\/scribe\/feed\?url=http%3A%2F%2Fmediarium-rsshub%3A1200%2Fharpers%2Flatest&s=/)
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

test('退订：先试算不删，确认了才删', async () => {
  const dry = await call(manageLink, 'unsubscribe', { feed_id: 2 })
  assert.match(dry.text, /试算.*2 篇文章，其中收藏 1 篇/)
  assert.match(dry.text, /★ A Man from the Future/)
  assert.equal(state.deleted.length, 0)
  const done = await call(manageLink, 'unsubscribe', { feed_id: 2, confirm: true })
  assert.match(done.text, /已退订 #2/)
  assert.deepEqual(state.deleted, [2])
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

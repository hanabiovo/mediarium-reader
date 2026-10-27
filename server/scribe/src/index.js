// 灵媒 · 誊写服务（mediarium-scribe，阶段 5b，2026-10-21）
//   GET /feed?url=原订阅地址        替 Miniflux 先读原始的源，誊好再交给它（BBC 补原文链接、公众号认小标题 / 加粗 / 图注）。
//                                   只给同一个 docker 网络里的 Miniflux 用；经 Nginx 从外面来的请求一律不认（除非带对 FEED_KEY）。
//   GET /img?u=图片地址              给灵媒中转图片：导出 md / epub 时把图打包进去、高对比深色下读像素认白底图。
//                                   必须带灵媒的登录密钥（X-Auth-Token），拿去问 Miniflux 是不是有效账号。
//   GET /doctor/check?url=订阅地址[&via=proxy]  源医生体检（5b-3；via=proxy 绕道去取，0.8）：从服务器这边取一次，量出能不能用、全文还是摘要、多久更新。要登录密钥
//   /translate/…                     翻译（阶段 4）：config 各账号设置、preset 预设、models 拉模型列表、
//                                    POST /translate 一批短文本、POST /translate/stream 正文（流式）。都要登录密钥
//   /admin/invites                   管理员：邀请列表、生成、作废（5d）
//   /invite/check、/invite/accept    公开：朋友拿邀请链接查码、自己注册（5d，见 invites.js）
//   GET /hub/info、/hub/search?q=、/hub/site?id=（或 ?route=）、/hub/match?url=   本站 RSSHub（「灵媒自建」）的开关与路由目录（阶段 6，见 hub.js）。要登录密钥
//   GET /hub/wrap?url=灵媒自建上的地址   给 Miniflux 订的地址：/scribe/feed?url=…&s=签名（0.7，见 feed 一节）。要登录密钥
//   GET /health                     活着没
// 安全护栏见 guard.js：只取 http(s)、不碰内网地址、有超时和大小上限。
import http from 'node:http'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir, stat, unlink, utimes } from 'node:fs/promises'
import path from 'node:path'
import { Blocked, proxyOn, safeFetch } from './guard.js'
import { transformFeed } from './rules.js'
import { checkFeed } from './doctor.js'
import { pruneTr, translateBatch, translateStream } from './translate.js'
import { builtinView, canStore, keyOf, loadBuiltin, loadUser, poolView, presetOf, publicView, saveBuiltin, saveUser } from './store.js'
import { CHUNK, ChannelError, builtinOn, listModels, setBuiltin } from './channels.js'
import { HUB, HUB_CONFIGURED, getIndex, hubOn, matchUrl, nestedIds, searchSites, siteDetail, siteOfPath } from './hub.js'
import { onHub, sigOk, signFeed } from './sign.js'
import { acceptInvite, checkInvite, createInvite, inviteOn, listInvites, revokeInvite, tooMany } from './invites.js'

const PORT = Number(process.env.PORT || 8011)
const MINIFLUX = (process.env.MINIFLUX_URL || 'http://mediarium-miniflux:8080').replace(/\/$/, '')
const FEED_KEY = process.env.FEED_KEY || ''            // 只有 Miniflux 走不了内网时才用：订阅地址里带 &k=
const CACHE_DIR = process.env.CACHE_DIR || '/data/img'
const CACHE_MAX = Number(process.env.CACHE_MAX_MB || 1024) * 1024 * 1024
const UA = 'Mozilla/5.0 (compatible; Miniflux; +https://miniflux.app) mediarium-scribe/0.2.1'

const log = (...a) => console.log(new Date().toISOString(), ...a)
const send = (res, status, body, headers = {}) => { res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', ...headers }); res.end(body) }
const same = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b))
const fromOutside = (req) => !!(req.headers['x-forwarded-for'] || req.headers['x-real-ip'])

// ——— 登录密钥：问 Miniflux，结果记 5 分钟 ———
// Miniflux 设了带路径的 BASE_URL（…/miniflux/）时，接口在 /miniflux/v1 下，不在 /v1 下（2026-10-22：0.1 只问 /v1，回 404 全当成没登录）。
// 两个都试，记住问得通的那个；只有 Miniflux 明确说「有效 / 无效」才记结果，问不通不记。
const API_PATHS = [process.env.MINIFLUX_API_PATH, '/v1', '/miniflux/v1'].filter(Boolean)
let apiPath = null
const tokens = new Map()
async function askMe(token) {
  for (const p of apiPath ? [apiPath] : API_PATHS) {
    try {
      const r = await fetch(`${MINIFLUX}${p}/me`, { headers: { 'X-Auth-Token': token }, signal: AbortSignal.timeout(5000) })
      if (r.ok) { apiPath = p; const me = await r.json().catch(() => ({})); return { id: Number(me.id), username: String(me.username ?? ''), admin: !!me.is_admin } }
      if (r.status === 401 || r.status === 403) { apiPath = p; return false }
      log('miniflux /me', p, r.status)
    } catch (e) { log('miniflux /me', p, e?.message) }
  }
  return null   // 问不通
}
// 返回登录的是谁（{ id, username }），无效返回 false
async function validToken(token) {
  if (!token || token.length > 200) return false
  const key = createHash('sha256').update(token).digest('hex')
  const hit = tokens.get(key)
  if (hit && hit.until > Date.now()) return hit.ok
  const ok = await askMe(token)
  if (ok === null) return false
  tokens.set(key, { ok, until: Date.now() + 5 * 60 * 1000 })
  if (tokens.size > 200) tokens.delete(tokens.keys().next().value)
  return ok
}

// ——— /feed ———
// 从外面（经 Nginx）来的，两种放行：
//   · k=FEED_KEY：Hana 手配的那几个（BBC、公众号）；
//   · s=签名：灵媒自建上的源（0.7，2026-10-24）。Miniflux 不肯订内网地址，又不改它的内网设置（Hana 定），所以经这里转一道。
//     签名只对这一个地址有效、只签灵媒自建上的地址：订阅地址就算被看到，也只能拿来取这一个源，不能当跳板。密钥本身不出服务器
const SIGN_KEY = FEED_KEY || process.env.SCRIBE_SECRET || ''
async function feed(req, res, q) {
  const url = q.get('url')
  const keyOk = FEED_KEY && same(q.get('k') ?? '', FEED_KEY)
  const signed = sigOk(SIGN_KEY, HUB, url, q.get('s'))
  if (fromOutside(req) && !keyOk && !signed) return send(res, 403, 'internal only')
  if (!url) return send(res, 400, 'url?')
  const r = await safeFetch(url, { headers: { 'user-agent': UA, accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } })
  const type = r.headers.get('content-type') || 'application/xml'
  if (r.status !== 200) return send(res, 502, `upstream ${r.status}`)
  let body = r.body.toString('utf8')
  try { body = transformFeed(body, url) } catch (e) { log('transform failed, passing through', url, e.message) }
  send(res, 200, body, { 'content-type': /xml|rss|atom/i.test(type) ? type : 'application/xml; charset=utf-8', 'cache-control': 'no-store' })
}

// ——— /img：磁盘缓存，总量有上限 ———
async function img(req, res, q) {
  if (!(await validToken(String(req.headers['x-auth-token'] || '')))) return send(res, 401, 'login?')
  const u = q.get('u')
  if (!u) return send(res, 400, 'u?')
  const key = createHash('sha256').update(u).digest('hex')
  const file = path.join(CACHE_DIR, key)
  try {
    const [body, meta] = await Promise.all([readFile(file), readFile(file + '.type', 'utf8')])
    utimes(file, new Date(), new Date()).catch(() => {})
    return send(res, 200, body, { 'content-type': meta, 'cache-control': 'private, max-age=604800' })
  } catch { /* 没缓存，去取 */ }
  const r = await safeFetch(u, { maxBytes: 15 * 1024 * 1024, headers: { 'user-agent': UA, accept: 'image/*' } })
  const type = r.headers.get('content-type') || ''
  if (r.status !== 200 || !/^image\//i.test(type)) return send(res, 502, `not an image (${r.status})`)
  await mkdir(CACHE_DIR, { recursive: true })
  await Promise.all([writeFile(file, r.body), writeFile(file + '.type', type)]).catch((e) => log('cache write failed', e.message))
  send(res, 200, r.body, { 'content-type': type, 'cache-control': 'private, max-age=604800' })
}

// ——— /doctor/check：同时最多跑 6 个体检，免得被一页候选拖垮 ———
let checking = 0
async function doctor(req, res, q) {
  if (!(await validToken(String(req.headers['x-auth-token'] || '')))) return send(res, 401, 'login?')
  const url = q.get('url')
  if (!url) return send(res, 400, 'url?')
  if (checking >= 6) return send(res, 429, 'busy')
  checking++
  try {
    // via=proxy：绕道去取（只有配了 FETCH_PROXY 才行），用来判断「换条路取」有没有用
    const via = q.get('via') === 'proxy' ? 'proxy' : undefined
    if (via && !proxyOn()) return send(res, 404, 'no proxy')
    const out = await checkFeed(url, { via })
    send(res, 200, JSON.stringify(out), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  } finally { checking-- }
}

// ——— 翻译 ———
async function readJson(req, max = 256 * 1024) {
  const chunks = []
  let size = 0
  for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('太大了'), { status: 413 }); chunks.push(c) }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') } catch { throw Object.assign(new Error('不是 JSON'), { status: 400 }) }
}
const json = (res, status, obj) => send(res, status, JSON.stringify(obj), { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })

const NAME_MAX = 24
async function trView(u, user) {
  const b = await loadBuiltin()
  return {
    ...publicView(u), admin: user.admin, chunk: CHUNK,
    builtin: builtinOn() ? await poolView(user) : null,
    // 内置机翻的密钥只有管理员（Hana）看得到设没设、能改
    ...(user.admin ? { builtinKeys: builtinView(b) } : {}),
  }
}

// GET / PUT /translate/config：{ mode, mt, ai, titleAi, deepl: 密钥 | null, builtinKeys: { volcAk, volcSk }（只管理员） }
async function trConfig(req, res, user) {
  const u = await loadUser(user.id)
  if (req.method === 'GET') return json(res, 200, await trView(u, user))
  if (!canStore()) return json(res, 503, { error: '服务器还没配主密钥，存不了' })
  const b = await readJson(req, 16 * 1024)
  if (b.mode === 'mt' || b.mode === 'ai') u.mode = b.mode
  if (b.mt === 'volcano' || b.mt === 'deepl') u.mt = b.mt
  if (typeof b.ai === 'string' && presetOf(u, b.ai)) u.ai = b.ai
  if (typeof b.titleAi === 'boolean') u.titleAi = b.titleAi
  if (b.deepl === null) delete u.keys.deepl
  else if (typeof b.deepl === 'string' && b.deepl.trim()) u.keys.deepl = b.deepl.trim().slice(0, 200)
  if (user.admin && b.builtinKeys) {
    const cur = await loadBuiltin()
    for (const k of ['volcAk', 'volcSk']) {
      const v = b.builtinKeys[k]
      if (v === null) cur[k] = ''
      else if (typeof v === 'string' && v.trim()) cur[k] = v.trim().slice(0, 200)
    }
    await saveBuiltin(cur); setBuiltin(cur)
  }
  await saveUser(user.id, u)
  json(res, 200, await trView(u, user))
}

// POST /translate/preset：新建 / 修改一套预设 { id?, name, base, model, thinking, key: 密钥 | null }；DELETE ?id= 删自定义预设
async function trPreset(req, res, user, q) {
  if (!canStore()) return json(res, 503, { error: '服务器还没配主密钥，存不了' })
  const u = await loadUser(user.id)
  if (req.method === 'DELETE') {
    const id = q.get('id') ?? ''
    const p = presetOf(u, id)
    if (!p || p.kind !== 'custom') return json(res, 400, { error: '这套预设删不了' })
    u.presets = u.presets.filter((x) => x.id !== id); delete u.keys['p:' + id]
    if (u.ai === id) u.ai = 'deepseek'
    await saveUser(user.id, u)
    return json(res, 200, await trView(u, user))
  }
  const b = await readJson(req, 16 * 1024)
  let p = b.id ? presetOf(u, b.id) : null
  if (b.id && !p) return json(res, 404, { error: '没有这套预设' })
  if (!p) {
    if (u.presets.filter((x) => x.kind === 'custom').length >= 12) return json(res, 400, { error: '自定义预设最多 12 套' })
    p = { id: 'c' + randomBytes(4).toString('hex'), name: '', kind: 'custom', base: '', model: '', thinking: false }
    u.presets.push(p)
  }
  const str = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : undefined)
  if (p.kind === 'custom') {
    if (str(b.name, NAME_MAX) !== undefined) p.name = str(b.name, NAME_MAX) || '自定义'
    if (str(b.base, 300) !== undefined) p.base = str(b.base, 300)
    if (str(b.model, 200) !== undefined) p.model = str(b.model, 200)
  }
  if (p.kind === 'qwen' && str(b.base, 300) !== undefined) p.base = str(b.base, 300)
  if (p.kind === 'siliconflow' && str(b.model, 200) !== undefined) p.model = str(b.model, 200)
  if (p.kind === 'deepseek' && typeof b.thinking === 'boolean') p.thinking = b.thinking
  if (p.base && !/^https:\/\//i.test(p.base)) return json(res, 400, { error: '接口地址要以 https:// 开头' })
  if (b.key === null) delete u.keys['p:' + p.id]
  else if (str(b.key, 300)) u.keys['p:' + p.id] = str(b.key, 300)
  await saveUser(user.id, u)
  json(res, 200, { ...(await trView(u, user)), saved: p.id })
}

// POST /translate/models：拉模型列表 { id }（用存好的预设）或 { base, key }（还没存的）
async function trModels(req, res, user) {
  const b = await readJson(req, 16 * 1024)
  const u = await loadUser(user.id)
  const p = b.id ? presetOf(u, b.id) : null
  const base = (typeof b.base === 'string' && b.base.trim()) || p?.base || ''
  const key = (typeof b.key === 'string' && b.key.trim()) || (p ? keyOf(u, p.id) : '')
  if (!base || !key) return json(res, 400, { error: '先填接口地址和密钥' })
  try { json(res, 200, { models: await listModels(base, key) }) }
  catch (e) { json(res, 502, { error: e instanceof ChannelError ? e.toJSON() : { explain: String(e.message) } }) }
}

// POST /translate：一批短文本 { texts, kind: 'title' | 'selection' | 'para', via?: 'mt' | 'ai' }
async function trBatch(req, res, user) {
  const b = await readJson(req)
  if (!Array.isArray(b.texts) || !b.texts.length) return json(res, 400, { error: 'texts?' })
  const kind = ['title', 'selection', 'para'].includes(b.kind) ? b.kind : 'para'
  const via = b.via === 'mt' || b.via === 'ai' ? b.via : undefined
  try { json(res, 200, await translateBatch(user, b.texts, kind, via)) }
  catch (e) { json(res, 502, { error: e instanceof ChannelError ? e.toJSON() : { explain: String(e.message) } }) }
}

// POST /translate/stream：正文 { paras, title?, via?: 'mt' | 'ai' | 'mt:deepl' | 'ai:<预设 id>', fresh?: 强制重译 } → 一行一个 JSON（text/event-stream）
async function trStream(req, res, user) {
  const b = await readJson(req, 512 * 1024)
  if (!Array.isArray(b.paras)) return json(res, 400, { error: 'paras?' })
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
  const emit = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`)
  // 心跳：模型先思考、或者中转很慢时，可能几十秒一个字都不回；中间的代理（Nginx 等）空等太久会把连接掐断。
  // 每 15 秒发一行注释，浏览器那边会忽略（2026-10-22：Hana 用中转的 GLM-5 段落翻译，「连接中途断了」）
  const beat = setInterval(() => res.write(': ping\n\n'), 15000)
  res.on('close', () => clearInterval(beat))
  const via = typeof b.via === 'string' && /^(mt|ai)(:[\w-]{1,40})?$/.test(b.via) ? b.via : undefined
  try {
    const r = await translateStream(user, { paras: b.paras, title: typeof b.title === 'string' ? b.title : '', fresh: b.fresh === true }, via, emit)
    emit({ done: true, missing: r.missing })
  } catch (e) {
    emit({ error: e instanceof ChannelError ? e.toJSON() : { explain: String(e.message) }, missing: e.missing ?? null })
  }
  clearInterval(beat)
  res.end()
}

// ——— 邀请（5d）———
// 管理员：GET 列表 / POST { note } 生成（回一次码）/ DELETE ?id= 作废
async function adminInvites(req, res, user, q) {
  if (!user.admin) return json(res, 403, { error: '只有管理员能用' })
  if (req.method === 'GET') return json(res, 200, { on: inviteOn(), invites: await listInvites() })
  try {
    if (req.method === 'POST') { const b = await readJson(req, 4 * 1024); return json(res, 200, { invite: await createInvite(b.note) }) }
    if (req.method === 'DELETE') { await revokeInvite(q.get('id') ?? ''); return json(res, 200, { invites: await listInvites() }) }
  } catch (e) { return json(res, e.status ?? 500, { error: e.message }) }
  send(res, 405, 'method?')
}
// 公开：POST /invite/check { code } → { ok }；POST /invite/accept { code, username, password } → { ok, username }
// 码放在请求体里不放网址里，免得进访问日志
async function invite(req, res, route) {
  const ip = String(req.headers['x-real-ip'] || req.socket.remoteAddress || '')
  if (req.method !== 'POST') return send(res, 405, 'POST only')
  if (tooMany(ip)) return json(res, 429, { error: '试得太频繁了，过一会儿再来' })
  const b = await readJson(req, 4 * 1024)
  if (route === '/invite/check') return json(res, 200, { ok: await checkInvite(b.code) })
  if (route === '/invite/accept') {
    if (!apiPath) await askMe('x')   // 还没问过 Miniflux 接口在哪条路径下
    try { return json(res, 200, await acceptInvite(b.code, b.username, b.password, { miniflux: MINIFLUX, apiPath: apiPath ?? '/v1' })) }
    catch (e) { return json(res, e.status ?? 502, { error: e.message }) }
  }
  send(res, 404, 'not found')
}

// ——— 本站 RSSHub（阶段 6）———
async function hub(req, res, route, q) {
  try {
    if (route === '/hub/info') {
      if (!hubOn()) return json(res, 200, { on: false })
      const idx = await getIndex().catch(() => null)
      return json(res, 200, { on: true, base: HUB, wrap: !!SIGN_KEY, nested: nestedIds(idx), configured: HUB_CONFIGURED })
    }
    if (route === '/hub/search') return json(res, 200, { sites: searchSites(await getIndex(), q.get('q')) })
    if (route === '/hub/match') return json(res, 200, { routes: matchUrl(await getIndex(), q.get('url') ?? '') })
    if (route === '/hub/site') {
      const idx = await getIndex().catch(() => null)
      const id = q.get('route') ? siteOfPath(idx, q.get('route')) : q.get('id') ?? ''
      return json(res, 200, await siteDetail(id, idx))
    }
    if (route === '/hub/wrap') {
      const url = q.get('url') ?? ''
      if (!onHub(HUB, url) || url.length > 2000) return json(res, 400, { error: '不是灵媒自建上的地址' })
      if (!SIGN_KEY) return json(res, 503, { error: '灵媒自建暂时订不了' })
      return json(res, 200, { path: `/scribe/feed?url=${encodeURIComponent(url)}&s=${signFeed(SIGN_KEY, url)}` })
    }
    send(res, 404, 'not found')
  } catch (e) { log('hub', route, e?.message); json(res, e.status ?? 502, { error: e.status === 400 || e.status === 404 ? e.message : 'RSSHub 没回话，稍后再试' }) }
}

// 每小时清一次缓存：超过上限就从最久没用的删起
async function prune() {
  try {
    const names = (await readdir(CACHE_DIR)).filter((n) => !n.endsWith('.type'))
    const files = await Promise.all(names.map(async (n) => ({ n, s: await stat(path.join(CACHE_DIR, n)) })))
    let total = files.reduce((a, f) => a + f.s.size, 0)
    files.sort((a, b) => a.s.mtimeMs - b.s.mtimeMs)
    for (const f of files) {
      if (total <= CACHE_MAX) break
      await unlink(path.join(CACHE_DIR, f.n)).catch(() => {})
      await unlink(path.join(CACHE_DIR, f.n + '.type')).catch(() => {})
      total -= f.s.size
    }
  } catch { /* 目录还没建 */ }
}
setInterval(prune, 60 * 60 * 1000).unref()
setInterval(pruneTr, 24 * 60 * 60 * 1000).unref()

loadBuiltin().then(setBuiltin).catch(() => {})

http.createServer(async (req, res) => {
  const u = new URL(req.url || '/', 'http://x')
  const route = u.pathname.replace(/^\/scribe/, '')   // 经 Nginx 的 /scribe/ 前缀进来时也认
  try {
    if (route.startsWith('/translate')) {
      const user = await validToken(String(req.headers['x-auth-token'] || ''))
      if (!user) return send(res, 401, 'login?')
      const m = req.method
      if (route === '/translate' && m === 'POST') return await trBatch(req, res, user)
      if (route === '/translate/stream' && m === 'POST') return await trStream(req, res, user)
      if (route === '/translate/config' && (m === 'GET' || m === 'PUT')) return await trConfig(req, res, user)
      if (route === '/translate/preset' && (m === 'POST' || m === 'DELETE')) return await trPreset(req, res, user, u.searchParams)
      if (route === '/translate/models' && m === 'POST') return await trModels(req, res, user)
      return send(res, 405, 'method?')
    }
    if (route.startsWith('/admin/')) {
      const user = await validToken(String(req.headers['x-auth-token'] || ''))
      if (!user) return send(res, 401, 'login?')
      if (route === '/admin/invites') return await adminInvites(req, res, user, u.searchParams)
      return send(res, 404, 'not found')
    }
    if (route === '/invite/check' || route === '/invite/accept') return await invite(req, res, route)
    if (req.method !== 'GET') return send(res, 405, 'GET only')
    if (route === '/health') return send(res, 200, 'ok')
    // 自查：能不能问通 Miniflux（不带密钥问 /me，应得 401；不露任何信息）
    if (route === '/health/miniflux') { const r = await askMe('x'); return send(res, r === null ? 502 : 200, r === null ? 'miniflux unreachable' : `ok ${apiPath}`) }
    if (route === '/feed') return await feed(req, res, u.searchParams)
    if (route === '/img') return await img(req, res, u.searchParams)
    if (route === '/doctor/check') return await doctor(req, res, u.searchParams)
    if (route.startsWith('/hub/')) {
      if (!(await validToken(String(req.headers['x-auth-token'] || '')))) return send(res, 401, 'login?')
      return await hub(req, res, route, u.searchParams)
    }
    send(res, 404, 'not found')
  } catch (e) {
    if (e instanceof Blocked) return send(res, 400, e.message)
    if (e?.status) return send(res, e.status, e.message)
    log('error', route, e?.message)
    send(res, 502, 'upstream failed')
  }
}).listen(PORT, () => log(`scribe on :${PORT}, miniflux ${MINIFLUX}`))

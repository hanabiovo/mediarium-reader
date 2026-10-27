import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'scribe-'))
process.env.SCRIBE_SECRET = 'test-secret'
const { loadUser, saveUser, publicView } = await import('../src/store.js')
const { makeParser, setBuiltin, volcSign } = await import('../src/channels.js')
const { translateBatch, translateStream, isChinese } = await import('../src/translate.js')

// 假装是 OpenAI 兼容的流式接口
function sse(chunks, status = 200) {
  const enc = new TextEncoder()
  const body = new ReadableStream({ start(c) { for (const ch of chunks) c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: ch } }] })}\n\n`)); c.enqueue(enc.encode('data: [DONE]\n\n')); c.close() } })
  return new Response(body, { status, headers: { 'content-type': 'text/event-stream' } })
}
let calls = []
globalThis.fetch = async (url, init) => { calls.push({ url: String(url), body: init?.body ? JSON.parse(init.body) : null }); return next(url, init) }
let next = () => { throw new Error('没设') }

test('解析：编号段落逐段交出，剥掉 <think>', () => {
  const got = []
  const p = makeParser((k, t) => got.push([k, t]))
  p.push('<think>先想想</think>【T】标题')
  p.push('译\n\n【1】第一')
  assert.deepEqual(got, [['T', '标题译']])
  p.push('段\n\n【2】第二段')
  p.end()
  assert.deepEqual(got, [['T', '标题译'], ['1', '第一段'], ['2', '第二段']])
})

test('密钥加密存盘，给浏览器只有末四位', async () => {
  const u = await loadUser(1)
  u.keys['p:deepseek'] = 'sk-abcdef123456'
  u.mode = 'ai'
  await saveUser(1, u)
  const raw = readFileSync(path.join(process.env.DATA_DIR, 'users', '1.json'), 'utf8')
  assert.ok(!raw.includes('sk-abcdef123456'))
  assert.equal(publicView(u).presets.find((p) => p.id === 'deepseek').key, '····3456')
})

test('正文：一次请求、逐段到达、思考显式关、缓存命中不再发', async () => {
  calls = []
  next = () => sse(['【T】标题译\n\n【1】第一', '段译文\n\n【2】第二段译文'])
  const ev = []
  const r = await translateStream({ id: 1, username: 'h' }, { paras: ['First para.', 'Second para.'], title: 'A Title' }, undefined, (e) => ev.push(e))
  assert.equal(calls.length, 1)
  assert.deepEqual(calls[0].body.thinking, { type: 'disabled' })
  assert.deepEqual(r.missing, [])
  assert.ok(ev.some((e) => e.title === '标题译'))
  assert.ok(ev.some((e) => e.i === 1 && e.t === '第二段译文'))
  calls = []
  await translateStream({ id: 1, username: 'h' }, { paras: ['First para.', 'Second para.'], title: 'A Title' }, undefined, () => {})
  assert.equal(calls.length, 0)
})

test('正文：中途只回了一段，报出没翻成的，重试只补那一段', async () => {
  next = () => sse(['【1】甲译文\n\n'])
  const r = await translateStream({ id: 1, username: 'h' }, { paras: ['Alpha text.', 'Beta text.'] }, undefined, () => {})
  assert.deepEqual(r.missing, [1])
  calls = []
  next = () => sse(['【2】乙译文'])
  await translateStream({ id: 1, username: 'h' }, { paras: ['Alpha text.', 'Beta text.'] }, undefined, () => {})
  assert.equal(calls.length, 1)
  assert.match(calls[0].body.messages[1].content, /Beta/)
  assert.doesNotMatch(calls[0].body.messages[1].content, /Alpha/)
})

test('报错：DeepSeek 402 给出人话，保留状态码和原话', async () => {
  next = () => new Response(JSON.stringify({ error: { message: 'Insufficient Balance', type: 'unknown_error' } }), { status: 402 })
  const ev = []
  await assert.rejects(() => translateStream({ id: 1, username: 'h' }, { paras: ['Gamma text.'] }, undefined, (e) => ev.push(e)), (e) => {
    assert.equal(e.status, 402); assert.equal(e.raw, 'Insufficient Balance'); assert.match(e.explain, /余额不足/); return true
  })
})

test('火山签名：和官方文档的示例结果一致', () => {
  const auth = volcSign({
    method: 'POST', host: 'billing.volcengineapi.com', query: 'Action=ListBill&Version=2022-01-01', body: '{"Limit":10,"BillPeriod":"2023-08"}',
    ak: 'AKLTYWViMTVmZGYzM2E0NDI5Mzk2MDZjNjFmMjc2MjRjMzg', sk: 'WkRZeE1EQmxPVGhsWWpWak5HVmtNbUUxTXpZeU9UVXlOMlE1TmpZeVlqTQ==',
    region: 'cn-beijing', service: 'billing', xDate: '20250329T180937Z',
  })
  assert.equal(auth, 'HMAC-SHA256 Credential=AKLTYWViMTVmZGYzM2E0NDI5Mzk2MDZjNjFmMjc2MjRjMzg/20250329/cn-beijing/billing/request, SignedHeaders=host;x-date, Signature=5e8480ceea12d0000a23c054151c50dd02c1a7dec835004057d19f13d53a7658')
})

test('机翻：标题默认走内置火山，按全站额度记账；一次不超过 16 条', async () => {
  setBuiltin({ volcAk: 'ak', volcSk: 'sk' })
  calls = []
  next = (url, init) => { const n = JSON.parse(init.body).TextList.length; return new Response(JSON.stringify({ TranslationList: Array.from({ length: n }, (_, i) => ({ Translation: '标题' + i })), ResponseMetadata: { Error: null } }), { status: 200 }) }
  const titles = Array.from({ length: 20 }, (_, i) => 'Title number ' + i)
  const r = await translateBatch({ id: 2, username: 'f' }, titles, 'title', 'mt')
  assert.equal(r.channel, '火山机翻')
  assert.equal(r.out.length, 20)
  assert.equal(calls.length, 2)
  assert.match(calls[0].url, /translate\.volcengineapi\.com\/\?Action=TranslateText&Version=2020-06-01/)
  assert.equal(calls[0].body.TextList.length, 16)
})

test('机翻：火山报错按文档解释', async () => {
  next = () => new Response(JSON.stringify({ ResponseMetadata: { Error: { Code: '-429', Message: 'too many requests' } } }), { status: 200 })
  await assert.rejects(() => translateBatch({ id: 2, username: 'f' }, ['Another title here'], 'title', 'mt'), (e) => { assert.match(e.explain, /太频繁/); return true })
})

test('自定义预设：http 地址不收', async () => {
  const u = await loadUser(3)
  u.presets.push({ id: 'cx', name: '中转', kind: 'custom', base: 'http://example.com/v1', model: 'm', thinking: false })
  u.keys['p:cx'] = 'k'; u.mode = 'ai'; u.ai = 'cx'
  await assert.rejects(() => translateStream({ id: 3, username: 'x' }, { paras: ['Delta text.'] }, undefined, () => {}), /https/)
})

test('重译：指定渠道 ai:<预设>，fresh 跳过缓存、新译文覆盖旧的', async () => {
  next = () => sse(['【1】第一版'])
  await translateStream({ id: 1, username: 'h' }, { paras: ['Retry me.'] }, 'ai:deepseek', () => {})
  calls = []
  const ev = []
  await translateStream({ id: 1, username: 'h' }, { paras: ['Retry me.'] }, 'ai:deepseek', (e) => ev.push(e))
  assert.equal(calls.length, 0, '不 fresh：命中缓存，不发')
  assert.ok(ev.some((e) => e.t === '第一版' && e.cached))
  next = () => sse(['【1】第二版'])
  await translateStream({ id: 1, username: 'h' }, { paras: ['Retry me.'], fresh: true }, 'ai:deepseek', () => {})
  assert.equal(calls.length, 1, 'fresh：重新请求')
  calls = []
  const ev2 = []
  await translateStream({ id: 1, username: 'h' }, { paras: ['Retry me.'] }, 'ai:deepseek', (e) => ev2.push(e))
  assert.equal(calls.length, 0)
  assert.ok(ev2.some((e) => e.t === '第二版'), '缓存里只剩新的一份')
})

test('日文不当成中文：汉字多也要翻（痛いニュース）', () => {
  assert.equal(isChinese('東京都水道局が個人情報保存のハードディスク紛失　1900人あまりの名前や住所などを保存'), false)
  assert.equal(isChinese('水海道二高　女子ハンド部の男性コーチ、部員に威圧的指導か'), false)
  assert.equal(isChinese('정부가 새 정책을 발표했다'), false)
  assert.equal(isChinese('澎湃新闻：今天的天气很好'), true)
  assert.equal(isChinese('Hello world'), false)
})

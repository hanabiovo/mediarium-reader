import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import http from 'node:http'

const dir = mkdtempSync(path.join(tmpdir(), 'scribe-inv-'))
process.env.DATA_DIR = dir
process.env.SCRIBE_ADMIN_KEY = 'fake-admin-key'
const inv = await import('../src/invites.js')

// 假 Miniflux：记下收到的建号请求
const got = []
const srv = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => {
    const body = JSON.parse(b || '{}'); got.push({ path: req.url, key: req.headers['x-auth-token'], body })
    if (body.username === 'taken') { res.writeHead(400, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ error_message: 'This user already exists.' })) }
    res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 9, username: body.username }))
  })
})
await new Promise((ok) => srv.listen(0, '127.0.0.1', ok))
const mf = { miniflux: `http://127.0.0.1:${srv.address().port}`, apiPath: '/v1' }
test.after(() => srv.close())

test('生成 → 查码 → 注册 → 不能再用', async () => {
  const v = await inv.createInvite('小鱼')
  assert.match(v.code, /^[A-Za-z0-9_-]{24}$/)
  assert.equal(v.state, 'open')
  assert.ok(!readFileSync(path.join(dir, 'invites.json'), 'utf8').includes(v.code), '存盘不存明码')
  assert.equal(await inv.checkInvite(v.code), true)
  assert.equal(await inv.checkInvite('x'.repeat(24)), false)
  const r = await inv.acceptInvite(v.code, ' yu ', 'password123', mf)
  assert.deepEqual(r, { ok: true, username: 'yu' })
  const last = got.at(-1)
  assert.equal(last.path, '/v1/users'); assert.equal(last.key, 'fake-admin-key')
  assert.equal(last.body.is_admin, false)
  assert.equal(await inv.checkInvite(v.code), false)
  await assert.rejects(inv.acceptInvite(v.code, 'yu2', 'password123', mf), { status: 410 })
  const l = await inv.listInvites()
  assert.equal(l[0].state, 'used'); assert.equal(l[0].used.username, 'yu'); assert.ok(!('hash' in l[0]) && !('code' in l[0]))
})

test('用户名重复、格式不对、密码太短；失败不作废邀请', async () => {
  const v = await inv.createInvite('')
  await assert.rejects(inv.acceptInvite(v.code, 'taken', 'password123', mf), { status: 409 })
  await assert.rejects(inv.acceptInvite(v.code, 'a b', 'password123', mf), { status: 400 })
  await assert.rejects(inv.acceptInvite(v.code, 'ok', 'short', mf), { status: 400 })
  assert.equal(await inv.checkInvite(v.code), true)
})

test('作废', async () => {
  const v = await inv.createInvite('作废测试')
  await inv.revokeInvite(v.id)
  assert.equal(await inv.checkInvite(v.code), false)
  await assert.rejects(inv.revokeInvite(v.id), { status: 400 })
})

test('限频', () => {
  for (let i = 0; i < 12; i++) assert.equal(inv.tooMany('1.2.3.4'), false)
  assert.equal(inv.tooMany('1.2.3.4'), true)
  assert.equal(inv.tooMany('5.6.7.8'), false)
})

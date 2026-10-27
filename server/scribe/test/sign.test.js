import { test } from 'node:test'
import assert from 'node:assert/strict'
import { onHub, sigOk, signFeed } from '../src/sign.js'

const HUB = 'http://mediarium-rsshub:1200', K = 'fake-key-for-test'
test('签名：只对这一个地址有效', () => {
  const u = HUB + '/thepaper/featured'
  const s = signFeed(K, u)
  assert.equal(s.length, 32)
  assert.ok(sigOk(K, HUB, u, s))
  assert.ok(!sigOk(K, HUB, HUB + '/thepaper/list/25483', s), '换了地址就不认')
  assert.ok(!sigOk('other', HUB, u, s), '换了密钥就不认')
  assert.ok(!sigOk(K, HUB, u, s.slice(1)), '长度不对')
  assert.ok(!sigOk('', HUB, u, signFeed('', u)), '没配密钥一律不认')
})
test('只签灵媒自建上的地址', () => {
  assert.ok(onHub(HUB, HUB + '/a/b'))
  assert.ok(!onHub(HUB, 'http://mediarium-rsshub:12000/a'), '端口不同')
  assert.ok(!onHub(HUB, 'http://mediarium-miniflux:8080/v1/me'))
  assert.ok(!onHub(HUB, HUB + '/../x'))
  assert.ok(!onHub(HUB, HUB + '/a/./b'))
  assert.ok(!sigOk(K, HUB, 'https://example.com/x', signFeed(K, 'https://example.com/x')), '别的地址签了也不认')
})

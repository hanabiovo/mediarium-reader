// 邀请注册（5d，2026-10-22 Hana 定）：Hana 在灵媒「管理」页生成一次性邀请链接发给朋友，朋友自己起用户名、设密码。
// 生成链接 = 审批；Hana 不经手任何人的密码。
//   · Miniflux 只有管理员能建账号（查过官方 API 文档：POST /v1/users「You must be an administrator」），
//     所以服务器 .env 里放一把管理员的 API 密钥 SCRIBE_ADMIN_KEY，只在这个文件里用、只用来建普通账号（is_admin 写死 false）
//   · 邀请码 18 字节随机数（base64url 24 位），存盘只存它的 sha256：数据文件漏了也拿不到能用的码
//   · 一次性；7 天过期；Hana 可以随时作废没用过的
//   · 公开接口（查码、注册）按 IP 限频，Nginx 那边再限一道（见 nginx.invite.conf）
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.env.DATA_DIR || '/data'
const FILE = path.join(ROOT, 'invites.json')
const ADMIN_KEY = process.env.SCRIBE_ADMIN_KEY || ''
const DAYS = 7
const MAX_OPEN = 20                       // 同时最多 20 条没用的邀请
export const inviteOn = () => !!ADMIN_KEY

const sha = (s) => createHash('sha256').update(s).digest('hex')
const sameHex = (a, b) => a.length === b.length && timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'))

let list = null
async function load() {
  if (list) return list
  try { list = JSON.parse(await readFile(FILE, 'utf8')).list ?? [] } catch { list = [] }
  return list
}
async function save() {
  await mkdir(ROOT, { recursive: true })
  const tmp = FILE + '.tmp'
  await writeFile(tmp, JSON.stringify({ list }, null, 1))
  await rename(tmp, FILE)
}
const stateOf = (v, now = Date.now()) => (v.used ? 'used' : v.revoked ? 'revoked' : v.expires < now ? 'expired' : 'open')
const view = (v) => ({ id: v.id, note: v.note, created: v.created, expires: v.expires, state: stateOf(v), used: v.used ?? null })

// 超过 60 天的已用 / 作废 / 过期记录清掉，免得越攒越多
function tidy() {
  const cut = Date.now() - 60 * 864e5
  list = list.filter((v) => stateOf(v) === 'open' || Math.max(v.used?.at ?? 0, v.revoked ?? 0, v.expires) > cut)
}

// ——— 管理员 ———
export async function listInvites() { await load(); return list.map(view).reverse() }

export async function createInvite(note) {
  await load(); tidy()
  if (list.filter((v) => stateOf(v) === 'open').length >= MAX_OPEN) throw Object.assign(new Error(`没用的邀请最多 ${MAX_OPEN} 条，先作废几条`), { status: 400 })
  const code = randomBytes(18).toString('base64url')
  const now = Date.now()
  const v = { id: randomBytes(4).toString('hex'), hash: sha(code), note: String(note ?? '').trim().slice(0, 24), created: now, expires: now + DAYS * 864e5 }
  list.push(v)
  await save()
  return { ...view(v), code }               // 码只在这一次回给浏览器
}

export async function revokeInvite(id) {
  await load()
  const v = list.find((x) => x.id === id)
  if (!v || stateOf(v) !== 'open') throw Object.assign(new Error('这条邀请已经不能作废了'), { status: 400 })
  v.revoked = Date.now()
  await save()
}

// ——— 公开：查码、注册 ———
const CODE_RE = /^[A-Za-z0-9_-]{24}$/
async function find(code) {
  if (!CODE_RE.test(code ?? '')) return null
  await load()
  const h = sha(code)
  return list.find((v) => sameHex(v.hash, h)) ?? null
}
export async function checkInvite(code) {
  const v = await find(code)
  return !!v && stateOf(v) === 'open'
}

// Miniflux 用户名规则文档里没写死；这边自己收紧：2–32 个字母、数字、汉字或 _ . -
export const USER_RE = /^[\p{L}\p{N}_.-]{2,32}$/u
export const PASS_MIN = 8
const busy = new Set()

// 建号：{ ok: true, username } 或抛 { status, message }
export async function acceptInvite(code, username, password, { miniflux, apiPath }) {
  const fail = (status, message) => Object.assign(new Error(message), { status })
  if (!ADMIN_KEY) throw fail(503, '暂时不能注册，找发给你链接的人')
  const v = await find(code)
  if (!v || stateOf(v) !== 'open') throw fail(410, '邀请链接无效或已过期，找发给你的人要一条新的')
  if (typeof username !== 'string' || !USER_RE.test(username.trim())) throw fail(400, '用户名 2–32 位，只能用字母、数字、汉字和 _ . -')
  if (typeof password !== 'string' || password.length < PASS_MIN || password.length > 128) throw fail(400, `密码至少 ${PASS_MIN} 位`)
  if (busy.has(v.id)) throw fail(409, '正在注册，稍等')
  busy.add(v.id)
  try {
    let r
    try {
      r = await fetch(`${miniflux}${apiPath}/users`, {
        method: 'POST',
        headers: { 'X-Auth-Token': ADMIN_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password, is_admin: false }),   // 只建普通账号，写死
        signal: AbortSignal.timeout(10000),
      })
    } catch { throw fail(502, '连不上服务器，稍后再试') }
    if (r.status === 401 || r.status === 403) { console.log(new Date().toISOString(), 'invite: admin key rejected', r.status); throw fail(503, '暂时不能注册，找发给你链接的人') }
    if (!r.ok) {
      let msg = ''
      try { msg = String((await r.json()).error_message ?? '') } catch { /* 无 */ }
      if (/exist/i.test(msg)) throw fail(409, '这个用户名有人用了，换一个')
      console.log(new Date().toISOString(), 'invite: create user failed', r.status, msg)
      throw fail(400, '用户名或密码不符合要求，换一个试试')
    }
    v.used = { at: Date.now(), username: username.trim() }
    await save()
    return { ok: true, username: username.trim() }
  } finally { busy.delete(v.id) }
}

// ——— 公开接口的 IP 限频：每个 IP 15 分钟 12 次 ———
const hits = new Map()
export function tooMany(ip) {
  const now = Date.now(), win = 15 * 60e3
  const arr = (hits.get(ip) ?? []).filter((t) => now - t < win)
  arr.push(now); hits.set(ip, arr)
  if (hits.size > 2000) hits.delete(hits.keys().next().value)
  return arr.length > 12
}

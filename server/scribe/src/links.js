// 接入 AI 助手的专属链接（MCP，2026-10-27 Hana 定）。
//   · 每个账号可以有几条链接，每条一个权限档：read（只读：读文章、看订阅、找源体检、源医生）
//     或 manage（再加上添加、修改、退订订阅）。不管哪档都碰不到别人的账号、删不了文章、改不了账户设置。
//   · 生成时，誊写服务拿这个人的登录密钥请 Miniflux 单开一把 API 密钥（「MCP 连接 · …」），以后 MCP 就用这把、以他的身份办事。
//     这把会出现在灵媒「账户 › 登录过的设备」里：在那里作废，链接也就失效了。
//   · 链接 = https://域名/scribe/mcp/<一串随机字>。存的只是这串字的 sha256；Miniflux 密钥用 SCRIBE_SECRET 加密后存。
//     同 Atmosphere 的做法：Claude 网页版加不了自定义请求头，所以密钥放在路径里，Nginx 那段不记访问日志。
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { canStore, open, seal } from './store.js'
import { mf } from './mfclient.js'

const ROOT = process.env.DATA_DIR || '/data'
const FILE = path.join(ROOT, 'mcp-links.json')
const MAX_PER_USER = 5
export const SCOPES = ['read', 'manage']
export const linksOn = () => canStore()

const hash = (s) => createHash('sha256').update(s).digest('hex')
let links = null   // [{ h, uid, scope, key（加密）, keyId, created, used }]
async function load() {
  if (links) return links
  try { links = JSON.parse(await readFile(FILE, 'utf8')) } catch { links = [] }
  if (!Array.isArray(links)) links = []
  return links
}
// 写盘排队：记「最近使用」的那次不等写完就返回，和生成、作废的写盘碰在一起会抢同一个临时文件
let queue = Promise.resolve()
function save() {
  const run = queue.then(async () => {
    await mkdir(ROOT, { recursive: true })
    const tmp = FILE + '.tmp'
    await writeFile(tmp, JSON.stringify(links, null, 1))
    await rename(tmp, FILE)
  })
  queue = run.catch(() => {})
  return run
}
const view = (l) => ({ id: l.h.slice(0, 12), scope: l.scope, created: l.created, used: l.used ?? null })

export async function listLinks(uid) {
  return (await load()).filter((l) => l.uid === uid).map(view)
}

// userToken：这个人现在的登录密钥（只用来开一把新的 API 密钥，不存）
export async function createLink(uid, userToken, scope) {
  if (!canStore()) throw Object.assign(new Error('服务器没配 SCRIBE_SECRET，开不了链接'), { status: 503 })
  if (!SCOPES.includes(scope)) throw Object.assign(new Error('权限档不对'), { status: 400 })
  await load()
  if (links.filter((l) => l.uid === uid).length >= MAX_PER_USER) throw Object.assign(new Error(`最多 ${MAX_PER_USER} 条，先作废一条旧的`), { status: 409 })
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
  const k = await mf(userToken, '/api-keys', { method: 'POST', body: JSON.stringify({ description: `MCP 连接 · ${scope === 'manage' ? '可管理订阅' : '只读'} · ${stamp}` }) })
  if (!k?.token) throw Object.assign(new Error('Miniflux 没给密钥'), { status: 502 })
  const secret = randomBytes(32).toString('base64url')
  const l = { h: hash(secret), uid, scope, key: seal(k.token), keyId: k.id, created: new Date().toISOString() }
  links.push(l)
  await save()
  return { ...view(l), secret }
}

// 作废：先请 Miniflux 作废那把密钥（用它自己去删自己），再删记录。密钥早就被删了也照样删记录
export async function revokeLink(uid, id) {
  await load()
  const l = links.find((x) => x.uid === uid && x.h.startsWith(String(id)) && String(id).length >= 8)
  if (!l) return false
  try { await mf(open(l.key), `/api-keys/${l.keyId}`, { method: 'DELETE' }) } catch { /* 已经不在了 */ }
  links = links.filter((x) => x !== l)
  await save()
  return true
}

// 路径里的那串字 → { uid, scope, key }；对不上返回 null。顺手记一下最近一次用的时间（一小时内只写一次盘）
export async function resolveLink(secret) {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 128) return null
  await load()
  const h = hash(secret)
  const l = links.find((x) => x.h.length === h.length && timingSafeEqual(Buffer.from(x.h), Buffer.from(h)))
  if (!l) return null
  let key
  try { key = open(l.key) } catch { return null }   // 主密钥换了：这条作废
  const now = Date.now()
  if (!l.used || now - Date.parse(l.used) > 3600e3) { l.used = new Date(now).toISOString(); save().catch(() => {}) }
  return { uid: l.uid, scope: l.scope, key, id: l.h.slice(0, 12) }
}

// 每个开了链接的账号取一把能用的密钥（每日巡诊用；同一个人有几条链接时取最新的）
export async function keysByUser() {
  await load()
  const out = new Map()
  for (const l of links) { try { out.set(l.uid, open(l.key)) } catch { /* 解不开的跳过 */ } }
  return out
}

// 测试用
export function _reset() { links = null }

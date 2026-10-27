// 每个账号自己的翻译设置（阶段 4，2026-10-22）。存在 /data/users/<Miniflux 用户 id>.json，
// 密钥用 AES-256-GCM 加密（主密钥 SCRIBE_SECRET 只在服务器 .env），永远不回给浏览器，只回「末四位」。
//   mode      'mt' | 'ai'           用机翻还是 AI
//   mt        'volcano' | 'deepl'   机翻用哪家（火山是内置的）
//   ai        预设 id               AI 用哪套预设
//   presets   [{ id, name, kind: 'deepseek' | 'qwen' | 'siliconflow' | 'custom', base, model, thinking }]  DeepSeek、通义、硅基流动三套是固定的
//   titleAi   标题也用 AI（默认否：标题走内置机翻，免费）
//   keys      { deepl, ['p:' + 预设 id]: 密钥 }
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import path from 'node:path'

const ROOT = process.env.DATA_DIR || '/data'
const DIR = path.join(ROOT, 'users')
const SECRET = process.env.SCRIBE_SECRET || ''
const master = SECRET ? createHash('sha256').update(SECRET).digest() : null
export const canStore = () => !!master

export const FIXED_PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', kind: 'deepseek', base: 'https://api.deepseek.com', model: 'deepseek-flash', thinking: false },
  // 通义国际版（新加坡）：通用地址收同一地区任何工作空间的密钥（Model Studio「Base URL」文档）；也可以换成工作空间专用地址
  { id: 'qwen', name: '通义', kind: 'qwen', base: 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1', model: 'qwen-mt-flash', thinking: false },
  // 硅基流动（2026-10-22 Hana 提）：OpenAI 兼容，模型很多（小模型免费），模型从列表里选
  { id: 'siliconflow', name: '硅基流动', kind: 'siliconflow', base: 'https://api.siliconflow.cn/v1', model: '', thinking: false },
]
const DEFAULTS = () => ({ mode: 'mt', mt: 'volcano', ai: 'deepseek', titleAi: false, presets: [], keys: {}, usage: {} })

export function seal(text) {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', master, iv)
  const body = Buffer.concat([c.update(text, 'utf8'), c.final()])
  return [iv, c.getAuthTag(), body].map((b) => b.toString('base64')).join('.')
}
export function open(blob) {
  const [iv, tag, body] = blob.split('.').map((s) => Buffer.from(s, 'base64'))
  const d = createDecipheriv('aes-256-gcm', master, iv)
  d.setAuthTag(tag)
  return Buffer.concat([d.update(body), d.final()]).toString('utf8')
}
const tail = (v) => (v ? '····' + v.slice(-4) : '')

const file = (uid) => path.join(DIR, `${Number(uid)}.json`)
const cache = new Map()

export async function loadUser(uid) {
  if (cache.has(uid)) return cache.get(uid)
  let raw = {}
  try { raw = JSON.parse(await readFile(file(uid), 'utf8')) } catch { /* 还没设置过 */ }
  const keys = {}
  for (const [k, v] of Object.entries(raw.keys ?? {})) { try { keys[k] = open(v) } catch { /* 主密钥换了就作废 */ } }
  const u = { ...DEFAULTS(), ...raw, keys }
  if (u.mt !== 'deepl') u.mt = 'volcano'
  // 固定预设：用户只能改密钥、地址（通义）、思考（DeepSeek）
  u.presets = [
    ...FIXED_PRESETS.map((f) => {
      const saved = u.presets.find((p) => p.id === f.id) ?? {}
      return { ...f, ...saved, kind: f.kind, name: f.name, id: f.id, base: saved.base || f.base, model: saved.model || f.model }
    }),
    ...u.presets.filter((p) => p.kind === 'custom'),
  ]
  cache.set(uid, u)
  return u
}

export async function saveUser(uid, u) {
  await mkdir(DIR, { recursive: true })
  const keys = Object.fromEntries(Object.entries(u.keys).filter(([, v]) => v).map(([k, v]) => [k, seal(v)]))
  const tmp = file(uid) + '.tmp'
  await writeFile(tmp, JSON.stringify({ mode: u.mode, mt: u.mt, ai: u.ai, titleAi: u.titleAi, presets: u.presets, keys, usage: u.usage }))
  await rename(tmp, file(uid))
  cache.set(uid, u)
}

export const presetOf = (u, id) => u.presets.find((p) => p.id === id)
export const keyOf = (u, id) => u.keys['p:' + id] ?? ''

export function publicView(u) {
  return {
    mode: u.mode, mt: u.mt, ai: u.ai, titleAi: u.titleAi, canStore: canStore(),
    deepl: tail(u.keys.deepl),
    presets: u.presets.map((p) => ({ ...p, key: tail(keyOf(u, p.id)) })),
    usage: u.usage,
  }
}

// ——— 用量：按天、按渠道记字数、请求次数、token；只留 62 天 ———
const today = () => new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 10)   // 按北京时间算天
export function addUsage(u, channel, chars, tokens = { in: 0, out: 0 }, requests = 1) {
  const d = (u.usage[today()] ??= {})
  const e = (d[channel] ??= { chars: 0, req: 0, in: 0, out: 0 })
  e.chars += chars; e.req += requests; e.in += tokens.in; e.out += tokens.out
  const days = Object.keys(u.usage).sort()
  for (const old of days.slice(0, Math.max(0, days.length - 62))) delete u.usage[old]
}

// ——— 内置机翻（火山）的密钥：管理员（Hana）在灵媒里填，或 .env 的 VOLC_ACCESS_KEY / VOLC_SECRET_KEY ———
const BUILTIN_FILE = path.join(ROOT, 'builtin.json')
export async function loadBuiltin() {
  const env = { volcAk: process.env.VOLC_ACCESS_KEY || '', volcSk: process.env.VOLC_SECRET_KEY || '' }
  try {
    const raw = JSON.parse(await readFile(BUILTIN_FILE, 'utf8'))
    const out = { ...env }
    for (const [k, v] of Object.entries(raw)) { try { out[k] = open(v) } catch { /* 作废 */ } }
    return out
  } catch { return env }
}
export async function saveBuiltin(b) {
  if (!master) throw Object.assign(new Error('服务器还没配主密钥，存不了'), { status: 503 })
  await mkdir(ROOT, { recursive: true })
  await writeFile(BUILTIN_FILE, JSON.stringify(Object.fromEntries(Object.entries(b).filter(([, v]) => v).map(([k, v]) => [k, seal(v)]))))
}
export const builtinView = (b) => ({ volcAk: tail(b.volcAk), volcSk: tail(b.volcSk) })

// ——— 内置机翻的共用额度：火山每月前 200 万字免费，超了会按 49 元 / 百万字记账（默认后付费）。
// 前期不按人限（Hana 定），只留全站每月 180 万字的硬上限，碰不到收费线 ———
const POOL_FILE = path.join(ROOT, 'builtin-mt.json')
export const POOL_TOTAL = Number(process.env.BUILTIN_MT_MONTHLY || 1_800_000)
const thisMonth = () => today().slice(0, 7)
let pool = null
async function loadPool() {
  if (!pool) { try { pool = JSON.parse(await readFile(POOL_FILE, 'utf8')) } catch { pool = {} } }
  if (pool.month !== thisMonth()) pool = { month: thisMonth(), total: 0, users: {}, names: {} }
  return pool
}
export async function poolLeft() { const p = await loadPool(); return Math.max(0, POOL_TOTAL - p.total) }
export async function poolUse(user, chars) {
  const p = await loadPool()
  p.total += chars; p.users[user.id] = (p.users[user.id] ?? 0) + chars
  p.names = { ...(p.names ?? {}), [user.id]: user.username }
  await mkdir(ROOT, { recursive: true }).catch(() => {})
  await writeFile(POOL_FILE, JSON.stringify(p)).catch(() => {})
}
export async function poolView(user) {
  const p = await loadPool()
  const base = { mine: p.users[user.id] ?? 0, total: p.total, cap: POOL_TOTAL }
  // 管理员能看到每个账号用了多少（Hana：跑一两个月看会不会撞墙）
  return user.admin ? { ...base, byUser: Object.entries(p.users).map(([id, n]) => ({ name: p.names?.[id] ?? `#${id}`, chars: n })) } : base
}

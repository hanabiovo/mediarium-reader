// 翻译调度（阶段 4，2026-10-22 下午改）：
//   · 渠道是用户选定的那一个，不轮换；一次调用 = 对 AI 最多一次请求（机翻是免费的，可以按对方的单次上限分几批）
//   · 缓存：同一段原文 + 同一渠道 + 同一模型只翻一次，所有账号共用；命中缓存的不发
//   · 排队：每个账号同时 2 个、全站 6 个
import { createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { CHUNK, ChannelError, aiRequest, builtinOn, machine } from './channels.js'
import { addUsage, keyOf, loadUser, poolLeft, poolUse, presetOf, saveUser } from './store.js'

const DIR = path.join(process.env.DATA_DIR || '/data', 'tr')
const CACHE_MAX = Number(process.env.TR_CACHE_MAX_MB || 300) * 1024 * 1024

// 渠道签名：缓存按它分开
const sig = (ch) => (ch.type === 'mt' ? `mt:${ch.name}` : `ai:${ch.preset.kind}:${(() => { try { return new URL(ch.preset.base).host } catch { return '' } })()}:${ch.preset.model}:${ch.preset.thinking ? 1 : 0}`)
const cacheKey = (ch, kind, text) => createHash('sha256').update(sig(ch) + '\u0000' + kind + '\u0000' + text).digest('hex')
const fileOf = (k) => path.join(DIR, k.slice(0, 2), k)
async function cached(ch, kind, text) { try { return JSON.parse(await readFile(fileOf(cacheKey(ch, kind, text)), 'utf8')).t } catch { return null } }
async function remember(ch, kind, text, out) {
  const f = fileOf(cacheKey(ch, kind, text))
  await mkdir(path.dirname(f), { recursive: true }).catch(() => {})
  await writeFile(f, JSON.stringify({ t: out })).catch(() => {})
}
// 每天清一次：超过上限从最久没用的删起
export async function pruneTr() {
  try {
    const files = []
    for (const d of await readdir(DIR)) for (const n of await readdir(path.join(DIR, d))) { const f = path.join(DIR, d, n); files.push({ f, s: await stat(f) }) }
    let total = files.reduce((a, x) => a + x.s.size, 0)
    files.sort((a, b) => a.s.atimeMs - b.s.atimeMs)
    for (const x of files) { if (total <= CACHE_MAX) break; await unlink(x.f).catch(() => {}); total -= x.s.size }
  } catch { /* 还没有缓存 */ }
}

const running = new Map()
let globalRunning = 0
async function slot(uid) {
  while ((running.get(uid) ?? 0) >= 2 || globalRunning >= 6) await new Promise((ok) => setTimeout(ok, 150))
  running.set(uid, (running.get(uid) ?? 0) + 1); globalRunning++
  return () => { running.set(uid, running.get(uid) - 1); globalRunning-- }
}

// 已经是中文的不送去翻。汉字占三成以上算中文——但日文也满是汉字（「東京都水道局が個人情報保存のハードディスク紛失」），
// 所以带假名、谚文的一律不算中文（2026-10-24：痛いニュース的标题和正文几乎全被当成中文跳过了）
export const isChinese = (s) => {
  const t = String(s).replace(/\s/g, '')
  const kana = (t.match(/[\u3040-\u30ff\u31f0-\u31ff\uac00-\ud7af]/g) ?? []).length
  if (kana >= 2 || (kana && kana / t.length > 0.05)) return false
  return ((t.match(/[一-鿿]/g) ?? []).length / Math.max(1, t.length)) > 0.3
}

// 选定的渠道。via：
//   'mt' 强制机翻（标题默认、划词、「用机翻翻这段」），'ai' 强制 AI，不写就按用户的设置
//   'mt:volcano' | 'mt:deepl' | 'ai:<预设 id>' 指定某一个渠道（文章里「重译」选渠道，2026-10-23）
export function channelOf(u, via) {
  if (typeof via === 'string' && via.includes(':')) {
    const [type, name] = via.split(':')
    if (type === 'mt' && (name === 'volcano' || name === 'deepl')) return { type: 'mt', name, label: name === 'deepl' ? 'DeepL' : '火山机翻' }
    const preset = type === 'ai' ? presetOf(u, name) : null
    if (preset) return { type: 'ai', name: preset.kind, preset, label: preset.name }
  }
  const type = via === 'mt' || via === 'ai' ? via : u.mode
  if (type === 'mt') {
    // 选的是内置火山但它还没开、自己又填了 DeepL：机翻走 DeepL（2026-10-22：Hana 填了 DeepL，标题却因为内置没开翻不出来）
    const deepl = u.mt === 'deepl' || (!builtinOn() && !!u.keys.deepl)
    return { type: 'mt', name: deepl ? 'deepl' : 'volcano', label: deepl ? 'DeepL' : '火山机翻' }
  }
  const preset = presetOf(u, u.ai) ?? presetOf(u, 'deepseek')
  return { type: 'ai', name: preset.kind, preset, label: preset.name }
}

async function runMachine(user, u, ch, texts) {
  if (ch.name === 'volcano') {
    if (!builtinOn()) throw new ChannelError('volcano', 0, 'off', '', '内置机翻还没开（管理员没填密钥）')
    const chars = texts.reduce((a, t) => a + t.length, 0)
    if ((await poolLeft()) < chars) throw new ChannelError('volcano', 0, 'pool', '', '内置机翻本月的共用额度用完了，换个渠道试试')
    const out = await machine('volcano', texts, u.keys)
    await poolUse(user, chars)
    return out
  }
  return machine('deepl', texts, u.keys)
}

// ——— 一批短文本（标题、划词、单段机翻）：{ out, channel, engines } ———
export async function translateBatch(user, texts, kind, via) {
  texts = texts.slice(0, 80).map((t) => String(t).slice(0, kind === 'title' ? 400 : 6000))
  const u = await loadUser(user.id)
  const ch = channelOf(u, via)
  const out = new Array(texts.length).fill('')
  const todo = []
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i].trim()
    if (!t || isChinese(t)) { out[i] = texts[i]; continue }
    const c = await cached(ch, kind, t)
    if (c) out[i] = c; else todo.push(i)
  }
  if (!todo.length) return { out, channel: ch.label }
  const release = await slot(user.id)
  try {
    const batch = todo.map((i) => texts[i].trim())
    const chars = batch.reduce((a, t) => a + t.length, 0)
    if (ch.type === 'mt') {
      const res = await runMachine(user, u, ch, batch)
      todo.forEach((i, k) => { out[i] = res[k] })
      await Promise.all(todo.map((i, k) => remember(ch, kind, batch[k], res[k])))
      addUsage(u, ch.name, chars, undefined, 1)
    } else {
      if (chars > CHUNK[ch.preset.kind]) throw new ChannelError(ch.name, 413, 'long', '', '一次发的太多了')
      const got = {}
      const { done, usage } = await aiRequest(ch.preset, keyOf(u, ch.preset.id), kind, batch.map((t, k) => [String(k + 1), t]), (k, t) => { got[k] = t })
      addUsage(u, 'p:' + ch.preset.id, chars, usage, 1)
      todo.forEach((i, k) => { if (got[k + 1]) out[i] = got[k + 1] })
      await Promise.all(todo.map((i, k) => (got[k + 1] ? remember(ch, kind, batch[k], got[k + 1]) : null)))
      if (done.size < batch.length / 2) throw new ChannelError(ch.name, 200, 'format', '', '这个模型没按要求回答，换个模型试试')
    }
    await saveUser(user.id, u).catch(() => {})
    return { out, channel: ch.label }
  } finally { release() }
}

// ——— 正文（流式）：paras 是这一次要翻的段落（灵媒已按 CHUNK 切好，一次调用对 AI 只发一次请求）；title 可选 ———
// emit({ i, t }) 每段；emit({ title }) 标题；最后返回 { missing: [没翻成的段号] }
// fresh：强制重译（只对 AI；机翻同一段每次结果一样，不给）——不读缓存，新译文覆盖旧的，每个渠道始终只留一份
export async function translateStream(user, { paras, title, fresh }, via, emit) {
  const u = await loadUser(user.id)
  const ch = channelOf(u, via)
  const skip = !!fresh && ch.type === 'ai'
  emit({ channel: ch.label, type: ch.type })
  paras = paras.slice(0, 400).map((p) => String(p).trim())
  const todo = []
  for (let i = 0; i < paras.length; i++) {
    const p = paras[i]
    if (!p || isChinese(p)) { emit({ i, t: p, same: true }); continue }
    const c = skip ? null : await cached(ch, 'para', p)
    if (c) emit({ i, t: c, cached: true }); else todo.push(i)
  }
  let needTitle = false
  if (title && !isChinese(title)) {
    const c = skip ? null : await cached(ch, 'title', title.trim())
    if (c) emit({ title: c, cached: true }); else needTitle = true
  }
  if (!todo.length && !needTitle) return { missing: [] }

  const chars = todo.reduce((a, i) => a + paras[i].length, 0) + (needTitle ? title.length : 0)
  const release = await slot(user.id)
  try {
    if (ch.type === 'mt') {
      const texts = [...todo.map((i) => paras[i]), ...(needTitle ? [title.trim()] : [])]
      const res = await runMachine(user, u, ch, texts)
      for (let k = 0; k < todo.length; k++) { emit({ i: todo[k], t: res[k] }); await remember(ch, 'para', paras[todo[k]], res[k]) }
      if (needTitle) { const t = res[todo.length]; emit({ title: t }); await remember(ch, 'title', title.trim(), t) }
      addUsage(u, ch.name, chars, undefined, 1)
      await saveUser(user.id, u).catch(() => {})
      return { missing: [] }
    }
    if (chars > CHUNK[ch.preset.kind] * 1.1) throw new ChannelError(ch.name, 413, 'long', '', '这一次发的太多了')
    const items = [...(needTitle ? [['T', title.trim()]] : []), ...todo.map((i) => [String(i + 1), paras[i]])]
    const got = new Set()
    let usage = { in: 0, out: 0 }
    try {
      try {
      const r = await aiRequest(ch.preset, keyOf(u, ch.preset.id), 'para', items, (k, t) => {
        if (k === 'T') { if (!needTitle) return; emit({ title: t }); remember(ch, 'title', title.trim(), t); return }
        const i = Number(k) - 1
        if (!todo.includes(i) || got.has(i)) return
        got.add(i); emit({ i, t }); remember(ch, 'para', paras[i], t)
      })
      usage = r.usage
      } catch (e) { e.missing = todo.filter((i) => !got.has(i)); throw e }
    } finally {
      addUsage(u, 'p:' + ch.preset.id, chars, usage, 1)
      await saveUser(user.id, u).catch(() => {})
    }
    const missing = todo.filter((i) => !got.has(i))
    if (todo.length && missing.length === todo.length) throw new ChannelError(ch.name, 200, 'format', '', '这个模型没按要求回答，换个模型试试')
    return { missing }
  } finally { release() }
}

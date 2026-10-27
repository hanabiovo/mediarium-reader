// 翻译（阶段 4，2026-10-22 下午改）。真正去翻的是服务器上的誊写服务（密钥在那边），灵媒这边：
//   · 设置：模式（机翻 / AI）、机翻渠道、AI 预设（DeepSeek、通义两套固定的 + 自定义），标题也用 AI
//   · 规矩：每次 AI 请求都由一次点击触发。全文翻译按预设的单次上限先切好，按钮上先说要分几次
//   · 报错：渠道 · 状态码 + 对方原话 + 人话；具体原因同时写进控制台（前缀 [翻译]）
import { useEffect, useState } from 'react'
import { getToken, type Entry } from '../api/miniflux'
import { load, save } from '../api/storage'
import { useMeta, type Meta } from '../api/meta'

export type TrKind = 'title' | 'para' | 'selection'
export type Via = 'mt' | 'ai'
export type Preset = { id: string; name: string; kind: 'deepseek' | 'qwen' | 'siliconflow' | 'custom'; base: string; model: string; thinking: boolean; key: string }
export type TrConfig = {
  mode: Via; mt: 'volcano' | 'deepl'; ai: string; titleAi: boolean; canStore: boolean
  deepl: string; presets: Preset[]; chunk: Record<string, number>
  usage: Record<string, Record<string, { chars: number; req: number; in: number; out: number }>>
  admin?: boolean
  builtinKeys?: { volcAk: string; volcSk: string }
  builtin: { mine: number; total: number; cap: number; byUser?: { name: string; chars: number }[] } | null
}
export type TrFail = { channel?: string; status?: number; code?: string; raw?: string; explain?: string }

const H = () => ({ 'X-Auth-Token': getToken() ?? '', 'Content-Type': 'application/json' })
const NAMES: Record<string, string> = { deepseek: 'DeepSeek', qwen: '通义', siliconflow: '硅基流动', deepl: 'DeepL', volcano: '火山机翻', custom: '自定义接口' }

export class TrError extends Error {
  fail: TrFail
  constructor(fail: TrFail) { super(failText(fail)); this.fail = fail }
}
// 「DeepSeek · 402 Insufficient Balance：账户余额不足，去 DeepSeek 充值」
export function failText(f: TrFail): string {
  const who = f.channel ? NAMES[f.channel] ?? f.channel : '翻译'
  const code = [f.status ? String(f.status) : '', f.code && !/^(nokey|off|pool|format|long|timeout|network|blocked|count|too-big|redirect)$/.test(f.code) ? f.code : ''].filter(Boolean).join(' ')
  const raw = f.raw && f.raw !== f.explain ? f.raw : ''
  const head = [who, [code, raw].filter(Boolean).join(' ')].filter(Boolean).join(' · ')
  return f.explain ? `${head}：${f.explain}` : `${head}：对方返回了错误`
}
async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
  let r: Response
  try { r = await fetch('/scribe' + path, { ...init, headers: H() }) }
  catch (e) { console.warn('[翻译]', path, String(e)); throw new TrError({ explain: '连不上翻译服务' }) }
  const j = await r.json().catch(() => ({}))
  if (!r.ok) {
    console.warn('[翻译]', path, r.status, j)
    throw new TrError(typeof j.error === 'object' ? j.error : { status: r.status, explain: j.error ?? (r.status === 401 ? '没登录' : '翻译服务出错') })
  }
  return j as T
}

// ——— 设置（模块里存一份，按钮上显示渠道用） ———
let cfg: TrConfig | null | undefined
const cfgListeners = new Set<(c: TrConfig | null) => void>()
const setCfg = (c: TrConfig | null) => { cfg = c; cfgListeners.forEach((f) => f(c)) }
export async function getTrConfig(): Promise<TrConfig | null> {
  try { setCfg(await call<TrConfig>('/translate/config')) } catch { setCfg(null) }
  return cfg ?? null
}
export function useTrConfig(): TrConfig | null | undefined {
  const [c, set] = useState(cfg)
  useEffect(() => { cfgListeners.add(set); if (cfg === undefined) getTrConfig(); return () => { cfgListeners.delete(set) } }, [])
  return c
}
type ConfigChange = Partial<Pick<TrConfig, 'mode' | 'mt' | 'ai' | 'titleAi'>> & { deepl?: string | null; builtinKeys?: Partial<Record<'volcAk' | 'volcSk', string | null>> }
export async function putTrConfig(change: ConfigChange) { const c = await call<TrConfig>('/translate/config', { method: 'PUT', body: JSON.stringify(change) }); setCfg(c); return c }
export async function savePreset(p: Partial<Omit<Preset, 'key'>> & { key?: string | null }) { const c = await call<TrConfig & { saved: string }>('/translate/preset', { method: 'POST', body: JSON.stringify(p) }); setCfg(c); return c }
export async function deletePreset(id: string) { setCfg(await call<TrConfig>(`/translate/preset?id=${encodeURIComponent(id)}`, { method: 'DELETE' })) }
export const listModels = (q: { id?: string; base?: string; key?: string }) => call<{ models: string[] }>('/translate/models', { method: 'POST', body: JSON.stringify(q) }).then((r) => r.models)

// 机翻实际走哪家：选了 DeepL，或者内置火山还没开而自己填了 DeepL（和服务器一致）
export const mtIsDeepl = (c: TrConfig | null | undefined) => !!c && (c.mt === 'deepl' || (!c.builtin && !!c.deepl))

// 当前渠道：按钮上的名字、AI 预设、单次上限
export function channelOf(c: TrConfig | null | undefined, via?: Via): { label: string; type: Via; chunk: number } {
  const type = via ?? c?.mode ?? 'mt'
  if (type === 'mt' || !c) return { type: 'mt', label: mtIsDeepl(c) ? 'DeepL' : '火山机翻', chunk: Infinity }
  const p = c.presets.find((x) => x.id === c.ai) ?? c.presets[0]
  return { type: 'ai', label: p?.name ?? 'AI', chunk: c.chunk?.[p?.kind ?? 'custom'] ?? 8000 }
}

// ——— 文章里的渠道（2026-10-23）：一篇文章每个渠道各留一份译文，key = 'mt:volcano' | 'mt:deepl' | 'ai:<预设 id>' ———
export type ChKey = string
export type ChInfo = { key: ChKey; label: string; type: Via; chunk: number; ok: boolean }
export function defaultKey(c: TrConfig | null | undefined): ChKey {
  if (!c || c.mode === 'mt') return mtIsDeepl(c) ? 'mt:deepl' : 'mt:volcano'
  return 'ai:' + c.ai
}
export function chInfo(c: TrConfig | null | undefined, key: ChKey): ChInfo {
  if (key === 'mt:deepl') return { key, label: 'DeepL', type: 'mt', chunk: Infinity, ok: !!c?.deepl }
  if (key === 'mt:volcano' || !c) return { key, label: '火山机翻', type: 'mt', chunk: Infinity, ok: !!c?.builtin }
  const p = c.presets.find((x) => 'ai:' + x.id === key)
  return { key, label: p?.name ?? '已删的预设', type: 'ai', chunk: c.chunk?.[p?.kind ?? 'custom'] ?? 8000, ok: !!p?.key && !!p?.model }
}
export const allKeys = (c: TrConfig | null | undefined): ChKey[] => (c ? ['mt:volcano', 'mt:deepl', ...c.presets.map((p) => 'ai:' + p.id)] : [])

// 模型名提示（拉模型列表时）：会先思考 / 可能联网
export function modelHint(id: string): string {
  const s = id.toLowerCase()
  return [/(thinking|reasoner|reasoning|\br1\b|-r1)/.test(s) ? '会先思考' : '', /(search|online|web)/.test(s) ? '可能联网' : ''].filter(Boolean).join(' · ')
}

// ——— 翻一批短文本（标题、划词、「用机翻翻这段」） ———
export const translateBatch = (texts: string[], kind: TrKind, via?: Via) =>
  call<{ out: string[]; channel: string }>('/translate', { method: 'POST', body: JSON.stringify({ texts, kind, via }) })

// ——— 正文（流式）：一次调用 = 对 AI 一次请求 ———
export type StreamEvent = { channel?: string; type?: Via; i?: number; t?: string; title?: string; done?: boolean; missing?: number[] | null; error?: TrFail }
// via：'mt' | 'ai' | 具体渠道 ChKey；fresh：强制重译（不读缓存，只对 AI 有效）
export async function translateStream(paras: string[], title: string | undefined, via: Via | ChKey | undefined, on: (e: StreamEvent) => void, signal?: AbortSignal, fresh = false): Promise<{ missing: number[] }> {
  let r: Response
  try { r = await fetch('/scribe/translate/stream', { method: 'POST', headers: H(), body: JSON.stringify({ paras, title, via, ...(fresh ? { fresh: true } : {}) }), signal }) }
  catch (e) { console.warn('[翻译] stream', String(e)); throw new TrError({ explain: '连不上翻译服务' }) }
  if (!r.ok || !r.body) {
    const j = await r.json().catch(() => ({}))
    console.warn('[翻译] stream', r.status, j)
    throw new TrError(typeof j.error === 'object' ? j.error : { status: r.status, explain: r.status === 401 ? '没登录' : '翻译服务出错' })
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  let result: { missing: number[] } | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let at
    while ((at = buf.indexOf('\n\n')) >= 0) {
      const line = buf.slice(0, at).trim(); buf = buf.slice(at + 2)
      if (!line.startsWith('data:')) continue
      let e: StreamEvent
      try { e = JSON.parse(line.slice(5)) } catch { continue }
      if (e.error) { console.warn('[翻译]', e.error); const err = new TrError(e.error); (err as TrError & { missing?: number[] | null }).missing = e.missing; throw err }
      if (e.done) result = { missing: e.missing ?? [] }
      on(e)
    }
  }
  if (!result) { console.warn('[翻译] stream 没收到结束就断了（多半是中间的代理等太久掐断了）'); throw new TrError({ explain: '连接中途断了（对方太久没回话，被中间掐断）' }) }
  return result
}

// 按单次上限切块（以段为单位，不拆段；标题算进第一块）。返回每块的段号
export function planChunks(paras: string[], limit: number, titleLen = 0): number[][] {
  if (!Number.isFinite(limit)) return [paras.map((_, i) => i)]
  const chunks: number[][] = []
  let cur: number[] = [], size = titleLen
  paras.forEach((p, i) => {
    if (cur.length && size + p.length > limit) { chunks.push(cur); cur = []; size = 0 }
    cur.push(i); size += p.length
  })
  if (cur.length) chunks.push(cur)
  return chunks
}

// ——— 外文判断：中文字占比低于三成就当外文（接诊时看样本标题） ———
export function looksForeign(samples: string[]): boolean {
  const s = samples.join('').replace(/\s/g, '')
  if (s.length < 8) return false
  const han = (s.match(/[一-鿿]/g) ?? []).length
  const kana = (s.match(/[぀-ヿ가-힯]/g) ?? []).length
  return han / s.length < 0.3 || kana > s.length * 0.2
}

// ——— 标题：开了「翻译标题」的源。默认走机翻（免费）；设置里开了「标题也用 AI」才走 AI；用 AI 翻正文时会覆盖 ———
export const trTitleOn = (m: Meta, feedId: number) => !!m.feeds[feedId]?.trTitle

const CACHE_KEY = 'mediarium.tr.titles'
let titleCache: Record<string, string> = (() => { try { return JSON.parse(load(CACHE_KEY) ?? '{}') } catch { return {} } })()
const listeners = new Set<() => void>()
export function keepTitles(add: Record<string, string>) {
  titleCache = { ...titleCache, ...add }
  const ids = Object.keys(titleCache)
  if (ids.length > 3000) for (const id of ids.slice(0, ids.length - 3000)) delete titleCache[id]   // 最早记的先丢
  save(CACHE_KEY, JSON.stringify(titleCache))
  listeners.forEach((f) => f())
}
const pending = new Set<number>()
const failed = new Set<number>()

async function fetchTitles(list: Entry[]) {
  const c = cfg ?? (await getTrConfig())
  if (!c) return
  const need = list.filter((e) => !titleCache[e.id] && !pending.has(e.id) && !failed.has(e.id))
  for (let i = 0; i < need.length; i += 60) {
    const chunk = need.slice(i, i + 60)
    chunk.forEach((e) => pending.add(e.id))
    try {
      const r = await translateBatch(chunk.map((e) => e.title), 'title', c.mode === 'ai' && c.titleAi ? 'ai' : 'mt')
      const add: Record<string, string> = {}
      chunk.forEach((e, k) => { const t = r.out[k]; if (t && t !== e.title) add[e.id] = t })
      keepTitles(add)
    } catch (e) { console.warn('[翻译] 标题', (e as Error).message); chunk.forEach((x) => failed.add(x.id)) }   // 这次打开页面就不再试了
    finally { chunk.forEach((x) => pending.delete(x.id)) }
  }
}

// 列表用：给一串文章，返回 id → 中文标题
export function useTitleTr(entries: Entry[] | null | undefined): Record<number, string> {
  const meta = useMeta()
  const [, bump] = useState(0)
  useEffect(() => { const f = () => bump((n) => n + 1); listeners.add(f); return () => { listeners.delete(f) } }, [])
  // 主动去翻：只翻开了「翻译标题」的源；已经有译文的（比如在文章页用 AI 翻过全文，标题跟着翻了）不管开没开都显示（2026-10-22 Hana）
  const want = (entries ?? []).filter((e) => trTitleOn(meta, e.feed_id))
  const key = want.map((e) => e.id).join(',')
  useEffect(() => { if (want.length) fetchTitles(want) }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
  const map: Record<number, string> = {}
  for (const e of entries ?? []) if (titleCache[e.id]) map[e.id] = titleCache[e.id]
  return map
}
// 文章页：无论源开没开「翻译标题」，翻过正文就有
export const titleOf = (id: number): string | undefined => titleCache[id]
export function useTitleBump() { const [, b] = useState(0); useEffect(() => { const f = () => b((n) => n + 1); listeners.add(f); return () => { listeners.delete(f) } }, []) }

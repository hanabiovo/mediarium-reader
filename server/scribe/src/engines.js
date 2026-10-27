// 翻译引擎（阶段 4，2026-10-22）。接口格式都按官方文档写（查过）：
//   DeepSeek   https://api-docs.deepseek.com          OpenAI 兼容，model deepseek-flash，JSON 输出
//   通义 MT    alibabacloud.com/help/en/model-studio/qwen-mt-api   新加坡 {WorkspaceId}.ap-southeast-1.maas.aliyuncs.com，只收 user 消息，translation_options
//   腾讯 TMT   tmt.tencentcloudapi.com  Version 2018-03-21  TextTranslateBatch（TC3-HMAC-SHA256 签名）默认每秒 5 次
//              内置：Hana 的密钥（管理员在灵媒「设置 › 翻译」里填，或 .env 的 TENCENT_SECRET_ID / KEY），所有账号共用每月 500 万字免费额度（2026-10-22 Hana 定）
//   DeepL      api-free.deepl.com/v2/translate  Authorization: DeepL-Auth-Key，单次 ≤ 128KiB
// 每个引擎：translate(texts, kind, keys) → { out: string[], tokens: { in, out } }；条数对不上就抛错，交给下一个引擎。
import { createHash, createHmac } from 'node:crypto'

const T = (ms) => AbortSignal.timeout(ms)
class EngineError extends Error {}
export { EngineError }

const STYLE = {
  title: '这些是外文文章或新闻的标题。译成简洁、自然的中文标题，不加引号、不加句号。',
  para: '这些是同一篇文章里连续的段落。译成通顺、忠实的简体中文，保留原文的语气和段内结构；人名、地名、机构名第一次出现时可在译名后括注原文。',
  selection: '这是读者从文章里划选的一段话。译成准确、通顺的简体中文。',
}

// ——— DeepSeek：一次发一批，要求回 JSON {"t": [...]}，条数必须一致 ———
async function deepseek(texts, kind, keys) {
  if (!keys.deepseek) throw new EngineError('没有 DeepSeek 密钥')
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST', signal: T(60000),
    headers: { Authorization: `Bearer ${keys.deepseek}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek-flash',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: `你是专业的中文译者。${STYLE[kind] ?? STYLE.para}已经是中文的原样返回。用户给一个 JSON 数组，按同样顺序、同样条数逐条翻译，只输出 JSON：{"t": ["译文1", "译文2", …]}。` },
        { role: 'user', content: JSON.stringify(texts) },
      ],
    }),
  })
  if (!r.ok) throw new EngineError(`DeepSeek ${r.status}`)
  const j = await r.json()
  let out
  try { out = JSON.parse(j.choices?.[0]?.message?.content ?? '').t } catch { throw new EngineError('DeepSeek 回的不是 JSON') }
  if (!Array.isArray(out) || out.length !== texts.length) throw new EngineError('DeepSeek 条数对不上')
  return { out: out.map(String), tokens: { in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0 } }
}

// ——— 通义 qwen-mt-flash：一次一条（文档只示范单条 user 消息），一次最多三条并行，免得撞 60 RPM ———
async function qwenOne(text, keys) {
  const ws = String(keys.qwenWorkspace || '').trim()
  const base = /^https?:\/\//.test(ws) ? ws.replace(/\/$/, '') : `https://${ws}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1`
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST', signal: T(60000),
    headers: { Authorization: `Bearer ${keys.qwen}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'qwen-mt-flash', messages: [{ role: 'user', content: text }], translation_options: { source_lang: 'auto', target_lang: 'Chinese' } }),
  })
  if (!r.ok) throw new EngineError(`通义 ${r.status}`)
  const j = await r.json()
  return { text: String(j.choices?.[0]?.message?.content ?? ''), in: j.usage?.prompt_tokens ?? 0, out: j.usage?.completion_tokens ?? 0 }
}
async function qwen(texts, _kind, keys) {
  if (!keys.qwen || !keys.qwenWorkspace) throw new EngineError('没有通义密钥或工作空间')
  const out = new Array(texts.length)
  const tokens = { in: 0, out: 0 }
  let next = 0
  await Promise.all([0, 1, 2].map(async () => {
    while (next < texts.length) {
      const k = next++
      const r = await qwenOne(texts[k], keys)
      out[k] = r.text; tokens.in += r.in; tokens.out += r.out
    }
  }))
  return { out, tokens }
}

// ——— 腾讯云机器翻译：TC3-HMAC-SHA256 签名 ———
const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex')
const hmac = (k, s) => createHmac('sha256', k).update(s, 'utf8').digest()
const TMT = { tencentId: process.env.TENCENT_SECRET_ID || '', tencentKey: process.env.TENCENT_SECRET_KEY || '' }
export const builtinOn = () => !!(TMT.tencentId && TMT.tencentKey)
export const setBuiltin = (b) => { TMT.tencentId = b.tencentId || ''; TMT.tencentKey = b.tencentKey || '' }
async function tencentCall(action, payload, keys = TMT) {
  const host = 'tmt.tencentcloudapi.com', service = 'tmt'
  const ts = Math.floor(Date.now() / 1000)
  const date = new Date(ts * 1000).toISOString().slice(0, 10)
  const body = JSON.stringify(payload)
  const ct = 'application/json; charset=utf-8'
  const canonical = ['POST', '/', '', `content-type:${ct}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`, 'content-type;host;x-tc-action', sha(body)].join('\n')
  const scope = `${date}/${service}/tc3_request`
  const toSign = ['TC3-HMAC-SHA256', ts, scope, sha(canonical)].join('\n')
  const kSigning = hmac(hmac(hmac('TC3' + keys.tencentKey, date), service), 'tc3_request')
  const sig = createHmac('sha256', kSigning).update(toSign, 'utf8').digest('hex')
  const r = await fetch(`https://${host}`, {
    method: 'POST', signal: T(20000), body,
    headers: {
      Authorization: `TC3-HMAC-SHA256 Credential=${keys.tencentId}/${scope}, SignedHeaders=content-type;host;x-tc-action, Signature=${sig}`,
      'Content-Type': ct, Host: host, 'X-TC-Action': action, 'X-TC-Version': '2018-03-21', 'X-TC-Timestamp': String(ts), 'X-TC-Region': 'ap-guangzhou',
    },
  })
  const j = await r.json().catch(() => ({}))
  if (j.Response?.Error) throw new EngineError(`腾讯 ${j.Response.Error.Code}`)
  if (!r.ok) throw new EngineError(`腾讯 ${r.status}`)
  return j.Response
}
async function tencent(texts) {
  if (!builtinOn()) throw new EngineError('没有内置机翻')
  // 一批不超过 5000 字；超了分几批
  const out = []
  let batch = [], size = 0
  const flush = async () => {
    if (!batch.length) return
    const res = await tencentCall('TextTranslateBatch', { SourceTextList: batch, Source: 'auto', Target: 'zh', ProjectId: 0 })
    if (!Array.isArray(res.TargetTextList) || res.TargetTextList.length !== batch.length) throw new EngineError('腾讯 条数对不上')
    out.push(...res.TargetTextList.map(String))
    batch = []; size = 0
    await new Promise((ok) => setTimeout(ok, 220))   // 每秒 5 次
  }
  for (const t of texts) {
    if (size + t.length > 5000) await flush()
    batch.push(t); size += t.length
  }
  await flush()
  return { out, tokens: { in: 0, out: 0 } }
}

// ——— DeepL Free ———
async function deepl(texts, _kind, keys) {
  if (!keys.deepl) throw new EngineError('没有 DeepL 密钥')
  const host = keys.deepl.endsWith(':fx') ? 'api-free.deepl.com' : 'api.deepl.com'
  const call = (target) => fetch(`https://${host}/v2/translate`, {
    method: 'POST', signal: T(30000),
    headers: { Authorization: `DeepL-Auth-Key ${keys.deepl}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: texts, target_lang: target }),
  })
  // 简体中文文档里写作 ZH-HANS；不认的话退回 ZH
  let r = await call('ZH-HANS')
  if (r.status === 400) r = await call('ZH')
  if (!r.ok) throw new EngineError(`DeepL ${r.status}`)
  const j = await r.json()
  const out = (j.translations ?? []).map((t) => String(t.text))
  if (out.length !== texts.length) throw new EngineError('DeepL 条数对不上')
  return { out, tokens: { in: 0, out: 0 } }
}

export const ENGINES = { deepseek, qwen, tencent, deepl }
export const AI = ['deepseek', 'qwen']
export const MT = ['deepl', 'tencent']   // 先用各人自己的 DeepL，内置的腾讯最后兜底（省共用额度）
// 大概的花费（美元 / 百万 token，高峰价；错峰 DeepSeek 打对折，这里按高峰算，宁高勿低）。只用来给 Hana 看个数
export const PRICE = { deepseek: { in: 0.3, out: 1.2 }, qwen: { in: 0.16, out: 0.49 } }

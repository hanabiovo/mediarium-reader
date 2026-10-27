// 灵媒自己的设置（翻译标题、报刊归属、病历、不爱看……）。和网页端 web/src/api/meta.ts 同一份、同一个格式：
// 存在 Miniflux 账户的「自定义样式」（stylesheet）里，写成一段 CSS 注释 /* mediarium-meta:{json}:mediarium-meta */。
// 改的时候先重新读一遍、在最新的上面改、再写回，不会盖掉手机、电脑上刚写的（网页端也是这么做的）。
// 这里保留 JSON 里所有字段，认不得的也原样写回。
import { mf } from './mfclient.js'

const START = '/* mediarium-meta:'
const END = ':mediarium-meta */'

export function parseMeta(css) {
  const s = css ?? ''
  const i = s.indexOf(START), j = s.indexOf(END)
  let m = {}
  if (i >= 0 && j > i) { try { m = JSON.parse(s.slice(i + START.length, j)) ?? {} } catch { m = {} } }
  return { ...m, v: 1, feeds: m.feeds ?? {}, categories: m.categories ?? {} }
}

export function renderMeta(css, m) {
  const s = css ?? ''
  const block = START + JSON.stringify(m).replace(/\*\//g, '*\\/') + END
  const i = s.indexOf(START), j = s.indexOf(END)
  if (i >= 0 && j > i) return s.slice(0, i) + block + s.slice(j + END.length)
  return s ? `${s}\n${block}` : block
}

export async function readMeta(key) {
  const me = await mf(key, '/me')
  return parseMeta(me?.stylesheet)
}

export async function updateMeta(key, change) {
  const me = await mf(key, '/me')
  const next = change(parseMeta(me?.stylesheet))
  await mf(key, `/users/${me.id}`, { method: 'PUT', body: JSON.stringify({ stylesheet: renderMeta(me?.stylesheet, next) }) })
  return next
}

// 病历：每个源最近 8 条
export const withNote = (m, feedId, what) => {
  const id = String(feedId)
  const note = { t: new Date().toISOString(), what }
  return { ...m, feeds: { ...m.feeds, [id]: { ...m.feeds[id], notes: [note, ...(m.feeds[id]?.notes ?? [])].slice(0, 8) } } }
}

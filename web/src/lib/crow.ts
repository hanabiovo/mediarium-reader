// 寒鸦彩蛋（3e，2026-10-21 Hana 定）：主动去戳才会说话，不戳永远不出现。台词全在这个文件里，随手改。
// 关于页里有开关「寒鸦偶尔说话」，默认开。
import { load, save } from '../api/storage'
import { toast } from '../components/Toast'
import type { BirdName } from '../components/Bird'

export const LINES = {
  // 连点 logo（GPT 画的小鸮）7 下：它翻成文末那只寒鸦，说一句，几秒后翻回去
  logoFirst: '被你找到了。',
  logo: ['借这个位置站一会儿。', '猫头鹰去喝水了。', '我在。', '报亭今天也开着。', '这里没有隐藏关卡。……大概。'],
  logoEmpty: '没词了。明天再来。',
  endBird: '我先飞了。',               // 文末停着的鸟连点 3 下，它起飞
  divider: '这只只管送信。',           // 正文里送信的分隔鸟
  reading: '它在读，别吵它。',         // 「都读完了」那只低头读书的鸟
  streamEnd: '都说了到底了。',         // 信息流「到底了」以后还往下滚，第三下（喊一声的鸦，0.29.6；在 Stream.tsx 里数）
  star100: '第一百篇。这面墙快挂满了。', // 收藏第 100 篇
  crowArticle: '这篇写到我们了。',     // 收藏一篇，文中「鸦」字出现 3 次以上
  admin: '是Hana来了。',              // 账户页名字旁的鸟（只有管理员有），点它进「管理」；不受开关管
}

const KEY = 'mediarium.crow'
type State = { on: boolean; found?: boolean; day?: string; said?: number; star100?: boolean; articles?: number[] }
let state: State = (() => { try { return { on: true, ...JSON.parse(load(KEY) ?? '{}') } } catch { return { on: true } } })()
const put = (c: Partial<State>) => { state = { ...state, ...c }; save(KEY, JSON.stringify(state)) }

export const crowOn = () => state.on
export const setCrowOn = (on: boolean) => put({ on })
export function say(text: string, bird?: BirdName) { if (state.on) toast({ text, kind: 'crow', bird }) }

// logo 的台词：第一次固定一句，之后一天里按顺序轮一遍，轮完「没词了」，第二天重来
export function logoLine(): string {
  const today = new Date().toDateString()
  if (!state.found) { put({ found: true, day: today, said: 0 }); return LINES.logoFirst }
  const said = state.day === today ? state.said ?? 0 : 0
  put({ day: today, said: said + 1 })
  return said < LINES.logo.length ? LINES.logo[said] : LINES.logoEmpty
}

export function onStarred(total: number, content: string, id: number) {
  if (!state.on) return
  if (total >= 100 && !state.star100) { put({ star100: true }); return say(LINES.star100) }
  const n = (content.replace(/<[^>]+>/g, '').match(/鸦/g) ?? []).length
  if (n >= 3 && !(state.articles ?? []).includes(id)) { put({ articles: [...(state.articles ?? []), id].slice(-50) }); say(LINES.crowArticle) }
}

// 连点计数：间隔超过 0.8 秒就重新数
export function tapCounter(need: number, fire: () => void) {
  let n = 0, last = 0
  return () => {
    const now = Date.now()
    n = now - last > 800 ? 1 : n + 1
    last = now
    if (n >= need) { n = 0; fire() }
  }
}

// 正文里的鸟（分隔、文末）和空状态的读书鸟：在整个页面上听点击，组件不用改
export function initCrow() {
  const endTap = new WeakMap<Element, () => void>()
  document.addEventListener('click', (e) => {
    if (!state.on) return
    const el = e.target as Element | null
    if (!el?.closest) return
    const end = el.closest('.prose-end')
    if (end && !end.classList.contains('flying')) {
      if (!endTap.has(end)) endTap.set(end, tapCounter(3, () => { end.classList.add('flying'); say(LINES.endBird) }))
      return endTap.get(end)!()
    }
    if (el.closest('.prose-divider-bird')) return say(LINES.divider)
    if (el.closest('.bird-note-reading .bird')) return say(LINES.reading)
  })
}

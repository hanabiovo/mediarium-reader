// 信息流（0.28，2026-10-26 Hana 定）。记在灵媒自己的设置里（Miniflux 只认已读、未读、收藏）。
//   「稍后读」试了一版，0.28.1 下架（Hana：太鸡肋）
//   · 不爱看：信息流右滑、长按菜单、文章顶栏的眼睛。只从信息流里拿掉（按已读算），杂志目录、收藏里照旧在；
//     长按「收藏」换成「不看的」能找回。只留最近 90 天，源医生拿它算「近 30 天划掉了几成」
import type { Entry } from '../api/miniflux'
import { updateMeta, type Mark, type Meta } from '../api/meta'
import { load, save } from '../api/storage'

// 滚过即已读：每台设备自己记，默认开
const AUTO_KEY = 'mediarium.autoRead'
export const autoReadOn = () => load(AUTO_KEY) !== 'off'
export const setAutoRead = (on: boolean) => save(AUTO_KEY, on ? 'on' : 'off')

export const MUTED_DAYS = 90
const DAY = 864e5

export const mutedOf = (m: Meta): Record<string, Mark> => m.muted ?? {}
export const isMuted = (m: Meta, id: number) => !!m.muted?.[id]
const without = (r: Record<string, Mark> | undefined, ids: number[]) => {
  const out = { ...(r ?? {}) }
  for (const id of ids) delete out[id]
  return out
}
const freshMuted = (r: Record<string, Mark> | undefined): Record<string, Mark> =>
  Object.fromEntries(Object.entries(r ?? {}).filter(([, v]) => Date.now() - v.t < MUTED_DAYS * DAY))

export async function mute(e: Entry) {
  const mark = { f: e.feed_id, t: Date.now() }
  await updateMeta((m) => ({ ...m, muted: { ...freshMuted(m.muted), [e.id]: mark } }))
}
export async function unmute(id: number) {
  await updateMeta((m) => ({ ...m, muted: without(m.muted, [id]) }))
}

// 某本报刊近 30 天划掉了几篇（源医生用）
export function mutedRecently(m: Meta, feedId: number, days = 30): number {
  const since = Date.now() - days * DAY
  return Object.values(mutedOf(m)).filter((v) => v.f === feedId && v.t >= since).length
}

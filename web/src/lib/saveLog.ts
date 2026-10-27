// 保存信源的日志浮层（0.29，2026-10-26 Hana 定）：保存时在底部冒出一条，实时写到哪一步了。
// 不一一对应每个小环节，只让人知道大致到哪了：正在取文章 → （开了抓全文）正在获取全文 → 还在取 → 快好了 → 订好了。
// 超过 25 秒：加一句「后台继续取，订好了告诉你。」，浮层可以关掉、人可以走开，订完在当前页面弹提示。
// 哪一步出了问题就在那一行写原因，带「重试」（只重做那一步）。挂在 App 最外层（components/SaveLog.tsx），换页不断
import { useSyncExternalStore } from 'react'
import { toast } from '../components/Toast'

export type LineKind = 'step' | 'ok' | 'bad'
export type Line = { id: number; text: string; kind: LineKind; retry?: () => void }
export type Task = { id: number; title: string; lines: Line[]; state: 'run' | 'done' | 'fail'; started: number; bg: boolean; closed: boolean }

let tasks: Task[] = []
let seq = 0
const subs = new Set<() => void>()
const emit = () => { tasks = [...tasks]; subs.forEach((f) => f()) }
const edit = (id: number, f: (t: Task) => Task) => { tasks = tasks.map((t) => (t.id === id ? f(t) : t)); emit() }

export const BG_AFTER = 25e3

export type Log = {
  step: (text: string) => void              // 换掉当前进行中的那一行
  bad: (text: string, retry?: () => void) => void
  ok: (text: string) => void
  done: (text: string | null, failed?: boolean) => void   // 写最后一句（null：不另写，比如没成的那一行已经写了原因）；浮层关着的话改成弹提示
  elapsed: () => number
  reopen: () => void                         // 重试时：浮层重新出来、回到「进行中」
}

export function startLog(title: string): Log {
  const id = ++seq
  const task: Task = { id, title, lines: [], state: 'run', started: Date.now(), bg: false, closed: false }
  tasks = [...tasks.filter((t) => t.state === 'run'), task]
  emit()
  let bgTimer = 0
  const armBg = () => {
    window.clearTimeout(bgTimer)
    bgTimer = window.setTimeout(() => edit(id, (t) => (t.state === 'run' ? { ...t, bg: true } : t)), BG_AFTER)
  }
  armBg()
  const push = (line: Omit<Line, 'id'>, replaceStep: boolean) => edit(id, (t) => {
    const lines = replaceStep && t.lines.at(-1)?.kind === 'step' ? t.lines.slice(0, -1) : t.lines
    return { ...t, lines: [...lines, { ...line, id: ++seq }] }
  })
  return {
    step: (text) => push({ text, kind: 'step' }, true),
    bad: (text, retry) => push({ text, kind: 'bad', retry }, true),
    ok: (text) => push({ text, kind: 'ok' }, true),
    done: (text, failed = false) => {
      window.clearTimeout(bgTimer)
      if (text) push({ text, kind: failed ? 'bad' : 'ok' }, true)
      else edit(id, (t) => ({ ...t, lines: t.lines.filter((l, i) => !(i === t.lines.length - 1 && l.kind === 'step')) }))
      edit(id, (x) => ({ ...x, state: failed ? 'fail' : 'done' }))
      // 浮层已经关掉的：订完在当前页面弹一句；有没成的，点「看看」把浮层叫回来
      const t = taskOf(id)
      if (t?.closed) {
        const say = text ?? `《${t.title}》没订上`
        if (failed) toast({ text: say, kind: 'error', bird: 'oops', action: { label: '看看', run: () => edit(id, (x) => ({ ...x, closed: false })) } })
        else { toast({ text: say, bird: 'done' }); dropTask(id) }
      }
    },
    elapsed: () => Date.now() - task.started,
    reopen: () => { edit(id, (t) => ({ ...t, state: 'run', closed: false, lines: t.lines.filter((l) => !l.retry) })); armBg() },
  }
}

export function closeTask(id: number) { edit(id, (t) => ({ ...t, closed: true })) }
export function dropTask(id: number) { tasks = tasks.filter((t) => t.id !== id); emit() }
export const taskOf = (id: number) => tasks.find((t) => t.id === id)

export function useTasks(): Task[] {
  return useSyncExternalStore((f) => { subs.add(f); return () => subs.delete(f) }, () => tasks)
}

export const secs = (ms: number) => `${Math.max(1, Math.round(ms / 1000))} 秒`

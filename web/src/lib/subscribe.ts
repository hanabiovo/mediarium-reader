// 「保存」：报刊信息、栏目增减一起生效（阶段 6，Hana 定）。个别栏目订不上的，其余照常，订不上的把原因带回去
// 0.29（2026-10-26 Hana 定）：保存时底部一条日志浮层（lib/saveLog）写到哪一步了；成功失败这样判——
//   · Miniflux 回话说订上了：成功
//   · 回「已经订过了」：保存前就有这个地址 = 真重复；保存前没有 = 这次前一下已经订上了，按成功
//   · 超时、连不上、5xx：多半是它还在干活、中间的服务器先放弃了——不重订，每 5 秒查一次订阅列表，最多 2 分钟，出现了就算成功
//   · Miniflux 明确拒绝（不是订阅源、人机验证……）：失败，写原因，再体检一次附上结果，给「重试」
//   · 订上了但刊名、类别没写进去：不算没订上，单独一行，「重试」只重做这一步
//   原来「失败了等 1.5 秒自动再订一次」去掉了：第一次其实订上了，第二次报「已经订过了」，就是它造成的
// 0.21.2（2026-10-24）：
//   · 灵媒自建上的源订誊写服务的转发地址（feedUrlFor）
//   · 订不上就重新体检一次，把体检结果和原因一起带回去（Hana：体检能过的，保存时应该也能订上）
//   · Miniflux 里的源名写成「刊名 · 栏目」（只有一栏的报刊就写刊名）；这份报刊已有的栏目也顺手补上
import { ApiError, api, loadShelf, type Category, type Feed } from '../api/miniflux'
import { ensureUncategorized, updateMeta, type Meta } from '../api/meta'
import { minifluxOpts, type PaperForm, type SourceOpts } from '../components/SourcePick'
import { checkup, rsshubRoute, verdictLine, type Checkup } from './doctor'
import { currentMeta } from '../api/meta'
import { secs, startLog, type Log } from './saveLog'
import { feedUrlFor } from './hub'

export type Add = { key: string; url: string; column: string; opts: SourceOpts }
export type Failed = { key: string; why: string; check?: Checkup | null }
export type SaveResult = { added: number; removed: number; failed: Failed[] }

export function why(e: unknown): string {
  if (e instanceof ApiError) {
    if (/already exists/i.test(e.detail)) return '已经订过了'
    if (/unable to detect feed format/i.test(e.detail)) return '不是订阅源'
    if (/private network/i.test(e.detail)) return 'Miniflux 不肯取内网地址'
    if (/cloudflare|challenge/i.test(e.detail)) return '对方开了人机验证'
    return e.detail || `出错了（${e.status}）`
  }
  return String((e as Error).message || e)
}

// 栏目名：去掉打头的刊名（「澎湃新闻 - 思想市场」→「思想市场」）
export function shortColumn(title: string, paper: string): string {
  const t = title.trim()
  for (const p of [paper.trim(), paper.trim().replace(/(新闻|网|官网)$/, '')]) {
    if (p && t.startsWith(p) && t.length > p.length + 1) { const rest = t.slice(p.length).replace(/^[\s\-—–·:：|｜_]+/, ''); if (rest) return rest }
  }
  return t
}
export const feedTitle = (paper: string, column: string | undefined, single: boolean) =>
  single || !column?.trim() ? paper.trim() : `${paper.trim()} · ${column.trim()}`

const wait = (ms: number) => new Promise((ok) => setTimeout(ok, ms))
// 像是「它还在干活，是中间先放弃了」的错：连不上、超时、服务器 5xx、太忙
const slowError = (e: unknown) => !(e instanceof ApiError) || e.status >= 500 || e.status === 408 || e.status === 429
const findFeed = async (url: string) => (await api.feeds()).find((f) => f.feed_url === url)
async function waitFeed(url: string, ms = 120e3): Promise<number | null> {
  const until = Date.now() + ms
  while (Date.now() < until) {
    await wait(5000)
    const f = await findFeed(url).catch(() => undefined)
    if (f) return f.id
  }
  return null
}

type One = { ok: true; id: number } | { ok: false; why: string; retry: boolean; check?: Checkup | null }
async function subscribeOne(a: Add, cat: number, had: Set<string>, log: Log, label: string): Promise<One> {
  const url = await feedUrlFor(a.url)
  log.step(`正在取文章${label}…`)
  const timers = [
    a.opts.crawler ? window.setTimeout(() => log.step(`正在获取全文${label}，要逐篇取，会久一点…`), 4000) : 0,
    window.setTimeout(() => log.step(`还在取${label}，有的网站回得慢…`), 15000),
  ]
  try {
    return { ok: true, id: (await api.createFeed(url, cat, minifluxOpts(a.opts))).feed_id }
  } catch (e) {
    if (e instanceof ApiError && /already exists/i.test(e.detail)) {
      if (had.has(url)) return { ok: false, why: '已经订过了', retry: false }
      const f = await findFeed(url).catch(() => undefined)
      if (f) return { ok: true, id: f.id }
      return { ok: false, why: why(e), retry: true }
    }
    if (slowError(e)) {
      timers.forEach((t) => window.clearTimeout(t))
      log.step(`还在取${label}，等它回话…`)
      const id = await waitFeed(url)
      if (id) return { ok: true, id }
      return { ok: false, why: '一直没回话', retry: true }
    }
    timers.forEach((t) => window.clearTimeout(t))
    log.step(`正在检查${label}…`)
    return { ok: false, why: why(e), retry: true, check: await checkup(a.url, a.opts.proxy ? 'proxy' : undefined) }
  } finally { timers.forEach((t) => window.clearTimeout(t)) }
}

type Job = {
  paperId: string; site?: string; domain?: string
  form: PaperForm; meta: Meta; categories: Category[]
  existing: Feed[]; adds: Add[]; removes: number[]
}

export async function savePaper(p: Job): Promise<SaveResult> {
  const name = p.form.name.trim() || p.paperId
  const log = startLog(name)
  return run(p, name, log)
}

async function run(p: Job, name: string, log: Log): Promise<SaveResult> {
  const multi = p.adds.length > 1
  const failed: Failed[] = []
  try {
    // 类别：新建的先建；无类别要先认出来
    let cat: number = typeof p.form.cat === 'number' ? p.form.cat : -1
    if (p.form.cat === 'new') {
      if (!p.form.newCat.trim()) throw new Error('新类别还没起名字。')
      cat = (await api.createCategory(p.form.newCat.trim())).id
      // 新建类别时选了符号（0.29.2）
      if (p.form.newIcon) { const cid = cat, ic = p.form.newIcon; await updateMeta((m) => ({ ...m, categories: { ...m.categories, [cid]: { ...m.categories[cid], icon: ic } } })).catch(() => {}) }
      p = { ...p, form: { ...p.form, cat } }   // 重试时不再建一遍
    }
    else if (!p.categories.some((c) => c.id === cat)) cat = await ensureUncategorized(p.meta, p.categories)

    const had = new Set((await api.feeds()).map((f) => f.feed_url))
    const added: { id: number; add: Add }[] = []
    for (const a of p.adds) {
      const col = a.column || a.url
      const r = await subscribeOne(a, cat, had, log, multi ? `（${col}）` : '')
      if (r.ok) { added.push({ id: r.id, add: a }); if (multi) log.ok(`${col}：订上了`) }
      else {
        failed.push({ key: a.key, why: r.why, check: r.check })
        const text = `${multi ? col + '：' : ''}没订上，${r.why}${r.check ? `。再体检一次：${verdictLine(r.check)}` : ''}`
        log.bad(text, r.retry ? () => { log.reopen(); retryAdd(p, a, name, log) } : undefined)
      }
    }
    let removed = 0
    for (const id of p.removes) {
      try { await api.deleteFeed(id); removed++ } catch (e) { failed.push({ key: 'rm:' + id, why: why(e) }); log.bad(`移除没成：${why(e)}`) }
    }

    if (added.length || p.removes.length || !p.adds.length) {
      log.step('快好了…')
      try { await finish(p, name, cat, added) }
      catch (e) {
        log.bad(`订上了，刊名和类别没写进去：${(e as Error).message}`, () => { log.reopen(); finish(p, name, cat, added).then(() => log.done(`《${name}》订好了`), (err) => log.done(`还是没写进去：${(err as Error).message}`, true)) })
        await loadShelf().catch(() => {})
        log.done(null, true)
        return { added: added.length, removed, failed }
      }
    }
    await loadShelf().catch(() => {})
    const took = secs(log.elapsed())
    if (!failed.length) log.done(p.adds.length ? `《${name}》订好了 · ${took}` : `《${name}》保存好了`)
    else if (added.length) log.done(`订好 ${added.length} 个，${failed.length} 个没订上`, true)
    else log.done(null, true)
    return { added: added.length, removed, failed }
  } catch (e) {
    log.bad(`没保存上：${(e as Error).message}`, () => { log.reopen(); run(p, name, log) })
    log.done(null, true)
    throw e
  }
}

// 重试某一栏：只订这一栏，订上了照样写刊名、类别、栏目名
async function retryAdd(p: Job, a: Add, name: string, log: Log) {
  const sh = await loadShelf().catch(() => null)
  const m = currentMeta()
  const existing = sh ? sh.feeds.filter((f) => m.feeds[f.id]?.paper === p.paperId) : p.existing
  await run({ ...p, meta: m, categories: sh?.categories ?? p.categories, existing, adds: [a], removes: [] }, name, log).catch(() => {})
}

// 订上以后：栏目名、Miniflux 里的源名（「刊名 · 栏目」）、类别，和灵媒设置里的报刊信息
async function finish(p: Job, name: string, cat: number, added: { id: number; add: Add }[]) {
  // 栏目名：新加入的用加入时的名字；已有的没记过的，从源名里去掉刊名得来
  const kept = p.existing.filter((f) => !p.removes.includes(f.id))
  const columns = new Map<number, string>()
  const derive = (f: Feed) => { const c = shortColumn(f.title, name); return c && c !== name ? c : rsshubRoute(f.feed_url) ?? '官方 RSS' }
  for (const f of kept) columns.set(f.id, p.meta.feeds[f.id]?.column || derive(f))
  for (const { id, add } of added) columns.set(id, add.column)
  const single = columns.size === 1
  // 已有的栏目跟着报刊换类别、补源名；新加入的写源名
  for (const f of kept) {
    const title = feedTitle(name, columns.get(f.id), single)
    const change = { ...(f.category.id !== cat ? { category_id: cat } : {}), ...(f.title !== title ? { title } : {}) }
    if (Object.keys(change).length) await api.updateFeed(f.id, change).catch(() => {})
  }
  for (const { id } of added) await api.updateFeed(id, { title: feedTitle(name, columns.get(id), single) }).catch(() => {})

  await updateMeta((m) => {
    const feeds = { ...m.feeds }
    for (const { id, add } of added) feeds[id] = { ...feeds[id], paper: p.paperId, column: add.column || undefined, ...(add.opts.trTitle ? { trTitle: true } : {}) }
    for (const f of kept) feeds[f.id] = { ...feeds[f.id], paper: feeds[f.id]?.paper || p.paperId, column: feeds[f.id]?.column || (single ? undefined : columns.get(f.id) || undefined) }
    for (const id of p.removes) delete feeds[id]
    return { ...m, feeds, papers: { ...m.papers, [p.paperId]: { name, latin: p.form.latin.trim() || undefined, site: p.site, domain: p.domain } } }
  })
}

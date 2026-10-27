// 源医生 · 巡诊页（5b-3，2026-10-22）：设置 › 信源 › 源医生。
// 进来就巡一遍（十分钟内来过就用上次的），要看看的源排在前面，每个源下面是对症的处方；
// 处方做完记进病历。都好的源收起来，点开也能单独体检。
import { ensureHub } from '../../lib/hub'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { api, loadShelf, type Feed } from '../../api/miniflux'
import { useMeta } from '../../api/meta'
import { useShelf } from '../../hooks/useShelf'
import { depthOf } from '../../hooks/useDeepNav'
import { LoadingNote } from '../../components/Bird'
import { toast, toastError } from '../../components/Toast'
import { clock, monthDay } from '../../lib/day'
import {
  cachedRound, changeFeedUrl, retarget, checkup, markFine, notesOf, original, patrol, hideEntries, routeOn, rsshubRoute, showUrl, instanceLabel, usable,
  verdictLine, writeNote, type Checkup, type Issue, type Round, type Ward,
} from '../../lib/doctor'
import { sourceOf, usePapers } from '../../lib/papers'
import { Block, SubPage } from './frame'

const ORDER: Issue['kind'][] = ['error', 'exam', 'summary', 'duplicate', 'stale', 'paused']
const rank = (w: Ward) => Math.min(...w.issues.map((i) => ORDER.indexOf(i.kind)))

type Exam = Checkup | null | 'busy' | undefined
function Case({ ward, label, feeds, onDone, exam, onExam }: { ward: Ward; label: string; feeds: Feed[]; onDone: (kind: Issue['kind'] | null) => void; exam: Exam; onExam: (v: Exam) => void }) {
  const meta = useMeta()
  const navigate = useNavigate()
  const { state } = useLocation()
  const { feed, issues } = ward
  const [busy, setBusy] = useState('')
  const [hosts, setHosts] = useState<{ url: string; c: Checkup | null | undefined }[] | null>(null)
  const route = rsshubRoute(feed.feed_url)
  const has = (k: Issue['kind']) => issues.some((i) => i.kind === k)
  const notes = notesOf(meta, feed.id)

  const run = async (key: string, f: () => Promise<void>) => {
    setBusy(key)
    try { await f() } catch (e) { toastError(`没成功：${(e as Error).message}`) } finally { setBusy('') }
  }

  const refetch = () => run('refetch', async () => {
    await api.refreshFeed(feed.id)
    toast('重新抓了，过会儿再巡一遍。')
  })
  const crawler = () => run('crawler', async () => {
    await api.updateFeed(feed.id, { crawler: true })
    await api.refreshFeed(feed.id).catch(() => {})
    await writeNote(feed.id, '开了抓取全文')
    await loadShelf().catch(() => {})
    toast('开了抓取全文，新文章起生效。')
    onDone('summary')
  })
  const resume = () => run('resume', async () => {
    await api.updateFeed(feed.id, { disabled: false })
    await writeNote(feed.id, '恢复更新')
    await loadShelf().catch(() => {})
    toast('恢复更新了。')
    onDone('paused')
  })
  const dedupe = (ids: number[]) => run('dedupe', async () => {
    await hideEntries(ids, feed.id, `去重：藏起 ${ids.length} 篇重复的`)
    toast(`藏起了 ${ids.length} 篇重复的。`)
    onDone('duplicate')
  })
  const tryHosts = async () => {
    if (!route) return
    await ensureHub()
    const list = routeOn(route, feeds, 6, original(feed.feed_url)).map((url) => ({ url, c: undefined as Checkup | null | undefined }))
    setHosts(list)
    await Promise.all(list.map(async (h) => {
      const c = await checkup(h.url)
      setHosts((cur) => cur?.map((x) => (x.url === h.url ? { ...x, c } : x)) ?? cur)
    }))
  }
  const moveTo = (url: string) => run('move', async () => {
    const from = instanceLabel(feed.feed_url), to = instanceLabel(url)
    await changeFeedUrl(feed.id, await retarget(feed.feed_url, url))
    await api.refreshFeed(feed.id).catch(() => {})
    await writeNote(feed.id, `换实例：${from} → ${to}`)
    await loadShelf().catch(() => {})
    toast(`换到 ${to} 了。`)
    setHosts(null)
    onDone(null)
  })
  // 已经绕道的源，体检也绕道（和 Miniflux 取的是同一条路）
  const examine = async () => { onExam('busy'); onExam(await checkup(feed.feed_url, feed.fetch_via_proxy ? 'proxy' : undefined)) }
  const fine = () => run('fine', async () => {
    await markFine(feed, issues.filter((i) => i.kind !== 'paused'))
    onExam(undefined)
    for (const i of issues) if (i.kind !== 'paused') onDone(i.kind)
    toast({ text: '好，6 小时内不提它。', bird: 'rest' })
  })
  const replace = () => navigate('/settings/sources/add', { state: { ...(state as object ?? {}), depth: depthOf(state) + 1, root: '/settings', addUrl: feed.site_url || original(feed.feed_url) } })

  return (
    <li className="doc-case">
      <span className="shelf-row-title">{label}</span>
      <span className="doc-url">{showUrl(feed.feed_url)}</span>
      {issues.map((i) => (
        <span key={i.kind} className={i.kind === 'error' ? 'doc-issue bad' : 'doc-issue'}>
          {i.text}{i.kind === 'error' && i.detail && <span className="health-error">{i.detail}</span>}
        </span>
      ))}
      {exam && <span className="doc-exam">{exam === 'busy' ? '体检中…' : exam === null ? '体检不了' : `体检：${verdictLine(exam)}`}</span>}

      <div className="doc-rx">
        {has('error') && <button onClick={refetch} disabled={!!busy}>{busy === 'refetch' ? '抓取中…' : '重新抓取'}</button>}
        {has('summary') && !feed.crawler && <button onClick={crawler} disabled={!!busy}>开抓取全文</button>}
        {issues.map((i) => i.kind === 'duplicate' && <button key="dup" onClick={() => dedupe(i.ids)} disabled={!!busy}>去重</button>)}
        {has('paused') && <button onClick={resume} disabled={!!busy}>恢复更新</button>}
        {/* RSSHub 源随时都能换实例（原来只在有毛病时出现，健康的源点不到，2026-10-22 Hana 验收时发现） */}
        {route && !hosts && <button onClick={tryHosts} disabled={!!busy}>换实例</button>}
        {(has('error') || has('exam') || has('stale') || (has('summary') && feed.crawler)) && <button onClick={replace} disabled={!!busy}>找替代源</button>}
        <button onClick={examine} disabled={exam === 'busy'}>{exam && exam !== 'busy' ? '再体检' : '体检'}</button>
        {/* 误报：收起 6 小时，到时间自动回来（2026-10-24 Hana） */}
        {issues.some((i) => i.kind !== 'paused') && <button onClick={fine} disabled={!!busy}>它没事</button>}
      </div>

      {hosts && (
        <ul className="doc-hosts">
          {hosts.map((h) => (
            <li key={h.url}>
              <span className="doc-url">{instanceLabel(h.url)}{usable(h.c) && <span className="cand-ok"> 可用</span>}</span>
              <span className={h.c && h.c.ok && !h.c.problem ? 'doc-issue' : 'doc-issue bad'}>
                {h.c === undefined ? '体检中…' : h.c === null ? '体检不了' : verdictLine(h.c)}
              </span>
              {usable(h.c) && <button onClick={() => moveTo(h.url)} disabled={!!busy}>换到这台</button>}
            </li>
          ))}
        </ul>
      )}

      {notes.length > 0 && (
        <details className="doc-notes">
          <summary>病历 {notes.length}</summary>
          {notes.map((n) => <span key={n.t}>{monthDay(new Date(n.t))} {clock(new Date(n.t))} · {n.what}</span>)}
        </details>
      )}
    </li>
  )
}

export function Doctor() {
  const papers = usePapers()   // 标「报刊 · 栏目」（阶段 6 第 3 步）
  const { data } = useShelf()
  const [round, setRound] = useState<Round | null>(() => { const r = cachedRound(); return r && Date.now() - r.at < 10 * 60 * 1000 ? r : null })
  const [running, setRunning] = useState(false)
  const [showWell, setShowWell] = useState(false)
  // 体检结果（按源记）：单个点「体检」和「全部体检」共用；体检出毛病的源挪到「要看看」
  const [exams, setExams] = useState<Record<number, Exam>>({})
  const [examining, setExamining] = useState(false)
  const setExam = (id: number) => (v: Exam) => setExams((m) => ({ ...m, [id]: v }))
  const examAll = async () => {
    if (!data) return
    setExamining(true)
    const list = [...data.feeds]
    let next = 0
    await Promise.all([0, 1, 2].map(async () => {
      while (next < list.length) {
        const f = list[next++]
        setExam(f.id)('busy')
        setExam(f.id)(await checkup(f.feed_url, f.fetch_via_proxy ? 'proxy' : undefined))
      }
    }))
    setExamining(false)
  }

  const go = async () => {
    if (!data) return
    setRunning(true)
    try { setRound(await patrol(data.feeds)) } catch (e) { toast({ text: `检查没跑完：${(e as Error).message}`, kind: 'error', bird: 'oops' }) } finally { setRunning(false) }
  }
  useEffect(() => { if (data && !round) go() }, [!!data]) // eslint-disable-line react-hooks/exhaustive-deps

  // 处方做完：把对应的毛病从这一轮里划掉（null = 换了地址，整个源等下一轮再看）
  const done = (id: number) => (kind: Issue['kind'] | null) => setRound((r) => r && {
    ...r, wards: r.wards.map((w) => (w.feed.id !== id ? w : { ...w, issues: kind ? w.issues.filter((i) => i.kind !== kind) : [] })),
  })

  if (!data) return <SubPage title="检查信源" parent="/settings/sources"><LoadingNote /></SubPage>
  // 用最新的报刊架数据（处方改过开关后，按钮跟着变）
  const fresh = (w: Ward): Ward => {
    const e = exams[w.feed.id]
    const bad = e && e !== 'busy' && (!e.ok || e.problem)
    const issues = bad && !w.issues.some((i) => i.kind === 'exam') ? [...w.issues, { kind: 'exam' as const, text: '体检没过' }] : w.issues
    return { ...w, issues, feed: data.feeds.find((f) => f.id === w.feed.id) ?? w.feed }
  }
  const all = (round?.wards ?? []).map(fresh)
  const sick = all.filter((w) => w.issues.length).sort((a, b) => rank(a) - rank(b))
  const well = all.filter((w) => !w.issues.length)
  const doneCount = Object.values(exams).filter((e) => e !== 'busy' && e !== undefined).length

  return (
    <SubPage title="检查信源" parent="/settings/sources">
      <div className="doc-status">
        <span className="mono-label">
          {running ? '检查中…' : round ? `${clock(new Date(round.at))} 检查 · ${round.total} 个源，${sick.length ? `${sick.length} 个要看看` : '都好'}` : ''}
        </span>
        <span className="doc-actions">
          <button className="form-text-btn" onClick={go} disabled={running}>再查一遍</button>
          <button className="form-text-btn" onClick={examAll} disabled={examining || running}>{examining ? `体检中 ${doneCount}/${data.feeds.length}` : '全部体检'}</button>
        </span>
      </div>

      {sick.length > 0 && (
        <Block title="要看看">
          <ul className="doc-list">{sick.map((w) => <Case key={w.feed.id} ward={w} label={sourceOf(papers, w.feed.id, w.feed.title).label} feeds={data.feeds} onDone={done(w.feed.id)} exam={exams[w.feed.id]} onExam={setExam(w.feed.id)} />)}</ul>
        </Block>
      )}
      {well.length > 0 && (
        <Block title="都好">
          <button className="form-text-btn" onClick={() => setShowWell((v) => !v)}>{showWell ? '收起' : `${well.length} 个源，展开看`}</button>
          {showWell && <ul className="doc-list">{well.map((w) => <Case key={w.feed.id} ward={w} label={sourceOf(papers, w.feed.id, w.feed.title).label} feeds={data.feeds} onDone={done(w.feed.id)} exam={exams[w.feed.id]} onExam={setExam(w.feed.id)} />)}</ul>}
        </Block>
      )}
    </SubPage>
  )
}

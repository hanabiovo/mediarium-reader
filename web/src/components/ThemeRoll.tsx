// 寒鸦衔色（随机配色，2026-10-24 Hana 定；草图：草图/随机配色 草图 v1.html）。在外观页「配色」下面。
//   · 飞着的鸦 +「寒鸦衔色」：点一下 roll 一组（一明一暗），整个界面立刻换上；旁边撤销，往回退（最多十来步，离开页面清掉）
//   · roll 过以后：两条色卡（明 / 暗）、名字、「保存」→ 起名小面板（名字先替你起好，最长 12 个字）
//   · 我的配色：一排小卡片，纸色作底、墨色写名字、角上一只强调色的鸦，横着滑；点一下用它，长按（电脑右键）改名 / 删除
//   · 没保存就离开外观页：问一声（RollGuard，挂在 App 里）
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { updateMeta, useMeta, type SavedTheme } from '../api/meta'
import { applySaved, discardRoll, prevName, previewRoll, rolling, setTheme, useTheme } from '../theme/theme'
import { rollTheme, type Rolled } from '../theme/roll'
import { useLongPress } from '../hooks/useLongPress'
import { Bird } from './Bird'
import { Sheet } from './Sheet'
import { toast, toastError } from './Toast'

const NAME_MAX = 12
const APPEARANCE = '/settings/appearance'
let history: Rolled[] = []   // 这一轮 roll 过的，撤销用；离开页面（保存 / 不保存）就清掉

// roll 了没保存时去点别的配色（预设或存下的）：先问一声（2026-10-24 Hana 测出的漏洞）。
// 不保存 → 直接换成点的那套；保存 → 存下以后再换；取消 → 留在 roll 的这套
type Ask = { then?: () => void }
let asked: Ask | null = null
const askers = new Set<() => void>()
const setAsked = (a: Ask | null) => { asked = a; askers.forEach((f) => f()) }
export function guardSwitch(go: () => void) { if (rolling()) setAsked({ then: go }); else go() }

async function saveRolled(c: Rolled, name: string) {
  const t: SavedTheme = { id: 'u:' + Date.now().toString(36), name: name.trim().slice(0, NAME_MAX) || c.name, light: c.light, dark: c.dark }
  await updateMeta((m) => ({ ...m, themes: [...(m.themes ?? []), t] }))
  applySaved(t.id, { name: t.name, light: t.light, dark: t.dark })
  history = []
  return t
}

export function ThemeRoll() {
  const theme = useTheme()
  const meta = useMeta()
  const saved = meta.themes ?? []
  const [, bump] = useState(0)
  const [flap, setFlap] = useState(0)
  const [naming, setNaming] = useState(false)
  const [menu, setMenu] = useState<{ t: SavedTheme; anchor: HTMLElement } | null>(null)
  const [renaming, setRenaming] = useState<{ t: SavedTheme; anchor: HTMLElement } | null>(null)
  const saveBtn = useRef<HTMLButtonElement>(null)
  const cur = rolling() ? theme.custom as Rolled | undefined : undefined

  const roll = () => {
    const r = rollTheme(saved.map((t) => t.name))
    history = [...history, r].slice(-12)
    previewRoll(r)
    setFlap((n) => n + 1); bump((n) => n + 1)
  }
  const undo = () => {
    if (history.length < 2) return
    history = history.slice(0, -1)
    previewRoll(history.at(-1)!)
    bump((n) => n + 1)
  }
  const use = (t: SavedTheme) => guardSwitch(() => { history = []; applySaved(t.id, { name: t.name, light: t.light, dark: t.dark }) })
  const remove = async (t: SavedTheme) => {
    const at = saved.findIndex((x) => x.id === t.id), wasOn = theme.theme === t.id
    setMenu(null)
    try {
      await updateMeta((m) => ({ ...m, themes: (m.themes ?? []).filter((x) => x.id !== t.id) }))
      if (wasOn) setTheme({ theme: 'paper', custom: undefined })
      toast({ text: `删掉了「${t.name}」。`, action: { label: '撤销', run: () => {
        updateMeta((m) => { const l = [...(m.themes ?? [])]; l.splice(Math.min(at, l.length), 0, t); return { ...m, themes: l } }).catch(() => {})
        if (wasOn) use(t)
      } } })
    } catch (e) { toastError((e as Error).message) }
  }
  const rename = async (t: SavedTheme, name: string) => {
    const n = name.trim().slice(0, NAME_MAX)
    if (!n) return
    setRenaming(null)
    try {
      await updateMeta((m) => ({ ...m, themes: (m.themes ?? []).map((x) => (x.id === t.id ? { ...x, name: n } : x)) }))
      if (theme.theme === t.id) applySaved(t.id, { name: n, light: t.light, dark: t.dark })
    } catch (e) { toastError((e as Error).message) }
  }

  return (
    <div className="roll">
      <div className="roll-head">
        <button key={flap} className={flap ? 'roll-bird flap' : 'roll-bird'} onClick={roll} aria-label="寒鸦衔色：随机一组配色">
          <Bird name="departing" /><span className="roll-title">寒鸦衔色</span>
        </button>
        <button className="roll-undo" onClick={undo} disabled={history.length < 2} aria-label="撤销" title="撤销">↶</button>
      </div>
      {cur && (
        <div className="roll-now">
          <div className="roll-strips">
            {(['light', 'dark'] as const).map((m) => (
              <div key={m} className="roll-strip" style={{ background: cur[m].bg, color: cur[m].ink, borderColor: cur[m].rule }}>
                <span className="mono-label" style={{ color: cur[m].mid }}>{m === 'light' ? '明' : '暗'}</span>
                <span className="roll-dots">{[cur[m].ink, cur[m].mid, cur[m].accent].map((c, i) => <i key={i} style={{ background: c }} />)}</span>
              </div>
            ))}
          </div>
          <div className="roll-save">
            <span className="roll-name">{cur.name}</span>
            <button ref={saveBtn} className="form-submit" onClick={() => setNaming(true)}>保存</button>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <>
          <span className="sheet-label roll-mine-label">我的配色</span>
          <div className="roll-mine">
            {saved.map((t) => <MiniCard key={t.id} t={t} mode={theme.resolved} on={theme.theme === t.id} onPick={() => use(t)} onHold={(anchor) => setMenu({ t, anchor })} />)}
          </div>
        </>
      )}

      {naming && cur && <NameSheet title="存下这组配色" initial={cur.name} anchor={saveBtn.current} onClose={() => setNaming(false)}
        onSave={async (n) => { try { const t = await saveRolled(cur, n); setNaming(false); toast(`存下了「${t.name}」。`) } catch (e) { toastError((e as Error).message) } }} />}
      {menu && (
        <Sheet title={menu.t.name} placement="anchor" anchor={menu.anchor} onClose={() => setMenu(null)}>
          <div className="sheet-actions">
            <button className="sheet-action" onClick={() => { setRenaming(menu); setMenu(null) }}>改名</button>
            <button className="sheet-action danger" onClick={() => remove(menu.t)}>删除</button>
          </div>
        </Sheet>
      )}
      {renaming && <NameSheet title="改名" initial={renaming.t.name} anchor={renaming.anchor} onClose={() => setRenaming(null)} onSave={(n) => rename(renaming.t, n)} />}
    </div>
  )
}

function MiniCard({ t, mode, on, onPick, onHold }: { t: SavedTheme; mode: 'light' | 'dark'; on: boolean; onPick: () => void; onHold: (a: HTMLElement) => void }) {
  const ref = useRef<HTMLButtonElement>(null)
  const { pressing, bind } = useLongPress(() => ref.current && onHold(ref.current))
  const p = t[mode]
  return (
    <button ref={ref} {...bind} className={['roll-card', on && 'on', pressing && 'pressing'].filter(Boolean).join(' ')} aria-pressed={on}
      style={{ background: p.bg, color: p.ink, borderColor: p.rule }} onClick={onPick} title={t.name}>
      <span className="roll-card-name">{t.name}</span>
      <Bird name="perched" className="roll-card-bird" style={{ color: p.accent }} />
    </button>
  )
}

function NameSheet({ title, initial, anchor, onClose, onSave }: { title: string; initial: string; anchor: HTMLElement | null; onClose: () => void; onSave: (n: string) => void }) {
  const [name, setName] = useState(initial)
  return (
    <Sheet title={title} placement="anchor" anchor={anchor} form focusInput onClose={onClose}>
      <div className="form-rows">
        <label className="sheet-label" htmlFor="roll-name">名字</label>
        <input id="roll-name" className="form-input serif" value={name} maxLength={NAME_MAX} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="form-actions"><button className="form-text-btn" onClick={onClose}>算了</button><button className="form-submit" disabled={!name.trim()} onClick={() => onSave(name)}>保存</button></div>
    </Sheet>
  )
}

// 没保存就离开外观页：问一声。保存 → 起名；不保存 → 换回 roll 之前那套；取消 → 回外观页
export function RollGuard() {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const theme = useTheme()
  const [, bump] = useState(0)
  const [naming, setNaming] = useState(false)
  useEffect(() => { const f = () => bump((n) => n + 1); askers.add(f); return () => { askers.delete(f) } }, [])
  // 离开外观页：问一声（取消就回去）
  const [leaving, setLeaving] = useState(false)
  useEffect(() => { if (rolling() && pathname !== APPEARANCE) setLeaving(true) }, [pathname])
  useEffect(() => {
    if (theme.theme !== 'roll') return
    const h = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [theme.theme])
  const cur = rolling() ? (theme.custom as Rolled | undefined) : undefined
  const pending = asked
  if (!cur || (!leaving && !pending)) return null
  const done = () => { setLeaving(false); setAsked(null); history = [] }
  const cancel = () => { if (leaving) navigate(APPEARANCE); setLeaving(false); setAsked(null) }
  if (naming) return <NameSheet title="存下这组配色" initial={cur.name} anchor={null} onClose={() => setNaming(false)}
    onSave={async (n) => {
      try { const t = await saveRolled(cur, n); setNaming(false); const then = pending?.then; done(); then?.(); toast(`存下了「${t.name}」。`) }
      catch (e) { toastError((e as Error).message) }
    }} />
  return (
    <Sheet title="随机主题还未保存，要保存吗？" placement="bottom" anchor={null} onClose={cancel}>
      <p className="sheet-note">{pending?.then ? '不保存就直接换过去。' : `不保存就换回原来那套「${prevName() || '纸本'}」。`}</p>
      <div className="sheet-actions">
        <button className="sheet-action" onClick={() => setNaming(true)}>保存</button>
        <button className="sheet-action" onClick={() => { const then = pending?.then; if (!then) discardRoll(); done(); then?.() }}>不保存</button>
        <button className="sheet-action quiet" onClick={cancel}>取消</button>
      </div>
    </Sheet>
  )
}

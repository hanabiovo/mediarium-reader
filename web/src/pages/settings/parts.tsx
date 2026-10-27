// 外观设置的几块零件（3e）。设置页和文章里的 Aa 面板用的是同一份：
// 「一项设置只有一个家，可以有快捷方式」——文章排版的家在设置页，Aa 是它的快捷入口（2026-10-21 定）。
import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { LATIN_FONTS, UI_PRESETS } from '../../typo/fonts'
import { importLocalFont, removeLocalFont } from '../../typo/localFonts'
import { LEADING_STEPS, SIZE_STEPS, addLinkFont, addLocalFont, dropFont, setTypo, useFonts, useTypo } from '../../typo/settings'
import { THEMES } from '../../theme/themes'
import { setTheme, toggleMode, useTheme, type Mode } from '../../theme/theme'
import { toast, toastError } from '../../components/Toast'
import { guardSwitch } from '../../components/ThemeRoll'

const MODES: [Mode, string][] = [['auto', '跟随系统'], ['light', '浅'], ['dark', '深']]

// 配色：五套主题，每张小样用那套主题自己的颜色画（当前明暗下的那一面）
export function ThemePicker() {
  const t = useTheme()
  return (
    <div className="set-group">
      <div className="set-choices" role="radiogroup" aria-label="深浅色">
        {MODES.map(([m, label]) => (
          <button key={m} role="radio" aria-checked={t.mode === m} className={t.mode === m ? 'set-choice on' : 'set-choice'}
            onClick={() => setTheme({ mode: m, override: undefined })}>{label}</button>
        ))}
      </div>
      {t.mode === 'auto' && t.override && <p className="typo-hint set-hint">当前临时为{t.override.mode === 'dark' ? '深' : '浅'}色（在文章里切的），系统下次切换深浅时恢复跟随。</p>}
      <div className="theme-grid" role="radiogroup" aria-label="配色">
        {THEMES.map((th) => {
          const p = th[t.resolved]
          return (
            <button key={th.id} role="radio" aria-checked={t.theme === th.id} className={t.theme === th.id ? 'theme-card on' : 'theme-card'}
              style={{ background: p.bg, color: p.ink }} onClick={() => guardSwitch(() => setTheme({ theme: th.id }))}>
              <span className="theme-card-name">{th.label}</span>
              <span className="theme-card-body" style={{ color: p.body }}>正文的样子</span>
              <span className="theme-card-link" style={{ color: p.accent }}>链接</span>
              <span className="theme-card-note" style={{ color: p.mid }}>{th.note}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function UiFontPicker() {
  const t = useTypo()
  return (
    <div className="set-group">
    <div className="typo-presets">
      {UI_PRESETS.map((u) => (
        <button key={u.id} className={u.id === t.ui ? 'typo-preset on' : 'typo-preset'} onClick={() => setTypo({ ui: u.id })}>
          <span className="typo-preset-name">{u.label}</span>
          <span className="typo-preset-note">{u.note}</span>
        </button>
      ))}
    </div>
    <label className="set-check">
      <input type="checkbox" checked={t.sync} onChange={(e) => setTypo({ sync: e.target.checked })} />
      <span>文章字体同步</span>
      <span className="set-check-note">标题、正文、西文跟着界面字体走；在文章排版里改字体就取消</span>
    </label>
    </div>
  )
}

// 文章排版。inArticle：在 Aa 面板里——加深浅色快捷切换和「管理字体库」的跳转
export function ReadingControls({ inArticle = false }: { inArticle?: boolean }) {
  const t = useTypo()
  const fonts = useFonts()
  const theme = useTheme()
  const cjk = (k: 'body' | 'title') => (
    <select value={t.article[k]} onChange={(e) => setTypo({ article: { [k]: e.target.value } })}>
      {fonts.map((f) => <option key={f.id} value={f.id}>{f.label}{f.source === 'local' ? '（本机）' : f.source === 'link' ? '（外链）' : ''}</option>)}
    </select>
  )
  return (
    <div className="set-group">
      {t.sync && <p className="typo-hint set-hint">正在跟随界面字体；在这里换字体会取消同步。</p>}
      <label className="typo-row"><span className="sheet-label">正文</span>{cjk('body')}</label>
      <label className="typo-row"><span className="sheet-label">标题</span>{cjk('title')}</label>
      <label className="typo-row">
        <span className="sheet-label">西文</span>
        <select value={t.article.latin} onChange={(e) => setTypo({ article: { latin: e.target.value } })}>
          {LATIN_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      {t.article.latin === 'builtin' && <p className="typo-hint">英文用正文、标题字体各自带的。</p>}
      <label className="typo-row">
        <span className="sheet-label">字号</span>
        <input type="range" min={0} max={SIZE_STEPS.length - 1} step={1} value={SIZE_STEPS.indexOf(t.size)}
          onChange={(e) => setTypo({ size: SIZE_STEPS[Number(e.target.value)] })} />
        <span className="mono-label">{t.size}PX</span>
      </label>
      <label className="typo-row">
        <span className="sheet-label">行距</span>
        <input type="range" min={0} max={LEADING_STEPS.length - 1} step={1} value={LEADING_STEPS.indexOf(t.leading)}
          onChange={(e) => setTypo({ leading: LEADING_STEPS[Number(e.target.value)] })} />
        <span className="mono-label">{t.leading.toFixed(2)}</span>
      </label>
      <label className="typo-row">
        <span className="sheet-label">首行缩进</span>
        <input type="checkbox" checked={t.indent} onChange={(e) => setTypo({ indent: e.target.checked })} />
      </label>
      {inArticle && (
        <div className="typo-row">
          <span className="sheet-label">深浅</span>
          <button className="typo-btn" onClick={toggleMode}>{theme.resolved === 'dark' ? '换成浅色' : '换成深色'}</button>
        </div>
      )}
      {inArticle && <Link className="typo-btn set-more" to="/settings/appearance/fonts" state={{ depth: 1 }}>管理字体库…</Link>}
    </div>
  )
}

// 字体库：本机导入 + 外链 + 列表。只在设置页
export function FontLibrary() {
  const fonts = useFonts()
  const file = useRef<HTMLInputElement>(null)
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')
  const pick = async (f?: File) => {
    if (!f) return
    toast('导入中…')
    try { const font = await importLocalFont(f); addLocalFont(font); toast(`已导入「${font.label}」，存在这台设备上。`) }
    catch { toast({ text: '认不出这个文件，换 .ttf / .otf / .woff2 试试。', kind: 'error', bird: 'puzzled' }) }
  }
  const link = async () => {
    if (!url.trim()) return
    toast('读取中…')
    try { const f = await addLinkFont(url.trim(), name); toast(`已加入「${f.label}」。`); setUrl(''); setName('') }
    catch (e) { toastError((e as Error).message) }
  }
  const mine = fonts.filter((f) => f.source === 'local' || f.source === 'link')
  return (
    <div className="set-group">
      <p className="page-note">可用在正文和标题上。本机字体每台设备各导一次。</p>
      <div className="typo-row">
        <span className="sheet-label">本机</span>
        <button className="typo-btn" onClick={() => file.current?.click()}>导入字体文件</button>
        <input ref={file} type="file" accept=".ttf,.otf,.woff,.woff2" hidden onChange={(e) => { pick(e.target.files?.[0]); e.target.value = '' }} />
      </div>
      <div className="typo-row typo-link">
        <span className="sheet-label">外链</span>
        <input className="form-input mono" placeholder="字体样式表地址（.css）" value={url} onChange={(e) => setUrl(e.target.value)} />
        <span />
        <span />
        <input className="form-input" placeholder="字体名（读不出来时手填）" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="typo-btn" onClick={link}>加入</button>
      </div>
      {mine.length > 0 && <h3 className="sheet-label set-sub">已加入</h3>}
      {mine.map((f) => (
        <div key={f.id} className="typo-row">
          <span className="mono-label">{f.source === 'local' ? '本机' : '外链'}</span>
          <span style={{ fontFamily: `'${f.family}'` }}>{f.label}</span>
          <button className="typo-btn danger" onClick={async () => { if (f.source === 'local') await removeLocalFont(f.id); dropFont(f.id) }}>移除</button>
        </div>
      ))}
      <p className="page-note">预设字体共 {fonts.filter((f) => f.source === 'preset').length} 款，来自 zeoseven 字体站。</p>
    </div>
  )
}

// 临时排版面板（3d 验收用）。分三块：界面（预设，设置页的外观设置，所以排最上）、文章、字体库。
// 3e 做设置页和文章里的排版设置栏（Aa）时换成正式入口，这一块整个拿掉；文章内的面板不放「界面」。
import { useRef, useState } from 'react'
import { LATIN_FONTS, UI_PRESETS } from '../typo/fonts'
import { importLocalFont, removeLocalFont } from '../typo/localFonts'
import { LEADING_STEPS, SIZE_STEPS, addLinkFont, addLocalFont, dropFont, setTypo, useFonts, useTypo } from '../typo/settings'

// 示范文字用《桃花源记》开头（公版），之后换一段 Hana 挑的好文字
const SAMPLE_TITLE = '桃花源记：Utopia 的东方版本'
const SAMPLE_BODY = '晋太元中，武陵人捕鱼为业。缘溪行，忘路之远近。忽逢桃花林，夹岸数百步，中无杂树，芳草鲜美，落英缤纷。渔人甚异之，复前行，欲穷其林。'

export function TypoPanel() {
  const t = useTypo()
  const fonts = useFonts()
  const file = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState('')
  const [url, setUrl] = useState('')
  const [name, setName] = useState('')

  const pick = async (f?: File) => {
    if (!f) return
    setMsg('导入中…')
    try { const font = await importLocalFont(f); addLocalFont(font); setMsg(`已导入「${font.label}」，存在这台设备上。`) }
    catch { setMsg('这个文件浏览器认不出来，换一个 .ttf / .otf / .woff2 试试。') }
  }
  const link = async () => {
    if (!url.trim()) return
    setMsg('读取中…')
    try { const f = await addLinkFont(url.trim(), name); setMsg(`已加入「${f.label}」。`); setUrl(''); setName('') }
    catch (e) { setMsg((e as Error).message) }
  }
  const cjk = (k: 'body' | 'title') => (
    <select value={t.article[k]} onChange={(e) => setTypo({ article: { [k]: e.target.value } })}>
      {fonts.map((f) => <option key={f.id} value={f.id}>{f.label}{f.source === 'local' ? '（本机）' : f.source === 'link' ? '（外链）' : ''}</option>)}
    </select>
  )

  return (
    <section className="typo-panel">
      <h2 className="typo-panel-title">外观 <span className="mono-label">临时面板 · 3e 换正式入口</span></h2>

      <div className="typo-group">
        <span className="sheet-label">界面字体</span>
        <div className="typo-presets">
          {UI_PRESETS.map((u) => (
            <button key={u.id} className={u.id === t.ui ? 'typo-preset on' : 'typo-preset'} onClick={() => setTypo({ ui: u.id })}>
              <span className="typo-preset-name">{u.label}</span>
              <span className="typo-preset-note">{u.note}</span>
            </button>
          ))}
        </div>
      </div>

      <h2 className="typo-panel-title">文章</h2>
      <label className="typo-row"><span className="sheet-label">正文</span>{cjk('body')}</label>
      <label className="typo-row"><span className="sheet-label">标题</span>{cjk('title')}</label>
      <label className="typo-row">
        <span className="sheet-label">西文</span>
        <select value={t.article.latin} onChange={(e) => setTypo({ article: { latin: e.target.value } })}>
          {LATIN_FONTS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
        </select>
      </label>
      {t.article.latin === 'builtin' && <p className="typo-hint">正文里的英文用正文字体自带的，标题里的用标题字体自带的。</p>}
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
      <div className="typo-sample">
        <p className="mono-label">预览 · 文章标题与正文</p>
        <h3 className="typo-sample-title">{SAMPLE_TITLE}</h3>
        <div className="prose"><p>{SAMPLE_BODY}</p></div>
      </div>

      <h2 className="typo-panel-title">字体库 <span className="mono-label">文章组可用</span></h2>
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
      {fonts.filter((f) => f.source === 'local' || f.source === 'link').map((f) => (
        <div key={f.id} className="typo-row">
          <span className="mono-label">{f.source === 'local' ? '本机' : '外链'}</span>
          <span style={{ fontFamily: `'${f.family}'` }}>{f.label}</span>
          <button className="typo-btn danger" onClick={async () => { if (f.source === 'local') await removeLocalFont(f.id); dropFont(f.id) }}>移除</button>
        </div>
      ))}
      {msg && <p className="page-note">{msg}</p>}
    </section>
  )
}

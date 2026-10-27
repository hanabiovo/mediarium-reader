// 设置页（3e，2026-10-21 定）：一级列表，点进二级页。
//   外观 —— 配色与深浅色、界面字体，再往下：文章排版、字体库
//   信源 —— 我的信源（策展：分类、增删、进不进信息流）+ 源医生（接诊 = 添加信源、巡诊）+ 去找源 + 搬家（5b-3 按 Hana 的分工重排）
//   翻译（阶段 4）、源管家（阶段 5）先留栏位
//   账户、关于
import { useEffect, useRef, useState } from 'react'
import { Link, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, logout, myKeyId, type ApiKey } from '../api/miniflux'
import { clock, monthDay } from '../lib/day'
import { DISCOVER_LINKS } from '../lib/sources'
import { deliver } from '../lib/exporter'
import { importOpmlFile } from '../lib/opml'
import { toast, toastError } from '../components/Toast'
import { PageHeader } from '../components/PageHeader'
import { EggLogo } from '../components/EggLogo'
import { crowOn, setCrowOn, LINES } from '../lib/crow'
import { Bird } from '../components/Bird'
import { depthOf } from '../hooks/useDeepNav'
import { Block, SubPage } from './settings/frame'
import { Mcp } from './settings/Mcp'
import { useNewAlerts } from '../lib/mcp'
import { Doctor } from './settings/Doctor'
import { Translate } from './settings/Translate'
import { Admin } from './settings/Admin'
import { AddSource } from './settings/AddSource'
import { SitePage } from './settings/SitePage'
import { useTrConfig } from '../lib/translate'
import { FontLibrary, ReadingControls, ThemePicker, UiFontPicker } from './settings/parts'
import { THEMES } from '../theme/themes'
import { useTheme } from '../theme/theme'
import { UI_PRESETS } from '../typo/fonts'
import { useTypo } from '../typo/settings'
import { autoReadOn, setAutoRead } from '../lib/attention'
import { ink, inkBoldOn, inkFlashOn, setInkBold, setInkFlash } from '../lib/native'
import { markReady } from '../components/Welcome'
import { typeset } from '../typo/typeset'
import { ThemeRoll } from '../components/ThemeRoll'

// 往下一层：历史里记一层深度（返回 = 退一步），保留从报刊架带来的状态
function useDeeper() {
  const { state } = useLocation()
  return { ...(state as object ?? {}), depth: depthOf(state) + 1, root: '/settings' }
}

function Row({ to, title, note, soon, dot }: { to?: string; title: string; note?: string; soon?: string; dot?: boolean }) {
  const state = useDeeper()
  const body = (
    <>
      <span className="set-row-title">{title}{dot && <span className="set-dot" aria-label="有新情况" />}</span>
      {note && <span className="set-row-note">{note}</span>}
      {soon ? <span className="mono-label">{soon}</span> : <span className="set-row-go" aria-hidden="true">›</span>}
    </>
  )
  if (!to) return <div className="set-row soon">{body}</div>
  return <Link className="set-row" to={to} state={state}>{body}</Link>
}

function Home() {
  useEffect(() => { markReady() }, [])
  const theme = useTheme()
  const typo = useTypo()
  const themeName = THEMES.find((t) => t.id === theme.theme)?.label ?? theme.custom?.name ?? ''
  const uiName = UI_PRESETS.find((u) => u.id === typo.ui)?.label
  const modeName = { auto: '跟随系统', light: '浅色', dark: '深色' }[theme.mode]
  const alerts = useNewAlerts()
  return (
    <>
      <PageHeader title="设置" subtitle="Preferences" lead={<EggLogo size={40} />} leadLine={`V${__APP_VERSION__}`} />
      <div className="page-body set-home">
        <div className="set-list">
          <Row to="/settings/appearance" title="外观" note={`${themeName} · ${modeName} · 界面${uiName}`} />
          <Row to="/settings/sources" title="信源" note="报刊管理、添加、检查、搬家" dot={alerts > 0} />
          <Row to="/settings/translate" title="翻译" note="引擎、密钥、用量" />
          <Row to="/settings/mcp" title="接入 AI 助手" note="MCP · 读文章、找源、管订阅" />
          <Row to="/settings/account" title="账户" />
          <Row to="/settings/about" title="关于" note={`V${__APP_VERSION__}`} />
        </div>
      </div>
    </>
  )
}

function Appearance() {
  return (
    <SubPage title="外观" parent="/settings">
      <Block title="配色"><ThemePicker /><ThemeRoll /></Block>
      <Block title="界面字体"><UiFontPicker /></Block>
      <Block title="信息流"><AutoReadSwitch /></Block>
      {ink && <Block title="墨水屏"><InkSwitches /></Block>}
      <div className="set-list">
        <Row to="/settings/appearance/reading" title="文章排版" note="正文、标题、西文、字号、行距" />
        <Row to="/settings/appearance/fonts" title="字体库" note="本机字体、外链字体" />
      </div>
    </SubPage>
  )
}

// 示范文字（2026-10-24 Hana：格式太少、洋文太少）：一段管一样——
//   中文正文与首行缩进（《桃花源记》开头，公版）、中西混排 + 粗体斜体 + 链接、纯英文（西文字体、断词）、
//   分隔（换成鸟）、一首小诗（寒鸦写的）、文末的鸟。正文照文章页一样排一遍（typeset）
const SAMPLE_TITLE = '桃花源记：Utopia 的东方版本'
const SAMPLE_HTML = `
<p>晋太元中，武陵人捕鱼为业。缘溪行，忘路之远近。忽逢桃花林，夹岸数百步，中无杂树，芳草鲜美，落英缤纷。</p>
<p>一千一百多年后，Thomas More 在 1516 年给这种地方起了名字：<strong>Utopia</strong>，字面是 <em>ou-topos</em>，“没有的地方”；读起来又像 <em>eu-topos</em>，“好地方”。<a href="#">文中链接</a>。</p>
<p lang="en">Every map of paradise is also a map of the way out. The fisherman marked his path carefully, and still could not find it twice.</p>
<hr>
<h4>寒鸦记路</h4>
<p class="prose-poem">桃花落在来时的水上，<br>我把每一个弯都记下。<br>回头时，溪还是那条溪，<br>只是没有一朵花认得我。</p>`

function Reading() {
  const sample = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = sample.current
    if (!el) return
    el.innerHTML = SAMPLE_HTML
    el.querySelectorAll('a').forEach((a) => a.addEventListener('click', (e) => e.preventDefault()))
    return typeset(el)
  }, [])
  return (
    <SubPage title="文章排版" parent="/settings/appearance">
      <p className="page-note">读文章时点右上角的 Aa，也能调这些。</p>
      <ReadingControls />
      <div className="typo-sample">
        <p className="mono-label">预览 · 文章标题与正文</p>
        <h3 className="typo-sample-title">{SAMPLE_TITLE}</h3>
        <div className="prose" ref={sample} />
      </div>
    </SubPage>
  )
}

function Fonts() {
  return <SubPage title="字体库" parent="/settings/appearance"><FontLibrary /></SubPage>
}

function Sources() {
  const file = useRef<HTMLInputElement>(null)
  const alerts = useNewAlerts()
  const exportOpml = async () => {
    try {
      const xml = await api.exportOpml()
      const r = await deliver(`灵媒信源 ${new Date().toISOString().slice(0, 10)}.opml`, new Blob([xml], { type: 'text/x-opml' }))
      if (r === 'saved') toast('已导出 OPML。')
    } catch (e) { toastError(`导出没成功：${(e as Error).message}`) }
  }
  const importOpml = importOpmlFile
  return (
    <SubPage title="信源" parent="/settings">
      {/* 0.23（2026-10-24 Hana 定）：报刊管理、添加信源、检查信源一排在前；搬家其次；去找源收到最底下（添加信源自己能找了） */}
      <div className="set-list">
        <Row to="/shelf/manage" title="报刊管理" note="分类、报刊、栏目" />
        <Row to="/settings/sources/add" title="添加信源" note="贴网址或输站点名，体检后推荐" />
        <Row to="/settings/sources/doctor" title="检查信源" note={alerts > 0 ? `每日巡诊发现 ${alerts} 个新情况` : '报错、久不更新、摘要、重复'} dot={alerts > 0} />
      </div>
      <Block title="搬家">
        <div className="set-list">
          <button className="set-row" onClick={() => file.current?.click()}>
            <span className="set-row-title">导入 OPML</span><span className="set-row-note">从 Folo、Inoreader 等导出的文件</span><span className="set-row-go" aria-hidden="true">›</span>
          </button>
          <button className="set-row" onClick={exportOpml}>
            <span className="set-row-title">导出 OPML</span><span className="set-row-note">带分类</span><span className="set-row-go" aria-hidden="true">›</span>
          </button>
        </div>
        <input ref={file} type="file" accept=".opml,.xml,text/xml,text/x-opml" hidden onChange={(e) => { importOpml(e.target.files?.[0]); e.target.value = '' }} />
      </Block>
      <p className="page-note set-find">去找源：{DISCOVER_LINKS.map((l, n) => (
        <span key={l.url}>{n ? ' · ' : ''}<a href={l.url} target="_blank" rel="noopener noreferrer" title={l.note}>{l.label} ↗</a></span>
      ))}</p>
    </SubPage>
  )
}

// 管理入口（5d，2026-10-22 Hana 定）：管理员登录时，账户页名字旁停一只鸟；点它，寒鸦说一句，进「管理」
function AdminBird() {
  const nav = useNavigate()
  const state = useDeeper()
  return (
    <button className="acct-bird" aria-label="管理" onClick={() => { toast({ text: LINES.admin, kind: 'crow' }); nav('/settings/admin', { state }) }}>
      <Bird name="perched" />
    </button>
  )
}

// 账户（5c）：谁登录着、哪些设备登录过（每台设备一把密钥，可单独作废）、改密码去 Miniflux 自己的设置页、退出
function Account({ onLogout }: { onLogout: () => void }) {
  const [name, setName] = useState('')
  const [keys, setKeys] = useState<ApiKey[] | null>(null)
  const [confirm, setConfirm] = useState<number | null>(null)
  const mine = myKeyId()
  const admin = !!useTrConfig()?.admin
  const load = () => api.apiKeys().then(setKeys).catch(() => setKeys([]))
  useEffect(() => { api.me().then((m) => setName(m.username)).catch(() => {}); load() }, [])
  const revoke = async (k: ApiKey) => {
    if (confirm !== k.id) { setConfirm(k.id); return }
    try { await api.deleteApiKey(k.id); toast('作废了，那台设备要重新登录。'); setConfirm(null); load() }
    catch (e) { toastError(`没成功：${(e as Error).message}`) }
  }
  const when = (iso?: string | null) => (iso ? `${monthDay(new Date(iso))} ${clock(new Date(iso))}` : '没用过')
  return (
    <SubPage title="账户" parent="/settings">
      {name && <p className="page-note acct-who">当前登录：{name}{admin && <AdminBird />}</p>}
      {keys && keys.length > 0 && (
        <Block title="登录过的设备">
          <ul className="acct-devices">
            {keys.map((k) => (
              <li key={k.id} className="acct-device">
                <span className="acct-device-name">{k.description || `密钥 ${k.id}`}</span>
                <span className="acct-device-meta">最近使用 {when(k.last_used_at)}</span>
                {k.id === mine ? <span className="acct-this">这台</span>
                  : <button onClick={() => revoke(k)}>{confirm === k.id ? '确认作废' : '作废'}</button>}
              </li>
            ))}
          </ul>
        </Block>
      )}
      <div className="set-list">
        <a className="set-row" href="/miniflux/settings" target="_blank" rel="noopener noreferrer">
          <span className="set-row-title">改密码</span><span className="set-row-note">在 Miniflux 设置里改</span><span className="set-row-go" aria-hidden="true">↗</span>
        </a>
      </div>
      <button className="set-danger" onClick={async () => { await logout(); onLogout(); window.location.replace('/') }}>退出登录</button>
    </SubPage>
  )
}

// 墨水屏 APK 里才有（0.29.7）：切页面闪黑清残影、字迹加深，每台设备自己记
function InkSwitches() {
  const [flash, setFlash] = useState(inkFlashOn())
  const [bold, setBold] = useState(inkBoldOn())
  return (
    <>
      <label className="set-check">
        <input type="checkbox" checked={flash} onChange={(e) => { setInkFlash(e.target.checked); setFlash(e.target.checked) }} />
        <span>换页面时全屏刷新，清掉残影（多费一点电）</span>
      </label>
      <label className="set-check">
        <input type="checkbox" checked={bold} onChange={(e) => { setInkBold(e.target.checked); setBold(e.target.checked) }} />
        <span>字迹加深</span>
      </label>
    </>
  )
}

// 滚过即已读（0.28）：每台设备自己记
function AutoReadSwitch() {
  const [on, setOn] = useState(autoReadOn())
  return (
    <label className="set-check">
      <input type="checkbox" checked={on} onChange={(e) => { setAutoRead(e.target.checked); setOn(e.target.checked) }} />
      <span>「未读」里滚过去的算已读</span>
    </label>
  )
}

function CrowSwitch() {
  const [on, setOn] = useState(crowOn())
  return (
    <label className="set-check">
      <input type="checkbox" checked={on} onChange={(e) => { setCrowOn(e.target.checked); setOn(e.target.checked) }} />
      <span>寒鸦偶尔说话</span>
    </label>
  )
}

function About() {
  return (
    <SubPage title="关于" parent="/settings">
      <div className="set-about">
        <EggLogo size={48} />
        <p className="mag-title">灵媒 Mediarium</p>
        <p className="mono-label">V{__APP_VERSION__}</p>
        <p className="page-note">一个人的书报亭。文章由 Miniflux 抓取，中文字体来自 zeoseven。</p>
      </div>
      <CrowSwitch />
    </SubPage>
  )
}

export function Settings({ onLogout }: { onLogout: () => void }) {
  return (
    <Routes>
      <Route index element={<Home />} />
      <Route path="appearance" element={<Appearance />} />
      <Route path="appearance/reading" element={<Reading />} />
      <Route path="appearance/fonts" element={<Fonts />} />
      <Route path="sources" element={<Sources />} />
      <Route path="sources/add" element={<AddSource />} />
      <Route path="sources/site/:id" element={<SitePage />} />
      <Route path="sources/doctor" element={<Doctor />} />
      <Route path="translate" element={<Translate />} />
      <Route path="mcp" element={<Mcp />} />
      <Route path="claude" element={<Navigate to="/settings/mcp" replace />} />
      <Route path="account" element={<Account onLogout={onLogout} />} />
      <Route path="admin" element={<Admin />} />
      <Route path="about" element={<About />} />
    </Routes>
  )
}

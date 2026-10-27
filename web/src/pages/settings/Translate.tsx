// 设置 › 翻译（阶段 4，2026-10-22 下午改）：用户自己选渠道，每次翻译都用它（Hana 定：各家风味不同，混着别扭）。
//   方式：机翻（内置火山 / 自己的 DeepL）或 AI（DeepSeek、通义两套固定预设 + 自定义预设，OpenAI 兼容）
//   密钥存在服务器上（加密），这里只看得到末四位。外链都查过（见「阶段4 翻译.md」）
import { useEffect, useState } from 'react'
import { LoadingNote } from '../../components/Bird'
import { toast, toastError } from '../../components/Toast'
import { deletePreset, failText, getTrConfig, listModels, modelHint, putTrConfig, savePreset, TrError, useTrConfig, type Preset, type TrConfig } from '../../lib/translate'
import { Block, SubPage } from './frame'

// 2026-10-22：DeepSeek 用 Hana 给的地址；通义是 Model Studio 控制台（不是「机器翻译」那个产品）；硅基流动是控制台首页（左栏「API 密钥」）
const LINKS: Record<string, string> = {
  deepseek: 'https://platform.deepseek.com/api_keys',
  qwen: 'https://modelstudio.console.alibabacloud.com/',
  siliconflow: 'https://cloud.siliconflow.cn/',
  deepl: 'https://app.deepl.com/your-account/keys',
}
const QWEN_BASE = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1'
const n = (x: number) => x.toLocaleString()
const errMsg = (e: unknown) => (e instanceof TrError ? failText(e.fail) : (e as Error).message)

function Choice({ on, children, onClick, disabled }: { on: boolean; children: React.ReactNode; onClick: () => void; disabled?: boolean }) {
  return <button className={on ? 'sheet-choice on' : 'sheet-choice'} aria-pressed={on} onClick={onClick} disabled={disabled}>{children}</button>
}

// 一套 AI 预设的编辑区
function PresetEditor({ p, busy, setBusy }: { p: Preset; busy: boolean; setBusy: (b: boolean) => void }) {
  const [name, setName] = useState(p.name)
  const [base, setBase] = useState(p.base)
  const [model, setModel] = useState(p.model)
  const [key, setKey] = useState('')
  const [models, setModels] = useState<string[] | null>(null)
  const [pulling, setPulling] = useState(false)
  const [confirmDel, setConfirmDel] = useState(false)
  useEffect(() => { setName(p.name); setBase(p.base); setModel(p.model) }, [p.id, p.name, p.base, p.model])
  const custom = p.kind === 'custom'
  const pickModel = custom || p.kind === 'siliconflow'   // 模型从列表里选
  const dirty = !!key.trim() || (custom && (name !== p.name || base !== p.base)) || (pickModel && model !== p.model) || (p.kind === 'qwen' && base !== p.base)

  const save = async (extra: Partial<Omit<Preset, 'key'>> & { key?: string | null } = {}, msg = '存好了。') => {
    setBusy(true)
    try {
      await savePreset({ id: p.id, ...(custom ? { name, base } : {}), ...(pickModel ? { model } : {}), ...(p.kind === 'qwen' ? { base } : {}), ...(key.trim() ? { key: key.trim() } : {}), ...extra })
      setKey(''); toast(msg)
    } catch (e) { toastError(errMsg(e)) } finally { setBusy(false) }
  }
  const pull = async () => {
    setPulling(true)
    try { setModels(await listModels(key.trim() || base !== p.base ? { base, key: key.trim() || undefined, id: p.id } : { id: p.id })) }
    catch (e) { toastError(errMsg(e)) } finally { setPulling(false) }
  }
  const del = async () => {
    if (!confirmDel) { setConfirmDel(true); return }
    setBusy(true)
    try { await deletePreset(p.id); toast('删掉了。') } catch (e) { toastError(errMsg(e)) } finally { setBusy(false) }
  }

  return (
    <div className="tr-preset">
      {custom && (
        <div className="tr-key-row"><label className="sheet-label" htmlFor={`pn-${p.id}`}>名字</label>
          <input id={`pn-${p.id}`} className="form-input" value={name} maxLength={24} placeholder="按钮上显示的名字" onChange={(e) => setName(e.target.value)} /><span /></div>
      )}
      {(custom || p.kind === 'qwen') && (
        <div className="tr-key-row"><label className="sheet-label" htmlFor={`pb-${p.id}`}>接口地址</label>
          <input id={`pb-${p.id}`} className="form-input mono" value={base} spellCheck={false} inputMode="url"
            placeholder={p.kind === 'qwen' ? QWEN_BASE : 'https://…/v1'} onChange={(e) => setBase(e.target.value.trim())} /><span /></div>
      )}
      <div className="tr-key-row"><label className="sheet-label" htmlFor={`pk-${p.id}`}>密钥</label>
        <input id={`pk-${p.id}`} className="form-input mono key-mask" type="text" autoComplete="off" data-1p-ignore data-lpignore="true" spellCheck={false}
          placeholder={p.key ? `已设置 ${p.key}` : '未设置'} value={key} onChange={(e) => setKey(e.target.value)} />
        {p.key ? <button className="form-text-btn" disabled={busy} onClick={() => save({ key: null }, '清掉了。')}>清除</button> : <span />}
      </div>
      {pickModel && (
        <>
          <div className="tr-key-row"><label className="sheet-label" htmlFor={`pm-${p.id}`}>模型</label>
            <input id={`pm-${p.id}`} className="form-input mono" value={model} spellCheck={false} placeholder="拉取后选，或直接填" onChange={(e) => setModel(e.target.value.trim())} />
            <button className="form-text-btn" disabled={pulling || !base || (!key.trim() && !p.key)} onClick={pull}>{pulling ? '拉取中…' : '拉取'}</button>
          </div>
          {models && (
            <ul className="tr-models">
              {models.length === 0 && <li className="page-note">对方没有列出模型。</li>}
              {models.map((m) => (
                <li key={m}><button className={m === model ? 'on' : ''} onClick={() => setModel(m)}>
                  <span className="mono">{m}</span>{modelHint(m) && <span className="tr-model-hint">{modelHint(m)}</span>}
                </button></li>
              ))}
            </ul>
          )}
        </>
      )}
      {p.kind === 'deepseek' && (
        <label className="set-check"><input type="checkbox" checked={p.thinking} disabled={busy} onChange={(e) => save({ thinking: e.target.checked }, e.target.checked ? '开了思考。' : '关了思考。')} /><span>思考（更慢、更贵，难懂的文章再开）</span></label>
      )}
      <div className="tr-preset-actions">
        {LINKS[p.kind] && <a href={LINKS[p.kind]} target="_blank" rel="noopener noreferrer" className="form-text-btn">获取密钥 ↗</a>}
        {custom && <button className="form-danger" onClick={del} disabled={busy}>{confirmDel ? '确认删除' : '删除'}</button>}
        <span />
        <button className="form-submit" disabled={busy || !dirty} onClick={() => save()}>保存</button>
      </div>
    </div>
  )
}

export function Translate() {
  const cfg = useTrConfig()
  const [busy, setBusy] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const [deepl, setDeepl] = useState('')
  useEffect(() => { getTrConfig() }, [])

  const put = async (change: Parameters<typeof putTrConfig>[0], msg?: string) => {
    setBusy(true)
    try { await putTrConfig(change); if (msg) toast(msg) } catch (e) { toastError(errMsg(e)) } finally { setBusy(false) }
  }
  const addPreset = async () => {
    setBusy(true)
    try { const c = await savePreset({ name: '自定义' }); setOpen(c.saved) } catch (e) { toastError(errMsg(e)) } finally { setBusy(false) }
  }

  if (cfg === undefined) return <SubPage title="翻译" parent="/settings"><LoadingNote /></SubPage>
  if (cfg === null) return <SubPage title="翻译" parent="/settings"><p className="page-note">翻译服务没接上。</p></SubPage>

  // 本月用量
  const month = new Date(Date.now() + 8 * 3600e3).toISOString().slice(0, 7)
  const sum: Record<string, { chars: number; req: number; in: number; out: number }> = {}
  for (const [day, d] of Object.entries(cfg.usage)) if (day.startsWith(month)) for (const [k, u] of Object.entries(d)) {
    const s = (sum[k] ??= { chars: 0, req: 0, in: 0, out: 0 }); s.chars += u.chars; s.req += u.req ?? 0; s.in += u.in; s.out += u.out
  }
  const nameOf = (k: string) => (k === 'volcano' ? '火山机翻' : k === 'deepl' ? 'DeepL' : cfg.presets.find((p) => 'p:' + p.id === k)?.name ?? '已删的预设')

  return (
    <SubPage title="翻译" parent="/settings">
      {!cfg.canStore && <p className="page-error">服务器还没配好，暂时存不了设置。</p>}
      <Block title="方式">
        <div className="sheet-choices">
          <Choice on={cfg.mode === 'mt'} disabled={busy} onClick={() => cfg.mode !== 'mt' && put({ mode: 'mt' })}>机翻</Choice>
          <Choice on={cfg.mode === 'ai'} disabled={busy} onClick={() => cfg.mode !== 'ai' && put({ mode: 'ai' })}>AI 翻译</Choice>
        </div>
      </Block>

      {cfg.mode === 'mt' ? (
        <Block title="渠道">
          <div className="tr-channels">
            <div className={cfg.mt === 'volcano' ? 'tr-channel on' : 'tr-channel'}>
              <Choice on={cfg.mt === 'volcano'} disabled={busy} onClick={() => cfg.mt !== 'volcano' && put({ mt: 'volcano' })}>火山机翻</Choice>
              <span className="page-note">{cfg.builtin ? `每月 ${n(cfg.builtin.cap)} 字` : '还没开'}</span>
            </div>
            <div className={cfg.mt === 'deepl' ? 'tr-channel on' : 'tr-channel'}>
              <Choice on={cfg.mt === 'deepl'} disabled={busy} onClick={() => cfg.mt !== 'deepl' && put({ mt: 'deepl' })}>DeepL</Choice>
              <span className="page-note">自己的密钥，免费版每月 50 万字</span>
              <div className="tr-key-row">
                <label className="sheet-label" htmlFor="tr-deepl">密钥</label>
                <input id="tr-deepl" className="form-input mono key-mask" type="text" autoComplete="off" data-1p-ignore data-lpignore="true" spellCheck={false}
                  placeholder={cfg.deepl ? `已设置 ${cfg.deepl}` : '未设置'} value={deepl} onChange={(e) => setDeepl(e.target.value)} />
                {deepl.trim() ? <button className="form-text-btn" disabled={busy} onClick={async () => { await put({ deepl: deepl.trim() }, '存好了。'); setDeepl('') }}>保存</button>
                  : cfg.deepl ? <button className="form-text-btn" disabled={busy} onClick={() => put({ deepl: null }, '清掉了。')}>清除</button> : <span />}
              </div>
              <a className="form-text-btn" href={LINKS.deepl} target="_blank" rel="noopener noreferrer">获取密钥 ↗</a>
            </div>
          </div>
        </Block>
      ) : (
        <Block title="预设">
          <ul className="tr-presets">
            {cfg.presets.map((p) => (
              <li key={p.id} className={cfg.ai === p.id ? 'tr-preset-row on' : 'tr-preset-row'}>
                <div className="tr-preset-head">
                  <Choice on={cfg.ai === p.id} disabled={busy} onClick={() => cfg.ai !== p.id && put({ ai: p.id })}>{p.name}</Choice>
                  <span className="mono-label">{p.model || '未选模型'}{p.key ? '' : ' · 没填密钥'}</span>
                  <button className="form-text-btn" onClick={() => setOpen(open === p.id ? null : p.id)}>{open === p.id ? '收起' : '设置'}</button>
                </div>
                {open === p.id && <PresetEditor p={p} busy={busy} setBusy={setBusy} />}
              </li>
            ))}
          </ul>
          <button className="form-text-btn" onClick={addPreset} disabled={busy}>新建自定义预设</button>
          {/* 标题：默认用机翻；AI 翻全文时标题跟着换成 AI 版。只有 AI 方式下才有「标题也成批用 AI」（2026-10-22 Hana 定） */}
          <label className="set-check tr-title-ai"><input type="checkbox" checked={cfg.titleAi} disabled={busy} onChange={(e) => put({ titleAi: e.target.checked })} /><span>用 AI 批量翻译标题（会产生多次请求）</span></label>
        </Block>
      )}


      <Block title="本月用量">
        {Object.keys(sum).length === 0 ? <p className="page-note">还没用过。</p> : (
          <ul className="tr-usage">
            {Object.entries(sum).map(([k, u]) => (
              <li key={k}><span>{nameOf(k)}</span><span className="mono-label">{n(u.req)} 次 · {n(u.chars)} 字{u.in + u.out ? ` · ${n(u.in + u.out)} token` : ''}</span></li>
            ))}
          </ul>
        )}
      </Block>
    </SubPage>
  )
}

export type { TrConfig }

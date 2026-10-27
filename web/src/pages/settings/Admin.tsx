// 设置 › 账户 › 管理（5d，2026-10-22 Hana 定）：只有管理员看得到，入口是账户页名字旁那只鸟。
//   邀请 —— 生成一次性邀请链接发给朋友，朋友自己起用户名、设密码（生成 = 审批，不经手别人的密码）
//   内置机翻 —— 火山的密钥和各账号用量（从「翻译」页挪过来）
import { copyText } from '../../lib/native'
import { useEffect, useState } from 'react'
import { LoadingNote } from '../../components/Bird'
import { toast, toastError } from '../../components/Toast'
import { createInvite, inviteLink, listInvites, revokeInvite, type Invite } from '../../lib/admin'
import { failText, getTrConfig, putTrConfig, TrError, useTrConfig } from '../../lib/translate'
import { monthDay } from '../../lib/day'
import { Block, SubPage } from './frame'

const n = (x: number) => x.toLocaleString()
const day = (t: number) => monthDay(new Date(t))

function stateText(v: Invite): string {
  if (v.state === 'used' && v.used) return `${day(v.used.at)} 已注册 · ${v.used.username}`
  if (v.state === 'revoked') return '已作废'
  if (v.state === 'expired') return '已过期'
  const left = Math.max(1, Math.ceil((v.expires - Date.now()) / 864e5))
  return `未使用 · ${left} 天后过期`
}

function Invites() {
  const [data, setData] = useState<{ on: boolean; invites: Invite[] } | null | undefined>(undefined)
  const [note, setNote] = useState('')
  const [fresh, setFresh] = useState<{ id: string; link: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const load = () => listInvites().then(setData).catch(() => setData(null))
  useEffect(() => { load() }, [])

  const make = async () => {
    setBusy(true)
    try { const v = await createInvite(note.trim()); setFresh({ id: v.id, link: inviteLink(v.code) }); setNote(''); load() }
    catch (e) { toastError((e as Error).message) } finally { setBusy(false) }
  }
  const copy = async (link: string) => {
    try { await copyText(link); toast('复制好了。') } catch { toastError('复制不了，长按链接手动复制') }
  }
  const revoke = async (v: Invite) => {
    if (confirm !== v.id) { setConfirm(v.id); return }
    try { const list = await revokeInvite(v.id); setData((d) => d && { ...d, invites: list }); setConfirm(null); if (fresh?.id === v.id) setFresh(null); toast('作废了。') }
    catch (e) { toastError((e as Error).message); load() }
  }

  if (data === undefined) return <LoadingNote />
  if (data === null) return <p className="page-note">连不上服务器，稍后再试。</p>
  if (!data.on) return <p className="page-note">服务器还没配好建号密钥，暂时不能邀请。</p>
  return (
    <>
      <p className="page-note">链接一次有效，7 天后过期。对方用它自己设用户名和密码。</p>
      <div className="tr-key-row">
        <label className="sheet-label" htmlFor="inv-note">给谁</label>
        <input id="inv-note" name="invite-note" className="form-input" autoComplete="off" data-1p-ignore data-lpignore="true" maxLength={24} placeholder="备注，只有你看得到" value={note} onChange={(e) => setNote(e.target.value)} />
        <button className="form-text-btn" disabled={busy} onClick={make}>生成邀请</button>
      </div>
      {fresh && (
        <div className="inv-fresh">
          <p className="mono-label">新链接 · 只显示这一次</p>
          <p className="inv-link mono">{fresh.link}</p>
          <button className="form-text-btn" onClick={() => copy(fresh.link)}>复制</button>
        </div>
      )}
      {data.invites.length > 0 && (
        <ul className="acct-devices">
          {data.invites.map((v) => (
            <li key={v.id} className="acct-device">
              <span className="acct-device-name">{v.note || '没写备注'}</span>
              <span className="acct-device-meta">{day(v.created)} 生成 · {stateText(v)}</span>
              {v.state === 'open' && <button onClick={() => revoke(v)}>{confirm === v.id ? '确认作废' : '作废'}</button>}
            </li>
          ))}
        </ul>
      )}
    </>
  )
}

function Builtin() {
  const cfg = useTrConfig()
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<{ volcAk?: string; volcSk?: string }>({})
  useEffect(() => { getTrConfig() }, [])
  const put = async (change: Parameters<typeof putTrConfig>[0], msg?: string) => {
    setBusy(true)
    try { await putTrConfig(change); if (msg) toast(msg) } catch (e) { toastError(e instanceof TrError ? failText(e.fail) : (e as Error).message) } finally { setBusy(false) }
  }
  if (cfg === undefined) return <LoadingNote />
  if (!cfg?.builtinKeys) return <p className="page-note">翻译服务没接上。</p>
  const keys = cfg.builtinKeys
  return (
    <>
      <p className="page-note">火山引擎机器翻译，每月 {n(cfg.builtin?.cap ?? 1800000)} 字，所有账号共用。建议用只有机器翻译权限的子用户密钥。</p>
      <div className="tr-key-group">
        {([['volcAk', 'AccessKey ID'], ['volcSk', 'Secret Access Key']] as const).map(([f, label]) => (
          <div key={f} className="tr-key-row">
            <label className="sheet-label" htmlFor={`tb-${f}`}>{label}</label>
            <input id={`tb-${f}`} className="form-input mono key-mask" type="text" autoComplete="off" data-1p-ignore data-lpignore="true" spellCheck={false}
              placeholder={keys[f] ? `已设置 ${keys[f]}` : '未设置'} value={draft[f] ?? ''}
              onChange={(e) => setDraft((d) => ({ ...d, [f]: e.target.value }))} />
            {keys[f] ? <button className="form-text-btn" disabled={busy} onClick={() => put({ builtinKeys: { [f]: null } }, '清掉了。')}>清除</button> : <span />}
          </div>
        ))}
      </div>
      <div className="form-actions"><span /><button className="form-submit" disabled={busy || !(draft.volcAk?.trim() || draft.volcSk?.trim())}
        onClick={async () => { await put({ builtinKeys: draft }, '存好了。'); setDraft({}) }}>保存</button></div>
      {cfg.builtin?.byUser && cfg.builtin.byUser.length > 0 && (
        <ul className="tr-usage">
          {cfg.builtin.byUser.map((u) => <li key={u.name}><span>{u.name}</span><span className="mono-label">{n(u.chars)} 字</span></li>)}
          <li><span>全站本月</span><span className="mono-label">{n(cfg.builtin.total)} / {n(cfg.builtin.cap)} 字</span></li>
        </ul>
      )}
    </>
  )
}

export function Admin() {
  return (
    <SubPage title="管理" parent="/settings/account">
      <Block title="邀请"><Invites /></Block>
      <Block title="内置机翻"><Builtin /></Block>
    </SubPage>
  )
}

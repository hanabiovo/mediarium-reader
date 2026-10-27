// 设置 › 接入 AI 助手（MCP，2026-10-27 Hana 定）：生成专属链接，填进支持 MCP 的 AI 助手或客户端，它就能以你的身份读文章、找源、看源医生；
// 「可管理订阅」的还能替你添加、修改、退订。链接只显示一次；作废了就失效（Miniflux 那把密钥一起作废）。
// 不走 OAuth：链接本身就是钥匙，添加时认证方式选「无」（2026-10-27 Hana：界面上写清楚，免得选错；只在生成新链接后出现）。
import { useEffect, useState } from 'react'
import { LoadingNote } from '../../components/Bird'
import { toast, toastError } from '../../components/Toast'
import { createLink, linkUrl, listLinks, revokeLink, SCOPE_NAME, type McpLink, type Scope } from '../../lib/mcp'
import { clock, monthDay } from '../../lib/day'
import { copyText } from '../../lib/native'
import { Block, SubPage } from './frame'

const when = (iso: string | null) => (iso ? `${monthDay(new Date(iso))} ${clock(new Date(iso))}` : '还没用过')

// 两个分区（2026-10-27 Hana 定）：「生成链接」——两行按钮，生成后在下面给新链接，「认证方式选无」作为小字只在这时出现；
// 「已生成链接」——现有的链接，可以作废，一条都没有时整块不显示
function Links() {
  const [data, setData] = useState<{ on: boolean; links: McpLink[] } | null | undefined>(undefined)
  const [fresh, setFresh] = useState<{ id: string; url: string; scope: Scope } | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<string | null>(null)
  const reload = () => listLinks().then(setData).catch(() => setData(null))
  useEffect(() => { reload() }, [])

  const make = async (scope: Scope) => {
    setBusy(true)
    try { const l = await createLink(scope); setFresh({ id: l.id, url: linkUrl(l.secret), scope }); reload() }
    catch (e) { toastError((e as Error).message) } finally { setBusy(false) }
  }
  const copy = async (url: string) => {
    try { await copyText(url); toast('复制好了。') } catch { toastError('复制不了，长按链接手动复制') }
  }
  const revoke = async (l: McpLink) => {
    if (confirm !== l.id) { setConfirm(l.id); return }
    try { await revokeLink(l.id); setConfirm(null); if (fresh?.id === l.id) setFresh(null); toast('作废了，用这条链接的 AI 助手连不上了。'); reload() }
    catch (e) { toastError((e as Error).message) }
  }

  const body = data === undefined ? <LoadingNote />
    : data === null ? <p className="page-note">连不上服务器，稍后再试。</p>
    : !data.on ? <p className="page-note">服务器还没配好加密密钥，暂时开不了链接。</p>
    : (
      <>
        {/* 和「搬家」里导入、导出 OPML 一样的设置行：整行可点、右边带 ›（2026-10-27 Hana：原来两个文字按钮看不出能点，宽屏上还被拉到两头） */}
        <div className="set-list">
          <button className="set-row" disabled={busy} onClick={() => make('read')}>
            <span className="set-row-title">生成只读链接</span><span className="set-row-note">只看不改</span><span className="set-row-go" aria-hidden="true">›</span>
          </button>
          <button className="set-row" disabled={busy} onClick={() => make('manage')}>
            <span className="set-row-title">生成可管理订阅的链接</span><span className="set-row-note">还能增删订阅</span><span className="set-row-go" aria-hidden="true">›</span>
          </button>
        </div>
        {fresh && (
          <div className="inv-fresh">
            <p className="mono-label">新链接（{SCOPE_NAME[fresh.scope]}）· 只显示这一次</p>
            <p className="inv-link mono">{fresh.url}</p>
            <button className="form-text-btn" onClick={() => copy(fresh.url)}>复制</button>
            <p className="mcp-auth-note">添加时认证方式选「无」（No authentication），OAuth 的 Client ID、Secret 都留空。</p>
          </div>
        )}
      </>
    )
  return (
    <>
      <Block title="生成链接">{body}</Block>
      {data && data.links.length > 0 && (
        <Block title="已生成链接">
          <ul className="acct-devices">
            {data.links.map((l) => (
              <li key={l.id} className="acct-device">
                <span className="acct-device-name">{SCOPE_NAME[l.scope]}</span>
                <span className="acct-device-meta">{monthDay(new Date(l.created))} 生成 · 最近使用 {when(l.used)}</span>
                <button onClick={() => revoke(l)}>{confirm === l.id ? '确认作废' : '作废'}</button>
              </li>
            ))}
          </ul>
        </Block>
      )}
    </>
  )
}

export function Mcp() {
  return (
    <SubPage title="接入 AI 助手" parent="/settings">
      <p className="page-note">生成一条专属链接，填进支持 MCP 的 AI 助手（如 Claude、ChatGPT、Cursor），它就能在对话里读你的文章、找新信源、检查信源健康。</p>
      <Links />
      <Block title="说明">
        <ul className="page-note mcp-list">
          <li>两种链接都只能碰你自己的账号，删不了文章，也改不了账户设置；可管理订阅的，改动前会先跟你确认。</li>
          <li>用法：在 AI 助手里添加远程 MCP 服务器（有的叫「自定义连接器」），地址填这条链接。已在 Claude 上验证。</li>
          <li>链接就是钥匙，别外传；泄露了在这里作废再生成。AI 读到的文章全文会发给它。</li>
          <li>接入后服务器每天巡一遍信源，有新情况会在「检查信源」上提醒。</li>
        </ul>
      </Block>
    </SubPage>
  )
}

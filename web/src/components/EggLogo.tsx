// 会变身的 logo（寒鸦彩蛋，2026-10-21 Hana 出的主意）：连点 7 下，小鸮被戳得一抖，
// 翻过去成了文末那只停着的寒鸦，说一句话，几秒后翻回来。动效关闭时只淡入淡出。
import { useMemo, useState } from 'react'
import { Logo } from './Logo'
import { Bird } from './Bird'
import { crowOn, logoLine, say, tapCounter } from '../lib/crow'

// onTap：单击要做的事（电脑侧栏的 logo 单击回报刊架，2026-10-21 Hana 提）；连点照样数下去
export function EggLogo({ size, onTap }: { size: number; onTap?: () => void }) {
  const [phase, setPhase] = useState<'' | 'out' | 'crow' | 'back'>('')
  const tap = useMemo(() => tapCounter(7, () => {
    if (!crowOn()) return
    setPhase('out')
    // 震一下：被戳得一抖、翻身（安卓有；iPhone 的浏览器不给网页震动）
    try { navigator.vibrate?.([12, 60, 18]) } catch { /* 无 */ }
    window.setTimeout(() => { setPhase('crow'); say(logoLine()) }, 260)
    window.setTimeout(() => setPhase('back'), 4200)
    window.setTimeout(() => setPhase(''), 4460)
  }), [])
  return (
    <span className={`egg-logo ${phase}`} style={{ width: size, height: size }} onClick={() => { onTap?.(); if (!phase) tap() }}>
      {phase === 'crow' ? <Bird name="perched" className="egg-crow" /> : <Logo size={size} />}
    </span>
  )
}

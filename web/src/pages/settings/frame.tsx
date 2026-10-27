// 设置二级页的外框（从 Settings.tsx 拆出来，源医生页也用）
import { useEffect, type ReactNode } from 'react'
import { IconBack } from '../../components/Icons'
import { useBack } from '../../hooks/useDeepNav'

export function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="set-block">
      <h2 className="shelf-section-name block-title">{title}</h2>
      {children}
    </section>
  )
}

export function SubPage({ title, parent, children }: { title: string; parent: string; children: ReactNode }) {
  const back = useBack(parent)
  useEffect(() => { document.title = title }, [title])
  return (
    <div className="manage set-page">
      <div className="deep-bar">
        <button className="icon-btn manage-back" aria-label="返回" onClick={back}><IconBack /></button>
      </div>
      <header className="manage-head"><h1 className="mag-title">{title}</h1></header>
      <div className="manage-body">{children}</div>
    </div>
  )
}


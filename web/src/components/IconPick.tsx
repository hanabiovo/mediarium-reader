// 新建类别时选符号（0.29.2，2026-10-26 Hana 定）：输入框右边一个按钮，画着当前选的符号，点开是和「编辑类别」一样的那盘符号
import { useRef, useState } from 'react'
import { ALL_ICONS, CategoryIcon, DEFAULT_ICON } from './CategoryIcon'
import { Sheet } from './Sheet'

export function IconPick({ value, onChange }: { value?: string; onChange: (key: string) => void }) {
  const btn = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const cur = value || DEFAULT_ICON
  return (
    <>
      <button ref={btn} type="button" className="icon-pick-btn" aria-label="选符号" title="选符号" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
        <CategoryIcon name={cur} size={18} />
      </button>
      {open && (
        <Sheet title="选符号" placement="anchor" anchor={btn.current} onClose={() => setOpen(false)}>
          <div className="icon-grid" role="radiogroup" aria-label="符号">
            {ALL_ICONS.map((i) => (
              <button key={i.key} role="radio" aria-checked={cur === i.key} aria-label={i.label} title={i.label}
                className={cur === i.key ? 'icon-pick on' : 'icon-pick'} onClick={() => { onChange(i.key); setOpen(false) }}>
                <CategoryIcon name={i.key} size={18} />
              </button>
            ))}
          </div>
        </Sheet>
      )}
    </>
  )
}

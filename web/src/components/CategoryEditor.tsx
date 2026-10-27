// 新建 / 编辑类别：名称、别名、图标（从图标库里挑）。
// 「无类别」：名称固定，不能改名、不能删，只能换图标和别名。
// 删除：里面有刊物也能删，删之前提示「里面还有 N 本刊物，删除后将放回无类别」，确认后先把刊物移过去再删
// （Miniflux 直接删分类会连刊物和文章一起删掉，所以必须先移）。
import { useEffect, useState } from 'react'
import { ApiError, api, loadShelf, type Category, type Feed } from '../api/miniflux'
import { UNCATEGORIZED, categoryIcon, categoryLatin, ensureUncategorized, updateMeta, useMeta } from '../api/meta'
import { ALL_ICONS, CategoryIcon, DEFAULT_ICON } from './CategoryIcon'
import { Sheet } from './Sheet'
import { aliasClass } from '../lib/title'

type Props = {
  category?: Category        // 没有就是新建
  uncategorized: boolean     // 这一个是不是「无类别」
  feeds: Feed[]              // 这个类别里的刊物
  categories: Category[]
  anchor: HTMLElement | null
  onClose: () => void
}

export function CategoryEditor({ category, uncategorized, feeds, categories, anchor, onClose }: Props) {
  const meta = useMeta()
  const [title, setTitle] = useState(category?.title ?? '')
  const [latin, setLatin] = useState(category ? categoryLatin(meta, category.id) : '')
  const [icon, setIcon] = useState(categoryIcon(meta, category?.id) ?? DEFAULT_ICON)
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)

  useEffect(() => {
    if (!category || touched) return
    setLatin(categoryLatin(meta, category.id)); setIcon(categoryIcon(meta, category.id) ?? DEFAULT_ICON)
  }, [meta, category, touched])

  const save = async () => {
    if (!uncategorized && !title.trim()) { setError('类别还没起名字。'); return }
    setBusy(true); setError('')
    try {
      let id = category?.id
      if (!id) id = (await api.createCategory(title.trim())).id
      else if (!uncategorized && title.trim() !== category!.title) await api.updateCategory(id, title.trim())
      const cid = id
      if (touched || !category) {
        await updateMeta((m) => ({
          ...m, categories: { ...m.categories, [cid]: { latin: latin.trim() || undefined, icon: icon === DEFAULT_ICON ? undefined : icon } },
        }))
      }
      await loadShelf()
      onClose()
    } catch (e) {
      setError(e instanceof ApiError && /already exists/i.test(e.detail) ? '已经有同名的类别了。' : String((e as Error).message))
      setBusy(false)
    }
  }

  const remove = async () => {
    if (!confirmDelete) { setConfirmDelete(true); return }
    setBusy(true); setError('')
    try {
      if (feeds.length) {
        const target = await ensureUncategorized(meta, categories)
        for (const f of feeds) await api.updateFeed(f.id, { category_id: target })
      }
      await api.deleteCategory(category!.id)
      await updateMeta((m) => { const c = { ...m.categories }; delete c[category!.id]; return { ...m, categories: c } })
      await loadShelf()
      onClose()
    } catch (e) { setError(String((e as Error).message)); setBusy(false); await loadShelf().catch(() => {}) }
  }

  return (
    <Sheet title={category ? '编辑类别' : '新建类别'} placement="bottom" anchor={anchor} form focusInput={!category}
      align="left" onClose={onClose}>
      <div className="form-rows">
        <label className="sheet-label" htmlFor="ce-title">名称</label>
        {uncategorized
          ? <span className="form-fixed">{UNCATEGORIZED}<span className="form-fixed-note">名称固定</span></span>
          : <input id="ce-title" className="form-input serif strong" value={title} onChange={(e) => setTitle(e.target.value)} />}

        <label className="sheet-label" htmlFor="ce-latin">别名</label>
        <input id="ce-latin" className={aliasClass('form-input mono faint', latin)} value={latin} placeholder="可不填" autoCorrect="off"
          onChange={(e) => { setLatin(e.target.value); setTouched(true) }} />

        <span className="sheet-label">图标</span>
        <div className="icon-grid" role="radiogroup" aria-label="图标">
          {ALL_ICONS.map((i) => (
            <button key={i.key} role="radio" aria-checked={icon === i.key} aria-label={i.label} title={i.label}
              className={icon === i.key ? 'icon-pick on' : 'icon-pick'} onClick={() => { setIcon(i.key); setTouched(true) }}>
              <CategoryIcon name={i.key} size={18} />
            </button>
          ))}
        </div>
      </div>

      {confirmDelete && (
        <p className="sheet-note">
          {feeds.length ? `里面还有 ${feeds.length} 本刊物，删除后将放回「${UNCATEGORIZED}」。` : '这个类别是空的，删掉不影响任何刊物。'}
        </p>
      )}
      {error && <p className="page-error">{error}</p>}

      <div className="form-actions">
        {category && !uncategorized
          ? <button className="form-danger" onClick={remove} disabled={busy}>{confirmDelete ? '确认删除' : '删除类别'}</button>
          : <span />}
        <button className="form-submit" onClick={save} disabled={busy}>{category ? '保存' : '新建'}</button>
      </div>
    </Sheet>
  )
}

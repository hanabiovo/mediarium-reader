// 本机字体（2026-10-20 定）：非开源字体（如博雅方刊宋、仓耳云黑）不放服务器，
// 在这台设备上导入文件，存进浏览器自己的数据库（IndexedDB），每台设备各导一次。
// 本机字体只进文章组，不进界面。导入入口 3e 放进设置页的字体库；3d 先在临时面板里放一个按钮供验收。
import type { CjkFont } from './fonts'

type Rec = { id: string; label: string; data: ArrayBuffer }

const DB = 'mediarium'
const STORE = 'fonts'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB, 1)
    r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(STORE)) r.result.createObjectStore(STORE, { keyPath: 'id' }) }
    r.onsuccess = () => resolve(r.result)
    r.onerror = () => reject(r.error)
  })
}
function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then((db) => new Promise<T>((resolve, reject) => {
    const req = fn(db.transaction(STORE, mode).objectStore(STORE))
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  }))
}

const familyOf = (id: string) => `Mediarium Local ${id}`
const registered = new Set<string>()

async function register(r: Rec) {
  if (registered.has(r.id)) return
  const face = new FontFace(familyOf(r.id), r.data)
  await face.load()
  document.fonts.add(face)
  registered.add(r.id)
}

const asFont = (r: Rec): CjkFont => ({ id: `local:${r.id}`, label: r.label, family: familyOf(r.id), multiWeight: false, source: 'local' })

// 读出这台设备上导入过的字体并注册；坏文件跳过
export async function loadLocalFonts(): Promise<CjkFont[]> {
  try {
    const all = await tx<Rec[]>('readonly', (s) => s.getAll() as IDBRequest<Rec[]>)
    const ok: CjkFont[] = []
    for (const r of all) { try { await register(r); ok.push(asFont(r)) } catch { /* 坏文件 */ } }
    return ok
  } catch { return [] }
}

export async function importLocalFont(file: File): Promise<CjkFont> {
  const data = await file.arrayBuffer()
  const rec: Rec = { id: `${Date.now().toString(36)}`, label: file.name.replace(/\.(ttf|otf|woff2?|ttc)$/i, ''), data }
  await register(rec)   // 先确认浏览器认得这个文件，再存
  await tx('readwrite', (s) => s.put(rec))
  return asFont(rec)
}

export async function removeLocalFont(id: string) {
  await tx('readwrite', (s) => s.delete(id.replace(/^local:/, '')))
}

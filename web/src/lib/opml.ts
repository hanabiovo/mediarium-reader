// 导入 OPML（设置 › 信源 › 搬家、空报刊架上的按钮共用）：用 Miniflux 自带的导入，分类照文件里的来，重复的跳过
import { api, loadShelf } from '../api/miniflux'
import { toast } from '../components/Toast'

export async function importOpmlFile(f?: File) {
  if (!f) return
  toast('导入中…')
  try {
    await api.importOpml(await f.text())
    await loadShelf().catch(() => {})
    toast({ text: '导入好了，重复的源跳过了。', bird: 'done' })
  } catch (e) { toast({ text: `导入没成功：${(e as Error).message || '文件可能不是 OPML'}`, kind: 'error', bird: 'oops' }) }
}

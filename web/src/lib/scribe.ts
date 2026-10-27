// 誊写服务（5b，跑在服务器上，经 Nginx 的 /scribe/ 对外）。灵媒这边只用它中转图片：
// 浏览器直接去拿别的网站的图，跨站限制下读不到内容；经它转一道就是同一个网站，导出时能把图打包进去、能读像素。
import { getToken } from '../api/miniflux'

const BASE = '/scribe'

export async function fetchImage(src: string): Promise<Blob | null> {
  if (!/^https?:\/\//i.test(src)) return null
  try {
    const r = await fetch(`${BASE}/img?u=${encodeURIComponent(src)}`, { headers: { 'X-Auth-Token': getToken() ?? '' } })
    if (!r.ok) return null
    const b = await r.blob()
    return b.type.startsWith('image/') ? b : null
  } catch { return null }
}

// 高对比深色下的白底图（示意图、截图、表格图）：读一张缩小的像素，大部分是接近白的、颜色又很素，就反色。
// 照片不动（彩色多、亮度分布散）。认不准就不动（宁可漏认）
export async function looksLikeWhitePaper(src: string): Promise<boolean> {
  const blob = await fetchImage(src)
  if (!blob) return false
  try {
    const bmp = await createImageBitmap(blob)
    const N = 48
    const cv = new OffscreenCanvas(N, N)
    const g = cv.getContext('2d')!
    g.drawImage(bmp, 0, 0, N, N)
    const d = g.getImageData(0, 0, N, N).data
    let white = 0, colorful = 0
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], gg = d[i + 1], b = d[i + 2], max = Math.max(r, gg, b), min = Math.min(r, gg, b)
      if (min > 225) white++
      if (max - min > 60) colorful++
    }
    const n = d.length / 4
    return white / n > 0.55 && colorful / n < 0.15
  } catch { return false }
}

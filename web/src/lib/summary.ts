// 卡片摘要：从正文 HTML 里取前面一段纯文字（卡片上只显示两行，多取一点由样式截断）。
// Miniflux 没有单独的「摘要」字段。
const box = typeof document !== 'undefined' ? document.createElement('textarea') : null
const cache = new Map<number, string>()

export function summaryOf(id: number, html: string, max = 140): string {
  const hit = cache.get(id)
  if (hit !== undefined) return hit
  const text = html
    .replace(/<(script|style|figure|figcaption|table|pre)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
  let plain = text
  if (box) { box.innerHTML = text; plain = box.value }   // 把 &amp; 之类还原成字
  plain = plain.replace(/\s+/g, ' ').trim().slice(0, max)
  cache.set(id, plain)
  return plain
}

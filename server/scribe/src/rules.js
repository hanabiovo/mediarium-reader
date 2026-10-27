// 誊写规则：在 Miniflux 删掉行内样式之前，把样式里藏着的结构翻成真正的标签。
// 原则和前端排版模块一样：宁可漏认，不删只降级（认不准就原样放过）。
import * as cheerio from 'cheerio'

// ——— 公众号（wechat2rss 等）：小标题、加粗、图注都写在 style 里 ———
const BOLD = /font-weight\s*:\s*(bold|[6-9]00)/i
const CENTER = /text-align\s*:\s*center/i
const SMALL = /font-size\s*:\s*(1[0-3]|[0-9])px/i
const END_PUNCT = /[。！？；：…,.!?;:、，]$/

const text = ($, el) => $(el).text().replace(/\s+/g, ' ').trim()

function wechat(html) {
  const $ = cheerio.load(html, null, false)
  // 1. 加粗：style 里写着粗体的 span → <strong>（已经在 strong 里的不再套）
  $('span[style]').each((_, el) => {
    if (BOLD.test($(el).attr('style') ?? '') && !$(el).closest('strong, b').length && text($, el)) $(el).wrapInner('<strong></strong>')
  })
  // 2. 小标题：居中、整段都是粗体、很短、句末没标点、没有图 → <h3>。紧挨着的两行（主标题 + 副标题）合成一个
  const isHead = (el) => {
    const t = text($, el)
    if (!t || t.length > 40 || END_PUNCT.test(t) || $(el).find('img').length) return false
    if (!CENTER.test($(el).attr('style') ?? '')) return false
    const boldText = $(el).find('strong, b').map((_, s) => text($, s)).get().join('').replace(/\s+/g, '')
    return boldText.length > 0 && boldText === t.replace(/\s+/g, '')
  }
  $('p').each((_, el) => {
    if (!isHead(el)) return
    const prev = $(el).prev()
    const line = text($, el)
    if (prev.is('h3[data-scribe]')) { prev.append('<br>').append(esc(line)); $(el).remove(); return }
    $(el).replaceWith(`<h3 data-scribe="1">${esc(line)}</h3>`)
  })
  $('h3[data-scribe]').removeAttr('data-scribe')
  // 3. 图注：图片段落后面紧跟的一行居中小字 → 合成 <figure><img><figcaption>
  $('p').each((_, el) => {
    const st = $(el).attr('style') ?? ''
    const inner = $(el).html() ?? ''
    const t = text($, el)
    if (!t || t.length > 80 || $(el).find('img').length || !CENTER.test(st) || !(SMALL.test(st) || SMALL.test(inner))) return
    const prev = $(el).prev()
    const img = prev.find('img').first()
    if (!img.length || text($, prev)) return
    prev.replaceWith(`<figure>${$.html(img)}<figcaption>${esc(t)}</figcaption></figure>`)
    $(el).remove()
  })
  return $.html()
}
const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// ——— 处理整份源 ———
// 返回改过的 XML；认不出格式就原样返回
export function transformFeed(xml, feedUrl) {
  const $ = cheerio.load(xml, { xml: { xmlMode: true } })
  let changed = false

  // BBC 等：Atom 条目只有 rel="self" 的链接，没有 rel="alternate" → 把 self 当成原文地址补一条
  $('entry').each((_, e) => {
    const links = $(e).children('link')
    if (links.filter((_, l) => ($(l).attr('rel') ?? 'alternate') === 'alternate').length) return
    const self = links.filter((_, l) => $(l).attr('rel') === 'self').first()
    if (self.length && self.attr('href')) { $(e).append(`<link rel="alternate" type="text/html" href="${self.attr('href')}"/>`); changed = true }
  })

  // 公众号：正文里有 mmbiz（公众号图床）或来自 wechat2rss 的，按公众号规则誊一遍
  const isWechat = /wechat2rss|mp\.weixin/i.test(feedUrl)
  $('item, entry').each((_, it) => {
    $(it).children().each((_, c) => {
      const name = c.tagName ?? c.name
      if (!/^(description|content:encoded|content|summary)$/i.test(name)) return
      const raw = $(c).text()
      if (!raw || (!isWechat && !/mmbiz\.q(pic|logo)\.cn/.test(raw))) return
      const out = wechat(raw)
      if (out !== raw) { $(c).empty().append(`<![CDATA[${out.replace(/]]>/g, ']]]]><![CDATA[>')}]]>`); changed = true }
    })
  })

  return changed ? $.xml() : xml
}

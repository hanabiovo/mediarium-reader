import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseFeed, pageChars, verdict } from '../src/doctor.js'

const rss = `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/"><channel><title>测试刊</title><link>https://ex.com</link>
<item><title>一</title><link>https://ex.com/1</link><pubDate>Wed, 21 Oct 2026 08:00:00 GMT</pubDate><description>短摘要</description><content:encoded><![CDATA[<p>全文很长<img src="a.png"></p>]]></content:encoded></item>
<item><title>二</title><link>https://ex.com/2</link><dc:date>2026-10-19T08:00:00Z</dc:date><description><![CDATA[<p>只有摘要</p>]]></description></item>
</channel></rss>`
const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><title>Atom 刊</title><link href="https://a.com"/>
<entry><title>甲</title><link rel="self" href="https://a.com/self"/><link rel="alternate" href="https://a.com/1"/><updated>2026-10-20T00:00:00Z</updated><summary>摘要</summary></entry></feed>`

test('RSS：标题、链接、日期、优先取 content:encoded', () => {
  const f = parseFeed(rss)
  assert.equal(f.title, '测试刊')
  assert.equal(f.items.length, 2)
  assert.equal(f.items[0].link, 'https://ex.com/1')
  assert.match(f.items[0].html, /全文很长/)
  assert.ok(!Number.isNaN(f.items[1].date))
})
test('Atom：取 alternate 链接', () => {
  const f = parseFeed(atom)
  assert.equal(f.title, 'Atom 刊')
  assert.equal(f.items[0].link, 'https://a.com/1')
})
test('网页不是订阅源', () => assert.equal(parseFeed('<!doctype html><html><body>hi</body></html>'), null))
test('原网页正文：去掉导航，取 article 里的段落', () => {
  const n = pageChars(`<html><body><nav>${'导航'.repeat(200)}</nav><article><p>${'正文'.repeat(150)}</p></article></body></html>`)
  assert.equal(n, 300)
})
test('判全文 / 摘要', () => {
  assert.equal(verdict(2800, 3000), 'full')
  assert.equal(verdict(200, 3000), 'summary')
  assert.equal(verdict(1500, undefined), 'full')
  assert.equal(verdict(100, undefined), 'summary')
  assert.equal(verdict(700, undefined), 'unsure')
})

const { siblingFeeds } = await import('../src/doctor.js')
test('原网页：脚本画出来的页面抽不出正文', () => {
  assert.equal(pageChars(`<html><body><div id="app"></div><script>${'x'.repeat(5000)}</script><div>${'推荐 链接 '.repeat(100)}</div></body></html>`), 0)
  assert.equal(pageChars(`<html><body><p>短</p><p>${'正文'.repeat(30)}</p></body></html>`), 60)
})
test('摘要源的兄弟路径：只对 .xml 一类试', () => {
  assert.deepEqual(siblingFeeds('https://solar.lowtechmagazine.com/index.xml').slice(0, 2), ['https://solar.lowtechmagazine.com/posts/index.xml', 'https://solar.lowtechmagazine.com/blog/index.xml'])
  assert.deepEqual(siblingFeeds('https://a.com/feed/'), [])
  assert.ok(!siblingFeeds('https://a.com/posts/index.xml').includes('https://a.com/posts/posts/index.xml'))
})

test('绕道：没配代理时直接说明', async () => {
  const { safeFetch, Blocked } = await import('../src/guard.js')
  await assert.rejects(safeFetch('https://example.com/', { via: 'proxy' }), (e) => e instanceof Blocked && /没有配绕道/.test(e.message))
})

test('JSON Feed 认得出', () => {
  const f = parseFeed(JSON.stringify({ version: 'https://jsonfeed.org/version/1.1', title: 'DF', home_page_url: 'https://df.net', items: [{ title: 'a', url: 'https://df.net/a', content_html: '<p>hi</p>', date_published: '2026-10-01T00:00:00Z' }] }))
  assert.equal(f.title, 'DF'); assert.equal(f.items[0].link, 'https://df.net/a'); assert.ok(!Number.isNaN(f.items[0].date))
  assert.equal(parseFeed('{"not":"feed"}'), null)
})
test('视频、音频条目认得出', () => {
  const yt = parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom" xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>K</title><entry><title>v</title><yt:videoId>x</yt:videoId><link rel="alternate" href="https://www.youtube.com/watch?v=x"/></entry></feed>`)
  assert.ok(yt.items[0].video)
  const pod = parseFeed(`<rss><channel><title>P</title><item><title>e</title><enclosure url="https://a/x.mp3" type="audio/mpeg"/></item></channel></rss>`)
  assert.ok(pod.items[0].audio && !pod.items[0].video)
})

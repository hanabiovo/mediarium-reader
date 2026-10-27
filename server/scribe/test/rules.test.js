import { test } from 'node:test'
import assert from 'node:assert/strict'
import { transformFeed } from '../src/rules.js'

test('BBC：只有 rel=self 的条目补上 alternate', () => {
  const xml = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom"><link href="https://www.bbc.com/zhongwen/simp" rel="self"/>
<entry><id>x</id><title>t</title><link href="https://www.bbc.com/zhongwen/articles/abc/simp" rel="self"/><content type="html">&lt;p&gt;hi&lt;/p&gt;</content></entry></feed>`
  const out = transformFeed(xml, 'https://feeds.feedburner.com/cnbbc')
  assert.match(out, /<link rel="alternate" type="text\/html" href="https:\/\/www\.bbc\.com\/zhongwen\/articles\/abc\/simp"\/>/)
  assert.equal((out.match(/rel="alternate"/g) || []).length, 1)   // 源本身那条 self 不动
  assert.match(out, /&lt;p&gt;hi&lt;\/p&gt;/)                         // 正文原样
})

test('已经有 alternate 的不动', () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><link href="https://a/1"/><link rel="self" href="https://a/x"/></entry></feed>`
  assert.equal(transformFeed(xml, 'https://a/feed'), xml)
})

const W = (body) => `<?xml version="1.0"?><rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>机器之心</title>
<item><title>a</title><link>https://mp.weixin.qq.com/s?x=1</link><content:encoded><![CDATA[${body}]]></content:encoded></item></channel></rss>`

test('公众号：居中整段粗体 → h3；两行合一；粗体 span → strong；图注 → figure', () => {
  const body = `<p style="text-align: center;"><span style="font-size:16px;font-weight:bold;">足球直播</span></p>
<p style="text-align: center;"><span style="font-size:16px;font-weight:bold;">要过画质和延迟两道关</span></p>
<p style="text-align: justify;"><span style="font-size:15px;">正文里有</span><span style="font-weight:bold;">加粗</span><span>的字。</span></p>
<p style="text-align:center"><img src="https://wechat2rss.bestblogs.dev/img-proxy/?u=1"></p>
<p style="text-align:center"><span style="font-size:12px;color:#999">图源：论文</span></p>
<p style="text-align: center;"><span style="font-weight:bold;">这一句很长但是以句号结尾所以不是标题。</span></p>`
  const out = transformFeed(W(body), 'https://wechat2rss.bestblogs.dev/feed/8d97.xml')
  assert.match(out, /<h3>足球直播<br>要过画质和延迟两道关<\/h3>/)
  assert.match(out, /<strong>加粗<\/strong>/)
  assert.match(out, /<figure><img src="https:\/\/wechat2rss\.bestblogs\.dev\/img-proxy\/\?u=1"><figcaption>图源：论文<\/figcaption><\/figure>/)
  assert.doesNotMatch(out, /<h3>这一句很长/)
  assert.match(out, /<!\[CDATA\[/)
})

test('不是公众号、也没有公众号图片的源原样返回', () => {
  const xml = W('<p style="text-align:center"><b>标题</b></p>')
  assert.equal(transformFeed(xml, 'https://example.com/feed'), xml)
})

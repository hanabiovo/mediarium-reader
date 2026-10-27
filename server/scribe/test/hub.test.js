import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), 'scribe-hub-'))
process.env.RSSHUB_URL = 'http://127.0.0.1:1200/'
const { buildIndex, searchSites, matchUrl, HUB } = await import('../src/hub.js')
const { checkUrl, Blocked } = await import('../src/guard.js')

// 按 CC 取的样例（计划与说明/RSSHub 目录接口样例.md）缩写
const ALL = {
  thepaper: { name: '澎湃新闻', url: 'thepaper.cn', lang: 'zh-CN', routes: {
    '/featured': { name: '首页头条', radar: [{ source: ['thepaper.cn/'], target: '/featured' }] },
    '/sidebar/:sec?': { name: '侧边栏', radar: [{ source: ['thepaper.cn/'], target: '/sidebar' }] },
    '/839studio/:id': { name: '澎湃美数课作品集 - 分类', radar: [{ source: ['thepaper.cn/'] }] },
    '/factpaper/:status?': { name: '明查', radar: [{ source: ['factpaper.cn/'], target: '/factpaper/:status?' }] },
  } },
  zaobao: { name: '联合早报', url: 'www.zaobao.com', lang: 'zh-CN', routes: {
    '/popular/:period?': { name: '热门新闻', radar: [{ source: ['zaobao.com.sg/news'], target: '/popular/daily' }] },
    '/realtime/:section?': { name: '即时新闻' },
  } },
  github: { name: 'GitHub', url: 'github.com', routes: {
    '/issue/:user/:repo/:state?': { name: 'Issues', radar: [{ source: ['github.com/:user/:repo/issues', 'github.com/:user/:repo'], target: '/issue/:user/:repo' }] },
  } },
}
const idx = buildIndex(ALL)

test('地址去掉末尾斜杠', () => assert.equal(HUB, 'http://127.0.0.1:1200'))

test('索引：站点名、域名去 www、路由数', () => {
  assert.deepEqual(idx.sites.find((s) => s.id === 'zaobao'), { id: 'zaobao', name: '联合早报', url: 'zaobao.com', lang: 'zh-CN', n: 2 })
})

test('按汉字搜站点', () => {
  assert.equal(searchSites(idx, '澎湃')[0].id, 'thepaper')
  assert.equal(searchSites(idx, '早报')[0].id, 'zaobao')
  assert.equal(searchSites(idx, 'thepaper.cn')[0].id, 'thepaper')
  assert.deepEqual(searchSites(idx, ''), [])
})

test('按网址认路由：首页、带参数、填不上的留给人填', () => {
  const home = matchUrl(idx, 'https://www.thepaper.cn/')
  assert.deepEqual(home.map((r) => r.path), ['/thepaper/featured', '/thepaper/sidebar', null])
  assert.equal(home[2].needsInput, true)
  assert.equal(matchUrl(idx, 'https://www.thepaper.cn/newsDetail_forward_1').length, 0, '文章页不认成首页')
  assert.equal(matchUrl(idx, 'zaobao.com.sg/news')[0].path, '/zaobao/popular/daily')
  const gh = matchUrl(idx, 'https://github.com/DIYgod/RSSHub/issues')
  assert.equal(gh[0].path, '/github/issue/DIYgod/RSSHub')
  assert.equal(matchUrl(idx, 'https://factpaper.cn/')[0].path, '/thepaper/factpaper', '可省的参数没值就去掉')
})

test('护栏：只放行本站 RSSHub，别的内网照拦', async () => {
  assert.equal((await checkUrl('http://127.0.0.1:1200/thepaper/featured')).origin, 'http://127.0.0.1:1200')
  await assert.rejects(checkUrl('http://127.0.0.1:1201/'), Blocked)
  await assert.rejects(checkUrl('http://127.0.0.1/'), Blocked)
  await assert.rejects(checkUrl('https://127.0.0.1:1200/'), Blocked, '协议不同也不放')
})

const { validId, siteOfPath, nestedIds } = await import('../src/hub.js')
test('站点 id：带点、带斜杠的都认，.. 不认', () => {
  assert.ok(validId('thepaper') && validId('nppa.gov.cn') && validId('gov/nppa') && validId('a-b_c'))
  assert.ok(!validId('../etc') && !validId('a/../b') && !validId('a b') && !validId('') && !validId('/a') && !validId('a/'))
})
test('带斜杠的站点：路由归到最长的那个 id', () => {
  const ix = buildIndex({ ...ALL, 'gov/nppa': { name: '国家新闻出版署', url: 'nppa.gov.cn', routes: { '/:channel': { name: '栏目' } } } })
  assert.deepEqual(nestedIds(ix), ['gov/nppa'])
  assert.equal(siteOfPath(ix, '/gov/nppa/xxgk'), 'gov/nppa')
  assert.equal(siteOfPath(ix, '/thepaper/list/25483?x=1'), 'thepaper')
  assert.equal(siteOfPath(ix, '/gov/other'), 'gov')
})

test('HUB_CONFIGURED 只认配置名的样子，不收别的', async () => {
  process.env.HUB_CONFIGURED = 'XIAOHONGSHU_COOKIE, INSTAGRAM_COOKIE,bad name,=x,lower'
  const { HUB_CONFIGURED } = await import('../src/hub.js?cfg=' + Date.now())
  assert.deepEqual(HUB_CONFIGURED, ['XIAOHONGSHU_COOKIE', 'INSTAGRAM_COOKIE'])
})

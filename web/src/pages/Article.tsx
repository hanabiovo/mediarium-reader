// 文章（视觉稿「文章」）：基础排版。打开即记为已读；右上角收藏。
// 音频默认折叠成一行（蓝图：Hana 不爱音频）。
// 正文排版交给 src/typo（3d 排版模块）；排版设置栏（Aa）在 3e。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useOutletContext, useParams } from 'react-router-dom'
import { api, type Entry } from '../api/miniflux'
import { IconBack, IconBookmark, IconEye, IconPlay, IconShare } from '../components/Icons'
import { isMuted, mute, unmute } from '../lib/attention'
import { useMeta } from '../api/meta'
import { useBack } from '../hooks/useDeepNav'
import { monthDay } from '../lib/day'
import { typeset } from '../typo/typeset'
import { Sheet } from '../components/Sheet'
import { ReadingControls } from './settings/parts'
import { BirdNote, LoadingNote } from '../components/Bird'
import { markReady } from '../components/Welcome'
import { toastError } from '../components/Toast'
import { originOf, type Doc } from '../lib/exporter'
import { titleOf, useTitleTr } from '../lib/translate'
import { TrProgress, TrSheet, useArticleTranslation } from '../components/ArticleTranslate'
import { ShareSheet } from '../components/ShareSheet'
import { SelectionBar } from '../components/SelectionBar'
import { onStarred } from '../lib/crow'
import { useTheme } from '../theme/theme'
import { looksLikeWhitePaper } from '../lib/scribe'
import { ImageViewer, toViewImage, viewableImages, type ViewImage } from '../components/ImageViewer'
import { sourceOf, usePapers } from '../lib/papers'
import { ArticleAudio } from '../components/Player'
import { play, usePlayer, type Track } from '../lib/player'
import { linkStamps } from '../lib/stamps'


// 文章所在的那张列表（某天的杂志目录，或信息流）交给文章页的东西
export type ReaderContext = {
  backPath: string          // 直接打开链接时，返回到哪
  sourceTitle: string       // 文章里取不到刊名时用这个
  entries: Entry[]          // 列表里已有的文章（带全文），有就不再请求
  patch: (id: number, change: Partial<Entry>) => void  // 已读、收藏变化同步回列表
  numbered: boolean         // 顶栏是否显示「NO. 05」（杂志目录里才有意义）
}

export function Article() {
  const { eid } = useParams()
  const id = Number(eid)
  const ctx = useOutletContext<ReaderContext>()
  const papers = usePapers()
  const back = useBack(ctx.backPath)
  const fromList = ctx.entries.find((e) => e.id === id)
  const [loaded, setLoaded] = useState<Entry | null>(null)
  const [error, setError] = useState('')
  const [audioOpen, setAudioOpen] = useState(false)
  const playing = usePlayer().track?.entryId

  // 目录里已经有这篇（带全文）就直接用；直接打开链接时才单独请求
  const entry = fromList ?? (loaded?.id === id ? loaded : null)
  useEffect(() => {
    setAudioOpen(playing === id)   // 正在听的这一篇：播放条直接展开
    if (fromList) return
    api.entry(id).then(setLoaded).catch((e) => setError(String(e.message)))
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 打开即已读
  useEffect(() => {
    if (!entry || entry.status !== 'unread') return
    api.setStatus([entry.id], 'read').then(() => {
      ctx.patch(entry.id, { status: 'read' })
      setLoaded((l) => (l && l.id === entry.id ? { ...l, status: 'read' } : l))
    }).catch(() => {})
  }, [entry?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // 正文放进页面后排一遍（英文断词、图注、分隔与文末的鸟、功能性图片）。
  // 用回调 ref：正文节点每次挂上（含列表刷新后整块重建）、或换了一篇，都会再排；排过的不会重复动
  // 同一份 HTML 要给同一个对象：每次给新对象，React 会把正文整块重设，排好的版就没了
  const proseEl = useRef<HTMLDivElement | null>(null)
  const audio = entry?.enclosures?.find((x) => x.mime_type.startsWith('audio/'))
  const { pathname } = useLocation()
  const appMeta = useMeta()
  const muted = !!entry && isMuted(appMeta, entry.id)
  const toggleMute = () => {
    if (!entry) return
    ;(muted ? unmute(entry.id) : mute(entry)).catch((e) => toastError(`没改成：${(e as Error).message}`))
  }
  const track: Track | null = useMemo(() => entry && audio ? {
    entryId: entry.id, feedId: entry.feed_id, url: audio.url, title: entry.title, back: pathname,
    source: sourceOf(papers, entry.feed_id, entry.feed?.title || ctx.sourceTitle).label || entry.feed?.title || '',
  } : null, [entry?.id, audio?.url, entry?.title, papers]) // eslint-disable-line react-hooks/exhaustive-deps
  const trackRef = useRef(track)
  trackRef.current = track
  const html = useMemo(() => ({ __html: entry?.content ?? '' }), [entry?.content])
  const empty = useMemo(() => !!entry && !/<(img|video|audio|iframe)[\s>]/i.test(entry.content) && entry.content.replace(/<[^>]+>/g, '').replace(/&[a-z#0-9]+;/gi, '').replace(/\s+/g, '').length < 10, [entry])
  const proseRef = useCallback((node: HTMLDivElement | null) => {
    proseEl.current = node
    if (!node) return
    // 开发用：地址后加 ?raw=1 看 Miniflux 给的原样（不排版），对照认格式规则
    if (new URLSearchParams(location.search).has('raw')) return
    const undo = typeset(node, { url: entry?.url, title: entry?.title })
    // 带音频的：节目单里的时间点能点（0.27）
    if (!trackRef.current) return undo
    linkStamps(node)
    const jump = (e: MouseEvent) => {
      const b = (e.target as HTMLElement).closest<HTMLElement>('.prose-ts')
      if (!b || !trackRef.current) return
      play(trackRef.current, Number(b.dataset.t)); setAudioOpen(true)
    }
    node.addEventListener('click', jump)
    return () => { node.removeEventListener('click', jump); undo() }
  }, [entry?.id, entry?.content]) // eslint-disable-line react-hooks/exhaustive-deps

  // 原网页地址。BBC 的源把文章链接写成 rel="self"，Miniflux 认不出，拿订阅源地址顶上；这时不给链接（补地址归阶段 5 源管家）
  const origin = entry ? originOf(entry) : ''
  // 社交平台：正文常常只有标题
  const social = !!entry && /(^|\.)(xiaohongshu\.com|xhslink\.com|instagram\.com|weibo\.(com|cn)|x\.com|twitter\.com|threads\.(net|com)|bilibili\.com|douyin\.com)$/.test((() => { try { return new URL(entry.url).hostname } catch { return '' } })())

  useTitleTr(entry ? [entry] : null)
  // 翻译（阶段 4）
  const tr = useArticleTranslation(entry, proseEl)
  const [trOpen, setTrOpen] = useState(false)
  const trBtn = useRef<HTMLButtonElement>(null)
  const zhTitle = entry ? titleOf(entry.id) : undefined
  useEffect(() => { if (entry) document.title = entry.title }, [entry?.title]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (entry || error) markReady() }, [entry, error])

  // 看图（2026-10-23）：点正文里的图，全屏打开；段落翻译模式、按着 Ctrl / ⌘ 时不打开
  const [viewer, setViewer] = useState<{ images: ViewImage[]; start: number } | null>(null)
  useEffect(() => {
    const root = proseEl.current
    if (!root) return
    const on = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (t.tagName !== 'IMG' || root.classList.contains('tr-pick') || e.ctrlKey || e.metaKey) return
      const list = viewableImages(root)
      const i = list.indexOf(t as HTMLImageElement)
      if (i < 0) return
      e.preventDefault()   // 图带链接也先看图，链接在查看器里
      setViewer({ images: list.map(toViewImage), start: i })
    }
    root.addEventListener('click', on)
    return () => root.removeEventListener('click', on)
  }, [entry?.id, entry?.content])

  // 高对比深色：白底的示意图、截图反色，照片不动（5b-2，要经誊写服务读像素）
  const theme = useTheme()
  useEffect(() => {
    const root = proseEl.current
    if (!root) return
    const imgs = Array.from(root.querySelectorAll('img'))
    if (theme.theme !== 'contrast' || theme.resolved !== 'dark') { imgs.forEach((i) => i.classList.remove('hc-invert')); return }
    let alive = true
    ;(async () => {
      for (const img of imgs) {
        if (!alive) return
        if (img.dataset.hc) { img.classList.toggle('hc-invert', img.dataset.hc === '1'); continue }
        const yes = await looksLikeWhitePaper(img.currentSrc || img.src)
        img.dataset.hc = yes ? '1' : '0'
        if (alive) img.classList.toggle('hc-invert', yes)
      }
    })()
    return () => { alive = false }
  }, [theme.theme, theme.resolved, entry?.id])

  // 顶栏贴顶；往下滚就收窄一点，大标题滚到顶栏下面时显出信源名
  const [stuck, setStuck] = useState(false)
  const [titleGone, setTitleGone] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    const on = () => setStuck(window.scrollY > 8)
    on(); window.addEventListener('scroll', on, { passive: true })
    return () => window.removeEventListener('scroll', on)
  }, [])
  useEffect(() => {
    const el = titleRef.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setTitleGone(!e.isIntersecting && e.boundingClientRect.top < 0), { rootMargin: '-60px 0px 0px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [entry?.id])

  // 分享与导出（阶段 5a）：链接用原文地址；md / epub 用排好版的正文
  const [sharing, setSharing] = useState(false)
  const shareBtn = useRef<HTMLButtonElement>(null)
  const doc: Doc | null = entry ? { title: entry.title, source: sourceOf(papers, entry.feed_id, entry.feed?.title || ctx.sourceTitle || '').label, author: entry.author, published: entry.published_at, url: origin || undefined, html: '' } : null

  // Aa：文章排版设置的快捷入口（家在设置页 · 外观 · 文章排版），正在读的这篇就是预览
  const [aa, setAa] = useState(false)
  const aaBtn = useRef<HTMLButtonElement>(null)

  const toggleStar = () => {
    if (!entry) return
    const starred = !entry.starred
    ctx.patch(entry.id, { starred })
    setLoaded((l) => (l && l.id === entry.id ? { ...l, starred } : l))
    const e = entry
    api.toggleStar(e.id).then(() => {
      if (starred) api.entries({ starred: true, limit: 1 }).then((r) => onStarred(r.total, e.content, e.id)).catch(() => {})
    }).catch(() => {
      ctx.patch(e.id, { starred: !starred })
      setLoaded((l) => (l && l.id === e.id ? { ...l, starred: !starred } : l))
      toastError(starred ? '收藏没成功。' : '取消收藏没成功。', { label: '重试', run: toggleStar })
    })
  }

  const meta = entry ? [monthDay(new Date(entry.published_at)), entry.reading_time ? `${entry.reading_time} MIN` : ''].filter(Boolean).join(' · ') : ''
  // 多栏报刊（阶段 6 第 3 步）：左上角写栏目名，话题标签够短就接在后面（「私家历史 · 中日关系」）；来源行「澎湃新闻 · 私家历史」
  const from = entry ? sourceOf(papers, entry.feed_id, entry.feed?.title || ctx.sourceTitle) : null
  const tag = entry?.tags?.[0] ?? ''
  const kicker = from?.column ? (tag && [...tag].length <= 8 && tag !== from.column ? `${from.column} · ${tag}` : from.column) : tag
  const source = from?.label || entry?.feed?.title || ctx.sourceTitle

  return (
    <article className="article">
      <div className={stuck ? 'deep-bar art-bar stuck' : 'deep-bar art-bar'}>
        <button className="icon-btn art-back" aria-label="返回目录" onClick={back}><IconBack /></button>
        {/* 大标题滚出去之后，顶栏这一行显出信源名（2026-10-21 Hana 定；杂志编号去掉，信息量不大还和按钮挤） */}
        <span className={titleGone ? 'art-bar-name on' : 'art-bar-name'} aria-hidden={!titleGone}>{source}</span>
        <div className="art-tools">
        <button ref={trBtn} className={tr.picking ? 'icon-btn art-tr on' : 'icon-btn art-tr'} aria-label="翻译" aria-haspopup="dialog" aria-expanded={trOpen}
          onClick={() => setTrOpen(true)} disabled={!entry}><span aria-hidden="true">译</span></button>
        <button ref={aaBtn} className="icon-btn art-aa" aria-label="排版设置" aria-haspopup="dialog" aria-expanded={aa}
          onClick={() => setAa(true)}><span aria-hidden="true">Aa</span></button>
        <button ref={shareBtn} className="icon-btn art-share" aria-label="分享与导出" aria-haspopup="dialog" aria-expanded={sharing}
          onClick={() => setSharing(true)} disabled={!entry}><IconShare /></button>
        {/* 不爱看（0.28）：眼睛睁着 = 在看；闭上 = 不爱看，这篇不再出现在信息流里（杂志目录照旧） */}
        <button className={muted ? 'icon-btn art-eye off' : 'icon-btn art-eye'} aria-label={muted ? '不爱看（点一下取消）' : '在看（点一下标成不爱看）'} title={muted ? '不爱看' : '在看'}
          aria-pressed={muted} onClick={toggleMute} disabled={!entry}>
          <IconEye closed={muted} />
        </button>
        <button className="icon-btn art-star-icon" aria-label={entry?.starred ? '取消收藏' : '收藏'}
          aria-pressed={!!entry?.starred} onClick={toggleStar} disabled={!entry}>
          <IconBookmark filled={!!entry?.starred} />
        </button>
        </div>
      </div>
      {sharing && doc && <ShareSheet doc={doc} anchor={shareBtn.current} getProse={() => proseEl.current} onClose={() => setSharing(false)} />}
      <SelectionBar root={proseEl} doc={doc} />
      {trOpen && <TrSheet tr={tr} anchor={trBtn.current} onClose={() => setTrOpen(false)} />}
      {aa && <Sheet title="排版" placement="dock" anchor={aaBtn.current} onClose={() => setAa(false)}><ReadingControls inArticle /></Sheet>}

      {error && <div className="art-note"><BirdNote bird="departing">信没送到。{error}</BirdNote></div>}
      {!entry && !error && <div className="art-note"><LoadingNote /></div>}

      {entry && (
        <div className="art-body">
          <div className="art-kicker">
            <span className="mono-label art-tag">{kicker}</span>
            <span className="mono-label">{meta}</span>
          </div>
          <h1 ref={titleRef} className="art-title">{zhTitle ?? entry.title}</h1>
          {zhTitle && <p className="art-title-orig" lang="und">{entry.title}</p>}
          {(source || origin) && (
            <div className="art-source">
              {source}
              {origin && <>{source ? ' · ' : ''}<a className="art-origin" href={origin} target="_blank" rel="noreferrer">打开原网页</a></>}
            </div>
          )}

          {track && (
            <div className="art-audio">
              <button className="art-audio-bar" aria-expanded={audioOpen} onClick={() => setAudioOpen((o) => !o)}>
                <IconPlay />
                <span className="mono-label">AUDIO</span>
                <span className="mono-label art-audio-toggle">{audioOpen ? '收起' : '展开'}</span>
              </button>
              {audioOpen && <ArticleAudio track={track} />}
            </div>
          )}

          <TrProgress tr={tr} />
          {viewer && <ImageViewer images={viewer.images} start={viewer.start} onClose={() => setViewer(null)} />}
          {/* 正文由 Miniflux 清洗过（去掉脚本等），图片已走它的代理 */}
          <div className="prose" ref={proseRef} dangerouslySetInnerHTML={html} />
          {/* 正文空的（多半是开了抓取全文、原网页靠脚本出字）：说一声，别让人对着空白（0.21.2） */}
          {empty && (social ? (
            // 社交平台的帖子只给了标题（小红书的视频笔记就是这样，0.29.1）：不是坏了，内容在原网页里
            <div className="art-empty art-only-title">
              <BirdNote bird="puzzled" action={origin && <a className="form-text-btn art-go" href={origin} target="_blank" rel="noreferrer">打开原网页 ↗</a>}>
                这条只有标题，内容在原网页里。
              </BirdNote>
            </div>
          ) : <div className="art-empty"><BirdNote bird="puzzled">这篇没拉到正文。</BirdNote></div>)}
        </div>
      )}
    </article>
  )
}

# 名称与美术

本仓库的**代码**以 [AGPL-3.0](LICENSE) 授权。下面这些**名称和美术**不在 AGPL 授权范围内，作者保留全部权利：

- 「灵媒」「Mediarium」这两个名字
- logo：`web/src/components/Logo.tsx` 里的图形、`web/public/icons/`、`web/public/favicon.ico`
- 寒鸦形象：`web/src/assets/birds/` 里的全部图形

它们放在仓库里，只是为了让代码能完整跑起来、方便参考。

**fork 或二次开发时**，请把上面的名称和美术换成你自己的。换起来很简单：
- 鸟都从 `web/src/components/Bird.tsx` 进入界面，换掉 `assets/birds/` 里的 SVG 即可
- logo 改 `Logo.tsx` 和 `public/icons/`
- 名字改 `web/index.html`、`web/public/manifest.webmanifest`

只是自己部署、自己用，不对外发布的话，不用换。

想用寒鸦或 logo 的朋友，请直接联系作者。

---

第三方素材按各自的许可使用：
- 图标：[Lucide](https://lucide.dev)（ISC；部分来自 Feather，MIT）
- 字体：EB Garamond、Literata、Newsreader、Source Sans 3、Source Serif 4、Jost、Atkinson Hyperlegible Next、IBM Plex Mono（均为 SIL Open Font License 1.1）

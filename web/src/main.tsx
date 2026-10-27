import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
// 西文字体随应用打包，不依赖 Google Fonts（国内访问不稳）
// 只声明字体，用到哪款才下载哪款
import '@fontsource/eb-garamond/latin-400.css'
import '@fontsource/eb-garamond/latin-400-italic.css'
import '@fontsource/eb-garamond/latin-500.css'
import '@fontsource/eb-garamond/latin-700.css'
import '@fontsource/ibm-plex-mono/latin-400.css'
import '@fontsource/ibm-plex-mono/latin-500.css'
import '@fontsource/source-serif-4/latin-400.css'
import '@fontsource/source-serif-4/latin-400-italic.css'
import '@fontsource/source-serif-4/latin-700.css'
import '@fontsource/newsreader/latin-400.css'
import '@fontsource/newsreader/latin-400-italic.css'
import '@fontsource/newsreader/latin-700.css'
import '@fontsource/literata/latin-400.css'
import '@fontsource/literata/latin-400-italic.css'
import '@fontsource/literata/latin-700.css'
import '@fontsource/source-sans-3/latin-400.css'
import '@fontsource/source-sans-3/latin-400-italic.css'
import '@fontsource/source-sans-3/latin-700.css'
import '@fontsource/jost/latin-400.css'
import '@fontsource/jost/latin-400-italic.css'
import '@fontsource/jost/latin-700.css'
import '@fontsource/atkinson-hyperlegible-next/latin-400.css'
import '@fontsource/atkinson-hyperlegible-next/latin-400-italic.css'
import '@fontsource/atkinson-hyperlegible-next/latin-700.css'
import { initTypo } from './typo/settings'
import { noPageZoom } from './lib/zoom'
import { initTheme } from './theme/theme'
import { initInk } from './lib/native'
import { initCrow } from './lib/crow'
import App from './App'
import './styles/base.css'
import './styles/sheet.css'
import './styles/shelf.css'
import './styles/magazine.css'
import './styles/article.css'
import './typo/prose.css'
import './styles/stream.css'
import './styles/manage.css'
import './styles/player.css'

initTheme()
initInk()
initCrow()
initTypo()
noPageZoom()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}) })
}

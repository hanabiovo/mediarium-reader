// 阶段 3：最小 Service Worker，只为让灵媒能装到桌面。
// 不缓存任何内容；离线缓存是阶段 5 的事。
self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()))
self.addEventListener('fetch', () => {})

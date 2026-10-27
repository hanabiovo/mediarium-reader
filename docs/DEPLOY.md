# 部署灵媒

灵媒是自己部署的：一台 Linux 服务器 + 一个域名，就能给自己和朋友用。

## 它由哪几块组成

```
浏览器（PWA）
   │  https://你的域名
   ▼
Nginx（宿主机）
   ├─ /            → 灵媒界面（web/ 构建出的静态文件）
   ├─ /miniflux/   → Miniflux（订阅、文章、账号，127.0.0.1:8010）
   └─ /scribe/     → 誊写服务（排版修补、翻译、图片中转、邀请注册，127.0.0.1:8011）
                         │
                         └─ RSSHub（可选，「灵媒自建」，只在 docker 内网）
```

数据都在 Miniflux 和它的 PostgreSQL 里；誊写服务自己只存加密后的翻译设置、译文缓存和邀请记录。

## 需要准备

- 一台 Linux 服务器，1 GB 内存够用（几个容器都设了内存上限，合计约 1 GB 以内）
- Docker 和 Docker Compose
- Nginx 和 certbot（申请 HTTPS 证书）
- 一个域名，解析到这台服务器
- 本机或服务器上有 Node.js 22+，用来构建前端

## 步骤

### 1. 拿到代码

```bash
git clone https://github.com/<你的用户名>/mediarium-reader.git
cd mediarium-reader
```

### 2. 填配置，启动后端

```bash
cd deploy
cp .env.example .env
chmod 600 .env
```

打开 `.env`，至少填好：`MEDIARIUM_DOMAIN`、`MINIFLUX_VERSION`、`ADMIN_USERNAME`、`ADMIN_PASSWORD`、`DB_PASSWORD`、`SCRIBE_SECRET`、`RSSHUB_VERSION`。每一项的说明都写在文件里。

不想要 RSSHub 的话，把 `docker-compose.yml` 里整个 `rsshub:` 服务和 scribe 下的 `RSSHUB_URL` 那行删掉。

```bash
docker compose up -d --build
docker compose ps                       # 几个服务都应是 running / healthy
curl -s 127.0.0.1:8011/health           # → ok
curl -s 127.0.0.1:8011/health/miniflux  # → ok /miniflux/v1
```

### 3. 构建前端，放到网站目录

```bash
cd ../web
npm ci
npm run build
sudo mkdir -p /var/www/mediarium
sudo cp -r dist/. /var/www/mediarium/
```

在自己电脑上构建也可以，把 `web/dist/` 里的全部内容传到服务器的 `/var/www/mediarium/` 即可。

### 4. 配 Nginx 和 HTTPS

```bash
sudo cp ../deploy/nginx/mediarium-limits.conf /etc/nginx/conf.d/
sudo cp ../deploy/nginx/mediarium.conf /etc/nginx/sites-available/mediarium
sudo nano /etc/nginx/sites-available/mediarium   # 把 reader.example.com 换成你的域名
sudo ln -s /etc/nginx/sites-available/mediarium /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo certbot --nginx -d 你的域名
```

### 5. 打开用起来

浏览器打开 `https://你的域名`，用 `.env` 里的管理员账号登录。手机上可以「添加到主屏幕」，当 App 用。

## 可选功能

- **翻译**：每个账号在「设置 › 翻译」里填自己的 AI 或 DeepL 密钥。管理员还可以在那里填一组火山引擎机翻密钥，给全站共用。密钥用 `SCRIBE_SECRET` 加密后存在服务器上。
- **邀请朋友**：用管理员账号登录 `https://你的域名/miniflux/`，在 设置 › API Keys 新建一把密钥，填进 `.env` 的 `SCRIBE_ADMIN_KEY`，然后 `docker compose up -d scribe`。之后在灵媒「设置 › 管理」里就能生成邀请链接。
- **需要账号的 RSSHub 路由**（小红书、Instagram 等）：cookie 填进 `.env`，并把配置名写进 `HUB_CONFIGURED`，例如 `HUB_CONFIGURED=XIAOHONGSHU_COOKIE`。建议用小号。
- **抓取代理**：有的网站会拦机房 IP。可以在 `.env` 里填 `FETCH_PROXY`，然后在源的设置里勾「通过代理抓取」。
- **接入 AI 助手（MCP）**：不用额外配置（需要 `SCRIBE_SECRET`，Nginx 用 `deploy/nginx/mediarium.conf` 里的 `/scribe/mcp/` 那一段）。每个人在灵媒「设置 › 接入 AI 助手」生成自己的专属链接，填进支持 MCP 的客户端。端点是 `https://你的域名/scribe/mcp/<链接里的随机串>`：Streamable HTTP、无状态、只接受 POST，不走 OAuth（添加时认证方式选「无」）。链接分只读和可管理订阅两档，只能碰自己的账号；开了链接的账号，服务器每天巡一遍信源。

## 更新

```bash
git pull
cd deploy && docker compose up -d --build scribe
cd ../web && npm ci && npm run build && sudo rm -rf /var/www/mediarium/* && sudo cp -r dist/. /var/www/mediarium/
```

更新前最好备份一下网站目录：`cp -r /var/www/mediarium ~/mediarium-web.bak`。

## 安全提醒

- `.env` 里全是密钥，不要提交进仓库，也不要贴到聊天里。
- 所有容器端口都只绑 `127.0.0.1`，只有 Nginx 对外。别改成 `0.0.0.0`。
- `SCRIBE_SECRET` 设好以后不要换，换了以后大家存的翻译密钥就都解不开了。

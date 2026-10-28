# 余额面板

一个以 **Furin 0.8**（文件式路由 + 服务端渲染 + ISR）构建、跑在 **Bun 1.4.4 / Elysia 2** 上的内网 AI 订阅余额面板。首页在服务端渲染成完整 HTML，数据读取与打码全部发生在服务器；浏览器只负责交互、轮询轨迹增量，并在长开的 iframe 里每 30 秒调用一次 furin 的 `router.refresh()` 原地重跑 loader——这些操作都不会直接访问内网余额接口，客户端也不新增 `fetch`。

## 功能

- **文件式路由（`src/pages`）**：`root.tsx` 是文档外壳（`defineRootRoute()` + `mode: "ssg"`），`index.tsx` 是唯一业务路由（`defineRoute("/")` + `mode: "isr", revalidate: 60`），未匹配 URL 与异常分别落到 `not-found.tsx` / `error.tsx`。
- **URL 搜索参数归一化**：零依赖手写解析器 `src/lib/balance/search.ts` 决定 `q/status/sort/view` 的默认值与非法值回落；路由层的 Elysia schema 只做“这是不是字符串”的把关，长度、枚举与回落规则只有这一套，服务端、浏览器与测试共用。
- **路由 loader 取数**：`src/pages/index.tsx` 的 `.loader()` 直接调用 server-only 数据层（`src/server/balance.server.ts`：TTL 缓存 + single-flight + fixture 降级；缓存过期时在 loader 里 **await** 一次上游刷新），**没有 server function、没有 `/api`**。
- **路由轨迹增量**：loader 只等 800 ms 的路由种子（超时先渲染骨架），浏览器挂载后轮询同源 `GET /feed/routing?after=<seq>`；上游登录 cookie 与打码都留在服务端。
- **长开页面原地刷新**：`src/features/dashboard/use-dashboard-refresh.ts` 每 30 秒调用一次 `router.refresh()`（页面隐藏时暂停、失败指数退避、上限 120 秒）。Furin 会重跑当前路由的 loader 并原地更新组件树：不新增历史、不重置滚动、不丢搜索框输入，也**不发 `fetch`**。ISR 的 `revalidate` 仍是 60 秒。
- **完整文档渲染**：`root.tsx` 的 `.layout()` 输出完整 `<html>`（head 元信息、宿主主题桥接脚本、body、`<Scripts />`）；页面 `.head()` 只改 `<head>`，不再自己写文档骨架。
- **账号打码**：上游 `user` 字段（邮箱、用户名、手机号）在服务端整体替换为**与原文等长的 `*`**，不留前后缀、数字或域名，之后才进入 loader data 与 HTML；账户名（如 WorkBuddy）保持正常展示。账户 id 是 `provider::<哈希>`，不含原始身份。
- **显式 server-only 边界**：`src/server/**` 顶部用 `@teyik0/furin/server-only` 标记，构建期 `@teyik0/furin/strip-plugin` 会把页面模块里的 loader/head/config 从浏览器包剥离——因此页面 loader 可以直接 import 服务端模块，而这些模块永远进不了客户端 bundle。
- **部署运行时**：`furin build --target bun` 产出的 Bun 服务端包可直接用 `bun` 运行；`--compile embed` 再产出一个内嵌客户端与静态资源的单文件可执行程序，容器里只有它和 glibc。
- **new-api 风格 UI**：Tailwind CSS v4 + oklch 设计令牌、rounded-2xl 卡片、ring 边框；字体直接沿用 new-api 的字体令牌值（`--font-ui-sans: sans-serif`，serif 链与 new-api 相同），不下载任何 web font，正文与标题都由用户机器自带的系统字体渲染；深/浅色由 new-api 宿主通过 `postMessage` 决定，独立打开时跟随系统。
- **首页排版**：秘密房间文案（标题 → 欢迎语 → 叙事段落 → 契约提示）→ 账户分区（服务端搜索/筛选与账户列表合并在同一张卡片内）→ 用量概览；顶部不设导航栏，也不提供主题切换按钮。
- **服务端搜索**：搜索栏是 `action="/" method="get"` 的表单，禁用 JS 时也能由服务器重新加载；有 JS 时只有搜索词 `q` 会改变服务端数据，输入过程中不触发导航，点击「搜索」或按回车才提交，避免输入时布局抖动。
- **筛选与排序走 URL 状态**：「全部 / 正常 / 异常」、排序、网格/列表视图都写进 URL（可分享、可前进后退），并用 `replace: true` + `resetScroll: false` 让它们像本地更新一样发生。与旧实现的一个区别：这些切换现在也会触发一次 furin 路由导航（即一次该 URL 的路由数据请求），取舍见「搜索与 URL 状态」。
- **账户数据更新时间**：网格卡片与列表行都显示上游返回的 `readAt`（每个账户数据的实际抓取时间，按 `Asia/Shanghai` 格式化），与「最近读取」排序同源；数据源没有返回时间时该行自动隐藏。Hero 显示 `source.fetchedAt`（快照抓取时间）和每秒重算的“x 秒前更新”；`缓存命中 / 已重新拉取` 这类生成时状态只放在 title 里，避免 ISR 缓存页把某个静态状态一直挂在那里。
- **不展示每日/累计用量**：上游余额接口只返回额度窗口、额度与重置时间，不包含每日用量数据。面板因此不提供 7 / 14 / 30 天区间筛选、每日用量柱状图和累计用量统计，避免把并不存在的数据展示给用户；用量信息只来自各账户的额度窗口（已用比例、剩余额度与重置倒计时）。
- **没有「列表加载中」骨架**：筛选/搜索切换会触发一次 furin 路由导航，列表内容由该次路由数据请求的结果决定；页面没有单独的列表骨架或「正在更新」提示（状态行保留为空占位，`role="status"` 也不再播报中间态）。
- **无提供方详情页、无账号设置页、无对外 API**：面板只保留首页余额总览；`/providers/*`、`/settings`、`/api/*` 一律 404。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 运行时 / 包管理 | **Bun 1.4.4**（`engines.bun >=1.4.0`、`bun.lock`） |
| 框架 | **@teyik0/furin 0.8.0-alpha.0**：`src/pages` 文件式路由、SSG/ISR/SSR 渲染模式、Bun 构建与单文件编译 |
| HTTP 服务 | **Elysia 2.0.0-beta.32**：`src/server.ts` 挂 CORS、`/feed/routing` API、furin 页面与 `--healthcheck` |
| UI | **React 19.3.1**（真实运行时，无替换）+ Tailwind CSS v4 + Lucide icons |
| 数据 | 路由 loader + server-only 模块（TTL / single-flight / fixture，过期时等待上游刷新）；浏览器轮询 `/feed/routing`，并每 30 秒 `router.refresh()` |
| 校验 | Elysia `t`（路由 query）+ Zod 4（上游响应，仅服务端）；URL 归一化零依赖 |
| 构建 | `furin build --target bun` + `tsc --noEmit` |
| 测试 | Vitest 5（当前 9 个文件 / 103 个用例） |

## 快速开始

```bash
bun install
cp .env.example .env          # 可选：配置内网余额接口与上游网关
bun run dev                   # bun --hot src/server.ts → http://localhost:3000
```

开发期由 furin 的 Bun full-stack dev server 直接渲染页面：`bunfig.toml` 的 `[serve.static]` 负责 Tailwind 编译、`strip-plugin` 的浏览器桩替换，以及 `FURIN_PUBLIC_*` 的构建期内联。

未配置 `BALANCE_API_URL` 时自动使用 `src/server/fixtures/balances.json`，页面会明确标注「示例数据」。接口失败时优先返回旧缓存，否则降级到 fixture，并在页面显示警告。

### 生产构建与运行

```bash
bun run build                 # furin build --target bun && tsc --noEmit
bun run start                 # bun .furin/build/bun/server.js
bun run build:binary          # furin build --target bun --compile embed → .furin/build/bun/server
```

注意：`build:binary` 产出的是自包含单文件，它会重建 `.furin/build/bun`，不再保留 `server.js` / `client/` 目录（因此要与 `bun run start` 并存时，之后再跑一次 `bun run build`）。CI 的验收步骤排在编译单文件之前，原因相同。

Bun 启动时会自动读取仓库根目录的 `.env`；平台注入的环境变量优先。也可以完全不用 `.env`，直接由 Docker/systemd/PaaS 注入环境变量。

构建产物布局：

| 路径 | 内容 |
| --- | --- |
| `.furin/build/manifest.json` | 构建清单：`buildId`、路由（`pattern/mode/revalidate`）与 `targets.bun` |
| `.furin/build/bun/server.js` | Bun 服务端包入口（`bun run start` 运行它） |
| `.furin/build/bun/client/` | 客户端资产，URL 前缀 `/_client/`：`_hydrate-*.js` 入口、`index-*.js` 路由、`sort-select-impl-*.js` 懒加载、`_hydrate-*.css` |
| `.furin/build/bun/public/` | 公共静态资源：`public/` 下的文件按 `/public/<文件名>` 提供 |
| `.furin/build/bun/server` | `--compile embed` 的单文件产物（Windows 下为 `server.exe`），客户端与 public 资源已内嵌 |

响应头里的 `x-furin-build-id` 就是 manifest 里的 `buildId`，用来确认线上跑的到底是哪次构建。

## 目录结构

```text
src/pages/          文件式路由：root.tsx（文档外壳）、index.tsx（首页 ISR）、error.tsx、not-found.tsx
src/server.ts       Elysia 入口：onRequest CORS + 预检、挂 /feed/routing、挂 furin、--healthcheck
src/api/routing.ts  GET /feed/routing?after=N（增量轨迹，no-store）
src/server/         server-only 数据层：balance.server.ts、routing.server.ts、reveal.server.ts
src/lib/            纯逻辑：balance/*（schema/derive/format/auth/search）、routing/*（derive/geometry/timeline/types）、theme.ts
src/features/       页面与组件：dashboard/*、routing/*
src/components/     UI 原语、AppLayout、DefaultCatchBoundary、NotFound
src/styles/app.css  Tailwind 入口、设计令牌、动效与 reduced-motion 白名单
bunfig.toml         开发期 Bun 配置（[serve.static] 插件与 FURIN_PUBLIC_* 前缀）
furin.config.ts     生产构建配置（pagesDir / serverEntry / targets）
furin-env.d.ts      furin typegen 生成的类型（不要手改）
scripts/verify.mjs  验收矩阵（见 VERIFICATION.md）
```

## 作为 new-api 首页嵌入

页面设计为嵌入 [new-api](https://github.com/QuantumNous/new-api) 的自定义首页。配置位置：

1. new-api 管理端 **System Settings → Site & Branding → System Information**（`/system-settings/site/system-info`）；
2. 在 **Home Page Content** 里填本站点的**绝对 http(s) URL**（例如 `https://balance.example.com/`）。new-api 只在值是绝对 `http(s)` URL 时才用 iframe 渲染，相对路径会被当作 Markdown/HTML；
3. 页面高度跟随 iframe（new-api 使用 `h-screen`），顶部 `pt-16 sm:pt-20` 为 new-api 固定头部留出空间。

### 主题契约

new-api 用 sandbox iframe 渲染自定义首页，sandbox 不含 `allow-same-origin`，因此页面是 opaque origin：读父页或自身 `localStorage` 都会抛 `SecurityError`。主题只能靠父页单向 `postMessage`：

```js
// new-api web/src/features/home/index.tsx
iframe.contentWindow.postMessage({ themeMode: 'light' | 'dark' }, '*')
iframe.contentWindow.postMessage({ lang: 'zh-CN' }, '*')
```

- 发送时机：iframe `onLoad`，以及宿主主题/语言变化时；没有 `type` 字段、没有 ready/ack，父页也不监听子页消息。
- 本页面在 `src/pages/root.tsx` 的 `<head>` 里用**阻塞内联脚本**（`hostThemeInitScript`）同步注册监听（不能等 React hydration，否则会丢掉 `onLoad` 那条），用 `event.source === window.parent` 校验，兼容 `{ themeMode }`、`{ theme }`、`{ mode }` 与字符串载荷。
- 首帧直接按 `prefers-color-scheme` 绘制，**不用 `visibility:hidden` 等宿主消息**：那条消息只在 iframe `onLoad` 之后才到，遮罩会把整页的真实显示时间推到「所有资源加载完成」，进场动画还会在不可见状态下跑完。收到消息后只做一次颜色重绘。
- 如果宿主主题与系统主题不一致，首帧到消息到达之间会看到一次换色；在 new-api 里把首页地址写成 `https://panel.example.com/?theme=dark`（或 `light`）即可让首帧就是目标主题，完全不换色——显式 `?theme=` 优先于宿主的 `postMessage`。
- 支持 `?theme=light|dark|system` 强制主题，用于本地调试或其它宿主。

### 控制台入口（已移除）

旧版首页在密钥提示下方有一个「前盘仪表盘」链接（`target="_top"` 跳到 new-api 控制台）。**当前页面已不再渲染这个入口**；`src/lib/host-links.ts` 里的 `newApiDashboardHref` 目前没有任何消费者，属于待清理的死代码。

构建期公开变量 `FURIN_PUBLIC_NEWAPI_DASHBOARD_URL` 仍然保留在 `.env.example`、`Dockerfile` 与 CI 工作流里（会被内联进浏览器包），但**当前 UI 不消费它**；要恢复入口时把链接重新接到 hero 上，默认值 `/dashboard` 适用于面板与 new-api 同源部署。

### 需要放开的服务器侧设置（已内置）

- `src/server.ts` 的 Elysia `onRequest` 统一处理跨源：`OPTIONS` 预检直接回 204（不回落到 SSR/loader），其余带 `Origin` 的请求补 `Access-Control-Allow-Origin: *`；
- 显式 `Access-Control-Expose-Headers: x-furin-build-id`，否则跨源下客户端读不到构建标记；
- 这个钩子是唯一对**页面文档、ISR 缓存响应、`/_client/*` 静态资源与 `/feed/routing` 全部生效**的位置（furin 页面响应走自己的链路，`onAfterHandle` / `mapResponse` 改不到）；
- ISR 的缓存头由 furin 生成（见「渲染模式与缓存」），`/feed/routing` 自己在 `src/api/routing.ts` 里写 `cache-control: no-store`；
- 仓库不做应用内压缩、也不内联 CSS，压缩交给反向代理（见「为什么不在应用内压缩、也不内联 CSS」）。

### 已知限制

- new-api 在 iframe `onLoad` 后才发第一条消息，所以首帧只能先按系统主题绘制；宿主深色 + 系统浅色时会看到一次换色（用 `?theme=dark` 可消除，见上）。
- new-api 挂载自定义首页 iframe 之前要先等 `GET /api/setup` 与 `GET /api/home_page_content` 两个串行请求（宿主仓库的根路由与 home 组件），期间只显示文字「Loading...」——这段等待发生在宿主侧，本页面无法提前。
- new-api 在「主题已是 system 且系统主题未变」时不会重发消息；页面在此期间跟随系统，不影响显示。
- 父页只下发明暗与语言，不下发字体/圆角/预设等个性化令牌（new-api #7123 仍建议增加 ready/ack），所以本页字体固定为系统字体，与 new-api 的默认字体一致；宿主把字体轴切成 Sans / serif 时无法跟随。
- iframe 内 `fetch` 均为跨源：需要 cookie/session 的接口必须改成 token/Bearer（本项目余额接口与网关读取都在服务端，不受影响）。

## 渲染模式与缓存

| 文件 | 渲染模式 | 原因 |
| --- | --- | --- |
| `src/pages/root.tsx` | `ssg` | 文档外壳没有 loader，静态骨架；页面自己用 ISR 才能拿到 CDN 缓存头 |
| `src/pages/index.tsx` | `isr` + `revalidate: 60` | 公开数据（余额快照 + 轨迹种子）按 URL 缓存 60 秒，进程内缓存与 CDN 语义一致 |
| `src/pages/error.tsx` | 错误边界 | 页面 / loader / head 抛错时渲染，`reset()` 重跑当前路由 loader |
| `src/pages/not-found.tsx` | 404 边界 | 未匹配 URL 与 loader 里的 `notFound()` |

账号相关页面不包含提供方详情页、设置页或对外 API；`/providers/*`、`/settings`、`/api/*` 一律 404（验收脚本会断言）。

**为什么用 ISR 而不是 SSR**：furin 的 SSR 响应固定 `Cache-Control: no-store`（在 loader 里也改不动），首页会被每一层缓存都当成不可缓存；`mode: "isr"` 才拿得到 `s-maxage` 与 `stale-while-revalidate`，也才能让 CDN 边缘真正吃掉回源。ISR 的缓存键是**完整 URL（含 query）**，因此 `/?q=WorkBuddy`、`/?status=error` 各自有一份缓存。

**余额缓存与 ISR 的分工（2026-10-29 修复）**：旧的 `balance.server.ts` 自己也实现了一套 SWR——TTL 过期但手里有数据时立刻返回旧数据，再用 `void refresh()` 后台刷新。问题在于 `BALANCE_CACHE_TTL_SECONDS` 默认 30 秒，短于 ISR 的 `revalidate: 60`：ISR 每 60 秒再生成时，loader 拿到的正好是“已过期、先返回旧值”的旧快照，于是新 HTML 又被写回缓存，badge 永远停在旧数据状态，永远追不上上游。现在 loader 在过期/无缓存时 **await** 刷新，再生成完成才返回；`stale-while-revalidate` 只保留在 ISR 层，浏览器拿到旧 HTML 与后台换新由框架负责。`cache: 'stale'` 因此只表示“上游读取失败、仍展示上一份缓存”（同时写 `source.warning`），正常刷新是 `cache: 'miss'`；`ttlSeconds` 与 `fetchedAt` 仍如实反映服务端缓存状态。**Hero 不再把 `cache: 'miss'` 直接当常驻标签**：ISR 页面每 60 秒再生成一次，而每次再生成都会 await 刷新，所以旧写法会让「已重新拉取」看起来永远不变；现在改为按 `fetchedAt` 每秒重算的数据年龄（`刚刚更新` / `12 秒前更新` / …），每次刷新后按新的 `fetchedAt` 重新计时，缓存命中/已重新拉取/页面生成时间放进 title 供排查。

### 实测响应头（2026-10-28，构建 `ae2909324f9f`）

| 路径 | `Cache-Control` | 其他 |
| --- | --- | --- |
| `/`、`/?q=…`（ISR） | `public, max-age=0, s-maxage=60, stale-while-revalidate=60` | `ETag`、`Content-Length`、`cache-tag: /`、`x-furin-build-id` |
| `/feed/routing?after=N` | `no-store` | `application/json`，带 Origin 时有 `ACAO: *` |
| `/_client/*.js`、`/_client/*.css` | `public, max-age=31536000, immutable`（响应里还拼了一段 `public, max-age=86400`） | `ETag`、`Content-Range`、`x-furin-build-id` |
| `/public/*` | `public, max-age=86400`（无内容哈希） | public 目录下的静态文件 |
| `/api/**`、`/providers/*`、`/settings` | 404 页面不带缓存头 | 不进 CDN |

要点：

- **浏览器 `max-age=0`**：每次导航都回源校验（`ETag` 命中时是 304），不会长期看到旧页面；**CDN 边缘 60 秒**，部署后最多 1 分钟边缘生效，需要立即生效就在 CDN 控制台 purge。
- **ISR 响应带 `ETag` 与 `Content-Length`**，不再是流式 chunked。注意：ISR 后台再生成的那一次响应会把 `s-maxage` 改成 0（让 CDN 先别缓存这份半新不旧的副本），下一次命中才回到 60，所以监控里看到偶发 `s-maxage=0` 属于正常现象。
- 多数 CDN 用 `s-maxage` 作边缘 TTL；Cloudflare 优先读 `CDN-Cache-Control`，本仓库不发这个头，按 `s-maxage` 配置即可。
- 上游 `BALANCE_API_URL` 由服务端进程在内网访问，**不经过 CDN**，也不受这些头影响。
- 源站响应头只是前提，**CDN 侧还要允许缓存 HTML**（Cloudflare 默认只缓存静态扩展名）。以 Cloudflare 为例，在 **Caching → Cache Rules** 里按顺序配置：
  1. `starts_with(http.request.uri.path, "/feed/")` → **Bypass cache**；轨迹是实时数据，不能被边缘缓存；
  2. `http.request.uri.path eq "/"`（或 `content_type contains "text/html"`）→ **Eligible for cache**，Edge TTL 选「Use origin cache-control」。

  第 1 条必须排在第 2 条之前：如果 Cache Everything 规则把 `/feed/routing` 也纳入缓存并覆盖 Edge TTL，轨迹就会变成 60 秒前的旧数据。

验证（部署后）：

```bash
curl -sSI https://<面板域名>/                      | grep -i 'cache-control\|etag'
curl -sSI 'https://<面板域名>/feed/routing?after=0' | grep -i 'cache-control'
curl -sSI https://<面板域名>/_client/<入口>.js      | grep -i 'cache-control'
```

预期：首页 `public, max-age=0, s-maxage=60, stale-while-revalidate=60` + `ETag`；轨迹接口 `no-store`；`/_client/*` 一年 `immutable`。

### 首屏字节（构建产物实测，未压缩）

| 资产 | raw | gzip | br |
| --- | ---: | ---: | ---: |
| 入口 `_hydrate-*.js` | 306,337 | 98,370 | 84,603 |
| 路由 chunk `index-*.js` | 94,073 | 33,540 | 27,654 |
| 3 个共享 `_hydrate-*.js` | 37,496 | 13,327 | 11,618 |
| `error-*.js` + `not-found-*.js`（modulepreload） | 2,956 | 1,743 | 1,442 |
| **首屏 JS 合计** | **440,862** | **146,980** | **125,317** |
| 懒加载 `sort-select-impl-*.js`（load 后空闲/意图预取） | 94,599 | 33,261 | 29,409 |
| `_hydrate-*.css`（外部样式表） | 42,174 | 8,029 | 6,968 |
| 文档（fixture 4 个账户 / 0 个账户） | 32,878 / 20,140 | 7,491 / 5,956 | 6,004 / 4,763 |

- **首屏 JS 约 430 KiB 未压缩**，其中大部分是 React 19 与 furin 客户端运行时（含 RSC 客户端与路由层）的固定成本，业务代码只有几 KB；`sort-select-impl` 那 92 KiB 的 Radix 依赖链不在首屏，只在首次交互或 load 后空闲时加载。
- 首屏总传输（文档 + CSS + JS，未压缩）约 **504 KiB**；本地 brotli 压缩后约 **135 KiB**、gzip 约 159 KiB。这些压缩数字只是「反向代理开启压缩后大概能到哪」的参考，真实值取决于 CDN/代理的压缩级别与静态字典。
- 页面没有 web font（0 个 woff2）、没有图片、没有第三方脚本；CSS 是唯一的额外首屏请求。

### 为什么不在应用内压缩、也不内联 CSS

- 压缩：furin 的页面响应走自己的流式链路，Elysia 的 `onAfterHandle` / `mapResponse` 改不到它（实测：带 `Accept-Encoding: gzip, br` 请求首页，响应没有任何 `Content-Encoding` / `Vary`）；框架官方口径也是把压缩交给反向代理。所以这里**不做应用内 gzip**，由 nginx/Caddy/Cloudflare 统一压缩（推荐 brotli 优先，HTML/JS/CSS 都压）。
- CSS：furin 不提供构建期内联样式，`root.tsx` 只是普通 import `~/styles/app.css`，产物是外部 `/_client/*.css`。代价是首访多一次阻塞渲染的 CSS 请求（42 KB，br 约 7 KB）；收益是它带内容哈希、可以一年 `immutable` 缓存，而 ISR 的 HTML 每 60 秒就可能被 CDN 重新拉取——把 42 KB 样式塞进每份 HTML 会让每次回源都多传一遍。这是「首访」与「重复访问」的取舍，本轮选择后者。

## 服务端数据边界

```text
src/pages/index.tsx  .loader()            （服务端执行；客户端导航时该 URL 的路由数据由 furin 取回）
  -> src/server/balance.server.ts         （server-only：TTL 30s + single-flight；过期时 await 上游刷新，SWR 由 ISR 负责；fixture 降级）
       -> BALANCE_API_URL                 （fetch + Authorization: Bearer <BALANCE_API_KEY>）
  -> src/server/routing.server.ts         （800ms 预算的轨迹种子）
       -> 上游网关 web（?k= 换 HttpOnly cookie）-> GET /api/gateway/trace?after=N
  -> src/lib/balance/derive.ts            （纯函数：额度窗口、百分比、排序、等长打码、文本搜索）
页面组件
  -> parseDashboardSearch(search)          （归一化，无运行时依赖）
  -> applyDashboardFilters(payload, search)（status/sort/view，本地过滤，不发请求）
浏览器
  -> GET /feed/routing?after=<seq>          （增量轮询；no-store；失败退避）
  -> router.refresh() 每 30s               （重跑当前路由 loader 原地更新；无 fetch、无历史记录）
```

- **为什么 loader 可以直接 import `src/server/**`**：furin 构建时会把页面模块的 `loader` / `head` / `config` 从浏览器包剥离（`strip-plugin`），只有页面组件本身进客户端；`src/server/**` 又带 server-only 标记，因此不会泄漏。验收脚本会扫产物确认。
- **缓存与降级（`balance.server.ts`）**：TTL 内直接命中；TTL 过期或没有缓存时，loader **等这次上游读取完成再返回**（成功即 `cache: 'miss'`）。页面层的“旧数据先返回、后台换新”只由 furin ISR 的 `revalidate: 60` 负责，服务端不再重复实现一层 SWR。上游失败永不 reject：先退到上一份缓存（`cache: 'stale'` + `source.warning`），没有缓存再退到内置 fixture。并发请求共享同一次上游读取（single-flight）。
- **轨迹（`routing.server.ts`）**：上游 web 只用 HttpOnly cookie 认人，`/api` 不带 CORS，浏览器在 opaque origin 里既发不出 cookie 也读不到响应，所以登录、轮询、打码全在服务端；同一 `after` 的并发轮询合并成一次上游请求。
- **密钥**：`BALANCE_API_KEY` / `GATEWAY_WEB_KEY` 只在 Bun 服务端进程读取，不进入客户端 bundle、不出现在页面里。配置了 URL 但缺少 Key 时不会发出未认证请求，直接回退示例数据并提示。
- **打码**：账户身份在 `toAccountView()` 里变成等长 `*`，provider / 客户端名变成 `k…` / `agent-…` 哈希 token，只有脱敏值会被序列化到客户端；账户名（WorkBuddy 等）与渠道分组标题不参与打码。

## 搜索与 URL 状态

- **只有 `q` 影响服务端数据**：loader 把归一化后的 `q` 交给 `buildDashboard()`；`status` / `sort` / `view` 由 `applyDashboardFilters()` 在浏览器里过滤、排序、切换视图。
- **搜索是提交式的**：`onChange` 只改本地 state，提交或回车才 `navigate()`。输入过程中不导航、不请求、不抖动。
- **表单本身可服务端提交**：`action="/" method="get"` + 隐藏的 `status/sort/view` 字段，禁用 JS 时由浏览器直接请求该 URL，服务端照样渲染过滤后的结果（同一份 loader 与 ISR 缓存）。
- **URL 形状**：默认值不落地址栏（`toSearch()` 只写非默认字段），所以初始地址仍是 `/` 而不是 `/?q=&status=all`；导航一律 `replace: true` + `resetScroll: false`，不新增历史记录、不把页面滚回顶部。
- **取舍（如实说明）**：旧实现里筛选/排序/视图切换「完全不发请求」；现在它们也走 furin 的显式路由状态，因此**每次切换都会触发一次该 URL 的路由数据请求**（ISR 命中时是毫秒级缓存响应，未命中则要重跑 loader）。换来的是 URL 永远可分享、可前进后退、无需第二套本地状态。对频繁切换筛选的用户，这是比旧实现多出来的请求；如果不能接受，可以退回纯本地状态，但代价是地址栏不再反映视图。

## 账号打码规则

- 账户名（如 `WorkBuddy`、`Open Design`）保持正常展示。
- 邮箱 `user@example.com`、用户名 `exampleuser`、手机号 `138****0000`：**整个字段替换为与原文等长的 `*`**（例如 11 个字符 → 11 个星号），不留前后缀、数字或域名。
- 账户 id 是 `provider::<base36 哈希>`；轨迹里的 provider / 客户端名是不透明 token（`k…` / `agent-…`），展示名同样是等长星号，浏览器再叠一层高斯模糊（`REVEAL_IDENTITIES=1` 时除外）。
- 原始 `user` 字段只存在于服务端响应处理过程中，不写入 loader data、HTML、地址栏或客户端 JS。

## 测试与验收

```bash
bun run test          # Vitest：9 个文件 / 103 个用例（搜索归一化、格式化、打码、派生聚合、轨迹几何/时间轴/动效、主题桥接、余额缓存再生成、数据年龄）
bun run typecheck     # tsc --noEmit
bun run build         # furin build --target bun && tsc --noEmit
bun run verify        # bun scripts/verify.mjs：需先 build，再起 127.0.0.1:3210 做 SSR/打码/泄漏/路由/CORS 断言
```

`bun run verify` 需要先有 `.furin/build/bun/server.js`；它会自己再跑一遍 `bun run test`（用例数只增不减，门槛 103），并用 3210–3214 五个端口做 fixture / 临时 `.env` / mock 上游 / 缺 Key / 过期缓存刷新探针（C40 用 TTL=1s + 每次响应都变化的 mock 上游，断言过期缓存被 awaited 刷新成 `miss`，而不是 `stale`）。完整矩阵、断言口径与复现方式见 [VERIFICATION.md](VERIFICATION.md)。

## CI/CD 与容器部署

`.github/workflows/build-deploy.yml` 的流水线是：
`typecheck → 测试 → 构建 → 单文件编译 → 验收矩阵 → 构建镜像并推送 GHCR → 触发 Dokploy Webhook 部署`。镜像里的服务端是
`furin build --target bun --compile embed` 产出的单文件可执行程序（客户端与 public 资源内嵌），运行在
`cgr.dev/chainguard/glibc-dynamic` 上。本仓库只有一个应用，因此去掉了 matrix 与 `apps/**` 路径过滤，并补上了 PR 质量门禁与容器冒烟。

### 触发与任务

| 触发 | quality（typecheck + test + build + binary + verify） | image | deploy |
| --- | --- | --- | --- |
| Pull request | ✅ | ✅ 本地构建 + 容器冒烟，不推送 | — |
| push `main` | ✅ | ✅ 推送到 GHCR（仅代码相关路径变化时） | ✅ |
| `workflow_dispatch` | ✅ | ✅ | 可选，由 `deploy` 输入控制 |

镜像名为 `ghcr.io/<owner>/<repo>`，标签：

- `:<package.json 的 version>`（当前 `1.0.0`）
- `:<短 SHA>`
- `:latest`

`changes` 任务用 `dorny/paths-filter` 只看代码相关路径（`src/**`、`public/**`、`scripts/**`、`package.json`、`bun.lock`、`tsconfig.json`、`bunfig.toml`、`furin.config.ts`、`furin-env.d.ts`、`vitest.config.ts`、`Dockerfile`、`.dockerignore` 与 workflow 自身），纯文档提交只跑质量门禁。

PR 上的容器冒烟会启动镜像（映射到 3300），确认首页返回 `余额面板`，并从文档里取一个 `/_client/*.css` 名字再请求一次——静态资源必须真的来自二进制内嵌，而不是宿主目录。

### 需要的仓库配置

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `DEPLOY_WEBHOOK` | Dokploy 服务的 Webhook URL |
| Variable | `FURIN_PUBLIC_NEWAPI_DASHBOARD_URL` | 构建期公开变量（会内联进浏览器包）；当前 UI 未消费，留空即可 |

推送 GHCR 使用内置的 `GITHUB_TOKEN`，工作流已声明 `packages: write`，不需要额外的 PAT。

### 构建产物：单文件可执行程序

```bash
bun run build          # furin build --target bun && tsc --noEmit → .furin/build/bun/
bun run build:binary   # → .furin/build/bun/server（Windows 下为 server.exe）
```

- `--compile embed` 把 Bun 服务端包、`client/` 与 `public/` 一起编进单个可执行文件，运行期不再需要 `node_modules` 或静态目录；
- 二进制自带 `--healthcheck` 模式：在绑定端口之前请求本进程的 `/_furin/health/ready`（内部超时 4 秒），成功退 0、失败退 1；
- 该模式只在成品里使用：开发期 `bun src/server.ts` 下 furin 不注册健康端点。

本地运行：

```bash
PORT=3000 ./.furin/build/bun/server
PORT=3000 ./.furin/build/bun/server --healthcheck   # 0 = 正常，1 = 异常
```

### 容器镜像

```bash
docker build -t newapi-index:local .

docker run --rm -p 3000:3000 \
  -e BALANCE_API_URL=https://relay.example.com/api/balances \
  -e BALANCE_API_KEY=sk-... \
  newapi-index:local
```

- 构建阶段是 `oven/bun:1.4.4-slim`：`bun install --frozen-lockfile` → `bun run build`（类型错误会让镜像构建失败）→ `bun run build:binary`；
- 运行阶段是 `cgr.dev/chainguard/glibc-dynamic`（glibc + libgcc/libstdc++ + ca-certificates）+ `/app/server`：没有 Bun 运行时、没有 shell、没有 `node_modules`、没有 curl/wget；
- 以非 root（`65532:65532`，即镜像自带的 `nonroot`）运行，暴露 3000 端口；
- `HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD ["/app/server", "--healthcheck"]`：二进制内部的探活超时是 4 秒，给 Docker 的 5 秒留 1 秒余量；
- 镜像不含 tzdata：页面里的 `Intl.DateTimeFormat` 按 `Asia/Shanghai` 格式化时间，依赖 Bun 内置的 ICU 时区数据（已实测正确）；若以后需要系统时区数据（`/usr/share/zoneinfo`），再自己加一层；
- 基础镜像提供 `linux/amd64` 与 `linux/arm64` 两个平台；`:latest` 跟随 Chainguard 的安全更新，需要可复现构建时把 `Dockerfile` 里的 `FROM` 改成按 digest 固定；
- 运行期变量（`BALANCE_*`、`GATEWAY_*`、`PORT`、`BUILD_ID`）通过 `-e` 或 Dokploy 的环境变量注入，**不要**写进镜像；
- `FURIN_PUBLIC_NEWAPI_DASHBOARD_URL` 是构建期变量，用 `--build-arg` 传入；
- 镜像里没有 shell，排查问题只能看 `docker logs`，不能 `docker exec sh`。

### Dokploy 接入

1. 在 Dokploy 新建 Compose 服务，镜像指向 `ghcr.io/<owner>/<repo>:latest`；
2. 打开 **Auto Deploy**，复制该服务的 Webhook URL，填入仓库 Secret `DEPLOY_WEBHOOK`；
3. 分支填 `main`（与工作流的 `on.push.branches` 保持一致）；
4. 若 GHCR 包是私有的，在 Dokploy 配置 registry 凭据（用户名 + 带 `read:packages` 的 PAT）。

Webhook 请求体与参考项目一致（`ref` + `commits`，请求头 `x-github-event: push`），Dokploy 据此判断路径是否命中要部署的服务。

> 如果 Dokploy 的 compose 固定了版本标签而不是 `:latest`，需要同时调整工作流的推送标签，否则部署会拉到旧镜像。

> 镜像默认只构建 runner 的架构（`linux/amd64`）。若 Dokploy 主机是 ARM，在 `Build and push image` 步骤加 `platforms: linux/arm64`（或同时构建两个架构；多架构时 PR 上的 `load` 需要去掉）。

### 关于 `bun run verify`

验收脚本按 furin 的产物与响应头重写后已经稳定，**CI 已把它作为门禁**：`quality` 任务在 typecheck、单测、`bun run build` 与 `bun run build:binary` 之后执行 `bun run verify`（39 项 HTTP/SSR/安全断言，起 127.0.0.1:3210 跑生产产物；C40 额外用 3214 的 mock 上游验证过期缓存会在 ISR 再生成里被 awaited 刷新）。任何一项 FAIL 都会让流水线失败，镜像不会构建、也不会触发部署。

本地复现同样的门禁：

```bash
bun install --frozen-lockfile
bun run typecheck && bun run test && bun run build && bun run build:binary
bun run verify
```

`.gitignore` 已排除 `.env`、`node_modules`、`.furin`，本地密钥与构建产物不会被提交。

## 环境变量

Bun 会自动加载 `.env`、`.env.local`、`.env.production` 等文件；平台注入的环境变量优先。只有 `FURIN_PUBLIC_*` 前缀的变量会被内联进浏览器包（`bunfig.toml` 的 `[serve.static].env`），其余变量只存在于服务端进程。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BALANCE_API_URL` | 空 | 内网余额接口；为空时使用 fixture |
| `BALANCE_API_KEY` | 空 | 中转站 API Key，默认以 Bearer 方式发送（仅服务端） |
| `BALANCE_API_TIMEOUT_MS` | `5000` | 上游请求超时 |
| `BALANCE_CACHE_TTL_SECONDS` | `30` | 服务端缓存 TTL（秒）；过期后 loader 等一次上游刷新再返回（SWR 由 ISR 负责） |
| `PORT` | `3000` | Bun 服务端口（`--healthcheck` 也读它） |
| `FURIN_PUBLIC_NEWAPI_DASHBOARD_URL` | 空（默认 `/dashboard`） | 构建期内联的公开变量；当前 UI 未消费（见「控制台入口」） |
| `GATEWAY_WEB_URL` | 空 | 上游网关 web 页面地址（可带 `?k=…`）；路由轨迹在这里读 trace（仅服务端） |
| `GATEWAY_WEB_KEY` | 空 | 该页面的访问 key；也可以直接写在 `GATEWAY_WEB_URL` 的 `?k=` 里 |
| `GATEWAY_WEB_TIMEOUT_MS` | `5000` | 上游网关 web 请求超时 |
| `REVEAL_IDENTITIES` | 空（**任何环境都默认关闭**） | 设为 `1` 时把真实账号身份发给浏览器，仅用于本机对账 |

### 身份打码与本地对账

- **默认（生产、构建产物、验收脚本）**：账号身份在服务端就抹成等长 `*`，provider 与客户端换成不透明 token，页面 HTML 与浏览器数据里没有任何原始账号。
- **本机对账**：现在**没有**「开发环境自动解除打码」的开关了（旧的 dev 自动打开行为已移除）。需要在浏览器里看到真实账号、套餐与额度时，显式用 `REVEAL_IDENTITIES=1 bun run dev` 启动；`bun run build` 出来的产物恒为打码（除非显式设了 `REVEAL_IDENTITIES=1`）。
- 打码开关只影响**展示**：账户 id、轨迹的 provider token 在任何模式下都不换成原始值，否则同一批卡片会在两次轮询间换列。

## 相关文档

- [VERIFICATION.md](VERIFICATION.md)：验收矩阵、断言口径、运行方式与实测证据。
- [PERFORMANCE.md](PERFORMANCE.md)：当前可测量的体积/缓存/压缩口径，以及为什么不在应用内压缩。
- [docs/frontend-conventions.md](docs/frontend-conventions.md)：新页面落地约定（路由、数据、动效、测试、布局）。
- [docs/routing-page.md](docs/routing-page.md)：路由轨迹页面的数据与视觉说明。

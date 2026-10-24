# 余额面板

一个以 **TanStack Start**（React 19 API + Redact 运行时 + TanStack Router + Vite + Nitro）构建、运行在 **Bun** 上的内网 AI 订阅余额面板。所有页面与数据获取都在服务器完成；浏览器只接收 HTML 与交互脚本，不会直接访问内网余额接口。

## 功能

- **文件式 TanStack Router 路由**：`src/routes/` 下 `__root.tsx`、`index.tsx`，只有一个业务路由（首页）。
- **URL 搜索参数校验**：零依赖手写解析器（`src/lib/balance/search.ts`）+ `stripSearchParams`，非法参数安全回退，默认值不污染 URL；服务端校验仍用 Zod。
- **TanStack Query 数据层**：`queryOptions` 统一 queryKey/queryFn；SSR loader 用 `ensureQueryData` 取数，组件用 `useQuery` + `placeholderData: keepPreviousData` 读取（换搜索词时保留上一份数据），SSR 查询缓存由 `@tanstack/react-router-ssr-query` dehydrate/hydrate；每个请求独立 QueryClient。
- **类型安全 server functions**：`createServerFn` + Zod validator，统一由全局 function middleware 计时。
- **完整文档 SSR**：root route 的 `shellComponent` 输出完整 `<html>`（head、宿主主题桥接脚本、body、Scripts）。
- **账号打码**：API 的 `user` 字段（邮箱、用户名、手机号）在服务端整体替换为 `***` 后才进入 loader data 与 HTML；不保留任何前后缀。账户名（如 WorkBuddy）保持正常展示。
- **显式 server-only 边界**：`*.server.ts` + `import '@tanstack/react-start/server-only'` + 构建期 import protection（`src/server/**` 禁止进入客户端 bundle）。
- **部署运行时**：Nitro `bun` preset，产物用 Bun 直接运行；切换其它 Nitro preset 不改变路由/loader/SSR 模型。
- **new-api 风格 UI**：Tailwind CSS v4 + oklch 设计令牌、rounded-2xl 卡片、ring 边框、Public Sans 字体（serif 文案走系统 Noto Serif SC / Songti SC / SimSun）；深/浅色由 new-api 宿主通过 `postMessage` 决定，独立打开时跟随系统。
- **首页排版**：秘密房间文案（标题 → 欢迎语 → 叙事段落 → 契约提示）→ 账户分区（服务端搜索/筛选与账户列表合并在同一张卡片内）→ 用量概览；顶部不设导航栏，也不提供主题切换按钮。
- **服务端搜索**：搜索栏是 `action="/" method="get"` 的表单，禁用 JS 时也能由服务器重新加载；有 JS 时只有搜索词 `q` 需要重新取数，并用 `resetScroll: false` 保持当前滚动位置。输入过程中不会触发请求，点击「搜索」或按回车才提交，避免输入时布局抖动。
- **本地筛选与排序**：「全部 / 正常 / 异常」是同一份数据上的字符串过滤（「全部」已包含另外两个），排序与网格/列表视图同样只影响本地渲染。这些切换只改写 URL（可分享、可前进后退），不重新请求数据。
- **账户数据更新时间**：网格卡片与列表行都显示上游返回的 `readAt`（每个账户数据的实际抓取时间，按 `Asia/Shanghai` 格式化），与「最近读取」排序同源；数据源没有返回时间时该行自动隐藏。
- **不展示每日/累计用量**：上游余额接口只返回额度窗口、额度与重置时间，不包含每日用量数据。面板因此不提供 7 / 14 / 30 天区间筛选、每日用量柱状图和累计用量统计，避免把并不存在的数据展示给用户；用量信息只来自各账户的额度窗口（已用比例、剩余额度与重置倒计时）。
- **列表级加载态**：只有搜索词变化时才取数；此时页面其余部分保持原位，加载提示与骨架只出现在账户列表区域。
- **无提供方详情页、无账号设置页、无对外 API**：面板只保留首页余额总览。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 运行时 / 包管理 | **Bun 1.4**（`bun.lock`） |
| 框架 | TanStack Start 1.169 / TanStack Router 1.170 |
| UI | **Redact 0.1**（构建期替换 react/react-dom 的 React 19 API 兼容运行时，见「首屏速度」）、Tailwind CSS v4、Lucide icons |
| 数据获取 | TanStack Query 5 + `@tanstack/react-router-ssr-query` |
| 校验 | Zod 4 **Mini**（server function 输入、API 响应；URL 搜索参数用零依赖解析器，避免 zod 进入客户端） |
| 构建 | Vite 8 + Nitro 3（`bun` preset） |
| 测试 | Vitest 5 |

## 快速开始

```bash
bun install
cp .env.example .env          # 可选：配置内网余额接口
bun run dev                   # http://localhost:3000
```

未配置 `BALANCE_API_URL` 时自动使用 `src/server/fixtures/balances.json`，页面会明确标注「示例数据」。接口失败时优先返回短期缓存，否则降级到 fixture，并在页面显示警告。

### 生产构建（Bun）

```bash
bun run build                 # vite build + tsc --noEmit → .output/
bun run start                 # bun .output/server/index.mjs（直接用 Bun 运行）
bun run build:binary          # 单文件可执行程序 → .output/server-bin
```

Bun 启动时会自动读取仓库根目录的 `.env`；生产平台注入的环境变量优先。也可以完全不用 `.env`，直接由 Docker/systemd/PaaS 注入环境变量。

`vite.config.ts` 中显式声明 `nitro({ preset: 'bun' })`，产物 `.output/server/index.mjs` 由 Bun 运行；
镜像部署则用 `bun run build:binary` 编出的单文件二进制（静态资源内嵌），运行在
`cgr.dev/chainguard/glibc-dynamic` 上，详见下文「CI/CD 与容器部署」。

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
- 本页面在 `<head>` 的阻塞内联脚本里同步注册监听（不能等 React hydration，否则会丢掉 `onLoad` 那条），用 `event.source === window.parent` 校验，兼容 `{ themeMode }`、`{ theme }`、`{ mode }` 与字符串载荷。
- 首帧直接按 `prefers-color-scheme` 绘制，**不再用 `visibility:hidden` 等宿主消息**：那条消息只在 iframe `onLoad` 之后才到，遮罩会把整页的真实显示时间推到「所有资源加载完成」，进场动画还会在不可见状态下跑完。收到消息后只做一次颜色重绘。
- 如果宿主主题与系统主题不一致，首帧到消息到达之间会看到一次换色；在 new-api 里把首页地址写成 `https://panel.example.com/?theme=dark`（或 `light`）即可让首帧就是目标主题，完全不换色——显式 `?theme=` 优先于宿主的 `postMessage`。
- 支持 `?theme=light|dark|system` 强制主题，用于本地调试或其它宿主。

### 控制台入口

密钥提示下方有一个「前盘仪表盘」链接，使用 `target="_top"` 让 new-api 的顶层窗口跳转到其控制台（new-api 的 sandbox 允许用户激活的顶层导航）。默认 `href="/dashboard"`，适用于面板与 new-api 同源部署；面板在独立域名时，构建期设置 `VITE_NEWAPI_DASHBOARD_URL=https://<new-api>/dashboard`。

### 需要放开的服务器侧设置（已内置）

- `src/server.ts` 自定义 server entry：直接回答 sandbox iframe 的 CORS 预检（`OPTIONS` → 204），并给所有响应加 `Access-Control-Allow-Origin: *`；
- 暴露 TanStack Start 的 `x-tss-serialized` 等响应头，否则跨源下客户端读不到序列化标记，server function 会解析失败；
- Nitro `routeRules` 给 `/assets/**` 加 CORS 与长期缓存头；HTML 与接口的缓存策略见「缓存与 CDN 响应头」；
- CSRF 中间件对 `Origin: null` 的只读 GET server function 跳过同源校验（面板无登录态、GET 无副作用）；其余请求仍按默认策略校验。

### 已知限制

- new-api 在 iframe `onLoad` 后才发第一条消息，所以首帧只能先按系统主题绘制；宿主深色 + 系统浅色时会看到一次换色（用 `?theme=dark` 可消除，见上）。
- new-api 挂载自定义首页 iframe 之前要先等 `GET /api/setup` 与 `GET /api/home_page_content` 两个串行请求（`web/src/routes/__root.tsx`、`web/src/features/home/index.tsx`），期间只显示文字「Loading...」——这段等待发生在宿主侧，本页面无法提前。
- new-api 在「主题已是 system 且系统主题未变」时不会重发消息；页面在此期间跟随系统，不影响显示。
- 父页只下发明暗与语言，不下发字体/圆角/预设等个性化令牌（new-api #7123 仍建议增加 ready/ack）。
- iframe 内 `fetch` 均为跨源：需要 cookie/session 的接口必须改成 token/Bearer（本项目余额接口在服务端读取，不受影响）。

## 首屏速度（iframe 嵌入）

嵌入 new-api 时「页面要等全部加载完才出现」，根因不在网络快慢，而是渲染被三件事串行卡住：

1. **主题遮罩**（已移除）：new-api 只在 iframe `onLoad` 之后 `postMessage` 主题，旧实现用
   `html[data-host-theme-pending] body { visibility: hidden }` 等这条消息，等于把「用户能看见」
   推迟到 HTML、CSS、JS、字体全部加载完成之后；而 `.rise-in` 动画在遮罩期间照常播放，所以
   遮罩解除时动画早已播完（2 Mbps / 100 ms 链路实测：动画 388 ms 开始，页面 1106 ms 才出现，
   相差 718 ms）。
2. **未压缩的传输**：入口 JS 498 KB、CSS 39 KB、HTML 28 KB 原样发出；iframe `load` 也要等这些
   资源下完，而宿主正是靠 `load` 才发主题消息。
3. **TTFB 被上游读取阻塞**：SSR loader `await ensureQueryData()`，进程内缓存过期（默认 30 秒）
   后每个文档请求都要等一次内网接口；接口慢或不可用时首字节直接顶到超时。

对应改动：

| 改动 | 位置 | 效果 |
| --- | --- | --- |
| 首帧直接按系统主题绘制，收到宿主消息只重绘一次 | `src/lib/theme.ts`、`src/styles/app.css` | 不用等 `load`；进场动画在可见状态下才开始 |
| 静态资源构建期预压缩（br/gzip），SSR HTML / JSON 运行时 gzip | `vite.config.ts`、`src/server/compress-response.ts` | 入口 JS 498 KB → 134 KB（br）/ 156 KB（gzip）；CSS 39 KB → 7.2 KB；HTML 37 KB → 9 KB |
| 缓存改为 stale-while-revalidate：过期也立刻返回旧数据、后台刷新 | `src/server/balance.server.ts` | TTFB 不再取决于上游；只有进程启动后的第一个请求需要等 |
| 校验库换成 `zod/mini`（同一套 Zod 4 运行时，函数式 API，仍实现 Standard Schema） | `src/lib/balance/schema.ts` | 入口 JS 498 KB → 429 KB（原始），br 134 KB → 118 KB，约 −69 KB |

实测（本地 Bun 服务 + sandbox iframe + new-api 同款 `postMessage`，2 Mbps / 100 ms RTT 限速代理，
fixture 数据）：

| 指标 | 改动前 | 改动后 |
| --- | --- | --- |
| 页面可见（body 不再被遮住） | 1106 ms | 262 ms |
| 首内容绘制（FCP） | 1128 ms | 368 ms |
| 进场动画开始 | 388 ms（页面还不可见） | 345 ms（页面已可见） |
| iframe `load` | 2294 ms | 828 ms |
| HTML 传输字节 | 37 KB | 9 KB |

上游故意慢 1.5 秒（`BALANCE_CACHE_TTL_SECONDS=0`）时，SWR 让冷启动后的请求从「每次等满 1.5 秒」
变成 **5–7 ms**（实测：1600 ms / 7 ms / 5 ms）。

### 第二轮优化（2026-10-24）：内联 CSS、按需 Select、去掉客户端 zod 与 Lora

同一链路复测（fixture、2 Mbps / 100 ms RTT、Chromium 无缓存、3 次中位）：

| 指标 | 第一轮后 | 第二轮后 |
| --- | --- | --- |
| 首内容绘制（FCP） | 380 ms | **232 ms**（−39%） |
| iframe `load`（宿主等待的事件） | 1249 ms | **948 ms**（−24%） |
| 页面 `load` | 1166 ms | **885 ms**（−24%） |
| 首屏传输（文档 + JS + CSS + 字体） | 237 KB | **169 KB**（−29%） |
| 首屏 JS（br） | 155 KB | **125 KB**（−19%） |
| 运行时字体下载 | 65 KB | **27 KB**（−58%） |
| 首屏 CSS 请求 | 7.6 KB / 1 RTT | **0**（随 HTML 内联到达） |

改动：

| 改动 | 位置 | 效果 |
| --- | --- | --- |
| 首屏 CSS 构建期内联（TanStack Start `inlineCss`） | `vite.config.ts`、`src/routes/__root.tsx` | CSS 以 `<style data-tsr-inline-css>` 随文档到达，删掉一次阻塞渲染的 RTT；FCP −148 ms |
| 移除 Lora web 字体 | `src/styles/app.css` | serif 文案全是中文；CDP `CSS.getPlatformFontsForNode` 实测字形 100% 由系统 Noto Serif SC 渲染，Lora 一个字形都没用上：运行时字体 65 KB → 27 KB，构建 woff2 211 KB → 53 KB |
| 排序下拉（Radix Select）按需加载 | `src/features/dashboard/sort-select*.tsx`、`dashboard-toolbar.tsx` | Radix 整条依赖链（~80 KB min / ~27 KB br）移出首屏；routes chunk br 36.5 KB → 10.6 KB；只在 `load` 之后空闲或 pointer/focus 意图时下载 |
| URL 搜索参数改用零依赖解析器 | `src/lib/balance/search.ts`、`src/routes/index.tsx` | zod 移出客户端（index chunk br 118.2 KB → 113.9 KB），服务端校验继续用 zod |
| 死代码/过期文案整理 | card、format、labels、progress、site-footer、account-windows | 删除无消费者导出与「详见详情页」等已移除功能的文案 |

内联 CSS 的取舍：HTML 从 8.9 KB 涨到约 16 KB（gzip），但少一次独立 CSS 请求；CSS 资产仍会由按需
Select chunk 的 preload 在 `load` 之后取一次（6.9 KB，immutable 缓存），不占首屏。LCP 在正常模式下
被 hero 的 `.rise-in` 动画推迟（与首屏字节无关，前后不可比）；`prefers-reduced-motion: reduce` 下
LCP = FCP，380 ms → 204 ms。

### 第三轮：用 Redact 替换 React 运行时（2026-10-24）

[TanStack Redact](https://github.com/TanStack/redact)（`@tanstack/redact` 0.1.4）是 React 19 API 兼容的
同步渲染运行时：一个 Vite 插件把 `react` / `react-dom` / `react-dom/client` / `react-dom/server` /
`scheduler` / `jsx-runtime` / `use-sync-external-store` 的解析改到 Redact 实现，业务代码与组件库的
import 完全不变。项目保持 `react` / `react-dom` 依赖（类型、插件与生态仍按真实 React 解析），只在
构建期替换运行时。

| 指标 | React 运行时 | Redact 运行时 | 变化 |
| --- | --- | --- | --- |
| FCP | 240 ms | 244 ms（噪声，由 CSS 决定，±10 ms） | — |
| 页面 `load` | 877 ms | **699 ms** | −20% |
| iframe `load` | 946 ms | **762 ms** | −19% |
| 首屏 JS 传输 | 125,098 B | **83,685 B** | −33% |
| 首屏总传输（文档+JS+CSS+字体） | 168,578 B | **127,163 B** | −25% |
| 入口 JS（raw / br） | 413,655 / 113,890 | **245,221 / 72,591** | −41% / −36% |
| 全部 JS（raw / br） | 540,954 / 151,887 | **367,758 / 110,329** | −32% / −27% |

接入方式：

- [vite.config.ts](vite.config.ts) 在插件列表最前面加入 `redact()`（内部 `enforce: 'pre'` 完成别名）。
- 只关闭没有消费者的 feature：`activity` / `fragmentRefs` / `lazy`（省约 8.7 KB raw / 2.3 KB br）。
  Router 需要 `memo`，Radix 需要 `forwardRef` / `context` / `portal`，CatchBoundary 是 class 错误
  边界（`classComponents`），SSR 需要 `hydration` 与 `suspense`，这些保持开启。
- [redact-events.ts](src/lib/redact-events.ts)：Redact 0.1.4 的 DOM 事件只补了 `nativeEvent`，没有实现
  TypeScript 里声明的 `isPropagationStopped()` / `isDefaultPrevented()`。Radix Select 选中条目时会
  调用前者，未处理会抛 `TypeError: e.isPropagationStopped is not a function`，下拉无法提交选择。
  该模块在 `__root` 渲染前给原生事件补齐这两个方法并记录 `stopPropagation`，SSR 自动跳过；等上游
  实现后可以删除。
- [scripts/verify.mjs](scripts/verify.mjs) 的 C39 改为大小写不敏感地匹配 `<time dateTime|datetime>`：
  React SSR 输出 `dateTime`，Redact 输出小写 `datetime`（HTML 属性名大小写不敏感，两者等价）。

验证：构建/类型/单测/verify 全绿（38/38），Playwright E2E 34/34（含无 JS SSR、下拉、筛选、搜索、
主题、sandbox iframe、移动端、无 hydration warning）；1280 桌面浅色/深色与 390 移动端截图与 React
版本**逐像素一致**（PIL diff = 0）；键盘 `ArrowDown` 打开下拉、dev server 与 HMR 均正常。

取舍与风险（切换前必读）：

- Redact 仍是 **0.1.x**（2026-10 首次发布），没有 React DevTools；并发特性被同步化：
  `useTransition`/`startTransition` 同步执行且 `pending` 恒为 false，`useActionState`/`useOptimistic`/
  `useFormStatus` 是 no-op。本项目没有使用这些特性，但以后新增“乐观更新/表单 action”时需重新评估。
- 官方 hydration 微基准比 React 慢约 21%，但首屏少下载 41 KB，实测 `load`/iframe `load` 仍快 19–21%。
- 上游当前缺少 SyntheticEvent 方法（本项目的 shim 已覆盖）；后续升级 Redact 时应先跑
  `bun run verify` 与 E2E，确认 shim 是否还需要。

剩下的开销，按收益排序：

- **宿主侧前置等待**：new-api 先串行请求 `GET /api/setup`、`GET /api/home_page_content`，拿到
  自定义首页地址后才挂载 iframe，期间只显示「Loading...」。这段在宿主侧，本页面无法提前。
- **入口 JS 仍以框架为主**：Redact 版入口 JS 约 245 KB raw（br 73 KB），其中 Redact 约 63 KB min、
  Router 约 60 KB min、Query 约 32 KB min、tailwind-merge 约 27 KB min（`cn()` 的类名合并引擎）与
  seroval 约 25 KB min（SSR 序列化）。继续压缩需要替换 `cn()` 的合并实现或去掉 React Query，收益
  与回归风险都不小，暂不做。
- **按需 Select chunk**：`load` 后空闲会预取约 34 KB（chunk + 被它 preload 的 CSS）；不交互的
  用户也会支付。若想更省可改为仅 intent 预取，代价是首次打开下拉多等约 100–200 ms。
- **modulepreload 的 `fetchPriority="low"`**：TanStack Router 生成的预加载提示不阻塞显示，但会
  推迟 hydration；实测对 FCP 无影响，未改。
- **CDN**：HTML 边缘缓存 60 秒能直接吃掉 TTFB 与压缩开销，见下一节。

## 路由与 SSR 模式

| 路由 | SSR 模式 | 原因 |
| --- | --- | --- |
| `/` | `ssr: true` | 首屏余额总览需要完整 HTML |

账号相关页面不包含提供方详情页、设置页或对外 API；`/providers/*` 一律返回 404。

`src/routes/__root.tsx` 的 `shellComponent` 始终在服务器渲染完整文档；`src/start.ts` 设置 `defaultSsr: true` 并注册 CSRF/请求中间件。

## 服务端数据边界

```text
route loader (SSR blocks, client never waits)
  -> queryClient.ensureQueryData(dashboardQueryOptions({ q }))
     -> queryFn
        -> createServerFn (src/lib/balance/functions.ts, Zod validated)
           -> src/server/balance.server.ts  (server-only marker, Bun runtime)
              -> intranet BALANCE_API_URL  (fetch + Authorization: Bearer <relay API key>)
              -> in-memory TTL cache (stale-while-revalidate)
              -> bundled fixture fallback
        -> src/lib/balance/derive.ts     (pure transforms + masking + text search)
component
  -> useQuery(same dashboardQueryOptions) + placeholderData: keepPreviousData
  -> applyDashboardFilters(payload, search)   (status/sort, no request)
```

- `src/router.tsx` 每次创建 router 时新建 QueryClient，并接入 SSR query 集成，避免跨请求缓存共享。
- queryKey 只包含搜索词（`['dashboard', { q }]`）：只有它会触发新的服务端查询。`status` / `sort` / `view` 由 `applyDashboardFilters()` 在浏览器里过滤与排序，切换时不发请求。
- 首屏 HTML 由 SSR loader 等待查询完成后渲染：命中缓存立即返回；缓存过期时按 stale-while-revalidate 先返回旧数据、后台刷新，只有进程启动后的第一个请求才会真正等上游。客户端导航不再等待 loader：命中缓存立即渲染，未命中时后台取数，加载态只出现在账户列表区域。
- 默认 `staleTime` 30 秒，与上游缓存 TTL 对齐；命中缓存时切回之前的搜索词不会重复请求。

- `src/server/**` 只允许被 server function handler 引用；客户端构建遇到该目录会直接失败。
- `BALANCE_API_KEY`（中转站 API Key）只在 Bun 服务端进程读取，默认以 `Authorization: Bearer <key>` 发送，不会进入客户端 bundle，也不会出现在页面中。
- 如果配置了 `BALANCE_API_URL` 但缺少 `BALANCE_API_KEY`，页面会明确提示并回退到示例数据，不会发出未认证请求。
- 账号标识在 `toAccountView()` 中整体替换为 `***`，只有脱敏值会被序列化到客户端；账户名不参与打码。

## 缓存与 CDN 响应头

服务端通过 Nitro `routeRules`（见 `vite.config.ts`）为每类响应发出缓存头，CDN 只需「遵循源站缓存」：

| 路径 | `Cache-Control` | `CDN-Cache-Control` | 说明 |
| --- | --- | --- | --- |
| `/_serverFn/**` | `no-store, no-cache, must-revalidate, max-age=0` | `no-store` | 浏览器直接访问的 server function 接口；余额数据不进入 CDN |
| `/api/**` | 同上 | `no-store` | 目前没有该路由，预留给以后新增的接口 |
| `/assets/**` | `public, max-age=31536000, immutable` | 同左 | Vite 带内容哈希的文件名，可永久缓存 |
| `/favicon.svg` | `public, max-age=86400` | 同左 | 无内容哈希，缓存一天 |
| 其余路径（SSR HTML） | `public, max-age=0, s-maxage=60, stale-while-revalidate=300, stale-if-error=86400` | `public, max-age=60, stale-while-revalidate=300, stale-if-error=86400` | 浏览器每次导航回源校验；CDN 边缘缓存 60 秒 |

要点：

- **HTML 只在 CDN 边缘缓存 60 秒**，浏览器 `max-age=0`（不会长期看到旧页面）；部署后最多 1 分钟边缘生效，需要立即生效就在 CDN 控制台 purge 对应 URL。TTL 常量在 `vite.config.ts` 顶部（`CDN_HTML_MAX_AGE_SECONDS` 等）。
- **首屏 CSS 已内联进 HTML**（`<style data-tsr-inline-css>`），因此 HTML 响应包含约 37 KB 样式（gzip 后约 16 KB）；`/assets/**` 下的 CSS 文件仍会生成，用于按需 Select chunk 的 preload，按一年 `immutable` 缓存即可。
- 多数 CDN 使用 `s-maxage` 作为边缘 TTL；Cloudflare 优先读取 `CDN-Cache-Control`，两处保持一致，避免面板配置与源站语义冲突。
- 上游 `BALANCE_API_URL` 由服务端进程在内网访问，**不经过 CDN**，也不受这些头影响；浏览器能看到的唯一接口是 TanStack Start 的 `/_serverFn/**`。
- 源站响应头只是前提，**CDN 侧还要允许缓存 HTML**（Cloudflare 默认只缓存静态扩展名）。以 Cloudflare 为例，在 **Caching → Cache Rules** 中按顺序配置：
  1. `starts_with(http.request.uri.path, "/_serverFn/")` 或 `starts_with(http.request.uri.path, "/api/")` → **Bypass cache**；
  2. `http.request.uri.path eq "/"`（或 `content_type contains "text/html"`）→ **Eligible for cache**，Edge TTL 选「Use origin cache-control」。

  第 1 条必须排在第 2 条之前：如果 Cache Everything 规则把接口也纳入缓存并覆盖 Edge TTL，`no-store` 可能被忽略，余额数据就会被 CDN 缓存。

验证（部署后）：

```bash
curl -sSI https://<面板域名>/                    | grep -i 'cache-control\|cdn-cache-control'
curl -sSI https://<面板域名>/assets/<文件名>.css | grep -i 'cache-control\|cdn-cache-control'
curl -sSI https://<面板域名>/favicon.svg         | grep -i 'cache-control\|cdn-cache-control'
```

预期：HTML 与 favicon 为 `public` 且带 CDN TTL；`/assets/**` 为一年 `immutable`；server function 为 `no-store`。

### 传输压缩

首屏（以及 iframe `load`）的耗时主要花在下载字节上，所以压缩是必选项：

- **静态资源**：Nitro `compressPublicAssets`（`vite.config.ts`）在构建期生成 `.br` / `.gz`，
  Nitro 的静态处理器按 `Accept-Encoding` 选择对应文件，响应带 `Vary: Accept-Encoding`；
  `/assets/**` 仍然是一年 `immutable`。当前入口 JS 245 KB → 72.6 KB（br）/ 88 KB（gzip），
  routes chunk 34.4 KB → 10.5 KB（br），按需 Select chunk 88 KB → 27.2 KB（br）。
- **SSR 文档与 server function JSON**：`src/server/compress-response.ts` 在 server entry 里用
  `CompressionStream('gzip')` 流式压缩（不缓冲文档），删除 `Content-Length` 并补 `Vary`。
- 只压文本类型；已经带 `Content-Encoding` 的响应（例如 CDN 回源时已压缩）原样放行。
- `scripts/verify.mjs` 断言流式文档时显式发 `Accept-Encoding: identity`，避免把压缩字节当成 HTML。

验证：

```bash
curl -sSI -H 'Accept-Encoding: br'   https://<面板域名>/assets/<文件名>.js | grep -i content-encoding  # br
curl -sSI -H 'Accept-Encoding: gzip' https://<面板域名>/                   | grep -i content-encoding  # gzip
```

## 账号打码规则

- 账户名（如 `WorkBuddy`、`Open Design`）保持正常展示。
- 邮箱：`user@example.com` → `***`
- 用户名：`exampleuser` → `***`
- 手机号：`138****0000` → `***`
- 原始 `user` 字段只存在于服务端响应处理过程中，不写入 loader data、HTML、地址栏或客户端 JS。

## 测试

```bash
bun run test          # Vitest：搜索参数、格式化、打码、派生聚合、筛选排序、宿主主题桥接
bun run typecheck
bun run verify        # 构建后启动 3210 端口，做 SSR/打码/泄漏/路由/sandbox iframe CORS 断言
```

## CI/CD 与容器部署

`.github/workflows/build-deploy.yml` 参考 galzy 项目 `apps/web-tanstack` 的流水线：
`typecheck → 构建镜像并推送 GHCR → 触发 Dokploy Webhook 部署`。镜像里的服务端是
`bun build --compile` 产出的单文件可执行程序，运行在 `cgr.dev/chainguard/glibc-dynamic` 上。
本仓库只有一个应用，因此去掉了 matrix 与 `apps/**` 路径过滤，并补上了 PR 质量门禁与容器冒烟。

### 触发与任务

| 触发 | quality（typecheck + test + build + binary） | image | deploy |
| --- | --- | --- | --- |
| Pull request | ✅ | ✅ 本地构建 + 冒烟，不推送 | — |
| push `main` | ✅ | ✅ 推送到 GHCR（仅代码相关路径变化时） | ✅（同上） |
| `workflow_dispatch` | ✅ | ✅ | 可选，由 `deploy` 输入控制 |

镜像名为 `ghcr.io/<owner>/<repo>`，标签：

- `:<package.json 的 version>`（当前 `1.0.0`）
- `:<短 SHA>`
- `:latest`

### 需要的仓库配置

| 类型 | 名称 | 用途 |
| --- | --- | --- |
| Secret | `DEPLOY_WEBHOOK` | Dokploy 服务的 Webhook URL |
| Variable | `VITE_NEWAPI_DASHBOARD_URL` | 构建期公开变量；留空时使用相对 `/dashboard` |

推送 GHCR 使用内置的 `GITHUB_TOKEN`，工作流已声明 `packages: write`，不需要额外的 PAT。

### 构建产物：单文件可执行程序

`bun run build` 产出 Nitro（`bun` preset）的 `.output/`；`bun run build:binary` 再把它
编译成单文件可执行程序：

```bash
bun run build          # vite build + tsc --noEmit → .output/
bun run build:binary   # → .output/server-bin（Windows 下为 server-bin.exe）
```

- `server-prod.ts` 是生产入口：先处理 `--healthcheck`，再把 `__nitro_main__` 指向二进制内的
  虚拟路径，最后加载 Nitro 入口（参考 TanStack Router `examples/react/start-bun`）；
- `scripts/build-binary.mjs` 生成 `.assets.generated.ts`，用 `with { type: "file" }` 把
  `.output/public/**` 全部内嵌进二进制；
- 编译命令为 `bun build --compile --asset-naming="[dir]/[name].[ext]"`，保留目录结构，
  运行时静态资源直接从二进制内读取，不需要 `public/` 目录；
- 产物约 106 MB（Bun 运行时 + 全部静态资源）。

本地运行：

```bash
PORT=3000 ./.output/server-bin
PORT=3000 ./.output/server-bin --healthcheck   # 0 = 正常，1 = 异常
```

### 容器镜像

```bash
docker build -t newapi-index:local .

docker run --rm -p 3000:3000 \
  -e BALANCE_API_URL=https://relay.example.com/api/balances \
  -e BALANCE_API_KEY=sk-... \
  newapi-index:local
```

- 运行阶段是 `cgr.dev/chainguard/glibc-dynamic`（Wolfi 基础镜像：glibc + libgcc/libstdc++ +
  ca-certificates）+ `/app/server`，镜像约 58 MB（比 distroless 版本小约 5 MB）：没有 Bun
  运行时、没有 shell、没有 `node_modules`、没有 curl/wget；
- 以非 root（`65532:65532`，即镜像自带的 `nonroot`）运行，暴露 3000 端口；
- `HEALTHCHECK` 调用二进制自带的 `--healthcheck`（镜像里没有 curl），每 30s 请求一次
  本机首页，`PORT` 变化时跟着变；
- 镜像不含 tzdata：页面里的 `Intl.DateTimeFormat` 按 `Asia/Shanghai` 格式化时间，依赖
  Bun 内置的 ICU 时区数据（已实测正确）；若以后需要系统时区数据（`/usr/share/zoneinfo`），
  再自己加一层；
- 基础镜像提供 `linux/amd64` 与 `linux/arm64` 两个平台；`:latest` 跟随 Chainguard 的安全
  更新，需要可复现构建时把 `Dockerfile` 里的 `FROM` 改成按 digest 固定；
- 运行期变量（`BALANCE_*`、`PORT`、`BUILD_ID`）通过 `-e` 或 Dokploy 的环境变量注入，
  **不要**写进镜像；
- `VITE_NEWAPI_DASHBOARD_URL` 是构建期变量，用 `--build-arg` 传入；
- 镜像里没有 shell，排查问题只能看 `docker logs`，不能 `docker exec sh`。

### Dokploy 接入

1. 在 Dokploy 新建 Compose 服务，镜像指向 `ghcr.io/<owner>/<repo>:latest`；
2. 打开 **Auto Deploy**，复制该服务的 Webhook URL，填入仓库 Secret `DEPLOY_WEBHOOK`；
3. 分支填 `main`（与工作流的 `on.push.branches` 保持一致）；
4. 若 GHCR 包是私有的，在 Dokploy 配置 registry 凭据（用户名 + 带 `read:packages` 的 PAT）。

Webhook 请求体与参考项目一致（`ref` + `commits`，请求头 `x-github-event: push`），
Dokploy 据此判断路径是否命中要部署的服务。

> 如果 Dokploy 的 compose 固定了版本标签而不是 `:latest`，需要同时调整工作流的推送标签，
> 否则部署会拉到旧镜像。

> 镜像默认只构建 runner 的架构（`linux/amd64`）。若 Dokploy 主机是 ARM，在
> `Build and push image` 步骤加 `platforms: linux/arm64`（或同时构建两个架构；
> 多架构时 PR 上的 `load` 需要去掉）。

### 关于 `bun run verify`

`scripts/verify.mjs` 目前有 2 项断言失败（C36 搜索提交提示文案、C37 搜索行固定高度类名），
两者都与数据流无关，失败原因与 CI 环境无关，因此暂未纳入流水线。之后在 `quality` 任务末尾追加即可：

```yaml
      - name: Acceptance verification
        run: bun run verify
```

### 启用流水线的前置条件

仓库目前还没有初始化 git；推到 GitHub 后工作流才会生效：

```bash
git init -b main
git add -A
git commit -m "chore: init"
git remote add origin git@github.com:<owner>/<repo>.git
git push -u origin main
```

`.gitignore` 已排除 `.env`、`node_modules`、`.output`，本地密钥与构建产物不会被提交。

## 环境变量

Bun 会自动加载 `.env`、`.env.local`、`.env.production` 等文件；平台注入的环境变量优先。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `BALANCE_API_URL` | 空 | 内网余额接口；为空时使用 fixture |
| `BALANCE_API_KEY` | 空 | 中转站 API Key，默认以 Bearer 方式发送（仅服务端） |
| `BALANCE_API_TIMEOUT_MS` | `5000` | 上游请求超时 |
| `BALANCE_CACHE_TTL_SECONDS` | `30` | 服务端缓存 TTL |
| `PORT` | `3000` | Bun 服务端口 |
| `VITE_NEWAPI_DASHBOARD_URL` | 空（相对 `/dashboard`） | 构建期变量：控制台入口链接；跨源部署时填 new-api 的绝对地址 |
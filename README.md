# 余额面板

一个以 **TanStack Start**（React 19 + TanStack Router + Vite + Nitro）构建、运行在 **Bun** 上的内网 AI 订阅余额面板。所有页面与数据获取都在服务器完成；浏览器只接收 HTML 与交互脚本，不会直接访问内网余额接口。

## 功能

- **文件式 TanStack Router 路由**：`src/routes/` 下 `__root.tsx`、`index.tsx`，只有一个业务路由（首页）。
- **URL 搜索参数校验**：Zod schema + `stripSearchParams`，非法参数安全回退，默认值不污染 URL。
- **TanStack Query 数据层**：`queryOptions` 统一 queryKey/queryFn；loader 用 `ensureQueryData` 预取，组件用 `useSuspenseQuery` 读取，SSR 查询缓存由 `@tanstack/react-router-ssr-query` dehydrate/hydrate；每个请求独立 QueryClient。
- **类型安全 server functions**：`createServerFn` + Zod validator，统一由全局 function middleware 计时。
- **完整文档 SSR**：root route 的 `shellComponent` 输出完整 `<html>`（head、宿主主题桥接脚本、body、Scripts）。
- **账号打码**：API 的 `user` 字段（邮箱、用户名、手机号）在服务端整体替换为 `***` 后才进入 loader data 与 HTML；不保留任何前后缀。账户名（如 WorkBuddy）保持正常展示。
- **显式 server-only 边界**：`*.server.ts` + `import '@tanstack/react-start/server-only'` + 构建期 import protection（`src/server/**` 禁止进入客户端 bundle）。
- **部署运行时**：Nitro `bun` preset，产物用 Bun 直接运行；切换其它 Nitro preset 不改变路由/loader/SSR 模型。
- **new-api 风格 UI**：Tailwind CSS v4 + oklch 设计令牌、rounded-2xl 卡片、ring 边框、Public Sans/Lora 字体；深/浅色由 new-api 宿主通过 `postMessage` 决定，独立打开时跟随系统。
- **首页排版**：魔导局文案（标题 → 叙事段落 → 密钥提示 → 控制台入口）→ 账户分区（服务端搜索/筛选与账户列表合并在同一张卡片内）→ 用量概览；顶部不设导航栏，也不提供主题切换按钮。
- **服务端搜索**：搜索栏是 `action="/" method="get"` 的表单，禁用 JS 时也能由服务器重新加载；有 JS 时通过路由 loader 在服务端取数，并用 `resetScroll: false` 保持当前滚动位置。输入过程中不会触发请求，点击「搜索」或按回车才提交，避免输入时布局抖动。
- **无提供方详情页、无账号设置页、无对外 API**：面板只保留首页余额总览。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 运行时 / 包管理 | **Bun 1.4**（`bun.lock`） |
| 框架 | TanStack Start 1.169 / TanStack Router 1.170 |
| UI | React 19、Tailwind CSS v4、Lucide icons |
| 数据获取 | TanStack Query 5 + `@tanstack/react-router-ssr-query` |
| 校验 | Zod 4（路由搜索参数、server function 输入、API 响应） |
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
`gcr.io/distroless/base` 上，详见下文「CI/CD 与容器部署」。

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
- 嵌入状态下正文先被 `data-host-theme-pending` 遮住，收到宿主主题后解除，700ms 超时兜底，避免宿主深色/系统浅色时闪一下；独立打开直接跟随 `prefers-color-scheme`。
- 支持 `?theme=light|dark|system` 强制主题，用于本地调试或其它宿主。

### 控制台入口

密钥提示下方有一个「前盘仪表盘」链接，使用 `target="_top"` 让 new-api 的顶层窗口跳转到其控制台（new-api 的 sandbox 允许用户激活的顶层导航）。默认 `href="/dashboard"`，适用于面板与 new-api 同源部署；面板在独立域名时，构建期设置 `VITE_NEWAPI_DASHBOARD_URL=https://<new-api>/dashboard`。

### 需要放开的服务器侧设置（已内置）

- `src/server.ts` 自定义 server entry：直接回答 sandbox iframe 的 CORS 预检（`OPTIONS` → 204），并给所有响应加 `Access-Control-Allow-Origin: *`；
- 暴露 TanStack Start 的 `x-tss-serialized` 等响应头，否则跨源下客户端读不到序列化标记，server function 会解析失败；
- Nitro `routeRules` 给 `/assets/**` 加 CORS，`@font-face` 才能在 opaque origin 里加载；
- CSRF 中间件对 `Origin: null` 的只读 GET server function 跳过同源校验（面板无登录态、GET 无副作用）；其余请求仍按默认策略校验。

### 已知限制

- new-api 在 iframe `onLoad` 后才发第一条消息，首帧仍可能先按系统主题绘制（已用遮罩缓解，无法彻底消除）。
- new-api 在「主题已是 system 且系统主题未变」时不会重发消息；页面在此期间跟随系统，不影响显示。
- 父页只下发明暗与语言，不下发字体/圆角/预设等个性化令牌（new-api #7123 仍建议增加 ready/ack）。
- iframe 内 `fetch` 均为跨源：需要 cookie/session 的接口必须改成 token/Bearer（本项目余额接口在服务端读取，不受影响）。

## 路由与 SSR 模式

| 路由 | SSR 模式 | 原因 |
| --- | --- | --- |
| `/` | `ssr: true` | 首屏余额总览需要完整 HTML |

账号相关页面不包含提供方详情页、设置页或对外 API；`/providers/*` 一律返回 404。

`src/routes/__root.tsx` 的 `shellComponent` 始终在服务器渲染完整文档；`src/start.ts` 设置 `defaultSsr: true` 并注册 CSRF/请求中间件。

## 服务端数据边界

```text
route loader
  -> queryClient.ensureQueryData(dashboardQueryOptions(search))
     -> queryFn
        -> createServerFn (src/lib/balance/functions.ts, Zod validated)
           -> src/server/balance.server.ts  (server-only marker, Bun runtime)
              -> intranet BALANCE_API_URL  (fetch + Authorization: Bearer <relay API key>)
              -> in-memory TTL cache
              -> bundled fixture fallback
        -> src/lib/balance/derive.ts     (pure transforms + account masking)
component
  -> useSuspenseQuery(same dashboardQueryOptions)
```

- `src/router.tsx` 每次创建 router 时新建 QueryClient，并接入 SSR query 集成，避免跨请求缓存共享。
- 搜索条件进入 queryKey（`['dashboard', search]`），筛选变化自然触发新的服务端查询；默认 `staleTime` 30 秒，与上游缓存 TTL 对齐。
- 首屏 HTML 由 loader 等待查询完成后再渲染；客户端 hydration 复用 dehydrate 下来的缓存，不会重复请求。

- `src/server/**` 只允许被 server function handler 引用；客户端构建遇到该目录会直接失败。
- `BALANCE_API_KEY`（中转站 API Key）只在 Bun 服务端进程读取，默认以 `Authorization: Bearer <key>` 发送，不会进入客户端 bundle，也不会出现在页面中。
- 如果配置了 `BALANCE_API_URL` 但缺少 `BALANCE_API_KEY`，页面会明确提示并回退到示例数据，不会发出未认证请求。
- 账号标识在 `toAccountView()` 中整体替换为 `***`，只有脱敏值会被序列化到客户端；账户名不参与打码。

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
`bun build --compile` 产出的单文件可执行程序，运行在 `gcr.io/distroless/base` 上。
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

- 运行阶段是 `gcr.io/distroless/base` + `/app/server`，镜像约 63 MB：没有 Bun 运行时、
  没有 shell、没有 `node_modules`；
- 以 `nonroot:nonroot` 运行，暴露 3000 端口；
- `HEALTHCHECK` 调用二进制自带的 `--healthcheck`（distroless 没有 curl），每 30s 请求一次
  本机首页，`PORT` 变化时跟着变；
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

`scripts/verify.mjs` 目前有 6 项断言失败（`data-filtered-count` 标记、搜索页脚高度、
hero 文案顺序等与实际页面不一致），失败原因与 CI 环境无关，因此暂未纳入流水线。
修好之后在 `quality` 任务末尾追加即可：

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
# 独立验收（Independent Verification）— furin 版本

验收矩阵由 [scripts/verify.mjs](scripts/verify.mjs) 执行：**39 项断言**（编号 C01–C40，C37 历史上就没有，因此实际 39 条）。本文档说明矩阵断言什么、怎么跑、哪些意图不能变，以及本轮文档核对时手工实测到的证据。

**最近一次定稿轮（2026-10-29，构建 `815424f285ce`）：`bun run build && bun run verify` → PASS 39 / FAIL 0（含 C40 过期缓存 awaited 刷新），3210–3214 全部释放。**（2026-10-28 furin 重构后、C40 加入前曾为 PASS 38 / FAIL 0。）

- 运行时：**Bun 1.4.4**，构建命令 `furin build --target bun`，产物根目录 `.furin/build/`。
- 服务端入口：`.furin/build/bun/server.js`（与 `bun run start` 同一个文件）；**必须先 `bun run build`**，产物缺失时脚本直接失败并提示。
- 验证端口：`VERIFY_PORT=3210`（主服务，fixture 模式 + sentinel key）、`VERIFY_ENV_PORT=3211`（隔离 `.env` 探针）、`VERIFY_LIVE_PORT=3212`（mock 上游）、`VERIFY_NO_KEY_PORT=3213`（缺 Key 探针）、`VERIFY_REFRESH_PORT=3214`（过期缓存刷新探针，mock 上游每次响应都不同）。
- 验收期间 **仓库 `.env` 逐字节不变**（C31 用快照比对）；`.env.example` 的 `BALANCE_API_URL` / `BALANCE_API_KEY` 保持空值。
- 单测门槛：**≥ 103 个用例 / 9 个文件**（只增不减；新增 `src/server/__tests__/balance-cache.test.ts` 的 8 个缓存再生成用例，以及 `formatAge` 的 1 个数据年龄用例）。
- **CI 已把 `bun run verify` 作为门禁**：`.github/workflows/build-deploy.yml` 的 `quality` 任务依次跑 typecheck → 单测 → `bun run build` → `bun run build:binary` → `bun run verify`，任一步失败整条流水线失败（镜像不会构建）。

## 1. 怎么跑

```bash
bun install --frozen-lockfile
bun run typecheck        # tsc --noEmit
bun run test             # vitest run：9 文件 / 103 用例
bun run build            # furin build --target bun && tsc --noEmit
bun run verify           # bun scripts/verify.mjs（内部会再跑一遍 bun run test）
```

端口被占用时可以换一组（五个端口必须都空闲）：

```bash
VERIFY_PORT=3401 VERIFY_ENV_PORT=3402 VERIFY_LIVE_PORT=3403 VERIFY_NO_KEY_PORT=3404 VERIFY_REFRESH_PORT=3405 bun run verify
```

行为约定：

- **3210 / 3211 已被占用 → 直接打印 FAIL 并退出 1**，脚本不会复用或杀掉未知进程；3212 / 3213 / 3214 被占用时，对应的探针项 FAIL。
- 每个子进程都按 `SIGTERM → SIGKILL →（Windows）taskkill /T /F` 清理；C21 断言主服务与临时端口释放、子进程 pid 消失，C28 / C29 / C40 各自在 `finally` 里断言自己的探针端口释放、pid 消失。
- 输出是「矩阵 + 原始证据」：每项一条 `ID / RESULT / CHECK / TIME` 与一行细节，最后打印 `PASS n  FAIL m`，任何 FAIL 都以非零码退出。

## 2. 验收矩阵总览

编号分组（逐项语义以脚本里的 `check('Cxx', ...)` 为准）：

| 组 | 编号 | 断言什么（furin 口径） |
| --- | --- | --- |
| 启动与冒烟 | C01 | 产物存在、服务在 3210 就绪（fixture 强制、sentinel key）；就绪探测走 HTTP（首页或 `/_furin/health/ready`） |
| 仓库状态 | C02 | `bun@1.4.4`、`bun.lock`、Bun 脚本；依赖含 `@teyik0/furin` 与 `elysia`，**不含**旧框架依赖；根目录有 `bunfig.toml` + `furin.config.ts`，且显式断言旧框架的构建配置文件不存在；`dev` 脚本以 `bun` 开头且指向 `src/server.ts` |
| 运行时与产物 | C03 | Bun 版本、`.furin/build/manifest.json` 可解析（`targets` 含 `bun`、`buildId` 非空）、响应头 `x-furin-build-id` 与 manifest 的 `buildId` 一致、服务进程是 bun |
| 单测 | C04 | 脚本自己跑 `bun run test`，要求 **≥ 103** 个用例（9 个文件）通过 |
| 完整文档 | C05 | `<!DOCTYPE html>`、`<html lang>`、head/body、标题；ISR 响应带 `ETag` + `Content-Length`（也接受 chunked），不再强制 chunked |
| 无残留 | C06 | 文档首块是 doctype、结尾是 `</html>`，没有旧功能（用量洞察等）的标记或文案 |
| 主题与样式 | C07 | head 里有主题桥接脚本（`themeMode` / `prefers-color-scheme` / `window.parent` / `?theme=`），**不出现 `localStorage`**；CSS 是外链 `/_client/*.css`（200 + `text/css`），含 `--font-ui-sans` 与 `@layer`，不含 `@font-face` / `Public Sans` / 品牌词；文档内 `<style` 计数为 0 |
| 首页数据 | C08 | `data-ssr-dashboard`、`data-filtered-count`、fixture 标记（JSON 里 `"mode":"fixture"`）、示例数据警告文案 |
| 打码 | C09 / C10 / C19 | 序列化的 `user` 全是等长 `*`（`"user":"\*+"`），没有原始邮箱/用户名/手机号片段；`id` 形如 `provider::<hash>`；原始标识只允许出现在服务端 fixture 与测试输入里；客户端产物里没有身份、没有 `BALANCE_*` |
| 路由裁剪 | C11 / C12 / C13 | `/providers/*`、`/settings`、`/api/*` 全部 404，且源码/产物里没有对应路由文件 |
| 品牌词 | C15 / C16 / C17 | HTML、构建产物、docs/源码/package/lockfile 三层扫描（verify 用 charCode 拼出品牌词，所以脚本自身也不含它） |
| 密钥 | C18 | sentinel key 不出现在 HTML 与客户端 JS 里 |
| 环境加载 | C20 | 隔离目录 + Bun 子进程证明 `.env` 自动加载；应用侧用显式空环境变量覆盖，展示 `ttlSeconds` 与不可达警告，key 不出现 |
| 退出 | C21 | 主服务与探针都停止、端口释放、pid 消失 |
| 首页文案/布局 | C22 / C23 / C24 | h1 唯一 + hero 文案与顺序；section 顺序 hero < 搜索表单 < 账户卡 < 用量概览；没有 `<nav>` / `sticky top-0` / 主题开关 |
| 服务端搜索 | C25 / C36 | 表单 `role="search" action="/" method="get"` + 隐藏 `status/sort/view`；`/?q=…` 由服务端渲染过滤结果；输入过程只改本地 state、不 `navigate`；URL 导航一律 `replace + resetScroll: false`（筛选切换也会导航，所以允许 `navigate` 出现多次），且 `resetScroll: true` 不存在 |
| 客户端不取数 | C26 | 除 `use-routing-stream.ts` 的 `/feed/routing` 外，源码里不出现 `fetch(` / `axios` / `useSWR`；另断言 `use-dashboard-refresh.ts` 存在、调用 `router.refresh()`、且不含 `fetch(`（页面数据刷新走路由，不走第二条数据通路） |
| 认证 | C27 / C28 / C29 / C30 | `BALANCE_API_KEY` 默认 Bearer（已有 `Bearer ` 前缀时不重复）；mock 上游恰好收到 **1** 次请求且带正确头，live 模式渲染打码数据；缺 Key 时 **0** 次上游请求 + fixture 警告；旧命名与密钥在文档/产物/源码里都不出现 |
| `.env` 保持 | C31 | 仓库 `.env` 运行前后 SHA-256 一致；扫描时排除运行时 `.env` |
| 名称可见性 | C32 | provider slug、icon、`provider:"workbuddy"` 等字段可见（名称/渠道不参与打码） |
| 打码范围 | C33 | 只有用户身份被打码，provider/名称/套餐保持可读（与 README「账号打码规则」一致） |
| furin 契约 | C34 | `package.json` 有 `@teyik0/furin` + `elysia` 且无旧框架；`src/server.ts` 有 `furin({ pagesDir: './src/pages' })` 与 `export default app`；`src/pages/index.tsx` 有 `defineRoute('/')` / `mode: 'isr'` / `revalidate: 60` / `.loader(` / `.head(`；`src/pages/root.tsx` 有 `defineRootRoute()` / `<HeadContent` / `<Scripts`；`src/api/routing.ts` 提供 `/feed/routing` |
| 路由数据 | C35 | 首页 `<script id="__FURIN_DATA__">` 的 JSON 可解析、`query` 里 `q` 为空（或缺省）、路径为 `/`；`/?q=open` 的 `q` 为 `open` 且计数为 1/4；两种页面都有 `data-ssr-dashboard` |
| 提交式搜索（静态） | C36 | 见上「服务端搜索」；另断言工具栏源码里没有 `setTimeout` / `debounce` |
| CORS / sandbox iframe | C38 | `OPTIONS` → 204 + `ACAO: *` + 允许 GET（回显 `access-control-request-headers`）；带 `Origin` 的文档、`/_client/*.js` 静态资源、`/feed/routing?after=0` 都带 ACAO，并暴露 `x-furin-build-id`；轨迹接口 `cache-control` 含 `no-store` |
| 更新时间 | C39 | 每个 `readAt` 恰好渲染一个 `<time dateTime>`，值与 payload 一致，标签等于 `Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Shanghai' })` |
| 过期缓存刷新 | C40 | 独立 mock 上游 + TTL=1s + 两个不同 ISR URL（`/`、`/?q=open`）：首个 live 页面 `source.cache === 'miss'` 且恰好 1 次上游；等过期后第二次 loader 必须 awaited 刷新——上游请求 ≥ 2、新页面仍为 `miss`（从 `__FURIN_DATA__.dashboard.source.cache` 读，不能是 `stale`）、`source.fetchedAt` 前进、HTML 渲染新的 `data[3].balance` marker 且不再出现旧 marker、健康路径没有 stale / 上游失败 badge；探针端口与子进程在 `finally` 清理并断言释放 |

补充：`/_furin/health/live` 与 `/_furin/health/ready` 都断言 200；ISR 的 `s-maxage` **不写死 60**——后台再生成的那一次框架会把它改成 0。

## 3. 不能变的验收意图

无论框架怎么换，下面这些意图是这套矩阵存在的理由：

1. **打码**：浏览器能拿到的任何东西（HTML、`__FURIN_DATA__`、客户端 JS）里都没有原始账号身份；账户名/渠道名可以可见，身份不行。`user` 用等长 `*`，id 用 `provider::<hash>`。
2. **没有对外 API**：`/api/*` 必须 404，客户端产物里不能出现 `/api/`；浏览器唯一能主动 `fetch` 的接口是 `/feed/routing`。页面数据周期刷新走 furin 的 `router.refresh()`（重跑路由 loader），客户端不新增第二条数据通路。
3. **路由裁剪**：`/providers/*` 与 `/settings` 必须 404（面板只有首页）。
4. **sandbox iframe 的 CORS**：opaque origin 下文档、静态资源、轮询接口都要能被读取——预检 204 + `ACAO: *` + 暴露构建标记头。
5. **密钥只在服务端**：`BALANCE_API_KEY` / `GATEWAY_WEB_KEY` 不出现在 HTML、客户端 JS、构建产物或日志断言里；缺 Key 时不发未认证请求。
6. **`.env` 神圣不可写**：验收期间逐字节不变，fixture 模式通过显式空环境变量覆盖实现。
7. **品牌词不出现**：HTML、构建产物、docs/源码/package/lockfile 三层扫描。
8. **无 JS 也能读**：完整文档 + 可服务端提交的搜索表单，禁用 JS 后页面内容仍然完整。

## 4. 本轮文档核对时的手工实测（不是 verify 输出）

下面这些是写文档时在 `.furin/build/bun/` 产物上直接 `curl` 得到的事实，用来核对文档口径；**正式结论仍以 `bun run verify` 的输出为准**：

| 探针 | 结果 |
| --- | --- |
| `GET /`（fixture 模式，独立端口 3397） | 200 `text/html`；`Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=60`；`ETag`、`Content-Length`、`cache-tag: /`、`x-furin-build-id: ae2909324f9f` |
| `GET /?q=WorkBuddy` / `GET /?status=error` | 各自 200，ETag 不同（ISR 以完整 URL 为缓存键），重复请求同一 URL 复用同一 ETag |
| `GET /` + `Origin: null` | `Access-Control-Allow-Origin: *` + `Access-Control-Expose-Headers: x-furin-build-id` |
| `OPTIONS /` + 预检头 | 204 + `ACAO: *` + `Access-Control-Allow-Methods: GET,HEAD,POST,OPTIONS` + 回显 `access-control-request-headers` + `Max-Age: 600` |
| `GET /_client/*.css` / `*.js` | 200 `text/css` / `text/javascript`；`Cache-Control: public, max-age=31536000, immutable, public, max-age=86400`；带 Origin 时有 ACAO |
| `GET /public/<静态文件>` | 200，`Cache-Control: public, max-age=86400`（public 资源的前缀是 `/public/`，不是根路径） |
| `GET /feed/routing?after=0` | 200 `application/json` + `Cache-Control: no-store`；带 Origin 时带 ACAO |
| `GET /api/foo`、`/providers/x`、`/settings`、`/nope` | 全部 404；404 页面不带 `Cache-Control` |
| `GET /_furin/health/live`、`/_furin/health/ready` | 均 200 |
| 压缩 | `GET /` 带 `Accept-Encoding: gzip, br` 时**没有** `Content-Encoding` / `Vary`——源站不压缩，交反向代理 |
| 打码形态（fixture 4 账户） | 页面显示 `显示 4 / 4 个账户`，序列化 `user` 为等长 `*`（11 / 9 / 22 / 23 个星号），无原始身份；标题 `余额面板 · 4 个账户` 来自页面 `.head()` |
| 页面框架数据 | 文档里是 `<script id="__FURIN_HEAD__">` 与 `<script id="__FURIN_DATA__">` 的普通 JSON；没有内联 `<style>`，CSS 是 `<link rel="stylesheet">` 外链 |
| 单测 | `bun run test` → 9 文件 / **103 passed**（theme 11、geometry 16、timeline 18、routing-derive 18、balance-derive 13、motion 6、wiring 4、search 9、server balance-cache 8） |

## 5. 与旧报告的差异

- 旧版本文档建立在另一套框架之上（旧的构建产物目录、server function、SSR 缓存脱水、内联 CSS、旧的静态资源与函数路径、运行时替换等）。这些章节与证据**全部作废并已删除**，不再作为验收依据。
- 语义变化的几项：C05 不再强制 chunked（ISR 是 `Content-Length` + `ETag`）；C07 从「内联 CSS」改成「外链 CSS + 无 web font」；C15–C19 的扫描根从旧产物目录换成 `.furin/build`；C26 允许筛选切换产生多次 `navigate`（只保留 `resetScroll: false` 与「输入不导航」这两个不变量）；C34 / C35 改为 furin 契约与 `__FURIN_DATA__` 断言；C38 改为 furin 的 CORS 契约（暴露 `x-furin-build-id`、轨迹接口 `no-store`）；C26 另追加 `use-dashboard-refresh.ts` 的 `router.refresh()` 静态断言；C40 新增“过期余额缓存必须 awaited 刷新”的隔离探针。
- 旧报告里的历史「运行记录」（某次 37/37、38/38 之类的快照）不再保留：它们对应的产物早已不存在，留下来只会误导。当前结果以脚本输出为准。

## 6. 局限与已知边界

- **HTTP/SSR 级验证**：不跑真实浏览器，因此没有 hydration 警告、滚动位置、键盘焦点、像素级视觉回归的断言；这些靠开发期手工检查与截图。
- **fixture 强制**：真实 relay 与真实网关凭据不参与验收（C20/C28/C29/C40 用隔离 `.env` 与本地 mock 上游代替）；TLS、真实错误码、限流不在范围内。
- **版本与端口写死**：Bun 版本、端口、依赖名都是断言的一部分，升级时要同步改脚本；断言不写死 ISR 的 `s-maxage`（后台再生成时会变成 0）。
- **不覆盖 CDN / 代理压缩**：源站本来就压缩不了（§4 实测），压缩正确性属于部署侧验证。
- **不覆盖 `/public/*` 的完整清单**：只断言 CSS/JS 资产与首页；public 资源的前缀是 `/public/`，具体的静态文件清单不在矩阵里。
- **CI 只跑 Linux runner**：门禁在 `ubuntu-latest` 上执行，Windows 下的进程清理分支（taskkill）只在本地开发时走到；两者的断言内容一致。

## 7. 复现

```bash
bun install --frozen-lockfile
bun run typecheck
bun run test
bun run build
bun run verify

# 换端口（五个都必须空闲）
VERIFY_PORT=3401 VERIFY_ENV_PORT=3402 VERIFY_LIVE_PORT=3403 VERIFY_NO_KEY_PORT=3404 VERIFY_REFRESH_PORT=3405 bun run verify
```

`scripts/verify.mjs` 的约定：品牌词用 charCode 拼出（脚本自身不含该词）；扫描 HTML / 构建产物 / docs / 源码；所有探针在 `finally` 里关闭并检查端口释放；任何 FAIL 都以非零码退出。

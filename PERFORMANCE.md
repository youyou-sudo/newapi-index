# 性能口径与首屏预算（2026-10-28，furin 0.8 重构后）

> 适用：newapi-index（Furin 0.8.0-alpha.0 + Bun 1.4.4 + Elysia 2.0.0-beta.32 + React 19.3.1 + Tailwind v4）
> 口径：只写能重复量出来的东西——构建产物字节（文件系统）、真实响应头（`curl -D`）、服务端请求日志里的 `durationMs`、以及本地 gzip/brotli 的参考压缩值。
> 不写实验室 FCP/LCP：在没有稳定的网络模拟与「多次取中位」流程时，那些数字复现不了，写进文档只会变成噪声。
> 旧版性能报告（另一套框架时期，含内联 CSS、运行时替换、应用内 gzip 等前提）的全部数字与结论**作废**，本文不再引用。

## 0. 结论速览

| 指标 | 现在（未压缩） | 说明 |
| --- | ---: | --- |
| 入口 `_hydrate-*.js` | 306,337 B | React 19 + furin 客户端运行时 + RSC 客户端 |
| 首屏 JS 合计（入口 + 路由 + 共享 chunk + error/not-found） | **440,862 B**（约 430 KiB） | 全部经 `modulepreload` 在 hydration 前到达 |
| 懒加载 `sort-select-impl-*.js` | 94,599 B | load 后空闲或交互意图才取，不在首屏 |
| 外部样式表 `_hydrate-*.css` | 42,174 B | 唯一额外首屏请求 |
| 文档 HTML（fixture 4 账户 / 空数据） | 32,878 B / 20,140 B | ISR 按 URL 缓存，带 ETag |
| 首屏总传输（文档 + CSS + JS） | **515,914 B**（约 504 KiB） | 本地 brotli 约 135 KiB、gzip 约 159 KiB |
| web font / 图片 / 三方脚本 | 0 / 0 / 0 | 产物扫描 |
| 文档 TTFB（ISR 命中 / 首次渲染） | 1–3 ms / ~800 ms | 服务端日志 `durationMs`；首次渲染受 800 ms 轨迹预算限制 |

四条判断：

1. **大头是框架固定成本，不是业务代码**：首屏 JS 约 430 KiB，其中 React 19 + furin 客户端运行时（含 RSC 客户端、路由与 link 层）占绝大部分，业务组件只有几 KB。这条成本不能靠「再拆一个 chunk」解决——hydration 前所有首屏模块都必须到达，模块图也由框架生成。
2. **压缩的收益在反向代理**：本地 brotli 把 504 KiB 压到约 135 KiB（−73%），gzip 到约 159 KiB（−69%）。应用内不压缩（见 §5），也不应该压——那会和代理重复劳动，还会破坏 `Content-Length`/`ETag` 语义。
3. **ISR 把 TTFB 从「等上游」变成「命中进程内缓存」**：命中 1–3 ms；只有进程启动后的第一次渲染要跑 loader（余额 + 最多 800 ms 的轨迹种子）。
4. **CSS 是外部资源、一次 immutable 缓存**：首访多一个阻塞 RTT（br 后约 7 KB），但不会随每份 ISR HTML 重复传输。

## 1. 构建产物基线（可复现）

```text
.furin/build/bun/client/
  _hydrate-d9becqjj.js            306,337   gz 98,370   br 84,603   入口（module script）
  index-f4rhv66f.js                94,073   gz 33,540   br 27,654   首页路由 chunk
  _hydrate-msrer1y9.js             33,316   gz 10,989   br  9,672   共享运行时
  _hydrate-asvkrvcs.js              3,857   gz  2,093   br  1,730   共享运行时
  _hydrate-gjcbzykv.js                323   gz    245   br    216   共享运行时
  error-qr46tey2.js                 1,679   gz    967   br    808   错误边界（modulepreload）
  not-found-a6zbhjd7.js             1,277   gz    776   br    634   404 边界（modulepreload）
  sort-select-impl-vms2b6n6.js     94,599   gz 33,261   br 29,409   懒加载（Radix Select 依赖链）
  _hydrate-zn6ttxar.css            42,174   gz  8,029   br  6,968   外部样式表
```

复现（`gz`/`br` 是本地 zlib 参考值，线上字节由代理的压缩级别决定）：

```bash
bun run build
ls -l .furin/build/bun/client
node -e "const fs=require('fs'),z=require('zlib');for(const f of process.argv.slice(1)){const b=fs.readFileSync(f);console.log(f.padEnd(36),b.length,'gz',z.gzipSync(b).length,'br',z.brotliCompressSync(b).length)}" .furin/build/bun/client/*.js .furin/build/bun/client/*.css
```

> 为什么不做模块归属（哪个 npm 包占多少字节）：当前构建不产 sourcemap，furin 也没有暴露分包/分析配置；按文件名猜归属只会得到不可复现的结论。

## 2. 首屏请求链

从渲染出来的文档里能直接看到（顺序即浏览器优先级）：

1. `GET /` → ISR 文档（可能命中缓存；失败/过期时回源重渲染）；
2. `<link rel="stylesheet" href="/_client/_hydrate-*.css">`：阻塞渲染，br 后约 7 KB；
3. 6 条 `<link rel="modulepreload">`（路由 chunk、3 个共享运行时、error、not-found）+ 末尾一条 `<script type="module" src="/_client/_hydrate-*.js">`；
4. hydration 完成、`window load` 之后：空闲回调（或 pointerenter / focus / touchstart）再取 `sort-select-impl`；
5. 首屏之后浏览器开始轮询 `GET /feed/routing?after=0`（若 loader 的 800 ms 种子超时，第一次轮询补上轨迹）。

关键路径是 1 → 2 → 3，共 **9 个请求**（文档 1 + CSS 1 + JS 7 = 6 条 modulepreload + 1 个入口 module script）。页面没有字体、图片、三方脚本请求。

## 3. 预算（防回归阈值）

下面是**建议阈值**，取值是当前字节 + 约 5–10% 余量，用来在 PR 上发现「无意中把某个大依赖拉回首屏」，不是性能目标：

| 指标 | 现在 | 建议上限 | 测量方式 |
| --- | ---: | ---: | --- |
| 入口 `_hydrate-*.js` | 306,337 | ≤ 330,000 | 产物文件字节 |
| 路由 chunk `index-*.js` | 94,073 | ≤ 100,000 | 产物文件字节 |
| 首屏 JS 合计 | 440,862 | ≤ 470,000 | 上述相加 |
| 外部 CSS | 42,174 | ≤ 45,000 | 产物文件字节 |
| 文档 HTML（fixture） | 32,878 | ≤ 40,000 | `GET /` 的 `Content-Length` |
| 首屏请求数（文档 + CSS + JS） | 9 | ≤ 10 | 文档里的 link/script 数量 |
| web font 文件（`.woff2?/.ttf/.otf`） | 0 | 0 | 产物扫描 |
| 文档内 `<style` 标签 | 0 | 0 | 文档扫描（CSS 必须是外部资产） |
| 客户端产物里的 `/api/` | 0 | 0 | 产物扫描 |

上调任何一项都要在 PR 描述里写清「涨了什么、为什么必须涨」。这些预算目前只写在文档里（验收脚本的 38 项断言没有字节预算项），所以每次动首屏代码时建议人工比较两次构建的产物字节。

## 4. 渲染与缓存（实测响应头）

| 路径 | `Cache-Control` | 其他头 | 结论 |
| --- | --- | --- | --- |
| `/`、`/?q=…` | `public, max-age=0, s-maxage=60, stale-while-revalidate=60` | `ETag`、`Content-Length`、`cache-tag: /`、`x-furin-build-id` | 浏览器每次导航回源校验（命中 ETag 时 304），CDN 边缘 60 s |
| `/feed/routing?after=N` | `no-store` | `application/json` | 实时数据，任何中间层都不缓存 |
| `/_client/*.js`、`/_client/*.css` | `public, max-age=31536000, immutable`（响应里还拼了一段 `public, max-age=86400`） | `ETag`、`Content-Range` | 内容哈希，一年缓存 |
| `/public/*` | `public, max-age=86400` | `ETag` | 无内容哈希的静态文件 |
| 404（`/api/*`、`/providers/*`、`/settings`、未知路径） | 无 | — | 不进 CDN |

要点：

- **为什么不是 SSR**：furin 的 SSR 响应固定 `no-store`，loader 里也改不动；`mode: "isr", revalidate: 60` 才拿得到 `s-maxage` 与 `stale-while-revalidate`。
- **缓存键是完整 URL（含 query）**：`/?q=WorkBuddy` 与 `/?status=error` 各一份缓存，所以筛选组合越多，进程内与 CDN 的缓存条目越多（单页面板的数据域很小，这不是问题，但要知道）。
- **ISR 后台再生成的那一次 `s-maxage` 会是 0**（让 CDN 先别缓存这份刚过期的副本），下一次命中回到 60。监控里偶发 `s-maxage=0` 属正常。
- **TTFB**：服务端日志里 ISR 命中的 `durationMs` 是 1–3 ms；首次渲染约 800 ms（轨迹种子的 800 ms 预算上限）；余额上游不可达时 fixture 是本地文件，不额外等网络。
- **`max-age=0` 的代价**：重复打开要一次条件请求（304，约 200 B）。如果以后想彻底省掉这一跳，可以在 CDN 侧把 HTML 的浏览器缓存设成短 TTL（15–30 s），但要同时保留上一版 `/_client/*` 资产至少同样的时长，否则旧 HTML 引用的旧资产会 404。

## 5. 压缩：交给反向代理

实测（2026-10-28，构建 `ae2909324f9f`）：

```bash
curl -sSI -H 'Accept-Encoding: gzip, br' https://<面板域名>/ | grep -i 'content-encoding\|vary'
# 源站：无输出 —— 响应没有任何 Content-Encoding / Vary
```

- **原因**：furin 的页面响应走自己的流式链路，Elysia 的 `onAfterHandle` / `mapResponse` 改不到它（`src/server.ts` 顶部注释记录了这条结论）。框架官方口径也是压缩交给反向代理。
- **推荐配置**（任选其一）：
  - nginx：`brotli on; brotli_comp_level 5; brotli_types text/html text/css application/javascript application/json image/svg+xml;` + 兜底 `gzip on; gzip_types ...`；
  - Caddy：`encode zstd gzip`（Caddy 2.7+ 默认就对 HTML/JS/CSS 生效）；
  - Cloudflare：自动 brotli，但注意它只压缩可缓存的响应类型，ISR HTML 属于可缓存。
- **注意**：代理压缩后，`ETag` 语义最好由代理保持一致（nginx 默认会弱化/改写 ETag，导致 304 退化为 200 全量传输；功能没问题，只是省不到那一次条件请求）。`Content-Length` 在压缩后会由代理重算，这是正常的。
- **不要**在应用里补 `CompressionStream`：页面响应不经过我们可以拦截的钩子，对静态资产也没必要（代理会压）。

## 6. CSS 与字体

- CSS 42,174 B（br 6,968 / gzip 8,029），是外部资产 `/_client/_hydrate-*.css`，带内容哈希，缓存一年。
- 首访多一个阻塞 RTT；之后所有导航都命中浏览器缓存。ISR HTML 不内联样式，所以每次 CDN 回源传的是「文档 + 外链」，而不是「文档 + 42 KB 样式」。
- 0 个 web font、0 个 `@font-face`：正文是 `sans-serif`（与 new-api 的 `--font-ui-sans` 同值），标题是 new-api 的 serif 链，字形由本机系统字体渲染，因此首屏没有字体下载与 FOUT/FOIT。
- 想再省一个 RTT 只剩代理侧手段（103 Early Hints / CDN 预热 / 把 CSS 并入更小的关键路径），代码层没有「内联 CSS」这个选项——furin 不提供构建期内联。

## 7. 懒加载的排序下拉

- `sort-select-impl-*.js` 94,599 B（br 29,409）只在需要时加载：`window load` 之后的空闲回调，或 pointerenter / focus / touchstart 意图；未加载完成时点击会记住「要打开」，chunk 到位后自动展开。
- 收益：不碰排序的用户完全不付这 92 KiB；代价：首次打开下拉多一个 chunk RTT（命中 `immutable` 缓存后几乎无感）。
- 如果要更省，可以改成「仅意图预取」（去掉 load 后空闲预取），代价是首次打开多等约 100–200 ms。这是设计取舍，本轮保留空闲预取。
- SSR 与 hydration 首帧渲染的是同款按钮（class/id/aria 都来自 `SORT_TRIGGER_CLASS` 等常量），因此加载前后不会改变尺寸，也不会产生 hydration 不一致。

## 8. 服务端数据与 TTFB

- **余额**：进程内 TTL 30 s（`BALANCE_CACHE_TTL_SECONDS`）+ stale-while-revalidate：TTL 过期但手里有数据时立刻返回旧数据、后台刷新；只有进程启动后的第一个请求要等上游。失败永不 reject：先用旧缓存，再退到内置 fixture，并把原因写进 `source.warning`。
- **轨迹**：首页 loader 只等 800 ms（`loadRoutingSeed(800)`），超时先渲染骨架，浏览器轮询 `GET /feed/routing?after=N` 补上；同一个 `after` 的并发轮询在服务端 single-flight。
- **可观测**：furin 给每个请求打一条 JSON 日志（`method`、`path`、`status`、`durationMs`、`furin.cache` = `hit|miss`、`furin.render` = `isr|not-found`、`buildId` 走响应头）。算 TTFB 与缓存命中率直接读日志，不需要额外埋点。

## 9. 不做清单（都有明确理由）

| 项目 | 结论 | 理由 |
| --- | --- | --- |
| 应用内 gzip / brotli | 不做 | 页面响应走框架自己的流式链路，Elysia 钩子改不到；压缩交反向代理 |
| 构建期内联 CSS | 不做 | furin 不提供；外部 CSS 可一年 immutable，ISR HTML 不必每次携带样式 |
| 再拆首屏 chunk | 不做 | hydration 前所有首屏模块都要到达，拆小只会多请求 |
| 运行时替换（更小的 React 兼容层） | 不做 | 已回到真实 React 19；替换层会牺牲并发特性与 DevTools，收益不可控 |
| 引入一层客户端查询缓存 | 不做 | 数据只有一条 loader 路径 + 一条轮询，多一层缓存没有收益，反而多一份失效逻辑 |
| 流式 SSR | 不做 | ISR 命中只要 1–3 ms；流式会让缓存头退回 `no-store`，CDN 无法缓存 |
| 预生成 `.br`/`.gz` 旁路文件 | 不做 | 代理在线压缩即可；避免产物翻倍、也避免源站与代理两套压缩语义打架 |
| 给首屏脚本加 `fetchpriority` | 不做 | 首屏 JS 已经在 `modulepreload` 列表里，改优先级属于噪声级调整，没有可复现证据 |

## 10. 复现

```bash
# 1) 构建 + 产物字节
bun run build
ls -l .furin/build/bun/client

# 2) 本地起服务，量响应头与 TTFB
PORT=3399 bun .furin/build/bun/server.js
curl -sS -o /dev/null -w 'ttfb=%{time_starttransfer}s total=%{time_total}s size=%{size_download}\n' http://127.0.0.1:3399/
curl -sSI http://127.0.0.1:3399/ | grep -i 'cache-control\|etag\|content-length\|x-furin-build-id'

# 3) 确认源站不压缩（代理之后这条才会有 content-encoding）
curl -sSI -H 'Accept-Encoding: gzip, br' http://127.0.0.1:3399/ | grep -i 'content-encoding\|vary' || echo 'no in-process compression'

# 4) 轨迹接口的缓存头
curl -sSI 'http://127.0.0.1:3399/feed/routing?after=0' | grep -i 'cache-control'
```

## 11. 与旧报告的关系

旧报告里基于上一套框架的结论——内联 CSS 省一个 RTT、运行时替换省 41 KB、应用内 gzip、构建期预压缩静态资源等——全部不再成立，数字作废。本报告只保留当前栈上可复现的三类证据：产物字节、真实响应头、服务端日志。要比较「改前/改后」时，用同一个构建命令在两棵树上各跑一次 §10，不要引用任何历史数字。

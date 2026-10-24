import { redact } from '@tanstack/redact/vite'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

// ── CDN / HTTP 缓存策略 ─────────────────────────────
// 源站统一发出缓存头，CDN 只需“遵循源站 / Cache Everything”即可：
//
//   /assets/**      带内容哈希，永久缓存；部署后文件名变化，无需手动失效。
//   /favicon.svg    没有哈希，缓存一天。
//   HTML 文档       仅 CDN 边缘缓存 60 秒（s-maxage / CDN-Cache-Control），
//                   浏览器每次导航都回源校验，避免部署后长时间看到旧页面；
//                   stale-while-revalidate 让边缘先回旧页面、后台刷新。
//   /_serverFn/**   浏览器唯一会直接访问的“接口”（TanStack Start 的 server
//   /api/**         function RPC 入口），一律 no-store，余额数据不进入 CDN。
//                   上游 BALANCE_API_URL 只由服务端进程访问，不经过 CDN。
//
// 注意：HTML 的 CDN 缓存需要 CDN 侧允许缓存 HTML（例如 Cloudflare 的
// “Cache Everything” Cache Rule）；仅靠响应头时 Cloudflare 默认只缓存
// 静态扩展名。详见 README「缓存与 CDN 响应头」。
const CDN_HTML_MAX_AGE_SECONDS = 60
const CDN_HTML_STALE_WHILE_REVALIDATE_SECONDS = 300
const CDN_HTML_STALE_IF_ERROR_SECONDS = 86400
const CDN_ASSET_MAX_AGE_SECONDS = 31536000 // 1 年
const CDN_FAVICON_MAX_AGE_SECONDS = 86400 // 1 天

const htmlCacheHeaders = {
  // 浏览器不缓存（max-age=0），共享缓存/CDN 缓存 60 秒。
  'cache-control':
    `public, max-age=0, s-maxage=${CDN_HTML_MAX_AGE_SECONDS}, ` +
    `stale-while-revalidate=${CDN_HTML_STALE_WHILE_REVALIDATE_SECONDS}, ` +
    `stale-if-error=${CDN_HTML_STALE_IF_ERROR_SECONDS}`,
  // 明确给 CDN 的 TTL：Cloudflare 等会优先读取该头，避免被 s-maxage 的
  // 语义差异或 CDN 面板配置覆盖。
  'cdn-cache-control':
    `public, max-age=${CDN_HTML_MAX_AGE_SECONDS}, ` +
    `stale-while-revalidate=${CDN_HTML_STALE_WHILE_REVALIDATE_SECONDS}, ` +
    `stale-if-error=${CDN_HTML_STALE_IF_ERROR_SECONDS}`,
}

const assetCacheHeaders = {
  'cache-control': `public, max-age=${CDN_ASSET_MAX_AGE_SECONDS}, immutable`,
  'cdn-cache-control': `public, max-age=${CDN_ASSET_MAX_AGE_SECONDS}, immutable`,
}

const noStoreHeaders = {
  // 接口响应绝不缓存：浏览器与 CDN 都按“不存储”处理。
  'cache-control': 'no-store, no-cache, must-revalidate, max-age=0',
  'cdn-cache-control': 'no-store',
  pragma: 'no-cache',
  expires: '0',
}

// Deployment target: a Bun server (Nitro "bun" preset).
// The intranet Balance API is reached from this process only. Changing the
// preset (e.g. to "node-server" or "cloudflare_module") does not change the
// app model: routes, loaders, server functions and SSR semantics stay identical.
export default defineConfig({
  server: {
    port: 3000,
    // 本地把页面嵌进 sandbox iframe 调试时，字体等静态资源同样按 CORS 请求。
    headers: { 'access-control-allow-origin': '*' },
  },
  resolve: {
    tsconfigPaths: true,
  },
  plugins: [
    // React 运行时替换：redact 的 Vite 插件把 react / react-dom / scheduler /
    // jsx-runtime 的解析结果改到 @tanstack/redact 的同步实现（导入语句不变）。
    // 放在最前面，靠 enforce:'pre' 保证其它插件看到的是同一份运行时。
    // 只保留这个界面真正用到的能力：Router 内部用 React.memo（memo）、
    // Radix 用 forwardRef/context/portal，CatchBoundary 是 class 错误边界
    // （classComponents），SSR 需要 hydration；Activity、Fragment refs 与
    // React.lazy 都没有消费者，关掉可少下载约 3 KB br。
    redact({ features: { activity: false, fragmentRefs: false, lazy: false } }),
    tailwindcss(),
    tanstackStart({
      srcDirectory: 'src',
      // 首屏 CSS 内联：TanStack Start 构建期把 app CSS 内容写进 start manifest，
      // SSR 文档直接输出 <style data-tsr-inline-css>（客户端 hydration 复用该节点），
      // 首屏不再发 CSS 请求、省掉一次阻塞渲染的 RTT。注：按需 Select chunk 的 Vite
      // preload 会在 load 之后取一次 CSS 资产（immutable 缓存），不影响首屏。
      // 见 README「首屏速度」。
      server: {
        build: {
          inlineCss: true,
        },
      },
      importProtection: {
        // Every module under src/server is server-only. Importing it from a
        // client-reachable module fails the production build instead of
        // leaking intranet credentials or node:fs into the browser bundle.
        client: {
          files: ['**/*.server.*', '**/server/**'],
        },
        behavior: {
          // Dev can report pre-tree-shaking edges; the production build is the
          // authoritative gate and must fail on any violation.
          dev: 'mock',
          build: 'error',
        },
      },
    }),
    viteReact(),
    nitro({
      preset: 'bun',
      // 第三方包（React Query、TanStack Router、Radix UI、lucide-react 等）为了兼容
      // React Server Components，会在模块顶层写 "use client"。本项目不是 RSC 应用，
      // 该指令没有语义，Rolldown 打包时丢弃它是正确的，但每次构建都会刷屏
      // [MODULE_LEVEL_DIRECTIVE] 警告。这里只关闭这一项检查，其余 Rolldown 警告
      // （循环依赖、未解析导入等）照常输出；该检查只针对 "use strict" 之外的模块级
      // 指令，因此不会掩盖真正的问题。
      rolldownConfig: {
        checks: {
          moduleLevelDirective: false,
        },
      },
      // 构建期把 public/ 里的静态资源预压缩成 .br/.gz。Nitro 的静态处理器会按
      // Accept-Encoding 选择预压缩文件（见 nitro runtime/internal/static.mjs），
      // 入口 JS 从 498KB 降到约 130KB（br）/ 152KB（gzip），这对 iframe 首屏
      // 几乎是决定性的：不压缩时浏览器要下载完整的未压缩 bundle。
      compressPublicAssets: { gzip: true, brotli: true },
      routeRules: {
        // @font-face 在 sandbox iframe（Origin: null）里需要显式放行，否则回退字体。
        '/assets/**': {
          headers: {
            'access-control-allow-origin': '*',
            ...assetCacheHeaders,
          },
        },
        // 没有内容哈希，不能 immutable。
        '/favicon.svg': {
          headers: {
            'cache-control': `public, max-age=${CDN_FAVICON_MAX_AGE_SECONDS}`,
            'cdn-cache-control': `public, max-age=${CDN_FAVICON_MAX_AGE_SECONDS}`,
          },
        },
        // 接口：TanStack Start server function 的 RPC 入口（浏览器直接请求）。
        '/_serverFn/**': { headers: noStoreHeaders },
        // 以防将来新增 /api 路由时被兜底规则误缓存。
        '/api/**': { headers: noStoreHeaders },
        // 兜底：SSR HTML 文档与其余响应。
        '/**': { headers: htmlCacheHeaders },
      },
    }),
  ],
})

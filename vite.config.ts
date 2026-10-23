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
    tailwindcss(),
    tanstackStart({
      srcDirectory: 'src',
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

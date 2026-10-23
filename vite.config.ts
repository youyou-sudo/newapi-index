import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import viteReact from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

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
      // @font-face 在 sandbox iframe（Origin: null）里需要显式放行，否则回退字体。
      routeRules: {
        '/assets/**': {
          headers: { 'access-control-allow-origin': '*' },
        },
      },
    }),
  ],
})
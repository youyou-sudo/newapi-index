/// <reference types="vite/client" />
import type { QueryClient } from '@tanstack/react-query'
import {
  HeadContent,
  Outlet,
  Scripts,
  createRootRouteWithContext,
} from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { AppLayout } from '~/components/app-layout'
import { DefaultCatchBoundary } from '~/components/default-catch-boundary'
import { NotFound } from '~/components/not-found'
import { installRedactEventCompat } from '~/lib/redact-events'
import { hostThemeInitScript } from '~/lib/theme'
// 普通 CSS 导入而不是 ?url：这样 app.css 会作为客户端 chunk 的 CSS 资产进入
// TanStack Start 的 start manifest，构建期 inlineCss 才能把整份样式内联进 SSR
// 文档（链接方式会多一次阻塞渲染的请求）。
import '~/styles/app.css'

// Redact 的运行时缺 React SyntheticEvent 的 isPropagationStopped/isDefaultPrevented
// 方法；Radix Select 选择条目时会调用它（详见 src/lib/redact-events.ts）。
// 在渲染任何组件之前安装，服务端会自动跳过。
installRedactEventCompat()

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { name: 'color-scheme', content: 'light dark' },
      { title: '余额面板' },
      {
        name: 'description',
        content:
          '集中查看 AI 订阅账户的余额与额度窗口，全部由服务器渲染。',
      },
      { name: 'theme-color', content: '#ffffff', media: '(prefers-color-scheme: light)' },
      { name: 'theme-color', content: '#1c1c1c', media: '(prefers-color-scheme: dark)' },
    ],
    links: [{ rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' }],
  }),
  shellComponent: RootDocument,
  component: RootLayout,
  errorComponent: DefaultCatchBoundary,
  notFoundComponent: NotFound,
})

/** Full-document SSR: the complete <html> document is rendered on the server. */
function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: hostThemeInitScript }} />
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  )
}

function RootLayout() {
  return (
    <AppLayout>
      <Outlet />
    </AppLayout>
  )
}
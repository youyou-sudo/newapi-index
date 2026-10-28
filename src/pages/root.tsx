import { HeadContent, Scripts, defineRootRoute } from '@teyik0/furin'
import { AppLayout } from '~/components/app-layout'
import { hostThemeInitScript } from '~/lib/theme'
// 普通 CSS 导入：furin 会把 app.css 编进客户端资产图（外部样式表 <link>），
// 主题与 Tailwind 工具类因此和 HTML 一起到达，不需要内联样式那一套。
import '~/styles/app.css'

/**
 * 文档外壳。
 *
 * - `mode: "ssg"`：根布局没有 loader，静态外壳；页面（index）用 ISR 才能拿到
 *   `public, max-age=0, s-maxage=60, stale-while-revalidate=60` 的缓存头。
 * - `hostThemeInitScript` 必须在任何渲染之前跑：new-api 在 iframe load 之后才下发
 *   主题消息，首屏要先按 ?theme= / 系统偏好把 .dark 打上，否则会闪一下白底。
 * - `<HeadContent />` 在前、静态兜底 meta 在后：页面 head() 声明的 <title>（首页
 *   带账户数）是文档里的第一个 title，浏览器以它为准；404/500 这类没有 head() 的
 *   页面退回静态 title。React 不合并重复的文档元数据，顺序是我们唯一的杠杆。
 */
export const route = defineRootRoute()
  .config({ mode: 'ssg' })
  .layout(({ children }) => (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: hostThemeInitScript }} />
        <HeadContent />
        <meta
          name="description"
          content="集中查看 AI 订阅账户的余额与额度窗口，全部由服务器渲染。"
        />
        <meta name="color-scheme" content="light dark" />
        <meta
          name="theme-color"
          content="#ffffff"
          media="(prefers-color-scheme: light)"
        />
        <meta
          name="theme-color"
          content="#1c1c1c"
          media="(prefers-color-scheme: dark)"
        />
        <link rel="icon" type="image/svg+xml" href="/public/favicon.svg" />
      </head>
      <body>
        <AppLayout>{children}</AppLayout>
        <Scripts />
      </body>
    </html>
  ))
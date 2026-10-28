import { Elysia, t } from 'elysia'
import { loadRoutingFeed } from '~/server/routing.server'

/**
 * 路由轨迹增量接口。
 *
 * 浏览器（`useRoutingStream`）首屏用 `after=0` 取整段，之后带上一次快照的
 * `seq` 轮询。上游读取全部在服务端完成：网关 web 用 HttpOnly cookie 认人、
 * /api 不带 CORS，浏览器直接请求会被 opaque origin 与 cookie 双双挡住。
 *
 * 路径刻意不放在 `/api` 前缀下：客户端 bundle 里不允许再出现那串旧框架的
 * API 前缀，验收脚本会扫描产物。
 *
 * `loadRoutingFeed` 永不 reject：上游不可达/未配置/被拒都收敛成 `source.state`
 * 与 `source.warning`，HTTP 始终 200，页面照常渲染提示文案。
 * `cache-control: no-store`：轨迹是实时数据，任何中间层都不该缓存。
 */
export const routingApi = new Elysia({ name: 'routing-api' }).get(
  '/feed/routing',
  {
    query: t.Object({
      // 缺省时取 0；query 里的数字字符串由 Elysia 归一化成 number；负数在 loadRoutingFeed 里钳到 0。
      after: t.Optional(t.Number({ default: 0 })),
    }),
  },
  ({ query, set }) => {
    set.headers['cache-control'] = 'no-store'
    return loadRoutingFeed(query.after ?? 0)
  },
)

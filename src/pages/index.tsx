import { defineRoute } from '@teyik0/furin'
import { t } from 'elysia'
import { DashboardPage } from '~/features/dashboard/dashboard-page'
import { buildDashboard } from '~/lib/balance/derive'
import { parseDashboardSearch } from '~/lib/balance/search'
import { loadBalanceSnapshot } from '~/server/balance.server'
import { loadRoutingSeed } from '~/server/routing.server'

/**
 * 首页。
 *
 * - `mode: "isr", revalidate: 60`：公开数据（余额快照 + 轨迹种子）按 URL（含
 *   query）缓存 60 秒，CDN 与进程内缓存语义一致；SSR 的 no-store 拿不到缓存头。
 * - query schema 只做“这是不是字符串”的把关：长度、枚举、非法值回落全部交给
 *   `parseDashboardSearch()`，服务端 / 浏览器 / 测试只有一套归一化规则。
 * - loader 只把 `q` 带进数据（status/sort/view 是浏览器端的展示筛选）；路由轨迹
 *   用 800ms 预算的种子，超时就先渲染骨架，浏览器轮询会补上。
 */
export const route = defineRoute('/')
  .config({
    mode: 'isr',
    revalidate: 60,
    query: t.Object({
      q: t.Optional(t.String()),
      status: t.Optional(t.String()),
      sort: t.Optional(t.String()),
      view: t.Optional(t.String()),
    }),
  })
  .loader(async ({ query }) => {
    const search = parseDashboardSearch({ ...query })
    const [snapshot, routing] = await Promise.all([
      loadBalanceSnapshot(),
      loadRoutingSeed(800),
    ])
    const now = Date.now()
    const dashboard = buildDashboard(
      snapshot,
      { q: search.q },
      now,
      // 本机调试时账户身份未打码（snapshot.source.revealed），页面照实显示；
      // 生产构建里这里恒为 false，server 端已经把身份抹成 ***。
      { reveal: snapshot.source.revealed },
    )
    return { dashboard, routing }
  })
  .head(({ dashboard }) => ({
    meta: [{ title: `余额面板 · ${dashboard.summary.accountCount} 个账户` }],
  }))
  .page(({ dashboard, routing, query }) => (
    <DashboardPage
      dashboard={dashboard}
      search={parseDashboardSearch({ ...query })}
      routingSeed={routing}
    />
  ))

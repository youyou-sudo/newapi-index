import { useSuspenseQuery } from '@tanstack/react-query'
import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import { DashboardPage } from '~/features/dashboard/dashboard-page'
import { dashboardQueryOptions } from '~/lib/balance/queries'
import { dashboardSearchSchema } from '~/lib/balance/schema'

export const Route = createFileRoute('/')({
  ssr: true,
  validateSearch: dashboardSearchSchema,
  search: {
    middlewares: [
      stripSearchParams({
        q: '',
        status: 'all',
        sort: 'recent',
        range: '14d',
        view: 'grid',
      }),
    ],
  },
  loaderDeps: ({ search }) => search,
  loader: async ({ context, deps }) => ({
    dashboard: await context.queryClient.ensureQueryData(
      dashboardQueryOptions(deps),
    ),
  }),
  head: ({ loaderData }) => ({
    meta: [
      {
        title: `余额面板 · ${loaderData?.dashboard.summary.accountCount ?? 0} 个账户`,
      },
      {
        name: 'description',
        content:
          '集中查看 AI 订阅账户的余额、额度窗口与每日用量，全部由服务器渲染。',
      },
    ],
  }),
  component: DashboardRoute,
})

function DashboardRoute() {
  const search = Route.useSearch()
  const { data: dashboard } = useSuspenseQuery(dashboardQueryOptions(search))
  return <DashboardPage dashboard={dashboard} />
}
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { createFileRoute, stripSearchParams } from '@tanstack/react-router'
import type { SearchSchemaInput } from '@tanstack/react-router'
import { RoutePending } from '~/components/route-pending'
import { DashboardPage } from '~/features/dashboard/dashboard-page'
import { dashboardQueryOptions } from '~/lib/balance/queries'
import { parseDashboardSearch } from '~/lib/balance/search'
import type { DashboardSearch } from '~/lib/balance/search'

export const Route = createFileRoute('/')({
  ssr: true,
  // Hand-written and dependency free: this runs in the browser on every
  // navigation, and the zod equivalent would ship the whole validator runtime
  // in the client entry chunk. The server keeps its zod schema.
  //
  // `SearchSchemaInput` keeps the *input* half of the schema permissive (all
  // keys optional), so `to="/"` and `navigate({ to: '/' })` stay valid — the
  // parsed search value itself is always complete.
  validateSearch: (search: SearchSchemaInput & Partial<DashboardSearch>) =>
    parseDashboardSearch({ ...search }),
  search: {
    middlewares: [
      stripSearchParams({
        q: '',
        status: 'all',
        sort: 'recent',
        view: 'grid',
      }),
    ],
  },
  // Only the text query narrows data on the server. Status/sort/view are
  // presentation state, so changing them must not revalidate this loader.
  loaderDeps: ({ search }) => ({ q: search.q }),
  loader: async ({ context, deps }) => {
    const options = dashboardQueryOptions(deps)

    // The document must ship with data, so SSR waits for the query.
    if (typeof window === 'undefined') {
      return { dashboard: await context.queryClient.ensureQueryData(options) }
    }

    // Client navigations render immediately: cached data is reused, and a
    // cache miss is fetched in the background while only the account list
    // shows its loading state.
    const cached = context.queryClient.getQueryData(options.queryKey)
    if (cached) return { dashboard: cached }

    void context.queryClient.ensureQueryData(options)
    return { dashboard: undefined }
  },
  head: ({ loaderData }) => {
    const accountCount = loaderData?.dashboard?.summary.accountCount
    return {
      meta: [
        {
          title:
            accountCount === undefined
              ? '余额面板'
              : `余额面板 · ${accountCount} 个账户`,
        },
        {
          name: 'description',
          content:
            '集中查看 AI 订阅账户的余额与额度窗口，全部由服务器渲染。',
        },
      ],
    }
  },
  component: DashboardRoute,
})

function DashboardRoute() {
  const search = Route.useSearch()
  const dashboard = useQuery({
    ...dashboardQueryOptions({ q: search.q }),
    // Keep the previous dataset on screen while a new query string loads, so
    // the page never falls back to a full-page loading state.
    placeholderData: keepPreviousData,
  })

  if (!dashboard.data) {
    // Without any data there is nothing to keep on screen, so an initial
    // failure surfaces through the route error boundary instead of a spinner
    // that never resolves. A failed *background* refetch keeps the last good
    // payload visible (React Query reports error + data at the same time).
    if (dashboard.error) throw dashboard.error
    return <RoutePending />
  }

  return (
    <DashboardPage
      dashboard={dashboard.data}
      search={search}
      updating={dashboard.isFetching}
      stale={dashboard.isPlaceholderData}
    />
  )
}

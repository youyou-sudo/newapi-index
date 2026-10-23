import { QueryClient } from '@tanstack/react-query'
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query'
import { createRouter } from '@tanstack/react-router'
import { DefaultCatchBoundary } from '~/components/default-catch-boundary'
import { NotFound } from '~/components/not-found'
import { RoutePending } from '~/components/route-pending'
import { routeTree } from './routeTree.gen'

export function getRouter() {
  // One QueryClient per router/request: never share a process-wide cache
  // between SSR requests (that could leak one reader's data into another).
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        gcTime: 5 * 60_000,
        retry: 1,
      },
    },
  })

  const router = createRouter({
    routeTree,
    context: { queryClient },
    defaultPreload: 'intent',
    // Let TanStack Query decide whether a preload needs a network read.
    defaultPreloadStaleTime: 0,
    defaultErrorComponent: DefaultCatchBoundary,
    defaultNotFoundComponent: NotFound,
    defaultPendingComponent: RoutePending,
    defaultPendingMinMs: 150,
    scrollRestoration: true,
  })

  // Dehydrates the request's query cache into the SSR document and hydrates it
  // in the browser, so the first client render reuses server data.
  setupRouterSsrQueryIntegration({ router, queryClient })
  return router
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}

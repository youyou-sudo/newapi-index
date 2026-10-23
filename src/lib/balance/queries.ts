import { queryOptions } from '@tanstack/react-query'
import { getDashboard } from './functions'
import type { DashboardQuery } from './schema'

/**
 * Query keys and functions live in one place so the route loader and the
 * component always read the same cache entry.
 *
 * The key only holds the text query: it is the only search state that reaches
 * the server. Status, sort and view are presentation state, so toggling them
 * keeps this cache entry (and never refetches).
 */
export function dashboardQueryOptions(query: DashboardQuery) {
  return queryOptions({
    queryKey: ['dashboard', { q: query.q }] as const,
    queryFn: () => getDashboard({ data: query }),
    staleTime: 30_000,
  })
}

import { queryOptions } from '@tanstack/react-query'
import { getDashboard } from './functions'
import type { DashboardSearch } from './schema'

/**
 * Query keys and functions live in one place so the route loader and the
 * component always read the same cache entry.
 */
export function dashboardQueryOptions(search: DashboardSearch) {
  return queryOptions({
    queryKey: ['dashboard', search] as const,
    queryFn: () => getDashboard({ data: search }),
    staleTime: 30_000,
  })
}


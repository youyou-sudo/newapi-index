import { createServerFn } from '@tanstack/react-start'
import { buildDashboard } from '~/lib/balance/derive'
import { dashboardSearchSchema } from '~/lib/balance/schema'
import { loadBalanceSnapshot } from '~/server/balance.server'

/**
 * Dashboard data for the initial SSR request and for client-side navigations.
 * Input is validated by the same Zod schema as the URL search params.
 */
export const getDashboard = createServerFn({ method: 'GET' })
  .validator(dashboardSearchSchema)
  .handler(async ({ data }) => {
    const snapshot = await loadBalanceSnapshot()
    return buildDashboard(snapshot, data, Date.now())
  })

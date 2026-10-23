import { createServerFn } from '@tanstack/react-start'
import { buildDashboard } from '~/lib/balance/derive'
import { dashboardQuerySchema } from '~/lib/balance/schema'
import { loadBalanceSnapshot } from '~/server/balance.server'

/**
 * Dashboard data for the initial SSR request and for text searches.
 *
 * Only `q` is accepted: status, sort and view are applied in the browser,
 * so changing them must never create a new request.
 */
export const getDashboard = createServerFn({ method: 'GET' })
  .validator(dashboardQuerySchema)
  .handler(async ({ data }) => {
    const snapshot = await loadBalanceSnapshot()
    return buildDashboard(snapshot, data, Date.now())
  })

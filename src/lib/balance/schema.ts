import * as z from 'zod/mini'

/**
 * Schemas come from `zod/mini`: it exposes the same runtime validators as the
 * classic entry with a functional API, and keeps the classic method wrappers out
 * of the browser bundle. Route search params and the server function validator
 * both consume Standard Schema (`~standard`), so TanStack Router / Start do not
 * care which entry the schema came from.
 *
 * Style: modifiers are functions (`z.optional`, `z._default`, `z.catch`,
 * `z.catchall`) and constraints are checks (`.check(z.trim(), z.maxLength(64))`)
 * applied in order.
 */

export const statusFilterSchema = z.enum(['all', 'ok', 'error'])
export const sortSchema = z.enum(['recent', 'usage', 'name', 'reset'])
export const viewSchema = z.enum(['grid', 'list'])

/**
 * Free-text query: trim first, then cap the length. `_default` covers a missing
 * param, the outer `catch` covers tampered values (arrays, numbers, ...).
 */
const queryTextSchema = z.catch(
  z._default(z.string().check(z.trim(), z.maxLength(64)), ''),
  '',
)

/**
 * Route search params are validated here. Invalid or tampered values fall back
 * to safe defaults instead of breaking the route, so links stay shareable.
 * Unknown keys (e.g. the retired `range` filter) are stripped rather than
 * forwarded, so old links keep working and keep the URL clean.
 */
export const dashboardSearchSchema = z.object({
  q: queryTextSchema,
  status: z.catch(z._default(statusFilterSchema, 'all'), 'all'),
  sort: z.catch(z._default(sortSchema, 'recent'), 'recent'),
  view: z.catch(z._default(viewSchema, 'grid'), 'grid'),
})

export type DashboardSearch = z.infer<typeof dashboardSearchSchema>

/**
 * Server function input. Only the free-text query needs the server: status,
 * sort and view are presentation state applied in the browser and must never
 * trigger a new request.
 */
export const dashboardQuerySchema = z.object({
  q: queryTextSchema,
})

export type DashboardQuery = z.infer<typeof dashboardQuerySchema>

export const balanceWindowSchema = z.catchall(
  z.object({
    name: z.string(),
    used: z.optional(z.number()),
    display: z.optional(z.string()),
    limit: z.optional(z.number()),
    unit: z.optional(z.string()),
    runsOutAt: z.optional(z.string()),
    runsOut: z.optional(z.number()),
    resetsAt: z.optional(z.string()),
  }),
  z.unknown(),
)

export const balanceAccountSchema = z.catchall(
  z.object({
    provider: z.string().check(z.minLength(1)),
    name: z.string().check(z.minLength(1)),
    icon: z.optional(z.string()),
    plan: z.optional(z.string()),
    user: z.optional(z.string()),
    windows: z._default(z.array(balanceWindowSchema), []),
    error: z.optional(z.string()),
    pluginError: z.optional(z.boolean()),
    balance: z.optional(z.string()),
    until: z.optional(z.string()),
    renew: z.optional(z.string()),
    readAt: z.optional(z.string()),
    kind: z.optional(z.string()),
  }),
  z.unknown(),
)

export const balancesResponseSchema = z.object({
  data: z.array(balanceAccountSchema),
  object: z.optional(z.string()),
})

export type ParsedBalancesResponse = z.infer<typeof balancesResponseSchema>

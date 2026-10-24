import * as z from 'zod/mini'

/**
 * Server-side schemas: the balance API response shape and the server function
 * input. Nothing in this module is needed to render or validate the URL, so it
 * must only ever be reached from server code paths; browser-side search parsing
 * lives in `./search` and is dependency free.
 *
 * Schemas come from `zod/mini`: it exposes the same runtime validators as the
 * classic entry with a functional API, and keeps the classic method wrappers out
 * of the bundle. The server function validator consumes Standard Schema
 * (`~standard`), so TanStack Start does not care which entry the schema came
 * from.
 *
 * Style: modifiers are functions (`z.optional`, `z._default`, `z.catch`,
 * `z.catchall`) and constraints are checks (`.check(z.trim(), z.maxLength(64))`)
 * applied in order.
 */

/**
 * Free-text query, kept in sync with `parseQueryText` in `./search`: trim
 * first, then cap the length. `_default` covers a missing param, the outer
 * `catch` covers tampered values (arrays, numbers, ...).
 */
const queryTextSchema = z.catch(
  z._default(z.string().check(z.trim(), z.maxLength(64)), ''),
  '',
)

/**
 * Server function input. Only the free-text query needs the server: status,
 * sort and view are presentation state applied in the browser and must never
 * trigger a new request.
 */
export const dashboardQuerySchema = z.object({
  q: queryTextSchema,
})

// The search types are declared in the dependency-free `./search` module so
// component code (and the route validator) never has to import this file.
// Re-exported here to keep the existing `~/lib/balance/schema` type imports
// working.
export type { DashboardQuery, DashboardSearch } from './search'

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

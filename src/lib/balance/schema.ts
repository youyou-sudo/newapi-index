import { z } from 'zod'

export const statusFilterSchema = z.enum(['all', 'ok', 'error'])
export const sortSchema = z.enum(['recent', 'usage', 'name', 'reset'])
export const rangeSchema = z.enum(['7d', '14d', '30d'])
export const viewSchema = z.enum(['grid', 'list'])

/**
 * Route search params are validated here. Invalid or tampered values fall back
 * to safe defaults instead of breaking the route, so links stay shareable.
 */
export const dashboardSearchSchema = z.object({
  q: z.string().trim().max(64).default('').catch(''),
  status: statusFilterSchema.default('all').catch('all'),
  sort: sortSchema.default('recent').catch('recent'),
  range: rangeSchema.default('14d').catch('14d'),
  view: viewSchema.default('grid').catch('grid'),
})

export type DashboardSearch = z.infer<typeof dashboardSearchSchema>

export const balanceWindowSchema = z
  .object({
    name: z.string(),
    used: z.number().optional(),
    display: z.string().optional(),
    limit: z.number().optional(),
    unit: z.string().optional(),
    runsOutAt: z.string().optional(),
    runsOut: z.number().optional(),
    resetsAt: z.string().optional(),
  })
  .catchall(z.unknown())

export const balanceDaySchema = z.object({
  day: z.string(),
  used: z.number(),
})

export const balanceAccountSchema = z
  .object({
    provider: z.string().min(1),
    name: z.string().min(1),
    icon: z.string().optional(),
    plan: z.string().optional(),
    user: z.string().optional(),
    windows: z.array(balanceWindowSchema).default([]),
    error: z.string().optional(),
    pluginError: z.boolean().optional(),
    daily: z
      .object({
        since: z.string(),
        days: z.array(balanceDaySchema).default([]),
      })
      .optional(),
    balance: z.string().optional(),
    until: z.string().optional(),
    renew: z.string().optional(),
    readAt: z.string().optional(),
    kind: z.string().optional(),
  })
  .catchall(z.unknown())

export const balancesResponseSchema = z.object({
  data: z.array(balanceAccountSchema),
  object: z.string().optional(),
})

export type ParsedBalancesResponse = z.infer<typeof balancesResponseSchema>
/**
 * URL search params for the dashboard, parsed without any runtime dependency.
 *
 * The route validator runs in the browser on every navigation, so it must stay
 * tiny: a schema library here would pull its whole validator runtime into the
 * client entry chunk to check four strings. The server keeps using the zod
 * schema in `./schema`; the semantics of both are pinned together by
 * `__tests__/search.test.ts`.
 */

export const STATUS_VALUES = ['all', 'ok', 'error'] as const
export const SORT_VALUES = ['recent', 'usage', 'name', 'reset'] as const
export const VIEW_VALUES = ['grid', 'list'] as const

export type DashboardStatus = (typeof STATUS_VALUES)[number]
export type DashboardSort = (typeof SORT_VALUES)[number]
export type DashboardView = (typeof VIEW_VALUES)[number]

export interface DashboardSearch {
  q: string
  status: DashboardStatus
  sort: DashboardSort
  view: DashboardView
}

/** Server function input: only the free-text query reaches the server. */
export interface DashboardQuery {
  q: string
}

/** Mirrors `z.maxLength(64)` applied after `z.trim()` in the server schema. */
const MAX_QUERY_LENGTH = 64

function parseQueryText(value: unknown): string {
  // A missing param is the empty query. Anything that is not a string (an
  // array from `?q=a&q=b`, a number from `?q=42`) is treated the same way
  // instead of throwing, so a tampered link can never break the route.
  if (typeof value !== 'string') return ''

  const trimmed = value.trim()
  // An over-long query falls back to the empty one (it is not truncated):
  // the server would otherwise search a silently cut-off term.
  if (trimmed.length > MAX_QUERY_LENGTH) return ''

  return trimmed
}

function parseEnum<T extends string>(
  value: unknown,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  if (typeof value !== 'string') return fallback
  for (const candidate of allowed) {
    if (candidate === value) return candidate
  }
  return fallback
}

/**
 * Route search params. Invalid or tampered values fall back to safe defaults
 * instead of breaking the route, so links stay shareable. Unknown keys (e.g.
 * the retired `range` filter) are dropped from the returned object, so they
 * are stripped from canonical URLs rather than forwarded.
 */
export function parseDashboardSearch(
  raw: Record<string, unknown>,
): DashboardSearch {
  return {
    q: parseQueryText(raw?.q),
    status: parseEnum(raw?.status, STATUS_VALUES, 'all'),
    sort: parseEnum(raw?.sort, SORT_VALUES, 'recent'),
    view: parseEnum(raw?.view, VIEW_VALUES, 'grid'),
  }
}

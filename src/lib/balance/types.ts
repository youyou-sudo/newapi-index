/**
 * Wire format returned by the intranet balance API.
 * The API is intranet-only, so these types are shared for display and tests
 * but data is only ever fetched on the server.
 */
export interface BalanceWindow {
  name: string
  used?: number
  display?: string
  limit?: number
  unit?: string
  runsOutAt?: string
  runsOut?: number
  resetsAt?: string
}

export interface BalanceDay {
  day: string
  used: number
}

export interface BalanceDaily {
  since: string
  days: Array<BalanceDay>
}

export interface BalanceAccount {
  provider: string
  name: string
  icon?: string
  plan?: string
  user?: string
  windows: Array<BalanceWindow>
  error?: string
  pluginError?: boolean
  daily?: BalanceDaily
  balance?: string
  until?: string
  renew?: string
  readAt?: string
  kind?: string
}

export interface BalanceBalancesResponse {
  data: Array<BalanceAccount>
  object?: string
}

export type BalanceSourceMode = 'live' | 'fixture'

export interface SourceInfo {
  mode: BalanceSourceMode
  fetchedAt: string
  ttlSeconds: number
  cache: 'hit' | 'miss' | 'fixture' | 'stale'
  warning: string | null
}

export interface WindowView {
  name: string
  display: string
  used: number | null
  limit: number | null
  unit: string | null
  ratio: number | null
  percent: number | null
  remaining: number | null
  resetAt: string | null
  resetInSeconds: number | null
}

export interface DayView {
  day: string
  used: number
  weekday: string
}

export interface AccountView {
  id: string
  provider: string
  name: string
  icon: string | null
  plan: string | null
  user: string | null
  kind: string
  status: 'ok' | 'error'
  error: string | null
  pluginError: boolean
  balance: string | null
  until: string | null
  renew: string | null
  readAt: string | null
  windows: Array<WindowView>
  daily: {
    since: string | null
    days: Array<DayView>
    total: number
    activeDays: number
    peak: DayView | null
  }
  usedToday: number
  usagePercent: number | null
  remainingPercent: number | null
  nextResetAt: string | null
  nextResetInSeconds: number | null
}

export interface DashboardSummary {
  accountCount: number
  providerCount: number
  errorCount: number
  warningCount: number
  windowCount: number
  trackedDays: number
  trackedUsage: number
  nextResetAt: string | null
}

export interface DashboardPayload {
  generatedAt: string
  source: SourceInfo
  summary: DashboardSummary
  accounts: Array<AccountView>
  filters: DashboardFilters
  totalAccountsBeforeFilter: number
}

export interface DashboardFilters {
  q: string
  status: 'all' | 'ok' | 'error'
  sort: 'recent' | 'usage' | 'name' | 'reset'
  range: '7d' | '14d' | '30d'
  view: 'grid' | 'list'
}

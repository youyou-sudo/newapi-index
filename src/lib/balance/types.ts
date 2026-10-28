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

export interface BalanceAccount {
  provider: string
  name: string
  icon?: string
  plan?: string
  user?: string
  windows: Array<BalanceWindow>
  error?: string
  pluginError?: boolean
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
  /**
   * 这份账号数据里的 user 字段是否已经解除了打码（本机调试）。
   *
   * 生产构建里恒为 false：账号身份在服务端就抹成 ***，浏览器里没有原始值。
   */
  revealed: boolean
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
  nextResetAt: string | null
}

export interface DashboardPayload {
  generatedAt: string
  source: SourceInfo
  summary: DashboardSummary
  /** Accounts matching the server-side text query, in data-source order. */
  accounts: Array<AccountView>
  /** Every account the data source returned, before the text query. */
  totalAccounts: number
}

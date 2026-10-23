import {
  maskAccountIdentifier,
  parseDisplayNumbers,
} from '~/lib/balance/format'
import type {
  AccountView,
  DashboardPayload,
  DashboardSummary,
  BalanceAccount,
  BalanceWindow,
  SourceInfo,
  WindowView,
} from '~/lib/balance/types'
import type { DashboardQuery, DashboardSearch } from '~/lib/balance/schema'

export interface BalanceSnapshot {
  accounts: Array<BalanceAccount>
  source: SourceInfo
}

function userFingerprint(value: string | null | undefined): string {
  const input = value?.trim() || 'default'
  let hash = 0x811c9dc5
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36)
}

export function accountKey(account: BalanceAccount): string {
  return `${account.provider}::${userFingerprint(account.user)}`
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value))
}

function toEpoch(iso: string | undefined | null): number | null {
  if (!iso) return null
  const value = new Date(iso).getTime()
  return Number.isNaN(value) ? null : value
}

export function toWindowView(window: BalanceWindow, nowMs: number): WindowView {
  const resetAt = window.resetsAt ?? window.runsOutAt ?? null
  const resetMs = toEpoch(resetAt)
  const resetInSeconds =
    resetMs === null ? null : Math.max(0, Math.round((resetMs - nowMs) / 1000))

  // The display string is the API's canonical rendering (it already applies
  // unit scaling such as "50k"). Prefer it so ratio math stays unit-safe.
  const parsed = parseDisplayNumbers(window.display)
  const used = parsed?.[0] ?? (typeof window.used === 'number' ? window.used : null)
  const limit = parsed?.[1] ?? (typeof window.limit === 'number' ? window.limit : null)

  const ratio =
    used !== null && limit !== null && limit > 0
      ? Math.min(1, Math.max(0, used / limit))
      : null
  const percent = ratio === null ? null : clampPercent(ratio * 100)

  return {
    name: window.name,
    display:
      window.display ??
      (used !== null && limit !== null
        ? `${used} / ${limit}`
        : '未提供额度'),
    used,
    limit,
    unit: window.unit ?? null,
    ratio,
    percent,
    remaining:
      used !== null && limit !== null && limit > 0
        ? Math.max(0, limit - used)
        : null,
    resetAt,
    resetInSeconds,
  }
}

export function toAccountView(account: BalanceAccount, nowMs: number): AccountView {
  const windows = account.windows.map((window) => toWindowView(window, nowMs))
  const rated = windows.filter(
    (window): window is WindowView & { percent: number } => window.percent !== null,
  )
  const usagePercent =
    rated.length === 0
      ? null
      : clampPercent(
          Math.max(...rated.map((window) => window.percent)),
        )

  const resets = windows
    .map((window) => window.resetInSeconds)
    .filter((value): value is number => value !== null)
  const nextResetInSeconds = resets.length > 0 ? Math.min(...resets) : null

  return {
    id: accountKey(account),
    provider: account.provider,
    name: account.name,
    icon: account.icon ?? null,
    plan: account.plan ?? null,
    user: maskAccountIdentifier(account.user),
    kind: account.kind ?? 'subscription',
    status: account.error ? 'error' : 'ok',
    error: account.error ?? null,
    pluginError: account.pluginError ?? false,
    balance: account.balance ?? null,
    until: account.until ?? null,
    renew: account.renew ?? null,
    readAt: account.readAt ?? null,
    windows,
    usagePercent,
    remainingPercent: usagePercent === null ? null : clampPercent(100 - usagePercent),
    nextResetAt:
      windows
        .map((window) => window.resetAt)
        .filter((value): value is string => Boolean(value))
        .sort()[0] ?? null,
    nextResetInSeconds,
  }
}

export function summarize(accounts: Array<AccountView>): DashboardSummary {
  const providers = new Set(accounts.map((account) => account.provider))
  let windowCount = 0
  for (const account of accounts) {
    windowCount += account.windows.length
  }

  const now = Date.now()
  const resets = accounts
    .flatMap((account) => account.windows.map((window) => window.resetAt))
    .filter((value): value is string => Boolean(value))
    .filter((value) => {
      const time = toEpoch(value)
      return time !== null && time > now
    })
    .sort()

  return {
    accountCount: accounts.length,
    providerCount: providers.size,
    errorCount: accounts.filter((account) => account.status === 'error').length,
    warningCount: accounts.filter(
      (account) => account.usagePercent !== null && account.usagePercent >= 80,
    ).length,
    windowCount,
    nextResetAt: resets[0] ?? null,
  }
}

/**
 * Free-text search over the fields the toolbar exposes. The raw user value is
 * never available here: it is masked before it reaches this module.
 */
export function searchAccounts(
  accounts: Array<AccountView>,
  query: string,
): Array<AccountView> {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return accounts
  return accounts.filter((account) =>
    [
      account.name,
      account.provider,
      account.plan ?? '',
      account.user ?? '',
      account.kind,
    ]
      .join(' ')
      .toLocaleLowerCase()
      .includes(needle),
  )
}

/**
 * Status is a local string filter: "all" already contains "ok" and "error", so
 * switching tabs must never ask the server for a new dataset.
 */
export function filterByStatus(
  accounts: Array<AccountView>,
  status: DashboardSearch['status'],
): Array<AccountView> {
  if (status === 'all') return accounts
  return accounts.filter((account) => account.status === status)
}

/** Returns a sorted copy so cached payloads are never mutated. */
export function sortAccounts(
  accounts: Array<AccountView>,
  sort: DashboardSearch['sort'],
): Array<AccountView> {
  return accounts.slice().sort((a, b) => {
    switch (sort) {
      case 'usage':
        return (b.usagePercent ?? -1) - (a.usagePercent ?? -1)
      case 'name':
        return a.name.localeCompare(b.name, 'zh-CN')
      case 'reset':
        return (
          (a.nextResetInSeconds ?? Number.POSITIVE_INFINITY) -
          (b.nextResetInSeconds ?? Number.POSITIVE_INFINITY)
        )
      case 'recent':
      default: {
        const aRead = toEpoch(a.readAt) ?? 0
        const bRead = toEpoch(b.readAt) ?? 0
        if (aRead !== bRead) return bRead - aRead
        return a.name.localeCompare(b.name, 'zh-CN')
      }
    }
  })
}

/**
 * Presentation filters for one render. The server only narrows by the text
 * query, so everything else is a pure function of the payload plus the URL
 * search state: toggling status/sort/view never refetches.
 */
export function applyDashboardFilters(
  accounts: Array<AccountView>,
  search: DashboardSearch,
): Array<AccountView> {
  const matched = searchAccounts(accounts, search.q)
  return sortAccounts(filterByStatus(matched, search.status), search.sort)
}

/**
 * Builds the payload for one server request. Only `q` reaches the server;
 * status, sort and view are applied by the browser.
 */
export function buildDashboard(
  snapshot: BalanceSnapshot,
  query: DashboardQuery,
  nowMs: number,
): DashboardPayload {
  const all = snapshot.accounts.map((account) => toAccountView(account, nowMs))

  return {
    generatedAt: new Date(nowMs).toISOString(),
    source: snapshot.source,
    summary: summarize(all),
    accounts: searchAccounts(all, query.q),
    totalAccounts: all.length,
  }
}

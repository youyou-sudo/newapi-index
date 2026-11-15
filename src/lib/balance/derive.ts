import {
  formatQuotaPair,
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

function ratioOf(used: number, limit: number): number | null {
  if (!Number.isFinite(used) || !Number.isFinite(limit) || limit <= 0) return null
  return Math.min(1, Math.max(0, used / limit))
}

/**
 * `display` 有两种口径：多数窗口是“已用 / 总量”，DeepAI 这类返回的是
 * “剩余 / 总量”（同时带 `text: true`）。按字面当已用算，会把“剩 193 / 193”
 * 画成 100% 的红条——这正是卡片看起来“数字和进度条互相打架”的原因。
 */
const REMAINING_DISPLAY = /^\s*(?:剩|剩余|剩餘|remaining|left)(?:\s|$)/i

function isRemainingDisplay(window: BalanceWindow): boolean {
  if (window.text === true) return true
  return REMAINING_DISPLAY.test(window.display ?? '')
}

interface WindowAmounts {
  used: number | null
  limit: number | null
  ratio: number | null
}

/**
 * 归一化一个窗口的用量。优先级：display（API 的规范渲染，单位已经缩放）>
 * amount（绝对量）> used（百分比口径，见 types.ts）。
 */
function resolveAmounts(window: BalanceWindow): WindowAmounts {
  const parsed = parseDisplayNumbers(window.display)
  if (parsed) {
    const [first, total] = parsed
    const used = isRemainingDisplay(window)
      ? Math.max(0, total - first)
      : first
    const ratio = ratioOf(used, total)
    return { used, limit: total, ratio }
  }

  const limit = typeof window.limit === 'number' ? window.limit : null
  if (limit !== null && limit > 0 && typeof window.amount === 'number') {
    return { used: window.amount, limit, ratio: ratioOf(window.amount, limit) }
  }

  if (typeof window.used === 'number') {
    // `used` 是“已用百分比”（0–100），不是绝对量：没有 display 时只能当百分比
    // 用，不能拿它去除 limit（73.48 / 4849 会变成 1.5%）。
    const ratio =
      window.used <= 100 ? Math.min(1, Math.max(0, window.used / 100)) : null
    if (ratio === null) {
      return {
        used: window.used,
        limit,
        ratio: limit !== null ? ratioOf(window.used, limit) : null,
      }
    }
    return {
      used: limit !== null ? ratio * limit : null,
      limit,
      ratio,
    }
  }

  return { used: null, limit, ratio: null }
}

function resolveReset(window: BalanceWindow): {
  resetAt: string | null
  resetKind: WindowView['resetKind']
} {
  // resetsAt 是周期性重置，runsOutAt 是额度到期：两者文案不同，不能混着说“重置”。
  if (window.resetsAt) return { resetAt: window.resetsAt, resetKind: 'reset' }
  if (window.runsOutAt) return { resetAt: window.runsOutAt, resetKind: 'expires' }
  return { resetAt: null, resetKind: null }
}

/**
 * 上游只有一部分窗口带 `unit`：Open Design 把单位写在 display 末尾
 * （“0 / 50k credits”），token 窗口只把单位写在名字里。少了这一层，
 * 卡片上的“0 / 50k”就没有任何单位可言。
 */
const DISPLAY_UNIT_TAIL = /(?:^|[\s/])([A-Za-z][A-Za-z0-9._-]*)\s*$/

function inferUnit(window: BalanceWindow, limit: number | null): string | null {
  if (window.unit) return window.unit
  const tail = DISPLAY_UNIT_TAIL.exec(window.display?.trim() ?? '')?.[1]
  if (tail) return tail
  if (/tokens?/i.test(window.name) && limit !== null && limit >= 10_000) return 'tokens'
  return null
}

/** One quota window as the UI needs it: numbers resolved, display never empty. */
export function toWindowView(window: BalanceWindow, nowMs: number): WindowView {
  const { resetAt, resetKind } = resolveReset(window)
  const resetMs = toEpoch(resetAt)
  const resetInSeconds =
    resetMs === null ? null : Math.max(0, Math.round((resetMs - nowMs) / 1000))

  const { used, limit, ratio } = resolveAmounts(window)
  const percent = ratio === null ? null : clampPercent(ratio * 100)
  const unit = inferUnit(window, limit)

  // 统一口径：一律显示“已用 / 总量”，不再把上游的“剩 N / N”原样贴在一个
  // 100% 的进度条旁边。算不出总量时才退回上游原文。
  const display =
    formatQuotaPair(used, limit, unit) ?? window.display?.trim() ?? '未提供额度'

  return {
    name: window.name,
    display,
    used,
    limit,
    unit,
    ratio,
    percent,
    remaining:
      used !== null && limit !== null && limit > 0
        ? Math.max(0, limit - used)
        : null,
    resetAt,
    resetKind,
    resetInSeconds,
  }
}

export interface RevealOptions {
  /** true 时保留原始账号身份（仅本机调试）：生产路径永远走打码分支。 */
  reveal?: boolean
}

function displayUser(user: string | null | undefined, reveal: boolean): string | null {
  if (!reveal) return maskAccountIdentifier(user)
  const trimmed = user?.trim()
  return trimmed ? trimmed : null
}

export function toAccountView(
  account: BalanceAccount,
  nowMs: number,
  options: RevealOptions = {},
): AccountView {
  const reveal = options.reveal === true
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
    user: displayUser(account.user, reveal),
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
      case 'reset':
        return (
          (a.nextResetInSeconds ?? Number.POSITIVE_INFINITY) -
          (b.nextResetInSeconds ?? Number.POSITIVE_INFINITY)
        )
      case 'recent': {
        const aRead = toEpoch(a.readAt) ?? 0
        const bRead = toEpoch(b.readAt) ?? 0
        if (aRead !== bRead) return bRead - aRead
        return a.name.localeCompare(b.name, 'zh-CN')
      }
      case 'name':
      default:
        // 与 URL 默认值一致：未知值也按名称排序。
        return a.name.localeCompare(b.name, 'zh-CN')
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
  options: RevealOptions = {},
): DashboardPayload {
  const all = snapshot.accounts.map((account) => toAccountView(account, nowMs, options))

  return {
    generatedAt: new Date(nowMs).toISOString(),
    source: snapshot.source,
    summary: summarize(all),
    accounts: searchAccounts(all, query.q),
    totalAccounts: all.length,
  }
}

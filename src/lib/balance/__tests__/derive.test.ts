import { describe, expect, it } from 'vitest'
import {
  applyDashboardFilters,
  buildDashboard,
  filterByStatus,
  searchAccounts,
  toAccountView,
  toWindowView,
} from '../derive'
import {
  formatDuration,
  maskAccountIdentifier,
  parseDisplayNumbers,
} from '../format'
import { relayAuthorizationHeader } from '../auth'
import type { BalanceSnapshot } from '../derive'
import type { BalanceAccount } from '../types'

const NOW = Date.parse('2026-10-23T04:00:00Z')

const accounts: Array<BalanceAccount> = [
  {
    provider: 'workbuddy',
    name: 'WorkBuddy',
    plan: 'Free',
    user: '130****0136',
    windows: [],
    error: 'Unauthorized',
    pluginError: true,
    kind: 'subscription',
  },
  {
    provider: 'workbuddy-ai',
    name: 'WorkBuddy AI',
    plan: 'Free',
    user: 'lityouyou',
    windows: [
      {
        name: 'Credits',
        used: 0,
        display: '0 / 350',
        limit: 350,
        unit: 'credits',
        runsOutAt: '2026-11-03T07:22:58Z',
        runsOut: 250,
      },
    ],
    readAt: '2026-10-23T04:52:59.034666952Z',
    kind: 'subscription',
  },
  {
    provider: 'opendesign',
    name: 'Open Design',
    plan: 'Design Plan Go',
    user: 'xiao.youyou@outlook.com',
    windows: [
      {
        name: '5 hours',
        used: 0.5,
        resetsAt: '2026-10-23T05:02:05.042Z',
        display: '257 / 50k credits',
      },
      {
        name: '7 days',
        used: 9,
        resetsAt: '2026-10-27T12:02:05.042Z',
        display: '13.5k / 150k credits',
      },
    ],
    balance: '$1.00',
    until: '2026-11-12T10:45:44Z',
    renew: 'auto',
    readAt: '2026-10-23T04:52:58.246664423Z',
    kind: 'subscription',
  },
]

const snapshot: BalanceSnapshot = {
  accounts,
  source: {
    mode: 'fixture',
    fetchedAt: new Date(NOW).toISOString(),
    ttlSeconds: 30,
    cache: 'fixture',
    warning: null,
  },
}

describe('relay station authentication', () => {
  it('defaults to the Bearer scheme for a raw relay API key', () => {
    expect(relayAuthorizationHeader('sk-relay-123')).toBe(
      'Bearer sk-relay-123',
    )
  })

  it('does not double-prefix an already Bearer-prefixed key', () => {
    expect(relayAuthorizationHeader('Bearer sk-relay-123')).toBe(
      'Bearer sk-relay-123',
    )
  })
})

describe('account identifier masking', () => {
  it('masks emails, usernames and phone numbers', () => {
    expect(maskAccountIdentifier('myxiaoyouyou@gmail.com')).toBe('***')
    expect(maskAccountIdentifier('xiao.youyou@outlook.com')).toBe('***')
    expect(maskAccountIdentifier('lityouyou')).toBe('***')
    expect(maskAccountIdentifier('130****0136')).toBe('***')
    expect(maskAccountIdentifier('')).toBeNull()
  })

  it('never exposes the raw user in the account view', () => {
    const view = toAccountView(accounts[1]!, NOW)
    expect(view.user).toBe('***')
    expect(view.user).not.toContain('lityouyou')
    expect(view.id).not.toContain('lityouyou')
    expect(view.name).toBe('WorkBuddy AI')
  })
})

describe('formatNumber helpers', () => {
  it('parses display strings with unit suffixes', () => {
    expect(parseDisplayNumbers('0 / 350')).toEqual([0, 350])
    expect(parseDisplayNumbers('257 / 50k credits')).toEqual([257, 50_000])
    expect(parseDisplayNumbers('13.5k / 150k credits')).toEqual([13_500, 150_000])
    expect(parseDisplayNumbers('no numbers')).toBeNull()
  })

  it('formats durations for countdown labels', () => {
    expect(formatDuration(90_061)).toBe('1 天 1 小时')
    expect(formatDuration(3_600)).toBe('1 小时 0 分')
    expect(formatDuration(0)).toBe('已到重置时间')
  })
})

describe('account derivation', () => {
  it('derives percentages from the canonical display string', () => {
    const view = toWindowView(accounts[2]!.windows[0]!, NOW)
    expect(view.percent).toBeCloseTo(0.514, 2)
    expect(view.remaining).toBe(49_743)
  })

  it('marks accounts with API errors and keeps an empty window list', () => {
    const view = toAccountView(accounts[0]!, NOW)
    expect(view.status).toBe('error')
    expect(view.error).toBe('Unauthorized')
    expect(view.windows).toHaveLength(0)
    expect(view.usagePercent).toBeNull()
  })

  it('computes reset countdowns in seconds', () => {
    const view = toAccountView(accounts[1]!, NOW)
    expect(view.usagePercent).toBe(0)
    expect(view.remainingPercent).toBe(100)
    expect(view.nextResetInSeconds).toBeGreaterThan(0)
  })

  it('filters and sorts accounts in the browser', () => {
    const views = accounts.map((account) => toAccountView(account, NOW))

    // Status is a plain string filter over the payload the server returned.
    const errors = filterByStatus(views, 'error')
    expect(errors.map((account) => account.name)).toEqual(['WorkBuddy'])
    expect(filterByStatus(views, 'all')).toHaveLength(3)

    // Search and sorting never touch the network either.
    expect(searchAccounts(views, 'open').map((account) => account.name)).toEqual([
      'Open Design',
    ])
    const byUsage = [...views].sort(
      (a, b) => (b.usagePercent ?? -1) - (a.usagePercent ?? -1),
    )
    expect(byUsage[0]!.name).toBe('Open Design')

    const filtered = applyDashboardFilters(views, {
      q: '',
      status: 'error',
      sort: 'recent',
      view: 'grid',
    })
    expect(filtered.map((account) => account.name)).toEqual(['WorkBuddy'])
    // Presentation toggles return new arrays and never mutate the payload.
    expect(views).toHaveLength(3)
  })
})

describe('payload builders', () => {
  it('builds a dashboard summary from the full snapshot', () => {
    const payload = buildDashboard(snapshot, { q: '' }, NOW)
    expect(payload.summary.accountCount).toBe(3)
    expect(payload.summary.providerCount).toBe(3)
    expect(payload.summary.errorCount).toBe(1)
    expect(payload.summary.windowCount).toBe(3)
    expect(payload.accounts).toHaveLength(3)
    expect(payload.totalAccounts).toBe(3)

    // The server payload only narrows by the text query.
    const searched = buildDashboard(snapshot, { q: 'open' }, NOW)
    expect(searched.accounts.map((account) => account.name)).toEqual([
      'Open Design',
    ])
    expect(searched.totalAccounts).toBe(3)
    expect(searched.summary.accountCount).toBe(3)
  })
})

import { describe, expect, it } from 'vitest'
import {
  applyDashboardFilters,
  buildDashboard,
  filterByStatus,
  searchAccounts,
  sortAccounts,
  toAccountView,
  toWindowView,
} from '../derive'
import {
  formatAge,
  formatDuration,
  formatPercent,
  formatQuotaNumber,
  formatQuotaPair,
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
    revealed: false,
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
    // 等字数：星号数量等于原文长度（固定三字只用于极短字符串）。
    expect(maskAccountIdentifier('abc')).toBe('***')
    const sample = accounts[2]!.user ?? ''
    expect(maskAccountIdentifier(sample)).toHaveLength(sample.length)
    expect(maskAccountIdentifier('myxiaoyouyou@gmail.com')).toMatch(/^\*+$/)
    expect(maskAccountIdentifier('xiao.youyou@outlook.com')).toMatch(/^\*+$/)
    expect(maskAccountIdentifier('lityouyou')).toMatch(/^\*+$/)
    expect(maskAccountIdentifier('130****0136')).toMatch(/^\*+$/)
    expect(maskAccountIdentifier('')).toBeNull()
  })

  it('never exposes the raw user in the account view', () => {
    const view = toAccountView(accounts[1]!, NOW)
    expect(view.user).toMatch(/^\*+$/)
    expect(view.user).not.toContain('lityouyou')
    expect(view.id).not.toContain('lityouyou')
    expect(view.name).toBe('WorkBuddy AI')
  })

  it('only reveals the raw user when the debug switch asks for it', () => {
    const account = accounts[2]!
    const raw = account.user ?? ''
    // 生产路径（默认）永远打码。
    expect(toAccountView(account, NOW).user).toMatch(/^\*+$/)
    // 本机调试：保留原始身份，但账户 id 仍然只是 provider::hash。
    const revealed = toAccountView(account, NOW, { reveal: true })
    expect(revealed.user).toBe(raw)
    expect(revealed.id).not.toContain(raw)
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

  it('formats data ages for the live freshness label', () => {
    expect(formatAge(0)).toBe('刚刚更新')
    expect(formatAge(4)).toBe('刚刚更新')
    expect(formatAge(12)).toBe('12 秒前更新')
    expect(formatAge(90)).toBe('1 分钟前更新')
    expect(formatAge(7_200)).toBe('2 小时前更新')
    expect(formatAge(null)).toBe('—')
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
      sort: 'name',
      view: 'grid',
    })
    expect(filtered.map((account) => account.name)).toEqual(['WorkBuddy'])
    // Presentation toggles return new arrays and never mutate the payload.
    expect(views).toHaveLength(3)
  })

  it('sorts by name by default and by read time on demand', () => {
    const views = accounts.map((account) => toAccountView(account, NOW))
    const names = (list: Array<{ name: string }>) => list.map((account) => account.name)

    // 名称：默认排序，未知排序值也走这条分支。
    expect(names(sortAccounts(views, 'name'))).toEqual([
      'Open Design',
      'WorkBuddy',
      'WorkBuddy AI',
    ])
    // 最近读取：按 readAt 倒序，没有 readAt 的账户排在最后。
    expect(names(sortAccounts(views, 'recent'))).toEqual([
      'WorkBuddy AI',
      'Open Design',
      'WorkBuddy',
    ])
    expect(views.map((account) => account.name)).toEqual([
      'WorkBuddy',
      'WorkBuddy AI',
      'Open Design',
    ])
  })
})

describe('quota window normalisation', () => {
  it('reads a remaining-style display as remaining, not as used', () => {
    // DeepAI 返回 “剩 193 / 193 theos” + text:true：这里一个额度都没用掉，
    // 卡片却曾经因为按字面求商而画出 100% 的红条。
    const untouched = toWindowView(
      {
        name: '今日 Theos',
        used: 0,
        limit: 193,
        unit: 'theos',
        display: '剩 193 / 193 theos',
        text: true,
      },
      NOW,
    )
    expect(untouched.percent).toBe(0)
    expect(untouched.remaining).toBe(193)
    expect(untouched.display).toBe('0 / 193 theos')

    const usedSome = toWindowView(
      { name: '今日 Theos', limit: 193, display: '剩 45 / 193 theos', text: true },
      NOW,
    )
    expect(usedSome.percent).toBeCloseTo(76.68, 2)
    expect(usedSome.remaining).toBe(45)
  })

  it('uses the absolute amount when the display string is missing', () => {
    // `used` 是百分比、`amount` 才是绝对量：拿 used 去除 limit 会算出 1.5%。
    const view = toWindowView(
      { name: 'Extra credits', used: 73.4805114, amount: 3563.07, limit: 4849 },
      NOW,
    )
    expect(view.percent).toBeCloseTo(73.48, 2)
    expect(view.used).toBeCloseTo(3563.07, 2)
    expect(view.display).toBe('3,563 / 4,849')
  })

  it('treats a display-less `used` as an already-computed percentage', () => {
    const view = toWindowView({ name: 'Credits', used: 73.48, limit: 4849 }, NOW)
    expect(view.percent).toBeCloseTo(73.48, 2)
    expect(view.used).toBeCloseTo(3563.07, 1)
  })

  it('distinguishes a periodic reset from the quota expiring', () => {
    const expiring = toWindowView(
      { name: 'Extra credits', limit: 100, display: '0 / 100', runsOutAt: '2026-10-24T04:00:00Z' },
      NOW,
    )
    expect(expiring.resetKind).toBe('expires')
    expect(expiring.resetAt).toBe('2026-10-24T04:00:00Z')
    expect(expiring.resetInSeconds).toBe(86_400)

    const resetting = toWindowView(
      { name: 'Credits', limit: 100, display: '0 / 100', resetsAt: '2026-10-23T05:00:00Z' },
      NOW,
    )
    expect(resetting.resetKind).toBe('reset')
  })

  it('fills in the unit the upstream string or window name implies', () => {
    // display 末尾的 “credits” 是唯一单位来源（opendesign 的窗口没有 unit 字段）。
    expect(
      toWindowView({ name: '5 hours', display: '0 / 50k credits' }, NOW).unit,
    ).toBe('credits')
    // token 窗口没有 unit，只在名字里写了 tokens。
    expect(
      toWindowView(
        { name: 'deepseek-v4.1-flash tokens (est.)', limit: 200_000_000 },
        NOW,
      ).unit,
    ).toBe('tokens')
    expect(
      toWindowView({ name: '今日 Theos', display: '剩 1 / 193 theos', text: true }, NOW)
        .unit,
    ).toBe('theos')
  })

  it('never returns an empty display string', () => {
    expect(toWindowView({ name: 'mystery' }, NOW).display).toBe('未提供额度')
  })
})

describe('quota number formatting', () => {
  it('scales large quota values and keeps small ones exact', () => {
    expect(formatQuotaNumber(0)).toBe('0')
    expect(formatQuotaNumber(193)).toBe('193')
    expect(formatQuotaNumber(1234)).toBe('1,234')
    expect(formatQuotaNumber(3563.07)).toBe('3,563')
    expect(formatQuotaNumber(50_000)).toBe('50k')
    expect(formatQuotaNumber(150_000)).toBe('150k')
    expect(formatQuotaNumber(1_078_254)).toBe('1.1M')
    expect(formatQuotaNumber(200_000_000)).toBe('200M')
    expect(formatQuotaNumber(Number.NaN)).toBe('—')
  })

  it('builds a "used / limit unit" pair and skips it when unknown', () => {
    expect(formatQuotaPair(0, 50_000, 'credits')).toBe('0 / 50k credits')
    expect(formatQuotaPair(1_078_254, 200_000_000, 'tokens')).toBe(
      '1.1M / 200M tokens',
    )
    expect(formatQuotaPair(null, 50_000, 'credits')).toBeNull()
    expect(formatQuotaPair(1, null, 'credits')).toBeNull()
  })

  it('rounds percentages to one decimal so cards stay comparable', () => {
    expect(formatPercent(30.938)).toBe('30.9%')
    expect(formatPercent(100)).toBe('100%')
    expect(formatPercent(0)).toBe('0%')
    expect(formatPercent(null)).toBe('—')
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

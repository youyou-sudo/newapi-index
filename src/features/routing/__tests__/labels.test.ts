import { describe, expect, it } from 'vitest'

import { bareModel, compactModelLabel, resetLabel, tokensLabel, usedPercentLabel } from '../labels'

describe('bareModel', () => {
  it('drops the provider prefix and leaves the model id alone', () => {
    expect(bareModel('openrouter/anthropic/claude-sonnet-4')).toBe('claude-sonnet-4')
    expect(bareModel('deepseek-v4.1-flash')).toBe('deepseek-v4.1-flash')
  })
})

describe('compactModelLabel', () => {
  it('drops the vendor prefix only when the id has three or more segments', () => {
    expect(compactModelLabel('deepseek-v4.1-flash-sg')).toBe('v4.1-flash-sg')
    expect(compactModelLabel('openai/deepseek-v4.1-flash')).toBe('v4.1-flash')
  })

  it('keeps short ids whole: stripping “gpt-” would leave “4o”', () => {
    expect(compactModelLabel('gpt-4o')).toBe('gpt-4o')
    expect(compactModelLabel('o3')).toBe('o3')
    expect(compactModelLabel('claude-3-5-sonnet')).toBe('claude-3-5-sonnet')
  })
})

describe('usedPercentLabel', () => {
  it('rounds to a whole percent and rejects nonsense', () => {
    expect(usedPercentLabel(16.9)).toBe('已用 17%')
    expect(usedPercentLabel(0)).toBe('已用 0%')
    expect(usedPercentLabel(null)).toBeNull()
    expect(usedPercentLabel(Number.NaN)).toBeNull()
  })
})

describe('resetLabel', () => {
  it('counts down from the server clock and hides past times', () => {
    const now = Date.parse('2026-11-09T12:00:00Z')
    expect(resetLabel('2026-11-15T12:00:00Z', now)).toBe('6 天后重置')
    expect(resetLabel('2026-11-09T15:00:00Z', now)).toBe('3 小时后重置')
    expect(resetLabel('2026-11-09T12:10:00Z', now)).toBe('10 分钟后重置')
    expect(resetLabel('2026-11-09T11:59:00Z', now)).toBeNull()
    expect(resetLabel(null, now)).toBeNull()
    // 还没挂载（nowMs = 0）时不画相对时间，避免 SSR/hydration 文本不一致。
    expect(resetLabel('2026-11-15T12:00:00Z', 0)).toBeNull()
  })
})

describe('tokensLabel', () => {
  it('abbreviates millions and thousands', () => {
    expect(tokensLabel(27_569_200)).toBe('27.6M token')
    expect(tokensLabel(12_700)).toBe('12.7k token')
    expect(tokensLabel(900)).toBe('900 token')
    expect(tokensLabel(0)).toBeNull()
  })
})

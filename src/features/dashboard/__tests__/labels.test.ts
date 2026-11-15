import { describe, expect, it } from 'vitest'
import {
  SORT_OPTIONS,
  resetLabel,
  sortLabel,
  windowLabel,
} from '~/features/dashboard/labels'

/**
 * 排序下拉的展示顺序是产品约定：默认按名称排序，所以「最近读取」放在最后，
 * 而不是像以前那样排第一。这里锁住顺序，避免以后改动 `labels.ts` 时悄悄回退。
 */
describe('dashboard sort options', () => {
  it('lists 最近读取 last now that name is the default', () => {
    expect(SORT_OPTIONS.map((option) => option.value)).toEqual([
      'usage',
      'name',
      'reset',
      'recent',
    ])
    expect(SORT_OPTIONS[SORT_OPTIONS.length - 1]).toEqual({
      value: 'recent',
      label: '最近读取',
    })
  })

  it('labels every sort value', () => {
    expect(sortLabel('name')).toBe('名称')
    expect(sortLabel('recent')).toBe('最近读取')
  })
})

/**
 * 窗口名直接来自上游，中英混排、还带 ASCII、“(est.)”这类说明。卡片宽度有限，
 * 长名字会被截断成半句话，所以认识的档位要翻译，未知的才原样透传。
 */
describe('quota window labels', () => {
  it('translates the known cadence keys case-insensitively', () => {
    expect(windowLabel('daily')).toBe('每日')
    expect(windowLabel('5 hours')).toBe('5 小时窗口')
    expect(windowLabel('7 days')).toBe('7 天窗口')
    // 上游大小写不统一（Credits / credits / CREDITS）。
    expect(windowLabel('Credits')).toBe('积分')
    expect(windowLabel('EXTRA CREDITS')).toBe('额外积分')
    expect(windowLabel('Total credits')).toBe('总积分')
  })

  it('keeps the model name and translates the trailing "tokens (est.)"', () => {
    expect(windowLabel('deepseek-v4.1-flash tokens (est.)')).toBe(
      'deepseek-v4.1-flash Token 估算',
    )
    expect(windowLabel('deepseek-v4.1-flash tokens (estimated)')).toBe(
      'deepseek-v4.1-flash Token 估算',
    )
  })

  it('falls back to the raw name for names it does not know', () => {
    expect(windowLabel('今日 Theos')).toBe('今日 Theos')
    expect(windowLabel('  session  ')).toBe('会话')
  })

  it('distinguishes a periodic reset from an expiring quota', () => {
    expect(resetLabel('reset')).toBe('重置')
    expect(resetLabel('expires')).toBe('到期')
    expect(resetLabel(null)).toBe('重置')
  })
})

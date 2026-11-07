import { describe, expect, it } from 'vitest'
import { SORT_OPTIONS, sortLabel } from '~/features/dashboard/labels'

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

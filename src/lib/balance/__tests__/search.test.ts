import { describe, expect, it } from 'vitest'
import {
  SORT_VALUES,
  STATUS_VALUES,
  VIEW_VALUES,
  parseDashboardSearch,
} from '../search'
import { dashboardQuerySchema } from '../schema'

const defaults = { q: '', status: 'all', sort: 'recent', view: 'grid' }

describe('parseDashboardSearch', () => {
  it('applies defaults for an empty search object', () => {
    expect(parseDashboardSearch({})).toEqual(defaults)
  })

  it('keeps every legal value', () => {
    expect(
      parseDashboardSearch({
        q: 'work',
        status: 'ok',
        sort: 'usage',
        view: 'list',
      }),
    ).toEqual({ q: 'work', status: 'ok', sort: 'usage', view: 'list' })

    for (const status of STATUS_VALUES) {
      expect(parseDashboardSearch({ status }).status).toBe(status)
    }
    for (const sort of SORT_VALUES) {
      expect(parseDashboardSearch({ sort }).sort).toBe(sort)
    }
    for (const view of VIEW_VALUES) {
      expect(parseDashboardSearch({ view }).view).toBe(view)
    }
  })

  it('falls back to defaults for unknown enum values', () => {
    expect(
      parseDashboardSearch({ status: 'nope', sort: 'rank', view: 'table' }),
    ).toEqual(defaults)
    // Case matters: the URL only ever carries the lower-case values.
    expect(
      parseDashboardSearch({ status: 'OK', sort: 'Usage', view: 'Grid' }),
    ).toEqual(defaults)
  })

  it('trims surrounding whitespace from the query', () => {
    expect(parseDashboardSearch({ q: '  work  ' }).q).toBe('work')
    expect(parseDashboardSearch({ q: '\t\nwork\r\n' }).q).toBe('work')
    expect(parseDashboardSearch({ q: '   ' }).q).toBe('')
  })

  it('treats non-string params as missing', () => {
    // `?q=a&q=b` parses to an array; `?q=42` to a number.
    const tampered = [
      undefined,
      null,
      42,
      true,
      ['work'],
      { q: 'work' },
    ]
    for (const q of tampered) {
      expect(parseDashboardSearch({ q }).q).toBe('')
    }
    for (const status of [null, 0, false, ['ok'], {}]) {
      expect(parseDashboardSearch({ status }).status).toBe('all')
    }
    for (const sort of [null, 9, ['usage'], {}]) {
      expect(parseDashboardSearch({ sort }).sort).toBe('recent')
    }
    for (const view of [null, 1, ['list'], {}]) {
      expect(parseDashboardSearch({ view }).view).toBe('grid')
    }
  })

  it('drops an over-long query instead of truncating it', () => {
    const exactly64 = 'a'.repeat(64)
    const over65 = 'a'.repeat(65)

    expect(parseDashboardSearch({ q: exactly64 }).q).toBe(exactly64)
    expect(parseDashboardSearch({ q: over65 }).q).toBe('')
    // The length cap applies after trimming, exactly like the server schema.
    expect(parseDashboardSearch({ q: `   ${exactly64}   ` }).q).toBe(exactly64)
    expect(parseDashboardSearch({ q: `   ${over65}   ` }).q).toBe('')
    expect(parseDashboardSearch({ q: over65 }).q).not.toBe(over65.slice(0, 64))
  })

  it('strips unknown keys', () => {
    const parsed = parseDashboardSearch({
      q: 'x',
      status: 'ok',
      sort: 'name',
      view: 'list',
      range: '7d',
      page: '2',
    })

    expect(Object.keys(parsed).sort()).toEqual(['q', 'sort', 'status', 'view'])
    expect(parsed).not.toHaveProperty('range')
    expect(parsed).not.toHaveProperty('page')
  })

  it('does not mutate its input', () => {
    const raw = { q: '  work  ', status: 'nope', range: '7d' }
    parseDashboardSearch(raw)
    expect(raw).toEqual({ q: '  work  ', status: 'nope', range: '7d' })
  })

  it('matches the server schema for the query text', () => {
    // Parity guard: the client parser and the server function validator must
    // agree on `q`, otherwise a search can narrow differently after hydration.
    const samples: Array<unknown> = [
      undefined,
      '',
      '   ',
      'work',
      '  work  ',
      '\twork\n',
      'a'.repeat(63),
      'a'.repeat(64),
      'a'.repeat(65),
      `  ${'a'.repeat(64)}  `,
      `  ${'a'.repeat(65)}  `,
      42,
      true,
      null,
      ['a', 'b'],
      { nested: 'a' },
      '安全 token',
    ]

    for (const sample of samples) {
      const viaZod =
        sample === undefined
          ? dashboardQuerySchema.parse({}).q
          : dashboardQuerySchema.parse({ q: sample }).q
      expect(parseDashboardSearch({ q: sample }).q).toBe(viaZod)
    }
  })
})

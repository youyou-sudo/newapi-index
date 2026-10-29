import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'
import type { BalanceAccount } from '~/lib/balance/types'

/**
 * The balance cache is module-level state (single-flight + last good entry), so
 * every test imports a fresh module instance through vi.resetModules(). The
 * clock is mocked with Date.now so TTL expiry is deterministic instead of
 * sleeping.
 */
type FetchMock = Mock<typeof fetch>

const API_URL = 'http://balance.test/api/user/balance'
const API_KEY = 'sk-test'
const START_TIME = Date.parse('2026-10-29T00:00:00Z')

const ACCOUNT_A: BalanceAccount = {
  provider: 'provider-a',
  name: 'Account A',
  windows: [
    { name: 'Credits', used: 0, display: '0 / 350', limit: 350, unit: 'credits' },
  ],
}

const ACCOUNT_B: BalanceAccount = {
  provider: 'provider-b',
  name: 'Account B',
  windows: [],
}

const ENV_KEYS = [
  'BALANCE_API_URL',
  'BALANCE_API_KEY',
  'BALANCE_CACHE_TTL_SECONDS',
  'BALANCE_API_TIMEOUT_MS',
  'REVEAL_IDENTITIES',
] as const

const savedEnv = new Map<string, string | undefined>(
  ENV_KEYS.map((key) => [key, process.env[key]]),
)

let fetchMock: FetchMock
let now = START_TIME

function jsonResponse(accounts: Array<BalanceAccount>): Response {
  return new Response(JSON.stringify({ data: accounts }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

async function loadModule(): Promise<typeof import('~/server/balance.server')> {
  vi.resetModules()
  return import('~/server/balance.server')
}

beforeEach(() => {
  now = START_TIME
  vi.spyOn(Date, 'now').mockImplementation(() => now)
  fetchMock = vi.fn<typeof fetch>()
  vi.stubGlobal('fetch', fetchMock)
  process.env.BALANCE_API_URL = API_URL
  process.env.BALANCE_API_KEY = API_KEY
  delete process.env.BALANCE_CACHE_TTL_SECONDS
  delete process.env.BALANCE_API_TIMEOUT_MS
  delete process.env.REVEAL_IDENTITIES
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  for (const key of ENV_KEYS) {
    const value = savedEnv.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('balance cache', () => {
  it('serves a fresh cache hit without reading the upstream again', async () => {
    fetchMock.mockResolvedValue(jsonResponse([ACCOUNT_A]))
    const { loadBalanceSnapshot } = await loadModule()

    const first = await loadBalanceSnapshot()
    expect(first.source.mode).toBe('live')
    expect(first.source.cache).toBe('miss')
    // Production path: identities stay masked (the snapshot only carries the flag).
    expect(first.source.revealed).toBe(false)
    expect(first.accounts.map((account) => account.provider)).toEqual(['provider-a'])
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]!
    expect(String(url)).toBe(API_URL)
    expect(init?.headers).toEqual({
      accept: 'application/json',
      Authorization: 'Bearer sk-test',
    })

    now += 29_000
    const second = await loadBalanceSnapshot()
    expect(second.source.cache).toBe('hit')
    expect(second.source.fetchedAt).toBe(first.source.fetchedAt)
    expect(second.accounts).toEqual(first.accounts)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('awaits a new upstream read once the entry expires', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([ACCOUNT_A]))
    const { loadBalanceSnapshot } = await loadModule()
    const first = await loadBalanceSnapshot()

    now += 30_000
    fetchMock.mockResolvedValueOnce(jsonResponse([ACCOUNT_B]))
    const second = await loadBalanceSnapshot()

    expect(second.source.cache).toBe('miss')
    expect(second.accounts.map((account) => account.provider)).toEqual(['provider-b'])
    expect(Date.parse(second.source.fetchedAt)).toBeGreaterThan(
      Date.parse(first.source.fetchedAt),
    )
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not resolve with the stale entry while the expired refresh is in flight', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([ACCOUNT_A]))
    const { loadBalanceSnapshot } = await loadModule()
    await loadBalanceSnapshot()

    now += 30_000
    let release: ((response: Response) => void) | undefined
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )

    let settled = false
    const pending = loadBalanceSnapshot().then((snapshot) => {
      settled = true
      return snapshot
    })
    await Promise.resolve()
    await Promise.resolve()
    // Regression: the old implementation returned the expired entry immediately
    // and refreshed in the background, so ISR regeneration cached stale HTML.
    expect(settled).toBe(false)

    if (!release) throw new Error('upstream fetch was never started')
    release(jsonResponse([ACCOUNT_B]))

    const snapshot = await pending
    expect(snapshot.source.cache).toBe('miss')
    expect(snapshot.accounts.map((account) => account.provider)).toEqual(['provider-b'])
  })

  it('keeps the last good entry and marks it stale when the upstream fails', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([ACCOUNT_A]))
    const { loadBalanceSnapshot } = await loadModule()
    await loadBalanceSnapshot()

    now += 31_000
    fetchMock.mockRejectedValueOnce(new Error('connect ECONNREFUSED'))
    const snapshot = await loadBalanceSnapshot()

    expect(snapshot.source.mode).toBe('live')
    expect(snapshot.source.cache).toBe('stale')
    expect(snapshot.source.warning).toContain('实时接口请求失败')
    expect(snapshot.source.warning).toContain('31 秒前')
    expect(snapshot.accounts.map((account) => account.provider)).toEqual(['provider-a'])
  })

  it('shares one upstream read between concurrent callers', async () => {
    fetchMock.mockResolvedValue(jsonResponse([ACCOUNT_A]))
    const { loadBalanceSnapshot } = await loadModule()

    const [first, second] = await Promise.all([
      loadBalanceSnapshot(),
      loadBalanceSnapshot(),
    ])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(first.source.cache).toBe('miss')
    expect(second.source.cache).toBe('miss')
    expect(first.accounts).toEqual(second.accounts)
  })

  it('falls back to the bundled fixture when the upstream is not configured', async () => {
    delete process.env.BALANCE_API_URL
    const { loadBalanceSnapshot } = await loadModule()

    const snapshot = await loadBalanceSnapshot()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(snapshot.source.mode).toBe('fixture')
    expect(snapshot.source.cache).toBe('fixture')
    expect(snapshot.source.warning).toContain('未配置内网余额接口地址')
    expect(snapshot.accounts.length).toBeGreaterThan(0)
  })

  it('falls back to the fixture when the first upstream read fails', async () => {
    fetchMock.mockRejectedValueOnce(new Error('boom'))
    const { loadBalanceSnapshot } = await loadModule()

    const snapshot = await loadBalanceSnapshot()
    expect(snapshot.source.mode).toBe('fixture')
    expect(snapshot.source.cache).toBe('fixture')
    expect(snapshot.source.warning).toContain('内网余额接口不可达')
  })

  it('returns fresh data again after a failed refresh recovers', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([ACCOUNT_A]))
    const { loadBalanceSnapshot } = await loadModule()
    await loadBalanceSnapshot()

    now += 31_000
    fetchMock.mockRejectedValueOnce(new Error('temporary outage'))
    const degraded = await loadBalanceSnapshot()
    expect(degraded.source.cache).toBe('stale')
    expect(degraded.source.warning).not.toBeNull()

    now += 31_000
    fetchMock.mockResolvedValueOnce(jsonResponse([ACCOUNT_B]))
    const recovered = await loadBalanceSnapshot()
    expect(recovered.source.cache).toBe('miss')
    expect(recovered.source.warning).toBeNull()
    expect(recovered.accounts.map((account) => account.provider)).toEqual(['provider-b'])
  })

  it('reloadBalanceSnapshot bypasses the TTL for the manual refresh button', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([ACCOUNT_A]))
    const { loadBalanceSnapshot, reloadBalanceSnapshot } = await loadModule()
    const first = await loadBalanceSnapshot()
    expect(first.source.cache).toBe('miss')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 缓存还新鲜（只过了 1 秒），普通读取会命中；手动刷新必须真的重读上游。
    now += 1_000
    const hit = await loadBalanceSnapshot()
    expect(hit.source.cache).toBe('hit')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockResolvedValueOnce(jsonResponse([ACCOUNT_B]))
    const forced = await reloadBalanceSnapshot()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(forced.source.cache).toBe('miss')
    expect(forced.source.mode).toBe('live')
    expect(forced.accounts.map((account) => account.provider)).toEqual(['provider-b'])
    expect(Date.parse(forced.source.fetchedAt)).toBeGreaterThan(
      Date.parse(first.source.fetchedAt),
    )

    // 强制刷新把新快照写回了缓存，之后的普通读取重新命中它。
    const after = await loadBalanceSnapshot()
    expect(after.source.cache).toBe('hit')
    expect(after.accounts.map((account) => account.provider)).toEqual(['provider-b'])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})

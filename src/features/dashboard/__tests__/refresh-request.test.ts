import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  INVALIDATE_ENDPOINT,
  REFRESH_ENDPOINT,
  requestServerRefresh,
} from '~/features/dashboard/refresh-request'

/**
 * 自动刷新与手动刷新打的是同一个接口，只差一个 `reload` 开关：
 *
 * - 自动刷新（30 秒一轮）必须带 `reload=0`，只清 ISR 条目、让余额 TTL 决定要不要
 *   打上游——否则长驻页面会把上游当成每 30 秒一次的轮询；
 * - 手动刷新（用户点“刷新”）必须强制重读上游，点了就要看到最新余额。
 *
 * 这层契约不看 UI，纯在请求层面断言，避免以后有人把两个分支合并回一个 URL。
 */
type FetchMock = ReturnType<typeof vi.fn>
let fetchMock: FetchMock

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response('{"ok":true}', { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function firstCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[0] as [unknown, RequestInit]
  return { url: String(url), init }
}

describe('dashboard refresh request', () => {
  it('asks the automatic refresh to only invalidate the ISR entry', async () => {
    await requestServerRefresh({ reloadUpstream: false })

    const { url, init } = firstCall()
    expect(url).toBe(INVALIDATE_ENDPOINT)
    expect(url).toBe(`${REFRESH_ENDPOINT}?reload=0`)
    expect(init.method).toBe('POST')
    // 失效动作本身不能被任何中间层缓存，也不能带凭据（iframe 是 opaque origin）。
    expect(init.cache).toBe('no-store')
    expect(init.credentials).toBe('same-origin')
  })

  it('forces an upstream read for the manual refresh', async () => {
    await requestServerRefresh()
    expect(firstCall().url).toBe(REFRESH_ENDPOINT)

    fetchMock.mockClear()
    await requestServerRefresh({ reloadUpstream: true })
    expect(firstCall().url).toBe(REFRESH_ENDPOINT)
  })

  it('rejects when the invalidation endpoint answers with an error', async () => {
    fetchMock.mockImplementationOnce(
      async () => new Response('nope', { status: 503 }),
    )
    await expect(requestServerRefresh({ reloadUpstream: false })).rejects.toThrow(
      '刷新接口返回 HTTP 503',
    )
  })
})

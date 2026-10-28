import { describe, expect, it } from 'vitest'

import { BOARD_MS, OUT_MS } from '~/lib/routing/timeline'
import type { AttemptView, TripView } from '~/lib/routing/types'
import { advanceDot, dotTrip } from '../motion'

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0)

function attempt(input: Partial<AttemptView> & { seatIndex: number }): AttemptView {
  const { seatIndex, ...rest } = input
  return {
    seatIndex,
    startedAt: T0,
    endedAt: null,
    done: false,
    ok: false,
    status: null,
    ms: null,
    ttft: null,
    fail: null,
    ...rest,
  }
}

function trip(input: { done?: boolean; attempts?: Array<AttemptView> }): TripView {
  return {
    routeId: 1,
    agentIndex: 0,
    startedAt: T0,
    model: 'model-x',
    done: input.done ?? false,
    ok: true,
    status: 200,
    ms: null,
    attempts: input.attempts ?? [attempt({ seatIndex: 2 })],
  }
}

describe('advanceDot', () => {
  it('starts a running request from the client when it is first seen', () => {
    const state = advanceDot(undefined, trip({}), T0 + 1_200)
    // 动画从“看到的这一刻”开始，不从服务器时间开始：点从客户端起飞。
    expect(state.startedAt).toBe(T0 + 1_200)
    expect(state.done).toBe(false)
    expect(state.attempts).toHaveLength(1)
    expect(state.attempts[0]).toMatchObject({ seatIndex: 2, done: false, endedAt: null })
  })

  it('marks an attempt finished at the moment the data says so', () => {
    const running = advanceDot(undefined, trip({}), T0)
    const finishedAttempt = trip({
      attempts: [attempt({ seatIndex: 2, done: true, ok: true, status: 200 })],
    })
    const state = advanceDot(running, finishedAttempt, T0 + 3_000)

    // 结束时间记成“现在”，于是返程立刻开始，但按正常时长播放。
    expect(state.attempts[0]).toMatchObject({ done: true, endedAt: T0 + 3_000, ok: true })
    expect(dotTrip(state, finishedAttempt).attempts[0]?.endedAt).toBe(T0 + 3_000)
  })

  it('marks the request done without moving its animation clock', () => {
    const running = advanceDot(undefined, trip({}), T0)
    const state = advanceDot(running, trip({ done: true }), T0 + 5_000)
    expect(state.done).toBe(true)
    expect(state.startedAt).toBe(T0)
  })

  it('flies straight home for a request that finished just before it was first seen', () => {
    const justFinished = trip({
      done: true,
      attempts: [attempt({ seatIndex: 2, done: true, ok: true, endedAt: T0 + 9_000 })],
    })
    const state = advanceDot(undefined, justFinished, T0 + 10_000)
    expect(state.done).toBe(true)
    // 起点倒退到“刚出网关”：不补播整条路径，也不快进。
    expect(state.startedAt).toBe(T0 + 10_000 - BOARD_MS - OUT_MS)
    expect(state.attempts[0]).toMatchObject({ endedAt: T0 + 10_000, done: true })
  })

  it('does not replay a request that finished long ago', () => {
    const old = trip({
      done: true,
      attempts: [attempt({ seatIndex: 2, done: true, ok: true, endedAt: T0 })],
    })
    const state = advanceDot(undefined, old, T0 + 60_000)
    // 没有尝试可播、起点也很早：时间轴直接判定“已完成且不可见”，页面刷新不会放旧回程。
    expect(state.done).toBe(true)
    expect(state.attempts).toHaveLength(0)
  })

  it('keeps earlier attempts so a retry can be played in order', () => {
    const first = advanceDot(
      undefined,
      trip({ attempts: [attempt({ seatIndex: 1, done: true, ok: false })] }),
      T0,
    )
    const retry = trip({
      attempts: [
        attempt({ seatIndex: 1, done: true, ok: false }),
        attempt({ seatIndex: 3 }),
      ],
    })
    const state = advanceDot(first, retry, T0 + 2_000)
    expect(state.attempts).toHaveLength(2)
    expect(state.attempts[1]).toMatchObject({ seatIndex: 3, done: false })
  })
})

import { describe, expect, it } from 'vitest'

import { HOME_MS, OUT_MS, frameForTrip } from '~/lib/routing/timeline'
import type { AttemptView, TripView } from '~/lib/routing/types'
import { GHOST_TTL_MS, expireGhosts, retireTrip, syncGhosts } from '../ghosts'
import type { GhostTrip, KnownTrip } from '../ghosts'
import { advanceDot, dotTrip } from '../motion'

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0)

function attempt(input: { seatIndex: number; startedAt?: number; done?: boolean }): AttemptView {
  return {
    seatIndex: input.seatIndex,
    startedAt: input.startedAt ?? T0,
    endedAt: null,
    done: input.done ?? false,
    ok: false,
    status: null,
    ms: null,
    ttft: null,
    fail: null,
  }
}

function trip(input: {
  routeId?: number
  done?: boolean
  attempts?: Array<AttemptView>
}): TripView {
  return {
    routeId: input.routeId ?? 7,
    agentIndex: 0,
    startedAt: T0,
    model: 'model-x',
    done: input.done ?? false,
    ok: false,
    status: null,
    ms: null,
    attempts: input.attempts ?? [attempt({ seatIndex: 1 })],
  }
}

describe('retireTrip', () => {
  it('finishes an in-flight attempt so the dot can fly home', () => {
    const running = trip({ attempts: [attempt({ seatIndex: 2 })] })
    const retired = retireTrip(running, T0 + 5_000)

    expect(retired.done).toBe(true)
    expect(retired.attempts[0]).toMatchObject({ done: true, endedAt: T0 + 5_000 })
  })

  it('leaves a finished request untouched', () => {
    const finished = trip({ done: true })
    expect(retireTrip(finished, T0 + 5_000)).toBe(finished)
  })
})

describe('syncGhosts', () => {
  it('retires a request that left the window while it was still answering', () => {
    // 这条请求被挤出数据窗口时还在作答：它的数据不会再更新。若不收尾，时间轴会
    // 永远停在 held —— 网关显示“没有在途”，点和线却一直亮着。
    const running = trip({ attempts: [attempt({ seatIndex: 1 })] })
    const known = new Map<number, KnownTrip>([[7, { trip: running, agentKey: 'claude' }]])
    const ghosts = new Map<number, GhostTrip>()

    const changed = syncGhosts(known, ghosts, [], () => null, T0 + 5_000)

    expect(changed).toBe(true)
    const ghost = ghosts.get(7)
    expect(ghost).toBeDefined()
    expect(ghost?.trip.done).toBe(true)
    expect(ghost?.trip.attempts[0]).toMatchObject({ done: true, endedAt: T0 + 5_000 })
    // 收尾之后时间轴会在有限时间内播完返程，点和线都不会永远留在舞台上。
    const first = advanceDot(undefined, running, T0 + 1_000)
    const after = advanceDot(first, ghost!.trip, T0 + 5_000)
    const animated = dotTrip(after, ghost!.trip)
    expect(frameForTrip(animated, T0 + 5_000 + OUT_MS + HOME_MS + 100).visible).toBe(false)
    // 对照：不收尾时它会一直“作答中”，这就是线上看到的那条永远亮着的线。
    expect(frameForTrip(running, T0 + 600_000)).toMatchObject({ phase: 'held', visible: true })
  })

  it('does not keep a ghost for an agent that already left the stage', () => {
    // 智能体被挤出舞台后没有可以沿着飞回去的线；用旧列位置去点亮会点到别人身上。
    const running = trip({})
    const known = new Map<number, KnownTrip>([[7, { trip: running, agentKey: null }]])
    const ghosts = new Map<number, GhostTrip>()

    expect(syncGhosts(known, ghosts, [], () => null, T0)).toBe(false)
    expect(ghosts.size).toBe(0)
  })

  it('drops the ghost when the request comes back into the window', () => {
    const running = trip({})
    const known = new Map<number, KnownTrip>([[7, { trip: running, agentKey: 'claude' }]])
    const ghosts = new Map<number, GhostTrip>()

    syncGhosts(known, ghosts, [], () => 'claude', T0)
    expect(ghosts.has(7)).toBe(true)

    expect(syncGhosts(known, ghosts, [running], () => 'claude', T0 + 100)).toBe(true)
    expect(ghosts.has(7)).toBe(false)
  })

  it('records the agent key of every request in the window', () => {
    const known = new Map<number, KnownTrip>()
    const ghosts = new Map<number, GhostTrip>()

    syncGhosts(known, ghosts, [trip({})], () => 'claude', T0)

    expect(known.get(7)).toEqual({ trip: trip({}), agentKey: 'claude' })
  })

  it('reports no change when the window is unchanged', () => {
    const running = trip({})
    const known = new Map<number, KnownTrip>([[7, { trip: running, agentKey: 'claude' }]])
    const ghosts = new Map<number, GhostTrip>()

    expect(syncGhosts(known, ghosts, [running], () => 'claude', T0)).toBe(false)
  })
})

describe('expireGhosts', () => {
  it('removes a ghost that outlived the animation', () => {
    const ghosts = new Map<number, GhostTrip>([
      [1, { trip: trip({ done: true }), agentKey: 'claude', since: T0 }],
    ])

    expect(expireGhosts(ghosts, T0 + GHOST_TTL_MS - 1)).toBe(false)
    expect(ghosts.size).toBe(1)
    expect(expireGhosts(ghosts, T0 + GHOST_TTL_MS)).toBe(true)
    expect(ghosts.size).toBe(0)
  })
})

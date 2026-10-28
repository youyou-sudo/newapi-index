import { describe, expect, it } from 'vitest'

import type { AttemptView, RoutingView, TripView } from '~/lib/routing/types'
import { computeWiring, focusTrip, liveSeatsOf } from '../wiring'

function attempt(input: Partial<AttemptView> & { seatIndex: number; startedAt: number }): AttemptView {
  return {
    seatIndex: input.seatIndex,
    startedAt: input.startedAt,
    endedAt: input.endedAt ?? null,
    done: input.done ?? false,
    ok: input.ok ?? false,
    status: input.status ?? null,
    ms: input.ms ?? null,
    ttft: input.ttft ?? null,
    fail: input.fail ?? null,
  }
}

function trip(input: {
  routeId: number
  agentIndex: number
  startedAt: number
  done?: boolean
  attempts?: Array<AttemptView>
}): TripView {
  return {
    routeId: input.routeId,
    agentIndex: input.agentIndex,
    startedAt: input.startedAt,
    model: 'model-x',
    done: input.done ?? false,
    ok: true,
    status: 200,
    ms: null,
    attempts: input.attempts ?? [],
  }
}

function view(trips: Array<TripView>, seats = 3, agents = 2): RoutingView {
  return {
    agents: Array.from({ length: agents }, (_unused, index) => ({
      key: `agent-${index}`,
      label: `agent-${index}`,
      hue: '#8b5cf6',
    })),
    seats: Array.from({ length: seats }, (_unused, index) => ({
      key: `p1/m/${index}`,
      slot: `p1`,
      provider: 'p1',
      name: '***',
      model: 'm',
      kind: 'account',
      who: null,
      plan: null,
      usedPercent: null,
      tokens: null,
      renews: [],
      rank: null,
      shared: false,
      fallback: false,
    })),
    trips,
    totals: { requests: 1, rerouted: 0, errors: 0 },
    mine: true,
  }
}

describe('focusTrip', () => {
  it('picks the route that started last', () => {
    const older = trip({ routeId: 1, agentIndex: 0, startedAt: 1_000 })
    const newer = trip({ routeId: 2, agentIndex: 1, startedAt: 2_000 })
    expect(focusTrip([older, newer])?.routeId).toBe(2)
    expect(focusTrip([])).toBeNull()
  })
})

describe('liveSeatsOf', () => {
  it('collects in-flight seats from every running request and keeps the latest', () => {
    const running = trip({
      routeId: 1,
      agentIndex: 0,
      startedAt: 1_000,
      attempts: [
        attempt({ seatIndex: 2, startedAt: 1_100 }),
        attempt({ seatIndex: 1, startedAt: 1_200, done: true, ok: true }),
      ],
    })
    const newer = trip({
      routeId: 2,
      agentIndex: 1,
      startedAt: 2_000,
      attempts: [attempt({ seatIndex: 2, startedAt: 2_100 })],
    })
    const live = liveSeatsOf([running, newer])
    // 只有“还没结束”的尝试算在回答；同一张卡被两条请求用到时留最新的那次。
    expect([...live.keys()]).toEqual([2])
    expect(live.get(2)).toBe(2_100)
  })
})

describe('computeWiring', () => {
  it('keeps a busy channel dashed and 回答中 even when the newest request is another one', () => {
    const busy = trip({
      routeId: 1,
      agentIndex: 0,
      startedAt: 1_000,
      attempts: [attempt({ seatIndex: 1, startedAt: 1_100 })],
    })
    const newest = trip({
      routeId: 2,
      agentIndex: 1,
      startedAt: 2_000,
      attempts: [attempt({ seatIndex: 2, startedAt: 2_100, done: true, ok: true, status: 200 })],
    })

    const wiring = computeWiring(view([busy, newest]))

    // 卡片 1 正在被回答：虚线 + 停靠光圈（卡片显示“回答中…”）。
    expect(wiring.seatStates[1]).toBe('live')
    expect(wiring.heldSeats.has(1)).toBe(true)
    // 最新那条请求仍没结束，它的座位也只是流动虚线，不能算实线。
    expect(wiring.seatStates[2]).toBe('live')
    expect(wiring.seatStates[0]).toBe('rest')
  })

  it('with nothing in flight leaves only the newest request solid', () => {
    const older = trip({
      routeId: 1,
      agentIndex: 0,
      startedAt: 1_000,
      done: true,
      attempts: [attempt({ seatIndex: 0, startedAt: 1_100, done: true, ok: true })],
    })
    const newest = trip({
      routeId: 2,
      agentIndex: 1,
      startedAt: 2_000,
      done: true,
      attempts: [attempt({ seatIndex: 2, startedAt: 2_100, done: true, ok: true })],
    })

    const wiring = computeWiring(view([older, newest]))

    // 只留网关最后一条请求的实线；旧请求用过的卡片回到灰色虚线。
    expect(wiring.seatStates).toEqual(['rest', 'rest', 'lit'])
    expect(wiring.heldSeats.size).toBe(0)
    expect(wiring.agentStates).toEqual(['idle', 'lit'])
  })
})

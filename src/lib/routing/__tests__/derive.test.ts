import { describe, expect, it } from 'vitest'

import { LINGER_MS, deriveRoutingView, hueForAgent } from '../derive'
import type { RouteAttempt, RouteCandidate, RoutingRoute, RoutingSnapshot } from '../types'

const NOW = Date.UTC(2026, 0, 1, 12, 0, 0)
const TOTALS = { requests: 3, rerouted: 1, errors: 2 }

function isoAt(ms: number): string {
  return new Date(ms).toISOString()
}

function candidate(input: Partial<RouteCandidate> & { slot: string }): RouteCandidate {
  return {
    slot: input.slot,
    provider: input.provider ?? 'acme',
    name: input.name ?? 'Acme',
    kind: input.kind ?? 'provider',
    model: input.model ?? 'model-x',
    routing: input.routing,
    usedPercent: input.usedPercent,
    tokens: input.tokens,
    who: input.who,
    plan: input.plan,
    renews: input.renews,
    rank: input.rank,
    shared: input.shared,
    fallback: input.fallback,
  }
}

function attempt(input: Partial<RouteAttempt> & { slot: string; start: string }): RouteAttempt {
  return {
    slot: input.slot,
    start: input.start,
    model: input.model,
    done: input.done ?? false,
    status: input.status,
    ms: input.ms,
    ttft: input.ttft,
    fail: input.fail,
    error: input.error,
    again: input.again,
    rest: input.rest,
    gone: input.gone,
  }
}

function route(
  input: { id: number; agent: string; time: string } & Partial<RoutingRoute>,
): RoutingRoute {
  return {
    seq: input.seq ?? input.id,
    id: input.id,
    time: input.time,
    agent: input.agent,
    model: input.model ?? 'model-x',
    provider: input.provider,
    done: input.done ?? true,
    status: input.status,
    ms: input.ms,
    ttft: input.ttft,
    order: input.order ?? [],
    tries: input.tries ?? [],
  }
}

function snapshot(routes: Array<RoutingRoute>, mine = true): RoutingSnapshot {
  return { seq: 1, now: isoAt(NOW), mine, totals: TOTALS, routes }
}

describe('deriveRoutingView trip pick', () => {
  it('keeps the newest ten finished routes', () => {
    const routes = Array.from({ length: 12 }, (_unused, index) =>
      route({ id: index + 1, agent: 'claude', time: isoAt(NOW - (12 - index) * 1_000) }),
    )

    const view = deriveRoutingView(snapshot(routes), NOW)

    expect(view.trips).toHaveLength(10)
    expect(view.trips.map((trip) => trip.routeId)).toEqual([3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
  })

  it('never drops a running route to make room for a finished one', () => {
    const finished = Array.from({ length: 10 }, (_unused, index) =>
      route({ id: index + 2, agent: 'claude', time: isoAt(NOW - (12 - index) * 1_000) }),
    )
    const running = route({ id: 1, agent: 'claude', time: isoAt(NOW - 60_000), done: false })

    const view = deriveRoutingView(snapshot([running, ...finished]), NOW)

    expect(view.trips).toHaveLength(10)
    expect(view.trips.map((trip) => trip.routeId)).toEqual([1, 3, 4, 5, 6, 7, 8, 9, 10, 11])
  })

  it('derives the same view whatever the clock says', () => {
    const startedAt = isoAt(NOW - 10 * 24 * 60 * 60 * 1_000)
    const routes = [
      route({
        id: 1,
        agent: 'claude',
        time: startedAt,
        done: true,
        status: 200,
        ms: 800,
        order: [candidate({ slot: 'a', provider: 'p1', model: 'one' })],
        tries: [
          attempt({ slot: 'a', model: 'one', start: startedAt, done: true, status: 200, ms: 800 }),
        ],
      }),
      route({ id: 2, agent: 'codex', time: isoAt(NOW - 2_000), done: false }),
      route({ id: 3, agent: 'gemini', time: isoAt(NOW - 1_000), done: true }),
    ]

    const now = deriveRoutingView(snapshot(routes), NOW)
    const later = deriveRoutingView(snapshot(routes), NOW + 3_600_000)
    const earlier = deriveRoutingView(snapshot(routes), NOW - 1_000_000)

    expect(later).toEqual(now)
    expect(earlier).toEqual(now)
    // 十天前的请求仍然在台上：视图不再按时间过滤。
    expect(now.trips.map((trip) => trip.routeId)).toEqual([1, 2, 3])
  })

  it('sorts an unparsable timestamp to the oldest slot', () => {
    const view = deriveRoutingView(
      snapshot([
        route({ id: 1, agent: 'claude', time: 'not-a-timestamp', done: false }),
        route({ id: 2, agent: 'claude', time: isoAt(NOW), done: true }),
      ]),
      NOW,
    )

    expect(view.trips.map((trip) => trip.routeId)).toEqual([1, 2])
    expect(view.trips[0]?.startedAt).toBe(0)
  })
})

describe('deriveRoutingView agents and seats', () => {
  it('keeps the four newest agents, sorted by id', () => {
    const agents = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot']
    const view = deriveRoutingView(
      snapshot(
        agents.map((agent, index) =>
          route({
            id: index + 1,
            agent,
            time: isoAt(NOW - (agents.length - index) * 1_000),
            done: false,
          }),
        ),
      ),
      NOW,
    )

    expect(view.agents.map((agent) => agent.key)).toEqual(['charlie', 'delta', 'echo', 'foxtrot'])
    expect(view.trips).toHaveLength(4)
    expect(view.agents[0]).toEqual({
      key: 'charlie',
      label: 'charlie',
      hue: hueForAgent('charlie'),
    })
  })

  it('keeps a long running request when four newer agents show up', () => {
    // 一条很慢的在途请求 + 四个刚发了快请求的智能体。舞台只放 4 个智能体，但“在途
    // 永不淘汰”：把还在作答的那条挤出去，页面会显示“没有在途”，它的线却还亮着。
    const running = route({ id: 1, agent: 'long', time: isoAt(NOW - 60_000), done: false })
    const newer = ['bravo', 'charlie', 'delta', 'echo'].map((agent, index) =>
      route({ id: index + 2, agent, time: isoAt(NOW - (5 - index) * 1_000) }),
    )

    const view = deriveRoutingView(snapshot([running, ...newer]), NOW)

    const agentKeys = view.agents.map((agent) => agent.key)
    expect(agentKeys).toContain('long')
    // 最新一条请求的智能体也要在：卡片状态与“最近一个请求”只讲它。
    expect(agentKeys).toContain('echo')
    expect(view.agents).toHaveLength(4)
    expect(view.trips.filter((trip) => !trip.done).map((trip) => trip.routeId)).toEqual([1])
  })

  it('always keeps the agent of the newest request on stage', () => {
    // 四个还在作答的智能体 + 一个刚结束的：最新那条请求不能被在途请求挤掉，否则
    // 卡片状态和底部说明会去讲一条更旧的请求。
    const busy = ['alpha', 'bravo', 'charlie', 'delta'].map((agent, index) =>
      route({ id: index + 1, agent, time: isoAt(NOW - 60_000 + index * 1_000), done: false }),
    )
    const newest = route({ id: 9, agent: 'zulu', time: isoAt(NOW - 1_000), done: true })

    const view = deriveRoutingView(snapshot([...busy, newest]), NOW)

    expect(view.agents.map((agent) => agent.key)).toContain('zulu')
    expect(view.trips[view.trips.length - 1]?.routeId).toBe(9)
  })

  it('orders trips oldest first and maps agents to indexes', () => {
    const view = deriveRoutingView(
      snapshot([
        route({ id: 1, agent: 'zeta', time: isoAt(NOW - 1_000), done: false }),
        route({ id: 2, agent: 'alpha', time: isoAt(NOW - 2_000), done: false }),
      ]),
      NOW,
    )

    expect(view.agents.map((agent) => agent.key)).toEqual(['alpha', 'zeta'])
    expect(view.trips.map((trip) => [trip.routeId, trip.agentIndex])).toEqual([
      [2, 0],
      [1, 1],
    ])
  })

  it('unions order candidates into seats sorted by provider, rank and id', () => {
    const view = deriveRoutingView(
      snapshot([
        route({
          id: 1,
          agent: 'claude',
          time: isoAt(NOW - 1_000),
          order: [
            candidate({ slot: 'k2', provider: 'zeta', model: 'm2' }),
            candidate({ slot: 'k1', provider: 'alpha', model: 'm1' }),
          ],
        }),
        route({
          id: 2,
          agent: 'codex',
          time: isoAt(NOW - 2_000),
          order: [
            candidate({ slot: 'k1', provider: 'alpha', model: 'm1' }),
            candidate({ slot: 'k3', provider: 'alpha', model: 'm1' }),
          ],
        }),
      ]),
      NOW,
    )

    expect(view.seats.map((seat) => seat.key)).toEqual(['alpha/m1/k1', 'alpha/m1/k3', 'zeta/m2/k2'])
    expect(view.seats[0]).toMatchObject({ slot: 'k1', provider: 'alpha', model: 'm1', kind: 'provider' })
  })

  it('resolves attempt seats by id and model, then by id, and appends unknown ones', () => {
    const startedAt = isoAt(NOW - 5_000)
    const view = deriveRoutingView(
      snapshot([
        route({
          id: 1,
          agent: 'claude',
          time: startedAt,
          done: false,
          order: [
            candidate({ slot: 'a', provider: 'p1', model: 'one' }),
            candidate({ slot: 'b', provider: 'p1', model: 'two' }),
          ],
          tries: [
            attempt({ slot: 'a', model: 'one', start: startedAt, done: true, status: 200, ms: 400 }),
            attempt({ slot: 'b', start: startedAt, done: true, status: 500, fail: 'other', ms: 100 }),
            attempt({ slot: 'ghost', model: 'nine', start: startedAt, done: false }),
          ],
        }),
      ]),
      NOW,
    )

    // 只有尝试、没有候选的落点没有 provider 可显示：用打码占位补一个座位。
    expect(view.seats.map((seat) => seat.key)).toEqual(['p1/one/a', 'p1/two/b', '***/nine/ghost'])
    expect(view.trips[0]?.attempts.map((entry) => entry.seatIndex)).toEqual([0, 1, 2])
  })

  it('keeps the account identity and the allowance numbers apart', () => {
    const view = deriveRoutingView(
      snapshot([
        route({
          id: 1,
          agent: 'claude',
          time: isoAt(NOW - 1_000),
          order: [
            candidate({
              slot: 'a',
              provider: 'p1',
              model: 'one',
              kind: 'account',
              who: 'someone@example.com',
              plan: 'Design Plan Go',
              // 上游的 used 是“额度已用百分比”，tokens 是“最近发给它的 token 数”。
              usedPercent: 16.9,
              tokens: 12_676_852,
              renews: ['2026-11-03T12:02:05.042Z'],
              rank: 2,
              shared: true,
            }),
            candidate({ slot: 'b', provider: 'p1', model: 'one', kind: 'key' }),
          ],
        }),
      ]),
      NOW,
    )

    const accountSeat = view.seats.find((seat) => seat.slot === 'a')
    const keySeat = view.seats.find((seat) => seat.slot === 'b')
    expect(accountSeat).toMatchObject({
      who: 'someone@example.com',
      plan: 'Design Plan Go',
      usedPercent: 16.9,
      tokens: 12_676_852,
      renews: ['2026-11-03T12:02:05.042Z'],
      rank: 2,
      shared: true,
    })
    // 打码模式（服务端已经抹掉身份）落成空值，而不是 undefined。
    expect(keySeat).toMatchObject({
      who: null,
      plan: null,
      usedPercent: null,
      tokens: null,
      renews: [],
      rank: null,
      shared: false,
    })
  })

  it('never paints an attempt on card 0 when its own card did not fit', () => {
    const older = isoAt(NOW - 10_000)
    const order = Array.from({ length: 12 }, (_unused, index) =>
      candidate({
        slot: `k${index + 1}`,
        provider: `p${String(index + 1).padStart(2, '0')}`,
        model: 'm',
      }),
    )
    // 旧请求的第 11、12 个候选会被 MAX_SEATS(10) 挤掉：它们的尝试必须是 -1，
    // 而不是被夹到第 0 张卡片上（那会把“回答了这个请求”标错账号）。
    const tries = [10, 11].map((index) =>
      attempt({
        slot: `k${index + 1}`,
        model: 'm',
        start: older,
        done: true,
        status: 200,
        ms: 100,
      }),
    )
    const newest = route({
      id: 2,
      agent: 'claude',
      time: isoAt(NOW - 1_000),
      done: true,
      order: [candidate({ slot: 'zz', provider: 'p0', model: 'm' })],
    })

    const view = deriveRoutingView(
      snapshot([route({ id: 1, agent: 'claude', time: older, done: true, order, tries }), newest]),
      NOW,
    )

    expect(view.seats).toHaveLength(10)
    const olderTrip = view.trips.find((trip) => trip.routeId === 1)
    expect(olderTrip?.attempts.map((entry) => entry.seatIndex)).toEqual([-1, -1])
  })

  it('keeps the newest request’s answering seat when candidates exceed the stage', () => {
    const startedAt = isoAt(NOW - 5_000)
    const order = Array.from({ length: 12 }, (_unused, index) =>
      candidate({ slot: `k${index + 1}`, provider: `p${index + 1}`, model: 'm' }),
    )
    // 这次请求第一个尝试的是第 12 个候选（排序后会被挤掉）：它的卡片必须留在
    // 舞台上，否则页面连“回答了这个请求”都没有。
    const tries = [
      attempt({ slot: 'k12', model: 'm', start: startedAt, done: true, status: 200, ms: 100 }),
    ]

    const view = deriveRoutingView(
      snapshot([route({ id: 1, agent: 'claude', time: startedAt, done: true, order, tries })]),
      NOW,
    )

    expect(view.seats).toHaveLength(10)
    const answered = view.seats.find((seat) => seat.slot === 'k12')
    expect(answered).toBeDefined()
    const seatIndex = view.seats.indexOf(answered!)
    expect(view.trips[0]?.attempts[0]?.seatIndex).toBe(seatIndex)
    // 顺位号仍是它在 order 里的真实位置（12），不是被挤掉后重排的 1。
    expect(view.trips[0]?.prioritySeatIndexes).toHaveLength(12)
    expect(view.trips[0]?.prioritySeatIndexes?.[11]).toBe(seatIndex)
    expect(view.trips[0]?.prioritySeatIndexes?.filter((index) => index < 0)).toHaveLength(2)
  })

  it('orders the column by provider rank, with an omitted rank counting as first', () => {
    const view = deriveRoutingView(
      snapshot([
        route({
          id: 1,
          agent: 'claude',
          time: isoAt(NOW - 1_000),
          order: [
            candidate({ slot: 'k3', provider: 'p1', model: 'm', rank: 2 }),
            candidate({ slot: 'k2', provider: 'p1', model: 'm', rank: 1 }),
            candidate({ slot: 'k1', provider: 'p1', model: 'm' }),
          ],
        }),
      ]),
      NOW,
    )

    expect(view.seats.map((seat) => seat.slot)).toEqual(['k1', 'k2', 'k3'])
  })

  it('takes a card quota from the newest request that used it', () => {
    const older = route({
      id: 1,
      agent: 'claude',
      time: isoAt(NOW - 10_000),
      order: [candidate({ slot: 'a', provider: 'p1', model: 'm', usedPercent: 10 })],
    })
    const newer = route({
      id: 2,
      agent: 'claude',
      time: isoAt(NOW - 1_000),
      order: [candidate({ slot: 'a', provider: 'p1', model: 'm', usedPercent: 42 })],
    })

    const view = deriveRoutingView(snapshot([older, newer]), NOW)

    expect(view.seats).toHaveLength(1)
    expect(view.seats[0]?.usedPercent).toBe(42)
  })

  it('marks attempts and trips from status, fail and duration', () => {
    const startedAt = isoAt(NOW - 5_000)
    const view = deriveRoutingView(
      snapshot([
        route({
          id: 1,
          agent: 'claude',
          time: startedAt,
          done: true,
          status: 200,
          ms: 900,
          order: [
            candidate({ slot: 'a', provider: 'p1', model: 'one' }),
            candidate({ slot: 'b', provider: 'p1', model: 'two' }),
          ],
          tries: [
            attempt({
              slot: 'a',
              model: 'one',
              start: startedAt,
              done: true,
              status: 429,
              fail: 'rate',
              ms: 400,
            }),
            attempt({ slot: 'b', model: 'two', start: startedAt, done: true, ms: 500 }),
          ],
        }),
      ]),
      NOW,
    )

    const trip = view.trips[0]
    const startMs = Date.parse(startedAt)
    expect(trip?.ok).toBe(true)
    expect(trip?.status).toBe(200)
    expect(trip?.ms).toBe(900)
    expect(trip?.attempts[0]).toMatchObject({
      ok: false,
      status: 429,
      fail: 'rate',
      done: true,
      ms: 400,
      startedAt: startMs,
      endedAt: startMs + 400,
    })
    expect(trip?.attempts[1]).toMatchObject({ ok: true, status: null, fail: null })
    expect(trip?.attempts[1]?.endedAt).toBe(startMs + 500)
  })

  it('passes totals and the gateway flag through', () => {
    const view = deriveRoutingView(snapshot([], false), NOW)

    expect(view.totals).toEqual(TOTALS)
    expect(view.mine).toBe(false)
    expect(view.trips).toEqual([])
    expect(view.agents).toEqual([])
    expect(view.seats).toEqual([])
  })
})

describe('hueForAgent', () => {
  it('is stable per agent id and differs between known agents', () => {
    expect(hueForAgent('claude')).toBe(hueForAgent('claude'))
    expect(hueForAgent('claude')).not.toBe(hueForAgent('codex'))
    expect(hueForAgent('mystery-agent')).toBe(hueForAgent('mystery-agent'))
    expect(hueForAgent('mystery-agent')).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('never returns a red-family hue', () => {
    const forbidden = new Set(['#dc2626', '#ef4444', '#f43f5e', '#e11d48'])
    const ids = ['claude', 'codex', 'gemini', 'dsh', 'mystery', 'agent-42', 'zzz', '']

    for (const id of ids) {
      const hue = hueForAgent(id)
      expect(hue).toMatch(/^#[0-9a-f]{6}$/)
      expect(forbidden.has(hue)).toBe(false)
    }
  })

  it('still exports the linger duration the component uses', () => {
    expect(LINGER_MS).toBe(12_000)
  })
})

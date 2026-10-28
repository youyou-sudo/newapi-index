import { describe, expect, it } from 'vitest'

import { ARRIVE_MIN_LAG_MS, BACK_MS, BOARD_MS, HOME_MS, OUT_MS, frameForTrip } from '../timeline'
import type { AttemptView, TripView } from '../types'

const T0 = Date.UTC(2026, 0, 1, 12, 0, 0)

function attemptView(input: {
  seatIndex: number
  startedAt: number
  endedAt?: number | null
  done?: boolean
  ok?: boolean
  status?: number | null
  ms?: number | null
  ttft?: number | null
  fail?: string | null
}): AttemptView {
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

function tripView(input: {
  startedAt: number
  attempts?: Array<AttemptView>
  done?: boolean
  ok?: boolean
}): TripView {
  return {
    routeId: 1,
    agentIndex: 0,
    startedAt: input.startedAt,
    model: 'model-x',
    done: input.done ?? false,
    ok: input.ok ?? true,
    status: null,
    ms: null,
    attempts: input.attempts ?? [],
  }
}

interface Change {
  at: number
  phase: string
  attemptIndex: number
}

function timeline(trip: TripView, from: number, to: number, step = 10): Array<Change> {
  const changes: Array<Change> = []
  let previous = ''
  for (let at = from; at <= to; at += step) {
    const frame = frameForTrip(trip, at)
    const key = frame.phase + ':' + frame.attemptIndex
    if (key === previous) continue
    changes.push({ at, phase: frame.phase, attemptIndex: frame.attemptIndex })
    previous = key
  }
  return changes
}

describe('frameForTrip with a seat that did not fit the stage', () => {
  it('waits at the gateway instead of flying to a seat index that is not there', () => {
    const trip = tripView({
      startedAt: T0,
      attempts: [
        attemptView({ seatIndex: -1, startedAt: T0 + BOARD_MS, done: true, ok: true, ms: 100 }),
      ],
    })

    // 没有可落的卡片：直接在网关等，结束就返程，不出现 outbound/held。
    const phases = timeline(trip, T0, T0 + BOARD_MS + 2000)
    expect(phases.map((change) => change.phase)).toEqual(['boarding', 'atHub'])

    const afterDone = tripView({
      startedAt: T0,
      done: true,
      attempts: [attemptView({ seatIndex: -1, startedAt: T0 + BOARD_MS, done: true })],
    })
    expect(frameForTrip(afterDone, T0 + BOARD_MS + 10).phase).toBe('home')
    expect(frameForTrip(afterDone, T0 + BOARD_MS + HOME_MS + 10).visible).toBe(false)
  })
})

// 第一次失败退回网关、第二次成功返程的两跳请求。
const RETRIED = tripView({
  startedAt: T0,
  done: true,
  ok: true,
  attempts: [
    attemptView({
      seatIndex: 0,
      startedAt: T0 + 1_000,
      endedAt: T0 + 2_600,
      done: true,
      ok: false,
      status: 429,
      fail: 'rate',
    }),
    attemptView({
      seatIndex: 1,
      startedAt: T0 + 5_000,
      endedAt: T0 + 7_000,
      done: true,
      ok: true,
      status: 200,
    }),
  ],
})

describe('frameForTrip phases', () => {
  it('walks boarding, outbound, held, back, outbound, held, home, done in order', () => {
    const changes = timeline(RETRIED, T0, T0 + 9_000)

    expect(changes.map((change) => change.phase)).toEqual([
      'boarding',
      'outbound',
      'held',
      'back',
      'atHub',
      'outbound',
      'held',
      'home',
      'done',
    ])
    expect(changes.map((change) => change.attemptIndex)).toEqual([0, 0, 0, 0, 1, 1, 1, 1, 1])
    // 时间轴（BOARD 800 / OUT 900 / BACK 700 / HOME 1000）：
    // 起飞 800、落座 1700、第一次尝试结束 2600、退回网关 3300、第二次起飞 4300、
    // 第二次落座（尝试开始 + 200）5200、作答结束 7000、回到家 8000。
    expect(changes.map((change) => change.at)).toEqual([
      T0,
      T0 + BOARD_MS,
      T0 + 1_700,
      T0 + 2_600,
      T0 + 3_300,
      T0 + 4_300,
      T0 + 5_200,
      T0 + 7_000,
      T0 + 8_000,
    ])
  })

  it('only changes phase at attempt boundaries and never runs time backwards', () => {
    const changes = timeline(RETRIED, T0, T0 + 9_000)
    for (let index = 1; index < changes.length; index += 1) {
      const previous = changes[index - 1]
      const current = changes[index]
      expect(previous).toBeDefined()
      expect(current).toBeDefined()
      if (previous === undefined || current === undefined) continue
      expect(current.at).toBeGreaterThan(previous.at)
    }

    const back = changes.find((change) => change.phase === 'back')
    const nextOut = changes.find((change) => change.phase === 'outbound' && change.attemptIndex === 1)
    expect(back).toBeDefined()
    expect(nextOut).toBeDefined()
    if (back === undefined || nextOut === undefined) return
    expect(nextOut.at).toBeGreaterThanOrEqual(back.at + BACK_MS)
  })

  it('never leaves an agent before boarding ends', () => {
    expect(frameForTrip(RETRIED, T0 - 1).phase).toBe('boarding')
    expect(frameForTrip(RETRIED, T0 + BOARD_MS - 1).phase).toBe('boarding')
    expect(frameForTrip(RETRIED, T0 + BOARD_MS).phase).toBe('outbound')
    expect(frameForTrip(RETRIED, T0 + BOARD_MS).seatIndex).toBe(0)
  })

  it('keeps the dot at the hub while the next attempt has not departed yet', () => {
    const frame = frameForTrip(RETRIED, T0 + 3_600)
    expect(frame).toMatchObject({ phase: 'atHub', progress: 0, attemptIndex: 1, seatIndex: null })
  })

  it('holds at the seat from arrival until the attempt has ended', () => {
    // 落座 = 起飞（BOARD_MS）+ 飞行（OUT_MS）。
    const arrival = T0 + BOARD_MS + OUT_MS
    expect(frameForTrip(RETRIED, arrival - 1).phase).toBe('outbound')
    expect(frameForTrip(RETRIED, arrival).phase).toBe('held')
    expect(frameForTrip(RETRIED, T0 + 2_599).phase).toBe('held')
    expect(frameForTrip(RETRIED, T0 + 2_600).phase).toBe('back')
  })

  it('marks a finished trip as done and invisible', () => {
    expect(frameForTrip(RETRIED, T0 + 100_000)).toEqual({
      phase: 'done',
      progress: 0,
      attemptIndex: 1,
      seatIndex: 1,
      visible: false,
    })
  })

  it('reports a not-yet-departed trip as invisible boarding', () => {
    expect(frameForTrip(RETRIED, T0 - 5_000)).toEqual({
      phase: 'boarding',
      progress: 0,
      attemptIndex: 0,
      seatIndex: null,
      visible: false,
    })
  })
})

describe('frameForTrip arrival rules', () => {
  const LATE = tripView({
    startedAt: T0,
    done: true,
    ok: true,
    attempts: [
      attemptView({
        seatIndex: 0,
        startedAt: T0 + 5_000,
        endedAt: T0 + 8_000,
        done: true,
        ok: true,
        status: 200,
      }),
    ],
  })

  it('arrives no earlier than the attempt start plus the arrival lag', () => {
    expect(frameForTrip(LATE, T0 + 5_190).phase).toBe('outbound')
    expect(frameForTrip(LATE, T0 + 5_200).phase).toBe('held')
    expect(frameForTrip(LATE, T0 + 5_200).attemptIndex).toBe(0)
    expect(frameForTrip(LATE, T0 + 5_200).seatIndex).toBe(0)
    expect(T0 + 5_200).toBe(T0 + 5_000 + ARRIVE_MIN_LAG_MS)
  })

  it('keeps outbound flights exactly OUT_MS long and moves the dot at a constant speed', () => {
    const depart = frameForTrip(LATE, T0 + 4_300)
    expect(depart.phase).toBe('outbound')
    expect(depart.progress).toBe(0)
    // 线性进度：过了半个 OUT_MS 就是一半路程（旧实现用 easeInOut，中段会快一截）。
    const middle = frameForTrip(LATE, T0 + 4_300 + OUT_MS / 2)
    expect(middle.phase).toBe('outbound')
    expect(middle.progress).toBeCloseTo(0.5, 6)
  })

  it('interpolates boarding progress', () => {
    const half = frameForTrip(RETRIED, T0 + BOARD_MS / 2)
    expect(half.phase).toBe('boarding')
    expect(half.progress).toBeCloseTo(0.5, 6)
  })

  it('keeps progress inside 0..1 for every sampled instant', () => {
    for (let at = T0 - 500; at <= T0 + 12_000; at += 37) {
      const frame = frameForTrip(RETRIED, at)
      expect(frame.progress).toBeGreaterThanOrEqual(0)
      expect(frame.progress).toBeLessThanOrEqual(1)
    }
  })
})

describe('frameForTrip unfinished work', () => {
  const RUNNING = tripView({
    startedAt: T0,
    done: false,
    attempts: [attemptView({ seatIndex: 0, startedAt: T0 + 1_000, endedAt: null, done: false })],
  })

  it('keeps an unfinished attempt held and visible forever', () => {
    expect(frameForTrip(RUNNING, T0 + BOARD_MS + OUT_MS + 1).phase).toBe('held')
    const later = frameForTrip(RUNNING, T0 + 600_000)
    expect(later).toMatchObject({ phase: 'held', visible: true, attemptIndex: 0, seatIndex: 0 })
    expect(later.progress).toBe(0)
  })

  it('waits at the hub when routing has not picked a candidate yet', () => {
    const waiting = tripView({ startedAt: T0, done: false })
    expect(frameForTrip(waiting, T0 + 1).phase).toBe('boarding')
    expect(frameForTrip(waiting, T0 + 60_000)).toEqual({
      phase: 'atHub',
      progress: 0,
      attemptIndex: -1,
      seatIndex: null,
      visible: true,
    })
  })

  it('flies straight home and finishes when a candidate-less trip is over', () => {
    const empty = tripView({ startedAt: T0, done: true, ok: true })
    expect(frameForTrip(empty, T0 + BOARD_MS)).toMatchObject({ phase: 'home', progress: 0 })
    const middle = frameForTrip(empty, T0 + BOARD_MS + HOME_MS / 2)
    expect(middle.phase).toBe('home')
    expect(middle.progress).toBeCloseTo(0.5, 6)
    expect(frameForTrip(empty, T0 + BOARD_MS + HOME_MS)).toEqual({
      phase: 'done',
      progress: 0,
      attemptIndex: -1,
      seatIndex: null,
      visible: false,
    })
  })
})

describe('frameForTrip failure endings', () => {
  const FINAL_FAIL = tripView({
    startedAt: T0,
    done: true,
    ok: false,
    attempts: [
      attemptView({
        seatIndex: 0,
        startedAt: T0 + 1_000,
        endedAt: T0 + 2_000,
        done: true,
        ok: false,
        status: 429,
        fail: 'rate',
      }),
    ],
  })

  it('goes home after a final failure instead of returning to the hub', () => {
    expect(timeline(FINAL_FAIL, T0, T0 + 6_000).map((change) => change.phase)).toEqual([
      'boarding',
      'outbound',
      'held',
      'home',
      'done',
    ])
    expect(frameForTrip(FINAL_FAIL, T0 + 1_900).phase).toBe('held')
    expect(frameForTrip(FINAL_FAIL, T0 + 2_000).phase).toBe('home')
    expect(frameForTrip(FINAL_FAIL, T0 + 2_000 + HOME_MS).phase).toBe('done')
  })

  it('recovers when a fast attempt ends before the dot has arrived', () => {
    const fast = tripView({
      startedAt: T0,
      done: true,
      ok: true,
      attempts: [
        attemptView({
          seatIndex: 0,
          startedAt: T0 + 1_000,
          endedAt: T0 + 1_080,
          done: true,
          ok: false,
          status: 503,
          fail: 'other',
        }),
        attemptView({
          seatIndex: 1,
          startedAt: T0 + 1_100,
          endedAt: T0 + 2_000,
          done: true,
          ok: true,
          status: 200,
        }),
      ],
    })

    const changes = timeline(fast, T0, T0 + 5_000)
    expect(changes.map((change) => change.phase)).toEqual([
      'boarding',
      'outbound',
      'back',
      'outbound',
      'home',
      'done',
    ])
    const back = changes.find((change) => change.phase === 'back')
    const secondOut = changes.filter((change) => change.phase === 'outbound')[1]
    expect(back).toBeDefined()
    expect(secondOut).toBeDefined()
    if (back === undefined || secondOut === undefined) return
    expect(secondOut.at).toBeGreaterThanOrEqual(back.at + BACK_MS)
    expect(frameForTrip(fast, back.at).progress).toBe(0)
  })

  it('finishes a trip whose last attempt never got marked done', () => {
    const stale = tripView({
      startedAt: T0,
      done: true,
      ok: true,
      attempts: [
        attemptView({
          seatIndex: 0,
          startedAt: T0 + 1_000,
          endedAt: T0 + 2_000,
          done: true,
          ok: false,
          status: 500,
          fail: 'other',
        }),
        attemptView({ seatIndex: 1, startedAt: T0 + 2_000, endedAt: null, done: false }),
      ],
    })

    expect(frameForTrip(stale, T0 + 100_000).phase).toBe('done')
    expect(frameForTrip(stale, T0 + 100_000).visible).toBe(false)
  })
})

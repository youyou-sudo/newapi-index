import { describe, expect, it } from 'vitest'

import {
  HUB_SIZE,
  easeInOut,
  hubCentre,
  layoutStage,
  pointOnLeg,
  type Box,
  type Point,
} from '../geometry'

const STAGE = layoutStage({ width: 1_200, height: 600, agentCount: 3, seatCount: 4 })

function sum(values: Array<number>): number {
  return values.reduce((total, value) => total + value, 0)
}

function boxNumbers(box: Box): Array<number> {
  return [box.x, box.y, box.width, box.height]
}

function expectPoint(actual: Point, expected: Point): void {
  expect(actual.x).toBeCloseTo(expected.x, 6)
  expect(actual.y).toBeCloseTo(expected.y, 6)
}

describe('layoutStage columns', () => {
  it('puts agents on the left, the hub in the middle and seats on the right', () => {
    expect(HUB_SIZE).toBe(96)
    expect(STAGE.width).toBe(1_200)
    expect(STAGE.height).toBe(600)
    expect(STAGE.agents).toHaveLength(3)
    expect(STAGE.seats).toHaveLength(4)
    expect(STAGE.hub.width).toBe(HUB_SIZE)
    expect(STAGE.hub.height).toBe(HUB_SIZE)
    expect(STAGE.hub.x).toBeCloseTo((1_200 - HUB_SIZE) / 2, 6)
    expect(STAGE.hub.y).toBeCloseTo((600 - HUB_SIZE) / 2, 6)

    for (const agent of STAGE.agents) {
      expect(agent.x + agent.width).toBeLessThanOrEqual(STAGE.hub.x)
    }
    for (const seat of STAGE.seats) {
      expect(seat.x).toBeGreaterThanOrEqual(STAGE.hub.x + STAGE.hub.width)
    }
  })

  it('centres each column vertically and keeps the gap between nodes', () => {
    const first = STAGE.agents[0]
    const last = STAGE.agents[STAGE.agents.length - 1]
    expect(first).toBeDefined()
    expect(last).toBeDefined()
    if (first === undefined || last === undefined) return

    expect((first.y + last.y + last.height) / 2).toBeCloseTo(300, 6)
    expect(first.y).toBeGreaterThanOrEqual(16)
    for (let index = 1; index < STAGE.agents.length; index += 1) {
      const previous = STAGE.agents[index - 1]
      const current = STAGE.agents[index]
      expect(previous).toBeDefined()
      expect(current).toBeDefined()
      if (previous === undefined || current === undefined) continue
      expect(current.y).toBeGreaterThan(previous.y)
    }
    expect(hubCentre(STAGE).x).toBeCloseTo(600, 6)
    expect(hubCentre(STAGE).y).toBeCloseTo(300, 6)
  })
})

describe('layoutStage wires', () => {
  it('starts the agent wire on the agent edge and ends it at the hub centre', () => {
    const agent = STAGE.agents[0]
    expect(agent).toBeDefined()
    if (agent === undefined) return

    const wire = STAGE.agentWire(0)
    expect(wire.d.startsWith('M ')).toBe(true)
    expect(wire.d).toContain(' C ')
    expect(wire.length).toBeGreaterThan(0)
    expectPoint(wire.pointAt(0), { x: agent.x + agent.width, y: agent.y + agent.height / 2 })
    // 终点在网关**中心**：卡片不透明，画在连线之上，所以最后一段是看不见的。
    expectPoint(wire.pointAt(1), hubCentre(STAGE))
  })

  it('starts the seat wire at the hub centre and ends it on the seat edge', () => {
    const seat = STAGE.seats[0]
    expect(seat).toBeDefined()
    if (seat === undefined) return

    const wire = STAGE.seatWire(0)
    expect(wire.length).toBeGreaterThan(0)
    expectPoint(wire.pointAt(0), hubCentre(STAGE))
    expectPoint(wire.pointAt(1), { x: seat.x, y: seat.y + seat.height / 2 })
  })

  it('meets at the hub centre so a packet can continue without jumping', () => {
    // 光点从客户端那条线钻进网关、再从账号那条线出来；两条线必须在同一点相接。
    for (const index of [0, 1, 2]) {
      for (const agentIndex of [0, 1, 2]) {
        expectPoint(STAGE.agentWire(agentIndex).pointAt(1), hubCentre(STAGE))
      }
      expectPoint(STAGE.seatWire(index).pointAt(0), hubCentre(STAGE))
    }
  })

  it('runs the agent leg from the agent centre to the hub centre', () => {
    const agent = STAGE.agents[1]
    expect(agent).toBeDefined()
    if (agent === undefined) return

    const leg = STAGE.agentLeg(1)
    expectPoint(leg.pointAt(0), {
      x: agent.x + agent.width / 2,
      y: agent.y + agent.height / 2,
    })
    expectPoint(leg.pointAt(1), hubCentre(STAGE))
  })

  it('parks the seat leg at the seat left edge, not on the text', () => {
    const seat = STAGE.seats[2]
    expect(seat).toBeDefined()
    if (seat === undefined) return

    const leg = STAGE.seatLeg(2)
    expectPoint(leg.pointAt(0), hubCentre(STAGE))
    expectPoint(leg.pointAt(1), { x: seat.x, y: seat.y + seat.height / 2 })
    expect(leg.pointAt(1).x).toBeLessThan(seat.x + seat.width / 2)
  })

  it('clamps the wire parameter to 0..1', () => {
    const wire = STAGE.seatWire(1)
    expectPoint(wire.pointAt(-2), wire.pointAt(0))
    expectPoint(wire.pointAt(4), wire.pointAt(1))
    expect(wire.pointAt(0.5).x).toBeGreaterThan(wire.pointAt(0).x)
    expect(wire.pointAt(0.5).x).toBeLessThan(wire.pointAt(1).x)
  })

  it('walks monotonically along the arc length', () => {
    const wire = STAGE.agentWire(0)
    let previous = wire.pointAt(0)
    const steps: Array<number> = []
    for (let step = 1; step <= 12; step += 1) {
      const next = wire.pointAt(step / 12)
      expect(next.x).toBeGreaterThanOrEqual(previous.x - 1e-6)
      steps.push(Math.hypot(next.x - previous.x, next.y - previous.y))
      previous = next
    }
    // 相邻弦长之和不会超过弧长，且应当非常接近它。
    expect(sum(steps)).toBeLessThanOrEqual(wire.length + 1e-6)
    expect(sum(steps)).toBeGreaterThan(wire.length * 0.97)
  })

  it('returns a zero-length wire at the hub centre for unknown indexes', () => {
    const centre = hubCentre(STAGE)
    const wires = [
      STAGE.agentWire(9),
      STAGE.agentWire(-1),
      STAGE.seatWire(9),
      STAGE.agentLeg(3),
      STAGE.seatLeg(-4),
    ]

    for (const wire of wires) {
      expect(wire.length).toBe(0)
      expectPoint(wire.pointAt(0.5), centre)
    }
  })

  it('returns the same wire for the same index', () => {
    expect(STAGE.agentWire(1).d).toBe(STAGE.agentWire(1).d)
    expect(STAGE.seatWire(2).length).toBe(STAGE.seatWire(2).length)
    expectPoint(STAGE.agentLeg(0).pointAt(0.5), STAGE.agentLeg(0).pointAt(0.5))
  })
})

describe('layoutStage guards', () => {
  it('clamps degenerate input instead of producing NaN', () => {
    const inputs = [
      { width: 0, height: 0, agentCount: 2, seatCount: 3 },
      { width: -40, height: -10, agentCount: 1, seatCount: 1 },
      { width: Number.NaN, height: 200, agentCount: 2, seatCount: 2 },
      { width: 120, height: 20, agentCount: 8, seatCount: 9 },
    ]

    for (const input of inputs) {
      const stage = layoutStage(input)
      const numbers = [
        stage.width,
        stage.height,
        ...boxNumbers(stage.hub),
        ...stage.agents.flatMap(boxNumbers),
        ...stage.seats.flatMap(boxNumbers),
      ]
      for (const value of numbers) expect(Number.isFinite(value)).toBe(true)
      for (const wire of [stage.agentWire(0), stage.seatWire(0), stage.agentLeg(0), stage.seatLeg(0)]) {
        expect(Number.isFinite(wire.length)).toBe(true)
        expect(Number.isFinite(wire.pointAt(0.5).x)).toBe(true)
        expect(Number.isFinite(wire.pointAt(0.5).y)).toBe(true)
      }
    }
  })

  it('keeps the stack inside a short stage', () => {
    const stage = layoutStage({ width: 320, height: 20, agentCount: 4, seatCount: 4 })
    for (const box of [...stage.agents, ...stage.seats]) {
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.y + box.height).toBeLessThanOrEqual(20 + 1e-6)
    }
  })
})

describe('easeInOut', () => {
  it('eases from 0 to 1 through 0.5 and clamps its input', () => {
    expect(easeInOut(0)).toBe(0)
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6)
    expect(easeInOut(1)).toBe(1)
    expect(easeInOut(-3)).toBe(0)
    expect(easeInOut(9)).toBe(1)
    expect(easeInOut(Number.NaN)).toBe(0)
    expect(easeInOut(0.25)).toBeLessThan(easeInOut(0.5))
  })
})

describe('pointOnLeg', () => {
  const leg = STAGE.seatLeg(0)

  it('reads the wire forwards by default', () => {
    expectPoint(pointOnLeg(leg, 0), leg.pointAt(0))
    expectPoint(pointOnLeg(leg, 1), leg.pointAt(1))
    expectPoint(pointOnLeg(leg, -1), leg.pointAt(0))
    expectPoint(pointOnLeg(leg, 2), leg.pointAt(1))
  })

  it('walks the wire backwards when reversed', () => {
    expectPoint(pointOnLeg(leg, 0, true), leg.pointAt(1))
    expectPoint(pointOnLeg(leg, 1, true), leg.pointAt(0))
    expectPoint(pointOnLeg(leg, 0.5, true), pointOnLeg(leg, 0.5))
  })
})
import type { RoutingView, TripView } from '~/lib/routing/types'

export type WireState = 'idle' | 'live' | 'lit' | 'rest'

export interface Wiring {
  agentStates: Array<WireState>
  seatStates: Array<WireState>
  /** 此刻正在被回答的落点：卡片显示“回答中…”，连线是流动的虚线。 */
  heldSeats: Set<number>
}

/** 网关最后一条请求：实线与“回答了这个请求/失败”都只讲它。 */
export function focusTrip(trips: Array<TripView>): TripView | null {
  return trips.reduce<TripView | null>(
    (newest, trip) => (!newest || trip.startedAt >= newest.startedAt ? trip : newest),
    null,
  )
}

/**
 * 每个落点此刻是不是“正在被回答”。
 *
 * 看**所有在途请求**，不只最新那条：只要这个渠道还有模型在答，它就一直在里面——
 * 卡片上一直是“回答中…”，连线一直是流动的虚线。同一张卡被两条请求同时用到时只认
 * 最后（最新）的那次尝试。
 */
export function liveSeatsOf(trips: Array<TripView>): Map<number, number> {
  const live = new Map<number, number>()
  for (const trip of trips) {
    if (trip.done) continue
    for (const attempt of trip.attempts) {
      if (attempt.seatIndex < 0 || attempt.done) continue
      const seen = live.get(attempt.seatIndex)
      if (seen === undefined || attempt.startedAt >= seen) {
        live.set(attempt.seatIndex, attempt.startedAt)
      }
    }
  }
  return live
}

/**
 * 连线状态，只由数据决定：
 * - 在途的请求：它的智能体线、正在作答的卡片线都是 {@link WireState} 'live'（流动虚线）；
 * - 没有请求在跑时，网关**最后一条**请求的路径留在图上（'lit'，实线）；
 * - 其余落点是 'rest'（灰色虚线）。
 */
export function computeWiring(view: RoutingView): Wiring {
  const live = liveSeatsOf(view.trips)
  const focus = focusTrip(view.trips)
  const agentStates: Array<WireState> = view.agents.map(() => 'idle')
  const seatStates: Array<WireState> = view.seats.map(() => 'rest')

  for (const trip of view.trips) {
    if (trip.done) continue
    if (agentStates[trip.agentIndex] !== undefined) agentStates[trip.agentIndex] = 'live'
  }
  for (const seatIndex of live.keys()) {
    if (seatStates[seatIndex] !== undefined) seatStates[seatIndex] = 'live'
  }

  if (focus) {
    const agentState = agentStates[focus.agentIndex]
    if (agentState !== undefined && agentState !== 'live') {
      agentStates[focus.agentIndex] = focus.done ? 'lit' : 'live'
    }
    for (const attempt of focus.attempts) {
      // seatIndex < 0：落点没进舞台，不画到任何卡片上（更不能落到第 0 张）。
      if (attempt.seatIndex < 0) continue
      const current = seatStates[attempt.seatIndex]
      if (current === 'live') continue
      seatStates[attempt.seatIndex] = focus.done ? 'lit' : 'live'
    }
  }

  return { agentStates, seatStates, heldSeats: new Set(live.keys()) }
}

/**
 * 把「一条请求 + 当前时刻」换算成动画描述：阶段、阶段内进度、以及点该停在哪。
 *
 * 纯函数，不碰 DOM 也不碰 rAF；组件每帧拿 nowMs 调一次即可。
 * 所有分支按时间先后排列，因此点只会在一段动作结束时换段，不会来回跳。
 */

import type { AttemptView, TripView } from './types'

/** 请求从智能体飞到网关中心的时长。 */
export const BOARD_MS = 800
/** 网关飞向候选卡片的时长（只算看得见的那一段，见 routing-stage 的 legArcs）。 */
export const OUT_MS = 900
/** 失败后从卡片退回网关的时长。 */
export const BACK_MS = 700
/** 从卡片回到智能体的时长。 */
export const HOME_MS = 1_000
/** 到达卡片至少要等尝试开始这么久，避免点比数据先到。 */
export const ARRIVE_MIN_LAG_MS = 200
/** 再快的尝试，点也要飞这么久：一瞬间闪过去看不清。 */
export const MIN_FLIGHT_MS = 600

export type TripPhase = 'boarding' | 'atHub' | 'outbound' | 'held' | 'back' | 'home' | 'done'

/**
 * 这一次尝试的飞行时长（毫秒）。
 *
 * 默认用 OUT_MS（慢一点、匀速看得清），但不会长过这次尝试本身：一次 800ms 就答完的
 * 请求，如果点还在路上飞 1.5 秒，画面上就成了“答案先到、点后到”。下限 MIN_FLIGHT_MS
 * 保证再短的尝试也有看得见的移动。
 */
function flightMs(attempt: AttemptView): number {
  if (!attempt.done || attempt.endedAt === null) return OUT_MS
  const span = attempt.endedAt - attempt.startedAt
  return Math.min(OUT_MS, Math.max(MIN_FLIGHT_MS, span))
}

export interface TripFrame {
  /** 当前阶段。 */
  phase: TripPhase
  /** 正在移动的阶段里的 0..1 进度；停住的阶段恒为 0。 */
  progress: number
  /** 这段动画对应的尝试序号，路由还没挑出候选时为 -1。 */
  attemptIndex: number
  /** 这段动画落脚的座位序号，还没落座时为 null。 */
  seatIndex: number | null
  /** 点此刻是否应该画出来。 */
  visible: boolean
}

function clampRatio(nowMs: number, fromMs: number, spanMs: number): number {
  if (!(spanMs > 0)) return nowMs >= fromMs ? 1 : 0
  return Math.min(1, Math.max(0, (nowMs - fromMs) / spanMs))
}

function frame(
  phase: TripPhase,
  progress: number,
  attemptIndex: number,
  seatIndex: number | null,
  visible: boolean,
): TripFrame {
  return { phase, progress, attemptIndex, seatIndex, visible }
}

/** Describes what a trip is doing at nowMs: phase, progress and the seat it targets. */
export function frameForTrip(trip: TripView, nowMs: number): TripFrame {
  const startedAt = Number.isFinite(trip.startedAt) ? trip.startedAt : 0
  const now = Number.isFinite(nowMs) ? nowMs : startedAt
  const hubAt = startedAt + BOARD_MS
  const attempts = trip.attempts
  const upcoming = attempts.length > 0 ? 0 : -1

  if (now < startedAt) return frame('boarding', 0, upcoming, null, false)
  if (now < hubAt) {
    return frame('boarding', clampRatio(now, startedAt, BOARD_MS), upcoming, null, true)
  }

  if (attempts.length === 0) {
    // 路由还没挑出候选：点在网关中心等着；请求结束后从这里直接返程。
    if (!trip.done) return frame('atHub', 0, -1, null, true)
    if (now < hubAt + HOME_MS) {
      return frame('home', clampRatio(now, hubAt, HOME_MS), -1, null, true)
    }
    return frame('done', 0, -1, null, false)
  }

  // 落点没进舞台的尝试不画：点在网关等着，别为一次看不见的“外出”空等 OUT_MS。
  if (!attempts.some((attempt) => attempt.seatIndex >= 0)) {
    if (!trip.done) return frame('atHub', 0, -1, null, true)
    if (now < hubAt + HOME_MS) {
      return frame('home', clampRatio(now, hubAt, HOME_MS), -1, null, true)
    }
    return frame('done', 0, -1, null, false)
  }

  let freeAt = hubAt

  for (let index = 0; index < attempts.length; index += 1) {
    const attempt = attempts[index]
    if (attempt === undefined) break
    if (attempt.seatIndex < 0) continue
    const previous = attempts[index - 1]
    const previousEnd = previous === undefined ? hubAt : (previous.endedAt ?? attempt.startedAt)
    const flight = flightMs(attempt)
    const desiredArrival = Math.max(previousEnd + flight, attempt.startedAt + ARRIVE_MIN_LAG_MS)
    // 上一段失败时点要先飞回网关，所以起飞只能推迟，不能提前。
    const departAt = Math.max(desiredArrival - flight, freeAt)
    const arriveAt = departAt + flight
    const last = index === attempts.length - 1

    if (now < departAt) return frame('atHub', 0, index, null, true)
    if (now < arriveAt) {
      return frame('outbound', clampRatio(now, departAt, flight), index, attempt.seatIndex, true)
    }

    const settled = attempt.done && attempt.endedAt !== null
    // 数据打架（整条请求已结束、最后一次尝试还没标记完成）时按到达即收尾，别把点钉死。
    const staleFinished = !settled && last && trip.done
    if (!settled && !staleFinished) {
      return frame('held', 0, index, attempt.seatIndex, true)
    }

    const leaveAt =
      settled && attempt.endedAt !== null ? Math.max(attempt.endedAt, arriveAt) : arriveAt
    if (now < leaveAt) return frame('held', 0, index, attempt.seatIndex, true)

    const next = attempts[index + 1]
    if (!attempt.ok && next !== undefined) {
      const backAt = leaveAt + BACK_MS
      if (now < backAt) {
        return frame('back', clampRatio(now, leaveAt, BACK_MS), index, attempt.seatIndex, true)
      }
      freeAt = backAt
      continue
    }

    const homeAt = leaveAt + HOME_MS
    if (now < homeAt) {
      return frame('home', clampRatio(now, leaveAt, HOME_MS), index, attempt.seatIndex, true)
    }
    return frame('done', 0, index, attempt.seatIndex, false)
  }

  const tail = attempts[attempts.length - 1]
  return frame('done', 0, attempts.length - 1, tail?.seatIndex ?? null, false)
}

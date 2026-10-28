import type { TripView } from '~/lib/routing/types'
import { BOARD_MS, OUT_MS } from '~/lib/routing/timeline'

/** 请求已经结束多久之后就不再补播它的返程。 */
export const STALE_AFTER_MS = 2_000

/** 一次尝试在“表演时间轴”上的样子：时刻由动画时钟决定，不跟服务器时间绑死。 */
export interface DotAttempt {
  seatIndex: number
  startedAt: number
  endedAt: number | null
  done: boolean
  ok: boolean
}

/** 一条请求的表演时间轴。 */
export interface DotState {
  /** 动画起点：第一次看到这条请求的时刻（或推算出来的起点）。 */
  startedAt: number
  attempts: Array<DotAttempt>
  done: boolean
}

/**
 * 推进一条请求的动画状态。
 *
 * 动画按固定时长一段段播（登机 800ms、出程 900ms、退回 700ms、回家 1000ms），
 * 数据只负责把**事件**接进来：第一次看到它就从客户端起飞；某次尝试结束就把它的
 * 结束时间记为“现在”；整条请求结束就准备返程。于是：
 * - 回答完成的那一刻，返程动画立刻开始，不会慢半拍；
 * - 返程本身仍按正常时长播放，不会为了追上时间而快进；
 * - 还没播完的请求（即使已经被挤出数据窗口）继续按自己的节奏播完。
 */
export function advanceDot(
  previous: DotState | undefined,
  real: TripView,
  nowMs: number,
): DotState {
  if (previous === undefined) {
    // 第一次看到就已经结束：刚结束的从账号那边飞回家（约 1 秒）；早就结束的不补播，
    // 否则刷新页面时十条旧请求会一起“回家”。
    if (real.done) {
      const last = real.attempts[real.attempts.length - 1]
      const lastEnd = last?.endedAt ?? null
      if (lastEnd === null || nowMs - lastEnd > STALE_AFTER_MS) {
        return { startedAt: nowMs - STALE_AFTER_MS, done: true, attempts: [] }
      }
      return {
        startedAt: nowMs - BOARD_MS - OUT_MS,
        done: true,
        attempts: last === undefined
          ? []
          : [
              {
                seatIndex: last.seatIndex,
                startedAt: nowMs - OUT_MS,
                endedAt: nowMs,
                done: true,
                ok: last.ok,
              },
            ],
      }
    }
  }

  const state: DotState =
    previous === undefined
      ? { startedAt: nowMs, attempts: [], done: false }
      : {
          startedAt: previous.startedAt,
          done: previous.done,
          attempts: previous.attempts.map((attempt) => ({ ...attempt })),
        }

  for (let index = 0; index < real.attempts.length; index += 1) {
    const source = real.attempts[index]
    if (source === undefined) break
    let attempt = state.attempts[index]
    if (attempt === undefined) {
      // 新的一次尝试：从现在出发，别把服务器时间当成动画时间。
      attempt = { seatIndex: source.seatIndex, startedAt: nowMs, endedAt: null, done: false, ok: false }
      state.attempts[index] = attempt
    }
    if (attempt.seatIndex !== source.seatIndex) attempt.seatIndex = source.seatIndex
    if (source.done && !attempt.done) {
      attempt.done = true
      attempt.endedAt = nowMs
      attempt.ok = source.ok
    }
  }

  if (real.done) state.done = true
  return state
}

/** 用真实请求的元信息 + 表演时间轴，拼出时间轴函数认识的 TripView。 */
export function dotTrip(state: DotState, real: TripView): TripView {
  return {
    ...real,
    startedAt: state.startedAt,
    done: state.done,
    attempts: state.attempts.map((attempt, index) => {
      const source = real.attempts[index]
      return {
        ...attempt,
        status: source?.status ?? null,
        ms: null,
        ttft: null,
        fail: source?.fail ?? null,
      }
    }),
  }
}

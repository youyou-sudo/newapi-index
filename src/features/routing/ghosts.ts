import type { TripView } from '~/lib/routing/types'

/**
 * 幽灵（ghost）：已经离开数据窗口、但动画还没播完的请求。
 *
 * 数据窗口最多 10 条请求、最多 4 个智能体，新请求会把旧的挤出去；可旧请求的小点
 * 可能还在回程路上。一个点代表一条请求，所以在它播完之前要留在舞台上。
 *
 * **但幽灵只能用来播完动画，不能用来等数据。** 一条请求离开窗口之后就不会再更新
 * 了：如果它当时还在作答，它的“作答中”会永远停在最后一份数据上，小点就永远钉在
 * 账号旁边、连线永远是流动虚线——线上出现过网关显示“没有在途”，图里却一直有线
 * 亮着、有光点停在卡片旁边。所以幽灵要么收尾（见 {@link retireTrip}），要么在有
 * 限时间内清掉（见 {@link GHOST_TTL_MS}）。
 */
export interface GhostTrip {
  trip: TripView
  /**
   * 它属于哪个智能体。
   *
   * 不能存 agentIndex：那是旧视图里的列位置，智能体被挤掉/换序之后会指到别人身上
   * （历史 bug：别人的线被点亮）。这里存稳定键，画线时再查当前位置。
   */
  agentKey: string
  /** 离开数据窗口的时刻（动画时钟，毫秒）。 */
  since: number
}

/** 数据窗口里的请求：快照 + 它属于哪个智能体（智能体已经不在舞台上时为空）。 */
export interface KnownTrip {
  trip: TripView
  agentKey: string | null
}

/**
 * 幽灵最多再留这么久。
 *
 * 收尾后的最长返程是「先飞完还没走完的出程（≤ OUT_MS）+ 回家（HOME_MS）」，
 * 留一倍余量；超过它说明时间轴没走完，宁可把点清掉，也不能让它永远亮着。
 */
export const GHOST_TTL_MS = 4_000

/**
 * 把一条即将离开窗口的请求收尾：还在途的尝试按“已经结束”记账。
 *
 * 它的数据不会再更新了，等下去只会把点和线永远钉在舞台上。收尾之后时间轴会按正常
 * 时长播一次返程，播完 `frameForTrip` 就返回不可见，幽灵随即被删掉。
 */
export function retireTrip(trip: TripView, nowMs: number): TripView {
  if (trip.done) return trip
  return {
    ...trip,
    done: true,
    attempts: trip.attempts.map((attempt) =>
      attempt.done ? attempt : { ...attempt, done: true, endedAt: nowMs },
    ),
  }
}

/**
 * 同步幽灵表。
 *
 * - 新离开窗口的请求：智能体还在舞台上就收尾后留下（小点飞完返程），智能体已经不在
 *   就没有可以沿着飞回去的线，直接不留；
 * - 重新回到窗口的请求：删掉幽灵，交还给数据；
 * - `known` 永远只保留当前窗口里的请求。
 *
 * 返回是否发生了变化（调用方据此触发一次重渲染，让幽灵的 circle 挂上去/摘下来）。
 */
export function syncGhosts(
  known: Map<number, KnownTrip>,
  ghosts: Map<number, GhostTrip>,
  current: Array<TripView>,
  agentKeyOf: (trip: TripView) => string | null,
  nowMs: number,
): boolean {
  const present = new Map<number, TripView>()
  for (const trip of current) present.set(trip.routeId, trip)

  let changed = false
  for (const [routeId, entry] of known) {
    if (present.has(routeId) || ghosts.has(routeId)) continue
    if (entry.agentKey === null) continue
    ghosts.set(routeId, {
      trip: retireTrip(entry.trip, nowMs),
      agentKey: entry.agentKey,
      since: nowMs,
    })
    changed = true
  }
  for (const routeId of present.keys()) {
    if (ghosts.delete(routeId)) changed = true
  }

  known.clear()
  for (const trip of current) known.set(trip.routeId, { trip, agentKey: agentKeyOf(trip) })
  return changed
}

/** 清掉超过 {@link GHOST_TTL_MS} 还没播完的幽灵（兜底：时间轴卡住时也不能永远亮着）。 */
export function expireGhosts(ghosts: Map<number, GhostTrip>, nowMs: number): boolean {
  let changed = false
  for (const [routeId, ghost] of ghosts) {
    if (nowMs - ghost.since < GHOST_TTL_MS) continue
    ghosts.delete(routeId)
    changed = true
  }
  return changed
}

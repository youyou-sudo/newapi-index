import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { svgPathProperties } from 'svg-path-properties'
import { easeInOut, hubCentre, layoutStage, stageMetrics } from '~/lib/routing/geometry'
import type { Box, Point, StageLayout, Wire } from '~/lib/routing/geometry'
import { frameForTrip } from '~/lib/routing/timeline'
import type { TripFrame } from '~/lib/routing/timeline'
import type { RoutingView, TripView } from '~/lib/routing/types'
import { cn } from '~/lib/utils'
import { expireGhosts, syncGhosts } from './ghosts'
import type { GhostTrip, KnownTrip } from './ghosts'
import { durationLabel } from './labels'
import { advanceDot, dotTrip } from './motion'
import { AgentNode, HubNode, SeatNode } from './stage-nodes'
import { computeWiring, focusTrip } from './wiring'
import type { WireState } from './wiring'

/** 舞台的最小高度：只有一两个节点时也不至于被压成一条。 */
const MIN_STAGE_HEIGHT = 184
/** 舞台上下留白，与 geometry.ts 的 padding 呼应（只用于算高度）。 */
const STAGE_PADDING = 76
/** 上限放宽到能放下 10 张候选卡：卡片有三行文字，压缩会裁字。 */
const MAX_STAGE_HEIGHT = 900
/** 渠道分组框与卡片之间的留白。 */
const GROUP_PAD = 6

type SeatTone = 'ok' | 'fail' | 'live' | 'idle'

/** 连线状态的强弱：实线 < 流动虚线；rest / idle 都只是“没亮”。 */
const WIRE_RANK: Record<WireState, number> = { idle: 0, rest: 1, lit: 2, live: 3 }

function mergeState(base: WireState, animated: WireState): WireState {
  return WIRE_RANK[animated] > WIRE_RANK[base] ? animated : base
}

interface RoutingStageProps {
  view: RoutingView
  /** 服务端时钟与本机时钟的差（毫秒）：时间是服务端给的，动画按服务端时钟走。 */
  clockOffset: number
  /** 已经从上游读到数据（网关是否“已启用”还要看 mine）。 */
  connected: boolean
  /** 候选卡片上的账户身份画成 ***，默认打码。 */
  masked?: boolean
}

/**
 * 页面挂载之后才给出“现在”。
 *
 * 卡片上的“6 天后重置”是相对时间，如果 SSR 也照同一份时钟算，服务端渲染的文本
 * 与浏览器 hydrate 时算出的分钟数会差一点，React 会报 hydration 不一致。所以
 * 首帧一律不画相对时间（nowMs = 0），挂载后每分钟补一次。
 */
function useClientNow(clockOffset: number): number {
  const [nowMs, setNowMs] = useState(0)
  useEffect(() => {
    const tick = () => setNowMs(Date.now() + clockOffset)
    tick()
    const handle = setInterval(tick, 60_000)
    return () => clearInterval(handle)
  }, [clockOffset])
  return nowMs
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false)
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    const apply = () => setReduced(query.matches)
    apply()
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [])
  return reduced
}

/**
 * Frame -> 舞台坐标：点走的就是画出来的那条线（agentWire / seatWire）。
 *
 * 以前走的是“腿”（节点中心到节点中心的另一条曲线）：点和线是两条不同的曲线，
 * 点还会浮在节点卡片上面，看着像没走在路径上。现在两者同源，点只在网关卡片后面
 * 穿过一次（那一段本来就看不见）。
 *
 * 进度按 easeInOut 映射成位置：起步和到站都慢、中段快一点，点才不像被瞬移过去。
 * 时长在 timeline.ts（BOARD_MS / OUT_MS / BACK_MS / HOME_MS），想整体快慢改那里。
 */
/** 光点半径（SVG 用户坐标）+ 一点余量：贴在卡片边上时不能被卡片盖掉一半。 */
const DOT_MARGIN = 7

interface WireSampler {
  total: number
  pointAtLength: (length: number) => Point
}

/** 同一条线只解析一次（卡片数量/布局变了才会出现新的 d）。 */
const samplerCache = new Map<string, WireSampler>()

/**
 * 沿着画出来的那条 SVG 路径做弧长采样（`svg-path-properties`）。
 *
 * 光点走的就是这条 d：以前自己算弧长表，与渲染出来的路径、以及两段路径在网关
 * 处的接缝各算各的，才会出现“点不在线上 / 到网关跳一下”。现在统一交给公共库，
 * 点一定落在路径上；两段又在网关中心相接，于是没有跳变。
 */
function samplerFor(wire: Wire): WireSampler {
  const cached = samplerCache.get(wire.d)
  if (cached !== undefined) return cached
  const properties = new svgPathProperties(wire.d)
  const total = properties.getTotalLength()
  const sampler: WireSampler = {
    total,
    pointAtLength: (length) =>
      properties.getPointAtLength(Math.min(total, Math.max(0, length))),
  }
  // 布局变化会产生新的 d；留一个上限，长跑页面不至于越攒越多。
  if (samplerCache.size > 240) samplerCache.clear()
  samplerCache.set(wire.d, sampler)
  return sampler
}

/** 沿一条线的弧长区间取点：进出网关的那一小截藏在卡片背后，不参与计时。 */
function pointOnArc(wire: Wire, t: number, from: number, to: number): Point {
  const sampler = samplerFor(wire)
  const clamped = Math.min(1, Math.max(0, t))
  return sampler.pointAtLength(from + (to - from) * clamped)
}

/** 光点半径 + 余量：停在账号卡旁边时整颗都在卡片外。 */
const HUB_CARD_INSET = 14

/** 弧长上的 x 交点（线是单调的，二分即可），按「线 + x」缓存。 */
const arcCache = new Map<string, number>()

function lengthAtX(wire: Wire, targetX: number): number {
  const key = wire.d + '|' + targetX.toFixed(1)
  const cached = arcCache.get(key)
  if (cached !== undefined) return cached
  const sampler = samplerFor(wire)
  let low = 0
  let high = sampler.total
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2
    if (sampler.pointAtLength(mid).x < targetX) low = mid
    else high = mid
  }
  if (arcCache.size > 240) arcCache.clear()
  arcCache.set(key, high)
  return high
}

/**
 * 两段「看得见」的弧长区间。
 *
 * 两条线都在网关中心相接；进/出网关的那一小截（左边进去一点、右边出来一点）
 * 整颗光点都藏在卡片背后，计时只算看得见的部分——所以重做接缝之后网关照旧
 * 是同样的速度，不会因为多走了卡片背后那几十像素而变慢。
 */
interface LegArcs {
  /** 客户端卡片右边 -> 网关卡片里面一点。 */
  boardFrom: number
  boardTo: number
  /** 网关卡片里面一点 -> 账号卡片左边。 */
  outFrom: number
  outTo: number
}

function legArcs(agentWire: Wire, seatWire: Wire | null, hub: Box): LegArcs {
  const boardTo = lengthAtX(agentWire, hub.x + HUB_CARD_INSET)
  if (seatWire === null) {
    return { boardFrom: DOT_MARGIN, boardTo, outFrom: 0, outTo: 0 }
  }
  const outFrom = lengthAtX(seatWire, hub.x + hub.width - HUB_CARD_INSET)
  const outTo = Math.max(outFrom, samplerFor(seatWire).total - DOT_MARGIN)
  return { boardFrom: DOT_MARGIN, boardTo, outFrom, outTo }
}

function pointForFrame(frame: TripFrame, layout: StageLayout, agentIndex: number): Point {
  // seatIndex < 0：这个落点被 MAX_SEATS 挤掉了，点按“还没落座”处理，停在网关，
  // 不要飞到 layout.seatWire(-1) 造出来的假坐标上。
  const seatWire =
    frame.seatIndex === null || frame.seatIndex < 0 ? null : layout.seatWire(frame.seatIndex)
  const agentWire = layout.agentWire(agentIndex)
  const arcs = legArcs(agentWire, seatWire, layout.hub)
  const travel = easeInOut(frame.progress)
  switch (frame.phase) {
    case 'boarding':
      return pointOnArc(agentWire, travel, arcs.boardFrom, arcs.boardTo)
    case 'outbound':
      return seatWire
        ? pointOnArc(seatWire, travel, arcs.outFrom, arcs.outTo)
        : hubCentre(layout)
    case 'held':
      return seatWire ? pointOnArc(seatWire, 1, arcs.outFrom, arcs.outTo) : hubCentre(layout)
    case 'back':
      return seatWire
        ? pointOnArc(seatWire, 1 - travel, arcs.outFrom, arcs.outTo)
        : hubCentre(layout)
    case 'home': {
      // 先回网关、再回客户端：两段各占一半时间，各自也是 easeInOut。
      if (travel < 0.5) {
        return seatWire
          ? pointOnArc(seatWire, 1 - travel * 2, arcs.outFrom, arcs.outTo)
          : hubCentre(layout)
      }
      return pointOnArc(agentWire, 1 - (travel - 0.5) * 2, arcs.boardFrom, arcs.boardTo)
    }
    default:
      return hubCentre(layout)
  }
}

export function RoutingStage(props: RoutingStageProps) {
  const { view, clockOffset, connected, masked = true } = props
  const nowMs = useClientNow(clockOffset)
  const containerRef = useRef<HTMLDivElement | null>(null)
  /** 容器宽度：决定用宽屏还是窄屏（手机）尺寸，以及要不要整体缩放。 */
  const [viewportWidth, setViewportWidth] = useState(0)
  const reduced = usePrefersReducedMotion()

  const compact = viewportWidth > 0 && viewportWidth < 640
  const metrics = useMemo(() => stageMetrics(compact), [compact])
  const rowHeight = metrics.nodeHeight + 20

  const stageHeight = useMemo(() => {
    const rows = Math.max(view.agents.length, view.seats.length, 1)
    return Math.min(MAX_STAGE_HEIGHT, Math.max(MIN_STAGE_HEIGHT, rows * rowHeight + STAGE_PADDING))
  }, [rowHeight, view.agents.length, view.seats.length])

  useLayoutEffect(() => {
    const host = containerRef.current
    if (!host) return
    const measure = () => setViewportWidth(host.clientWidth)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(host)
    return () => observer.disconnect()
  }, [])

  // 三列排开至少 minWidth：容器更窄（手机竖屏）时整体等比缩下来，不出现横向滚动。
  const stageWidth = Math.max(metrics.minWidth, viewportWidth)
  const scale = viewportWidth > 0 ? Math.min(1, viewportWidth / stageWidth) : 1

  const layout = useMemo(
    () =>
      layoutStage({
        width: stageWidth,
        height: stageHeight,
        agentCount: view.agents.length,
        seatCount: view.seats.length,
        compact,
      }),
    [stageWidth, stageHeight, view.agents.length, view.seats.length, compact],
  )

  const hueOfAgent = useMemo(() => {
    const map = new Map<number, string>()
    view.agents.forEach((agent, index) => map.set(index, agent.hue))
    return map
  }, [view.agents])

  /**
   * 网关**最后**那一条请求：卡片上“回答了这个请求 / 失败”与实线都只讲它。
   *
   * 之前按“所有近期请求里最后一次尝试”来算，于是一条旧请求的“回答了这个请求”会和
   * 在途请求的“作答中…”并排出现，看着像同一次路由同时用了两张卡（上游页面不会这样）。
   */
  const focus = useMemo(() => focusTrip(view.trips), [view.trips])

  /** 连线状态由数据决定，不逐帧改 DOM（CSS 负责流动）。 */
  const wiring = useMemo(() => computeWiring(view), [view])

  const activeAgents = useMemo(() => {
    const set = new Set<number>()
    for (const trip of view.trips) if (!trip.done) set.add(trip.agentIndex)
    return set
  }, [view.trips])

  const liveCount = useMemo(() => view.trips.filter((trip) => !trip.done).length, [view.trips])

  // ---- 逐帧动画：光点 --------------------------------------------------------
  const dotRefs = useRef(new Map<number, SVGCircleElement>())
  /** 每条请求的“表演时间轴”（事件驱动，见 ./motion.ts 的 advanceDot）。 */
  const dotStatesRef = useRef(new Map<number, ReturnType<typeof advanceDot>>())
  /** 已经离开数据窗口、但动画还没播完的请求：一个点代表一条请求，不许中途删掉。 */
  const ghostsRef = useRef(new Map<number, GhostTrip>())
  /** 上一帧数据里的请求（用在被挤出窗口时留一份给 ghost）。 */
  const knownRef = useRef(new Map<number, KnownTrip>())
  const [ghostVersion, bumpGhosts] = useReducer((value: number) => value + 1, 0)
  /** 连线元素：点还在飞的时候，要把它的线保持在亮起/实线状态。 */
  const agentWireRefs = useRef(new Map<number, SVGPathElement>())
  const seatWireRefs = useRef(new Map<number, SVGPathElement>())
  /** 最近一次渲染算出的“静态”连线状态（没有动画叠加时的样子）。 */
  const wiringRef = useRef(wiring)
  wiringRef.current = wiring
  /** 当前的智能体列：幽灵只按稳定键找线，不按旧视图里的列位置。 */
  const agentsRef = useRef(view.agents)
  agentsRef.current = view.agents
  /**
   * 已经离开数据窗口、但动画还没播完的请求。
   *
   * 数据窗口最多 10 条、最多 4 个智能体，新请求会把旧的挤出去；可旧请求的小点可能
   * 还在回程路上。一个点代表一条请求，所以在它播完之前要留在舞台上（见 renderFrame）。
   */
  const ghostTrips = useMemo(
    () => [...ghostsRef.current.values()].map((ghost) => ghost.trip),
    // ghostVersion 变化时重新取；view.trips 变化时同步逻辑在下面的 effect 里。
    [ghostVersion, view.trips],
  )
  const dotTrips = useMemo(() => [...view.trips, ...ghostTrips], [view.trips, ghostTrips])

  useEffect(() => {
    // 幽灵的数据不会再更新：离开窗口时还在途的尝试要在这里收尾，否则点会永远停在
    // 账号旁边（见 ./ghosts.ts）。智能体已经不在舞台上的请求直接不留。
    const changed = syncGhosts(
      knownRef.current,
      ghostsRef.current,
      view.trips,
      (trip) => view.agents[trip.agentIndex]?.key ?? null,
      Date.now() + clockRef.current,
    )
    if (changed) bumpGhosts()
  }, [view.trips])

  /** 最新请求的候选优先级：座号 -> 第几顺位（1 起）。 */
  const rankBySeat = useMemo(() => {
    const ranks = new Map<number, number>()
    focus?.prioritySeatIndexes?.forEach((seatIndex, order) => {
      // -1 是“这个候选没进舞台”的占位：它仍占着顺位号，只是没有卡片可标。
      if (seatIndex < 0) return
      if (!ranks.has(seatIndex)) ranks.set(seatIndex, order + 1)
    })
    return ranks
  }, [focus])

  const layoutRef = useRef(layout)
  const tripsRef = useRef(view.trips)
  const clockRef = useRef(clockOffset)
  layoutRef.current = layout
  tripsRef.current = view.trips
  clockRef.current = clockOffset

  useEffect(() => {
    /**
     * 这条请求此刻的“表演版”：事件驱动的动画时间轴（见 ./motion.ts 的 advanceDot）。
     * 回答一完成就排上返程，但返程仍按正常时长播放——不补播、不快进。
     */
    const animatedTripFor = (trip: TripView, nowMs: number): TripView => {
      const state = advanceDot(dotStatesRef.current.get(trip.routeId), trip, nowMs)
      dotStatesRef.current.set(trip.routeId, state)
      return dotTrip(state, trip)
    }

    /** 画一个光点，并把这一帧的时间轴描述返回给连线的处理逻辑。 */
    const paint = (trip: TripView, nowMs: number): TripFrame => {
      const frame = frameForTrip(trip, nowMs)
      const dot = dotRefs.current.get(trip.routeId)
      if (!dot) return frame
      if (!frame.visible) {
        dot.setAttribute('visibility', 'hidden')
        return frame
      }
      const point = pointForFrame(frame, layoutRef.current, trip.agentIndex)
      const returning = frame.phase === 'back' || frame.phase === 'home'
      const failed = returning && trip.attempts[frame.attemptIndex]?.ok === false
      dot.setAttribute('cx', point.x.toFixed(2))
      dot.setAttribute('cy', point.y.toFixed(2))
      dot.setAttribute('visibility', 'visible')
      dot.setAttribute('data-held', frame.phase === 'held' ? 'true' : 'false')
      dot.setAttribute('data-return', returning ? 'true' : 'false')
      dot.setAttribute('data-failed', failed ? 'true' : 'false')
      return frame
    }

    /**
     * 光点还在飞的时候，它走过的线要一直亮着。
     *
     * 请求一结束、又有新请求接手时，静态状态会立刻把旧线降回灰色虚线——可小点
     * 还在回程路上，线先没了就成了“点不在路径上”。这里按**动画时间轴**把这条
     * 线的状态抬回 lit/live，等小点飞完（frame.visible 变 false）再交还给静态状态。
     */
    const wireStateFor = (done: boolean): WireState => (done ? 'lit' : 'live')

    const mergeWire = (map: Map<number, WireState>, index: number, next: WireState): void => {
      const current = map.get(index)
      if (current === undefined || WIRE_RANK[next] > WIRE_RANK[current]) map.set(index, next)
    }

    const applyWires = (
      agentAnimated: Map<number, WireState>,
      seatAnimated: Map<number, WireState>,
    ): void => {
      const base = wiringRef.current
      const write = (element: SVGPathElement | undefined, state: WireState): void => {
        if (!element) return
        if (element.getAttribute('data-state') !== state) element.setAttribute('data-state', state)
      }
      for (let index = 0; index < base.agentStates.length; index += 1) {
        const baseState = base.agentStates[index] ?? 'idle'
        const animated = agentAnimated.get(index)
        write(
          agentWireRefs.current.get(index),
          animated === undefined ? baseState : mergeState(baseState, animated),
        )
      }
      for (let index = 0; index < base.seatStates.length; index += 1) {
        const baseState = base.seatStates[index] ?? 'rest'
        const animated = seatAnimated.get(index)
        write(
          seatWireRefs.current.get(index),
          animated === undefined ? baseState : mergeState(baseState, animated),
        )
      }
    }

    /** 清理：离开画面的请求不再保留它的动画状态。 */
    const prune = (trips: Array<TripView>): void => {
      if (dotStatesRef.current.size <= trips.length) return
      const present = new Set(trips.map((trip) => trip.routeId))
      for (const routeId of dotStatesRef.current.keys()) {
        if (!present.has(routeId)) dotStatesRef.current.delete(routeId)
      }
    }

    /** 一张画面对：每个点在哪儿 + 每根线该亮成什么。 */
    const renderFrame = (nowMs: number): void => {
      const agents = new Map<number, WireState>()
      const seats = new Map<number, WireState>()
      let ghostsChanged = expireGhosts(ghostsRef.current, nowMs)
      // 幽灵的 agentIndex 是旧视图里的列位置，不能直接拿来点线：按稳定键查当前位置。
      const agentIndexByKey = new Map(
        agentsRef.current.map((agent, index) => [agent.key, index] as const),
      )
      // 数据窗口里 + 已经离开、但动画还没播完的请求：一个点代表一条请求。
      const trips: Array<TripView> = [...tripsRef.current]
      const agentIndexOf = new Map<number, number>()
      for (const trip of trips) agentIndexOf.set(trip.routeId, trip.agentIndex)
      for (const ghost of ghostsRef.current.values()) {
        // 数据已经把它交还回来了（同步 effect 还没跑）：别画两遍。
        if (agentIndexOf.has(ghost.trip.routeId)) continue
        const index = agentIndexByKey.get(ghost.agentKey)
        trips.push(ghost.trip)
        agentIndexOf.set(ghost.trip.routeId, index ?? -1)
      }
      for (const trip of trips) {
        const animated = animatedTripFor(trip, nowMs)
        const frame = paint(animated, nowMs)
        if (!frame.visible) {
          // 播完（或本来就没有动画）的 ghost 交还；数据窗口里的请求由数据决定去留。
          if (ghostsRef.current.delete(trip.routeId)) ghostsChanged = true
          continue
        }
        const state = wireStateFor(trip.done)
        const agentIndex = agentIndexOf.get(trip.routeId) ?? trip.agentIndex
        // 智能体已经不在舞台上（-1）：没有可以点亮的线，别点到别人身上。
        if (agentIndex >= 0) mergeWire(agents, agentIndex, state)
        for (const attempt of trip.attempts) {
          if (attempt.seatIndex < 0) continue
          mergeWire(seats, attempt.seatIndex, state)
        }
      }
      applyWires(agents, seats)
      prune(trips)
      if (ghostsChanged) bumpGhosts()
    }

    if (reduced) {
      renderFrame(Date.now() + clockRef.current)
      return
    }

    let handle = 0
    const tick = () => {
      renderFrame(Date.now() + clockRef.current)
      handle = requestAnimationFrame(tick)
    }
    handle = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(handle)
  }, [reduced, layout])

  /** 同一个渠道（provider）的候选卡片归成一组：外面一个方框括起来并标注渠道名。 */
  const seatGroups = useMemo(() => {
    const runs: Array<{ key: string; label: string; from: number; to: number }> = []
    view.seats.forEach((seat, index) => {
      const last = runs[runs.length - 1]
      if (last !== undefined && last.key === seat.provider) {
        last.to = index
      } else {
        runs.push({ key: seat.provider, label: seat.name, from: index, to: index })
      }
    })
    return runs
  }, [view.seats])

  const seats = view.seats
  const agents = view.agents

  return (
    <div ref={containerRef} className="overflow-hidden">
      {/* 窄屏整体等比缩到容器宽度，不出现横向滚动；宽屏 scale = 1。 */}
      <div style={{ height: stageHeight * scale }}>
        <div
          data-slot="routing-stage"
          role="img"
          aria-label={`请求路径舞台：${agents.length} 个智能体、${seats.length} 个候选位置、${liveCount} 条在途请求`}
          className="relative"
          style={{
            height: stageHeight,
            width: stageWidth,
            transform: scale < 1 ? `scale(${scale})` : undefined,
            transformOrigin: 'top left',
          }}
        >
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`}
          preserveAspectRatio="none"
        >
          {agents.map((agent, index) => {
            const box = layout.agents[index]
            if (!box) return null
            return (
              <path
                key={`aw-${agent.key}`}
                ref={(element) => {
                  if (element) agentWireRefs.current.set(index, element)
                  else agentWireRefs.current.delete(index)
                }}
                className="route-wire"
                data-state={wiring.agentStates[index] ?? 'idle'}
                d={layout.agentWire(index).d}
                style={{ '--agent': agent.hue } as CSSProperties}
              />
            )
          })}
          {seats.map((seat, index) => {
            const box = layout.seats[index]
            if (!box) return null
            const hue = agentHueForSeat(view, seat.key, hueOfAgent)
            return (
              <path
                key={`sw-${seat.key}`}
                ref={(element) => {
                  if (element) seatWireRefs.current.set(index, element)
                  else seatWireRefs.current.delete(index)
                }}
                className="route-wire"
                data-state={wiring.seatStates[index] ?? 'rest'}
                d={layout.seatWire(index).d}
                style={hue ? ({ '--agent': hue } as CSSProperties) : undefined}
              />
            )
          })}
        </svg>

        {/* 光点画在连线之上、节点卡片之下：穿过网关时被卡片挡住，不会浮在卡片上。 */}
        <svg
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 size-full"
          viewBox={`0 0 ${Math.max(layout.width, 1)} ${Math.max(layout.height, 1)}`}
          preserveAspectRatio="none"
        >
          {dotTrips.map((trip) => {
            const hue = view.agents[trip.agentIndex]?.hue ?? 'currentColor'
            return (
              <g key={`trip-${trip.routeId}`} style={{ '--agent': hue } as CSSProperties}>
                <circle
                  ref={(element) => {
                    if (element) dotRefs.current.set(trip.routeId, element)
                    else dotRefs.current.delete(trip.routeId)
                  }}
                  className="route-pkt"
                  data-route={trip.routeId}
                  r={4.5}
                  visibility="hidden"
                />
              </g>
            )
          })}
        </svg>

        {/* 渠道分组框：同一个 provider 的候选卡片用一条框括起来，左上角标渠道名。 */}
        {seatGroups.map((group) => {
          const first = layout.seats[group.from]
          const last = layout.seats[group.to]
          if (first === undefined || last === undefined) return null
          const count = group.to - group.from + 1
          return (
            <div
              key={`seat-group-${group.key}`}
              data-slot="seat-group"
              className="pointer-events-none absolute rounded-xl border border-border/60"
              style={{
                left: first.x - GROUP_PAD,
                top: first.y - GROUP_PAD,
                width: first.width + GROUP_PAD * 2,
                height: last.y + last.height - first.y + GROUP_PAD * 2,
              }}
            >
              <span className="bg-card text-muted-foreground absolute -top-2 left-2 max-w-[calc(100%-12px)] truncate rounded px-1 text-[10px] leading-4">
                {group.label}
                {count > 1 ? ` · ${count} 个账号` : ''}
              </span>
            </div>
          )
        })}

        {agents.map((agent, index) => {
          const box = layout.agents[index]
          if (!box) return null
          const model = latestModelForAgent(view, agent.key)
          return (
            <AgentNode
              key={`agent-${agent.key}`}
              box={box}
              agent={agent}
              model={model}
              active={activeAgents.has(index)}
              masked={masked}
            />
          )
        })}

        <HubNode
          box={layout.hub}
          enabled={connected && view.mine}
          count={liveCount}
          compact={compact}
        />

        {seats.map((seat, index) => {
          const box = layout.seats[index]
          if (!box) return null
          const status = seatStatus(focus, index, wiring.heldSeats.has(index))
          return (
            <SeatNode
              key={`seat-${seat.key}`}
              box={box}
              seat={seat}
              state={wiring.seatStates[index] ?? 'rest'}
              hue={agentHueForSeat(view, seat.key, hueOfAgent)}
              held={wiring.heldSeats.has(index)}
              tone={status?.tone ?? 'idle'}
              status={status?.label ?? null}
              rank={rankBySeat.get(index) ?? null}
              nowMs={nowMs}
              masked={masked}
            />
          )
        })}
        </div>
      </div>
    </div>
  )
}

/**
 * 一张候选卡片此刻的“路由状态”，措辞对齐上游页面：
 * 回答中… / 回答了这个请求 / 失败原因；这张卡这次没被用到就返回 null，
 * 由卡片改显示额度行（上游也是这么做的：一张卡只有一句状态）。
 */
function seatStatus(
  trip: TripView | null,
  seatIndex: number,
  held: boolean,
): { label: string; tone: SeatTone } | null {
  if (held) return { label: '回答中…', tone: 'live' }
  if (!trip) return null
  // 同一张卡可能被重试过两次：取这条请求里对它的最后一次尝试。
  const attempt = [...trip.attempts].reverse().find((entry) => entry.seatIndex === seatIndex)
  if (!attempt) return null
  if (!attempt.done) {
    // 数据打架（整条请求已经结束、这次尝试却没标完成）：按整条请求的结果收尾，
    // 别让“回答中…”永远钉在卡片上（时间轴早已按结束处理）。
    if (trip.done) {
      return trip.ok
        ? { label: '回答了这个请求', tone: 'ok' }
        : { label: trip.status === null ? '失败' : `${trip.status} · 失败`, tone: 'fail' }
    }
    return { label: '回答中…', tone: 'live' }
  }
  if (attempt.ok) {
    // 不显示耗时：卡片只讲“发生了什么”，秒数不写在状态里。
    return { label: '回答了这个请求', tone: 'ok' }
  }
  return { label: `${attempt.status ?? '失败'} · ${attempt.fail ?? '失败'}`, tone: 'fail' }
}

/** 某张座位卡当前归哪个智能体的颜色：取最近一条用到它的在途/刚结束请求。 */
function agentHueForSeat(
  view: RoutingView,
  seatKey: string,
  hueOfAgent: Map<number, string>,
): string | null {
  let best: { hue: string; at: number } | null = null
  for (const trip of view.trips) {
    const used = trip.attempts.some((attempt) => view.seats[attempt.seatIndex]?.key === seatKey)
    if (!used) continue
    const hue = hueOfAgent.get(trip.agentIndex)
    if (!hue) continue
    if (!best || trip.startedAt >= best.at) best = { hue, at: trip.startedAt }
  }
  return best?.hue ?? null
}

/** 智能体节点副标题：它最近一条请求的模型。 */
function latestModelForAgent(view: RoutingView, agentKey: string): string | null {
  const index = view.agents.findIndex((agent) => agent.key === agentKey)
  if (index < 0) return null
  let model: string | null = null
  let at = -Infinity
  for (const trip of view.trips) {
    if (trip.agentIndex !== index) continue
    if (trip.startedAt >= at) {
      at = trip.startedAt
      model = trip.model
    }
  }
  return model
}

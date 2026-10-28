import { useEffect, useMemo, useRef, useState } from 'react'
import { deriveRoutingView } from '~/lib/routing/derive'
import type {
  RoutingFeed,
  RoutingRoute,
  RoutingSnapshot,
  RoutingSourceInfo,
  RoutingView,
} from '~/lib/routing/types'

/** 上游只保留最近一段轨迹；客户端也按这个上限丢最旧的，避免无限增长。 */
const MAX_ROUTES = 60
/** 一轮轮询结束到下一轮开始之间的间隔：上游本机毫秒级响应，1.1 秒足够跟手。 */
const POLL_MS = 1_200
/** 连续失败后的退避上限，网络恢复时下一轮就能接上。 */
const MAX_BACKOFF_MS = 6_000
/** 没配置或 key 被拒时不必每秒重试：这不是网络抖动，隔一会儿再看就行。 */
const IDLE_BACKOFF_MS = 30_000

/** 还没拿到第一份数据时的占位来源：页面此时只画骨架，不会读它。 */
const PENDING_SOURCE: RoutingSourceInfo = {
  state: 'unconfigured',
  fetchedAt: null,
  warning: null,
  revealed: false,
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

function parseTime(iso: string | undefined): number {
  const value = iso ? Date.parse(iso) : Number.NaN
  return Number.isFinite(value) ? value : 0
}

/**
 * 订阅路由轨迹。
 *
 * 首屏那一条由首页 loader 拿好（SSR 也要有内容），这里从它的 `seq` 接着往下要
 * 增量，按 `id` 合并进同一个 Map——上游每次更新（多一次尝试、结束）都会重发整条
 * 路由，所以“新的覆盖旧的”就够了。
 *
 * 浏览器直接请求同源的 `/feed/routing?after=N`（不做成 server function：这条路径
 * 只是转发 JSON，没有任何序列化/校验的价值）。为什么用循环而不是定时器：`after`
 * 必须取上一轮响应的 `seq`，两轮之间不能有并发；而且页面在后台时应当停下来，
 * 回到前台再从当前 `seq` 续上。
 */
export function useRoutingStream(seed: RoutingFeed | undefined): {
  /** 最近一份完整数据；种子缺失时在第一次轮询返回前是 undefined。 */
  feed: RoutingFeed | undefined
  view: RoutingView
  source: RoutingSourceInfo
  live: boolean
  /** 服务端时钟 - 本机时钟（毫秒）：舞台上的飞行时刻一律按服务端时钟算。 */
  clockOffset: number
} {
  const seedNow = parseTime(seed?.snapshot?.now) || Date.now()
  const [feed, setFeed] = useState<RoutingFeed | undefined>(seed)
  /** 每次赶上一次服务端时间戳就更新，供舞台把本机时钟换算成服务端时钟。 */
  const [clockOffset, setClockOffset] = useState(0)
  // 种子里已经是一次成功的读取，首屏就该显示“已连上游”，否则会先闪一下“等待上游”。
  const [live, setLive] = useState(seed?.source.state === 'connected')
  const [revision, setRevision] = useState(0)

  const mapRef = useRef<Map<number, RoutingRoute>>(new Map())
  const seqRef = useRef(0)

  // 首屏种子：SSR 与 hydration 用同一个服务端时刻推导，首帧因此是静止且一致的。
  useEffect(() => {
    const snapshot = seed?.snapshot
    if (!seed || !snapshot) return
    const map = mapRef.current
    for (const route of snapshot.routes) map.set(route.id, route)
    trim(map)
    seqRef.current = snapshot.seq
    setClockOffset(parseTime(snapshot.now) - Date.now())
    setFeed(seed)
  }, [seed])

  useEffect(() => {
    let cancelled = false
    let backoff = 0

    const merge = (incoming: RoutingFeed) => {
      const snapshot = incoming.snapshot
      if (!snapshot) {
        // 这一轮没读到快照（未配置 / 被拒 / 连不上）：保留上一份内容，只换状态。
        setFeed((previous) => ({
          snapshot: previous?.snapshot ?? null,
          source: incoming.source,
        }))
        return
      }
      // 上游重启后 seq 会回落：清空本地合并表，从 0 重新要一次整段轨迹。
      if (snapshot.seq < seqRef.current) {
        mapRef.current.clear()
        seqRef.current = 0
      }
      const map = mapRef.current
      for (const route of snapshot.routes) map.set(route.id, route)
      trim(map)
      seqRef.current = Math.max(seqRef.current, snapshot.seq)
      setClockOffset(parseTime(snapshot.now) - Date.now())
      setFeed(incoming)
      setRevision((value) => value + 1)
    }

    const pump = async () => {
      while (!cancelled) {
        if (typeof document !== 'undefined' && document.hidden) {
          await sleep(POLL_MS)
          continue
        }
        try {
          const response = await fetch(
            `/feed/routing?after=${seqRef.current}`,
            {
              cache: 'no-store',
              headers: { accept: 'application/json' },
            },
          )
          if (!response.ok) throw new Error(`routing feed ${response.status}`)
          const incoming = (await response.json()) as RoutingFeed
          if (cancelled) return
          merge(incoming)
          if (incoming.source.state === 'connected') {
            backoff = 0
            setLive(true)
          } else {
            setLive(false)
            if (incoming.source.state !== 'unreachable') backoff = IDLE_BACKOFF_MS
          }
        } catch {
          if (cancelled) return
          setLive(false)
          backoff = Math.min(MAX_BACKOFF_MS, backoff ? backoff * 2 : POLL_MS * 2)
        }
        await sleep(Math.max(POLL_MS, backoff))
      }
    }

    void pump()
    return () => {
      cancelled = true
    }
  }, [])

  const view = useMemo(() => {
    const base = feed?.snapshot
    // 合并表是客户端唯一的事实来源，但它只在 effect 里播种：SSR 与 hydration 的
    // 第一帧还没有它，所以这里先把数据源自己的 routes 铺一层，再由合并表覆盖。
    // 少了这层，首屏 HTML 会是“最近 0 条”，hydrate 后才补上。
    const byId = new Map<number, RoutingRoute>()
    for (const route of base?.routes ?? []) byId.set(route.id, route)
    for (const [id, route] of mapRef.current) byId.set(id, route)

    const merged: RoutingSnapshot = {
      seq: base?.seq ?? seqRef.current,
      now: base?.now ?? new Date(seedNow).toISOString(),
      mine: base?.mine ?? false,
      totals: base?.totals ?? { requests: 0, rerouted: 0, errors: 0 },
      routes: [...byId.values()],
    }
    // LINGER 的判定用服务端时钟：本机时钟可能偏，偏了会让刚结束的路径立刻消失。
    return deriveRoutingView(merged, Date.now() + clockOffset)
  }, [feed, clockOffset, revision, seedNow])

  return {
    feed,
    view,
    source: feed?.source ?? PENDING_SOURCE,
    live,
    clockOffset,
  }
}

function trim(map: Map<number, RoutingRoute>): void {
  if (map.size <= MAX_ROUTES) return
  const oldest = [...map.values()].sort((a, b) => a.id - b.id).slice(0, map.size - MAX_ROUTES)
  for (const route of oldest) map.delete(route.id)
}

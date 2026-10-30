import { useRouter } from '@teyik0/furin/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { requestServerRefresh } from './refresh-request'

/** 长驻 iframe 标签页的更新节奏：每 60 秒一轮，和上游余额的 TTL（30 秒）错开设。 */
export const DASHBOARD_REFRESH_INTERVAL_MS = 60_000
/** 连续失败时的退避上限：上游挂掉时别每分钟打一次，但最多两分钟也要再试。 */
export const DASHBOARD_REFRESH_MAX_BACKOFF_MS = 120_000

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

/** 工具栏「刷新」按钮要的状态与动作。 */
export interface DashboardRefresh {
  /** 上一次刷新是否失败（失败后按钮文案会变成「重试刷新」）。 */
  failed: boolean
  /** 点一次就算一次更新：强制重读上游 + 重跑 loader，并把 60 秒的节奏从头算起。 */
  refresh: () => Promise<void>
  refreshing: boolean
}

/**
 * 让长驻的 iframe 页面每 60 秒拿到一次新数据，并给工具栏「刷新」按钮提供入口。
 *
 * **自动更新**（每 60 秒一轮）由两步组成，缺一不可：
 *
 *   1. `POST /feed/refresh?reload=0` —— 清掉首页的 ISR 条目（不强制重读上游，
 *      余额快照仍受 `BALANCE_CACHE_TTL_SECONDS` 保护）；
 *   2. `router.refresh()` —— Furin 原地重跑 loader，不新增历史、不重置滚动，
 *      工具栏的本地搜索输入也不会丢。
 *
 * 为什么第 1 步不能省：首页是 ISR（`revalidate: 60`），`router.refresh()` 会命中
 * 已有的 ISR 条目，把**页面加载时那份快照**原样返回；即使条目已过期，furin 也是
 * “先把旧条目返回、后台再生成”，浏览器永远慢一轮。只调 `router.refresh()` 时
 * 页面每分钟都发了请求，显示的却是 1–2 分钟前的数据（Hero 的“N 分钟前更新”
 * 一直停在一分钟以上）。第 1 步让这次 loader 重跑变成一次真正的重新渲染。
 *
 * 另外，SPA 数据响应在 `src/server.ts` 里被改成 `no-store`：否则浏览器会按
 * `stale-while-revalidate` 把上一轮的 body 交给 fetch，慢一轮的问题只修一半。
 *
 * **手动刷新**（工具栏「刷新」）也算一次更新：它走同一个接口的强制模式（跳过 TTL
 * 重读上游），完成后把 60 秒的节奏从头算起——不会出现“刚点完刷新，5 秒后又自动
 * 刷一次”的观感。
 *
 * 数据仍然只有一条通路（路由 loader）：这里不取数，只让服务端缓存失效，
 * 客户端新增的网络请求依旧只有 `/feed/routing`（取数）与 `POST /feed/refresh`
 * （失效缓存，不搬运数据）两条。
 */
export function useDashboardRefresh(): DashboardRefresh {
  const router = useRouter()
  // 每次渲染同步最新的 router：effect 只跑一次，定时器里读到的必须是当前这次
  // 导航的 isNavigating / refresh，不能是挂载时闭包里的旧值。
  const routerRef = useRef(router)
  routerRef.current = router

  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  // 连点保护：一次刷新没结束前忽略后续点击（也避免两次 revalidate 叠在一起）。
  const busy = useRef(false)
  const mounted = useRef(true)
  // 由下方 effect 提供：把自动更新的节奏复位成“从现在起满一个间隔”。
  const restartCadence = useRef<() => void>(() => undefined)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let backoffMs = 0
    // 上次尝试刷新（即“数据可能还是新的”）的时刻：挂载时 loader 刚跑过，从此刻算。
    let lastAttemptAt = Date.now()

    const clearTimer = () => {
      if (timer !== undefined) {
        clearTimeout(timer)
        timer = undefined
      }
    }

    const schedule = (delayMs: number) => {
      clearTimer()
      if (cancelled) return
      timer = setTimeout(tick, Math.max(0, delayMs))
    }

    /** 下一次在“距上次尝试满一个间隔”时触发：一轮耗时不会把节奏越拖越长。 */
    const scheduleNextCycle = () => {
      schedule(DASHBOARD_REFRESH_INTERVAL_MS - (Date.now() - lastAttemptAt))
    }

    /**
     * 刷新一轮：先失效服务端 ISR 条目，再原地重跑 loader。
     *
     * 两步都成功才算这一轮成功；任何一步失败都按失败退避，页面继续显示旧内容
     * （刷新失败不是数据坏了）。
     */
    const refreshOnce = async (): Promise<void> => {
      await requestServerRefresh({ reloadUpstream: false })
      await routerRef.current.refresh()
    }

    function tick(): void {
      if (cancelled) return
      // 页面不可见时不浪费上游读取；回到前台由 visibilitychange 立即补一次。
      if (pageHidden()) {
        schedule(DASHBOARD_REFRESH_INTERVAL_MS)
        return
      }
      // 正在导航 / 已有 refresh 在跑：跳过这一轮，既不并发也不计入失败退避。
      // 从 ref 取当前导航的 router，effect 闭包里的那个可能还是挂载时的旧对象。
      if (routerRef.current.isNavigating) {
        schedule(DASHBOARD_REFRESH_INTERVAL_MS)
        return
      }

      lastAttemptAt = Date.now()
      refreshOnce()
        .then(() => {
          if (cancelled) return
          backoffMs = 0
          scheduleNextCycle()
        })
        .catch(() => {
          if (cancelled) return
          // 失败不是页面数据坏了：保留旧内容，只把下一次拉取推远一点。
          backoffMs =
            backoffMs === 0
              ? DASHBOARD_REFRESH_INTERVAL_MS * 2
              : Math.min(DASHBOARD_REFRESH_MAX_BACKOFF_MS, backoffMs * 2)
          lastAttemptAt = Date.now()
          schedule(backoffMs)
        })
    }

    /** 手动刷新完成后调用：把它当成刚发生过的一次更新，重置 60 秒节奏。 */
    restartCadence.current = () => {
      if (cancelled) return
      lastAttemptAt = Date.now()
      backoffMs = 0
      scheduleNextCycle()
    }

    const onVisibilityChange = () => {
      if (pageHidden()) return
      const elapsed = Date.now() - lastAttemptAt
      if (elapsed >= DASHBOARD_REFRESH_INTERVAL_MS) {
        clearTimer()
        tick()
        return
      }
      // 后台期间挂起的定时器可能还很远：对齐到“距上次尝试满一个间隔”，既不重复
      // 刷新，也不让刚回到前台的页面白等一轮。
      schedule(DASHBOARD_REFRESH_INTERVAL_MS - elapsed)
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', onVisibilityChange)
    }
    // 首次渲染的数据就是新的，所以第一轮等满一个间隔，不在挂载时额外打一次。
    schedule(DASHBOARD_REFRESH_INTERVAL_MS)

    return () => {
      cancelled = true
      clearTimer()
      restartCadence.current = () => undefined
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  }, [])

  const refresh = useCallback(async () => {
    if (busy.current) return
    busy.current = true
    if (mounted.current) {
      setRefreshing(true)
      setFailed(false)
    }
    try {
      // 手动刷新 = 立刻要最新数据：跳过余额 TTL 强制重读上游，再清 ISR 重跑 loader。
      await requestServerRefresh({ reloadUpstream: true })
      await routerRef.current.refresh()
      // 点一次也算一次更新：把自动更新的节奏从头算起。
      restartCadence.current()
    } catch {
      // 上游/网络失败：保留旧内容，不弹错误页，按钮提示可以重试。
      if (mounted.current) setFailed(true)
    } finally {
      busy.current = false
      if (mounted.current) setRefreshing(false)
    }
  }, [])

  return { failed, refresh, refreshing }
}

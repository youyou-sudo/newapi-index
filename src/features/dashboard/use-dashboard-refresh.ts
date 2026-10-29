import { useRouter } from '@teyik0/furin/link'
import { useCallback, useEffect, useRef, useState } from 'react'
import { requestServerRefresh } from './refresh-request'

/** 长驻 iframe 标签页的轮询间隔：ISR 的 revalidate 是 60 秒，30 秒一轮能及时接上再生成。 */
export const DASHBOARD_REFRESH_INTERVAL_MS = 30_000
/** 连续失败时的退避上限：上游挂掉时别每 30 秒打一次，但最多两分钟也要再试。 */
export const DASHBOARD_REFRESH_MAX_BACKOFF_MS = 120_000

function pageHidden(): boolean {
  return typeof document !== 'undefined' && document.hidden
}

/**
 * 让长驻的 iframe 页面自己跟上 ISR 的新数据。
 *
 * 页面是 ISR 缓存，缓存未过期时浏览器不会再去问服务端；宿主 iframe 又常常一挂
 * 就是一整天，所以只能由页面主动 `router.refresh()`：Furin 会清掉当前页的预取
 * 缓存、重跑 loader 并在原地更新组件树——不加历史记录、不重置滚动位置，工具栏
 * 里的本地搜索输入也不会丢（refresh 的契约就是“原地重载”）。
 *
 * 只调 `router.refresh()`，不直接 fetch：数据请求始终由路由 loader 拥有，客户端
 * 不新增第二条数据通路（仓库约定：唯一的客户端 fetch 在路由轨迹轮询里）。
 */
export function useDashboardRefresh(): void {
  const router = useRouter()
  // 每次渲染同步最新的 router：effect 只跑一次，定时器里读到的必须是当前这次
  // 导航的 isNavigating / refresh，不能是挂载时闭包里的旧值。
  const routerRef = useRef(router)
  routerRef.current = router

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

    function tick(): void {
      if (cancelled) return
      // 页面不可见时不浪费上游读取；回到前台由 visibilitychange 立即补一次。
      if (pageHidden()) {
        schedule(DASHBOARD_REFRESH_INTERVAL_MS)
        return
      }
      // 正在导航 / 已有 refresh 在跑：跳过这一轮，既不并发也不计入失败退避。
      // 从 ref 取当前导航的 router，effect 闭包里的那个可能还是挂载时的旧对象。
      const router = routerRef.current
      if (router.isNavigating) {
        schedule(DASHBOARD_REFRESH_INTERVAL_MS)
        return
      }

      lastAttemptAt = Date.now()
      router.refresh()
        .then(() => {
          if (cancelled) return
          backoffMs = 0
          schedule(DASHBOARD_REFRESH_INTERVAL_MS)
        })
        .catch(() => {
          if (cancelled) return
          // 失败不是页面数据坏了：保留旧内容，只把下一次拉取推远一点。
          backoffMs =
            backoffMs === 0
              ? DASHBOARD_REFRESH_INTERVAL_MS * 2
              : Math.min(DASHBOARD_REFRESH_MAX_BACKOFF_MS, backoffMs * 2)
          schedule(backoffMs)
        })
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
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', onVisibilityChange)
      }
    }
  }, [])
}

export interface ManualRefresh {
  /** 上一次手动刷新是否失败（失败后按钮文案会变成「重试刷新」）。 */
  failed: boolean
  refresh: () => Promise<void>
  refreshing: boolean
}

/**
 * 工具栏“刷新”按钮：先把服务端缓存弄脏，再用 `router.refresh()` 走回 loader。
 *
 * 只调 `router.refresh()` 不够：ISR 的 60 秒条目与 30 秒余额 TTL 都在服务端，
 * 路由刷新只会读到它们，用户会觉得按钮没反应。所以顺序固定为
 *
 *   1. `POST /feed/refresh` —— 服务端强制重读上游 + `revalidatePath()` 清 ISR；
 *   2. `router.refresh()` —— 原地重跑 loader（不新增历史、不重置滚动、不丢输入）。
 *
 * 失败时保留当前内容，只把按钮状态复位成「重试刷新」：刷新失败不是页面数据坏了。
 */
export function useManualRefresh(): ManualRefresh {
  const router = useRouter()
  const [refreshing, setRefreshing] = useState(false)
  const [failed, setFailed] = useState(false)
  // 连点保护：一次刷新没结束前忽略后续点击（也避免两次 revalidate 叠在一起）。
  const busy = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
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
      await requestServerRefresh()
      await router.refresh()
    } catch {
      // 上游/网络失败：保留旧内容，不弹错误页，按钮提示可以重试。
      if (mounted.current) setFailed(true)
    } finally {
      busy.current = false
      if (mounted.current) setRefreshing(false)
    }
  }, [router])

  return { failed, refresh, refreshing }
}

import { useEffect, useState } from 'react'

/** Whole seconds between a target ISO timestamp and a server-side base time. */
export function secondsBetween(
  targetIso: string | null,
  baseIso: string,
): number | null {
  if (!targetIso) return null
  const target = Date.parse(targetIso)
  const base = Date.parse(baseIso)
  if (Number.isNaN(target) || Number.isNaN(base)) return null
  return Math.max(0, Math.round((target - base) / 1000))
}

/**
 * 数据快照年龄的实时版本：首帧用服务端算好的 age（SSR/hydration 一致），
 * 挂载后按 fetchedAt 与本机时钟每秒重算。
 *
 * 不能像倒计时代码那样从挂载时刻往后累加：ISR 的 HTML 可能是在 60 秒前生成的，
 * 页面现在才被打开；只有 Date.now() - fetchedAt 才能反映真正的数据年龄。
 */
export function useLiveAge(
  fetchedAt: string | null,
  initialSeconds: number | null,
): number | null {
  const [seconds, setSeconds] = useState(initialSeconds)

  useEffect(() => {
    const fetchedMs = fetchedAt ? Date.parse(fetchedAt) : Number.NaN
    if (!Number.isFinite(fetchedMs)) {
      setSeconds(null)
      return
    }
    const tick = () =>
      setSeconds(Math.max(0, Math.floor((Date.now() - fetchedMs) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [fetchedAt, initialSeconds])

  return seconds
}

/**
 * Counts down from a server-computed number of seconds. The first render uses
 * the server value so hydration stays consistent; after mount the deadline is
 * anchored to the local clock and refreshed once per second.
 */
export function useLiveCountdown(initialSeconds: number | null): number | null {
  const [seconds, setSeconds] = useState(initialSeconds)

  useEffect(() => {
    if (initialSeconds === null) {
      setSeconds(null)
      return
    }
    const deadline = Date.now() + initialSeconds * 1000
    const tick = () =>
      setSeconds(Math.max(0, Math.round((deadline - Date.now()) / 1000)))
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [initialSeconds])

  return seconds
}

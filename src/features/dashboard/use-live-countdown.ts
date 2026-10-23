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

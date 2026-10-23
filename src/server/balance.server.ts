import '@tanstack/react-start/server-only'
import type { BalanceSnapshot } from '~/lib/balance/derive'
import { relayAuthorizationHeader } from '~/lib/balance/auth'
import { balancesResponseSchema } from '~/lib/balance/schema'
import type { BalanceAccount, BalanceSourceMode, SourceInfo } from '~/lib/balance/types'
import fixtureJson from './fixtures/balances.json'

interface CacheEntry {
  accounts: Array<BalanceAccount>
  fetchedAt: number
  mode: BalanceSourceMode
  warning: string | null
}

let cache: CacheEntry | null = null
let inflight: Promise<{ entry: CacheEntry; cacheState: SourceInfo['cache'] }> | null = null

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const value = Number(raw)
  return Number.isFinite(value) ? value : fallback
}

export function cacheTtlSeconds(): number {
  return Math.max(0, Math.floor(envNumber('BALANCE_CACHE_TTL_SECONDS', 30)))
}

export function apiTimeoutMs(): number {
  return Math.max(250, Math.floor(envNumber('BALANCE_API_TIMEOUT_MS', 5_000)))
}

function fixtureEntry(warning: string): CacheEntry {
  const parsed = balancesResponseSchema.parse(fixtureJson)
  return {
    accounts: parsed.data,
    fetchedAt: Date.now(),
    mode: 'fixture',
    warning,
  }
}

function toSnapshot(entry: CacheEntry, cacheState: SourceInfo['cache']): BalanceSnapshot {
  const effectiveState = entry.mode === 'fixture' ? 'fixture' : cacheState
  return {
    accounts: entry.accounts,
    source: {
      mode: entry.mode,
      fetchedAt: new Date(entry.fetchedAt).toISOString(),
      ttlSeconds: cacheTtlSeconds(),
      cache: effectiveState,
      warning: entry.warning,
    },
  }
}

async function fetchLive(url: string, apiKey: string): Promise<CacheEntry> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), apiTimeoutMs())

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        accept: 'application/json',
        // Relay station API keys default to the Bearer scheme.
        Authorization: relayAuthorizationHeader(apiKey),
      },
      signal: controller.signal,
      cache: 'no-store',
      redirect: 'follow',
    })

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    }

    const payload: unknown = await response.json()
    const parsed = balancesResponseSchema.safeParse(payload)
    if (!parsed.success) {
      throw new Error('响应结构与余额接口约定不一致')
    }

    return {
      accounts: parsed.data.data,
      fetchedAt: Date.now(),
      mode: 'live',
      warning: null,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Server-only entry point for balance data. It never runs in the browser:
 * the module is guarded by a server-only marker, and only server functions
 * import it. Results are cached briefly to protect the intranet API.
 */
export async function loadBalanceSnapshot(): Promise<BalanceSnapshot> {
  const ttl = cacheTtlSeconds() * 1_000
  if (cache && Date.now() - cache.fetchedAt < ttl) {
    return toSnapshot(cache, 'hit')
  }

  if (inflight) {
    const { entry, cacheState } = await inflight
    return toSnapshot(entry, cacheState === 'hit' ? 'hit' : 'miss')
  }

  const url = process.env.BALANCE_API_URL?.trim()
  const apiKey = process.env.BALANCE_API_KEY?.trim()

  inflight = (async (): Promise<{ entry: CacheEntry; cacheState: SourceInfo['cache'] }> => {
    if (!url) {
      return {
        entry: fixtureEntry(
          '未配置内网余额接口地址，当前展示内置示例数据。配置数据源后将自动切换为实时数据。',
        ),
        cacheState: 'fixture',
      }
    }

    if (!apiKey) {
      return {
        entry: fixtureEntry(
          '未配置中转站 API Key，当前展示内置示例数据。配置 BALANCE_API_KEY 后将自动切换为实时数据。',
        ),
        cacheState: 'fixture',
      }
    }

    try {
      const entry = await fetchLive(url, apiKey)
      cache = entry
      return { entry, cacheState: 'miss' }
    } catch (error) {
      const reason = error instanceof Error ? error.message : '未知错误'
      if (cache) {
        const ageSeconds = Math.max(1, Math.round((Date.now() - cache.fetchedAt) / 1000))
        return {
          entry: {
            ...cache,
            warning: `实时接口请求失败（${reason}），展示 ${ageSeconds} 秒前的缓存数据。`,
          },
          cacheState: 'stale',
        }
      }
      const entry = fixtureEntry(
        `内网余额接口不可达（${reason}），已降级为内置示例数据。`,
      )
      cache = entry
      return { entry, cacheState: 'fixture' }
    }
  })()

  try {
    const result = await inflight
    return toSnapshot(result.entry, result.cacheState)
  } finally {
    inflight = null
  }
}
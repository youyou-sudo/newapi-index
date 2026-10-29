import '@teyik0/furin/server-only'
import type { BalanceSnapshot } from '~/lib/balance/derive'
import { relayAuthorizationHeader } from '~/lib/balance/auth'
import { balancesResponseSchema } from '~/lib/balance/schema'
import type { BalanceAccount, BalanceSourceMode, SourceInfo } from '~/lib/balance/types'
import { revealIdentities } from '~/server/reveal.server'
import fixtureJson from './fixtures/balances.json'

interface CacheEntry {
  accounts: Array<BalanceAccount>
  fetchedAt: number
  mode: BalanceSourceMode
  warning: string | null
}

interface RefreshResult {
  entry: CacheEntry
  cacheState: SourceInfo['cache']
}

let cache: CacheEntry | null = null
/** 单飞：并发请求共享同一次上游读取，避免把内网接口打爆。 */
let inflight: Promise<RefreshResult> | null = null

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
      // 本机调试才把账号身份带到浏览器；生产与验收一律打码。
      revealed: revealIdentities(),
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
 * 读取一次上游并更新缓存；并发调用共享同一次请求（single-flight）。
 * 永不 reject：失败时返回旧缓存或 fixture，由调用方决定展示状态。
 *
 * 调用方必须 await 它：这里没有“后台刷新”模式，丢到后台只会让 ISR 再生成拿到
 * 旧快照（见 loadBalanceSnapshot 的注释）。
 */
function refresh(): Promise<RefreshResult> {
  if (inflight) return inflight

  const run = (async (): Promise<RefreshResult> => {
    const url = process.env.BALANCE_API_URL?.trim()
    const apiKey = process.env.BALANCE_API_KEY?.trim()

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
        // 上游失败：保留上一份好数据，但 cacheState 只能标成 'stale'（页面会带上
        // warning）；它不再表示“下面还有一次后台刷新”。
        const ageSeconds = Math.max(1, Math.round((Date.now() - cache.fetchedAt) / 1000))
        cache = {
          ...cache,
          warning: `实时接口请求失败（${reason}），展示 ${ageSeconds} 秒前的缓存数据。`,
        }
        return { entry: cache, cacheState: 'stale' }
      }
      const entry = fixtureEntry(
        `内网余额接口不可达（${reason}），已降级为内置示例数据。`,
      )
      cache = entry
      return { entry, cacheState: 'fixture' }
    }
  })()

  inflight = run.finally(() => {
    inflight = null
  })
  return inflight
}

/**
 * Server-only entry point for balance data. It never runs in the browser:
 * the module is guarded by a server-only marker, and only server functions
 * import it.
 *
 * 缓存只有两层，分工必须分清：
 *
 * 1. Furin 的 ISR 已经是 stale-while-revalidate 层：`revalidate` 过期后的第一次
 *    请求先拿到旧 HTML，再生成（= 重跑 loader）在后台进行；再生成失败也保留上一份
 *    好结果。页面层的“旧数据先返回、后台换新”由框架负责，不需要也不应该在这里
 *    重复实现。
 * 2. 这里只负责判断“上游数据现在值不值得重新读”：TTL 内直接命中；过期或没有缓存
 *    时**等这次上游读取完成再返回**。必须在 loader 里 await——如果像以前那样先返回
 *    旧数据、再 `void refresh()`，ISR 再生成拿到的还是过期快照，会把过期数据写进
 *    新的 HTML，过期徽标就会一直挂着。长驻 iframe 由
 *    `src/features/dashboard/use-dashboard-refresh.ts` 定时 `router.refresh()` 把
 *    最新一轮 loader 结果拉回来。
 *
 * 并发调用共享同一次上游读取（single-flight，见 refresh()）；超时/失败永不
 * reject：先退到上一份缓存（`cache: 'stale'` + warning），再退到内置 fixture。
 */
export async function loadBalanceSnapshot(): Promise<BalanceSnapshot> {
  const ttl = cacheTtlSeconds() * 1_000
  if (cache && Date.now() - cache.fetchedAt < ttl) {
    return toSnapshot(cache, 'hit')
  }

  // 过期或首次请求：loader（= ISR 再生成）把这次上游读取做完，结果才会进缓存。
  const result = await refresh()
  return toSnapshot(result.entry, result.cacheState)
}

/**
 * 强制重读上游并写回缓存（首页“刷新”按钮用，见 `src/api/refresh.ts`）。
 *
 * 和 `loadBalanceSnapshot()` 的唯一区别是**跳过 TTL**：即使缓存还新鲜也重读一次。
 * 手动刷新必须这样，否则用户点完按钮 30 秒内拿到的仍是旧快照。并发调用共享同一次
 * 上游读取（single-flight）；失败同样永不 reject，由 `toSnapshot` 把
 * `cache: 'stale'` / fixture 状态带出去。
 */
export async function reloadBalanceSnapshot(): Promise<BalanceSnapshot> {
  const result = await refresh()
  return toSnapshot(result.entry, result.cacheState)
}

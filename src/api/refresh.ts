import { revalidatePath } from '@teyik0/furin'
import { Elysia, t } from 'elysia'
import { loadBalanceSnapshot, reloadBalanceSnapshot } from '~/server/balance.server'

/**
 * 缓存失效接口：让服务端的缓存失效，但不搬运数据。
 *
 * 页面数据仍然只有一条通路（路由 loader）。这个 POST 只做两件服务端的事：
 *
 * 1. 读一次余额快照（`reload=1` 跳过 TTL 强制重读上游，`reload=0` 走正常 TTL）；
 * 2. `revalidatePath('/', 'page')`：清掉首页的 ISR 条目。furin 的 ISR 缓存按
 *    “路径去 search”匹配（见 `pathWithoutSearch`），所以 `/?q=...` 的所有变体
 *    会一起失效，下一次请求一定会重跑 loader。
 *
 * 浏览器随后调用 `router.refresh()` 原地重跑 loader，就能拿到刚写进缓存的快照。
 * 少了这两步，ISR 的 60 秒条目会让“刷新”看起来没有反应——长驻页面的自动刷新
 * （`useDashboardRefresh`）也走这里，否则它每 30 秒拿回的仍是页面加载时那份快照。
 *
 * 两种调用方的差别只有一个 `reload` 开关：
 *
 * - `reload=1`（缺省，工具栏「刷新」）：用户主动点按，值得强制读一次上游；
 * - `reload=0`（自动刷新）：只清 ISR 条目，上游读取仍由余额 TTL 决定，
 *   30 秒一轮不会把上游调用放大到 `BALANCE_CACHE_TTL_SECONDS` 之外。
 *
 * 路径刻意放在根路径下（`/feed/refresh`）而不是 `/api/*`：客户端产物里不允许
 * 出现 `/api/`，仓库约定所有给浏览器用的接口都挂在 `/feed/` 下。
 */
export const refreshApi = new Elysia({ name: 'refresh-api' }).post(
  '/feed/refresh',
  {
    query: t.Object({
      // 只认字符串：`reload=0` 是自动刷新（不强制重读上游），其余/缺省一律强制。
      reload: t.Optional(t.String()),
    }),
  },
  async ({ query, set }) => {
    // 这是一次“让缓存失效”的动作，任何中间层都不该缓存它的响应。
    set.headers['cache-control'] = 'no-store'

    const reload = query.reload !== '0'
    const snapshot = reload
      ? await reloadBalanceSnapshot()
      : await loadBalanceSnapshot()
    await revalidatePath('/', 'page')

    return {
      ok: true,
      reload,
      fetchedAt: snapshot.source.fetchedAt,
      cache: snapshot.source.cache,
      mode: snapshot.source.mode,
    }
  },
)

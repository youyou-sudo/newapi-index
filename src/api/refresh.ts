import { revalidatePath } from '@teyik0/furin'
import { Elysia } from 'elysia'
import { reloadBalanceSnapshot } from '~/server/balance.server'

/**
 * 手动刷新接口：让服务端的缓存失效，但不搬运数据。
 *
 * 页面数据仍然只有一条通路（路由 loader）。这个 POST 只做两件服务端的事：
 *
 * 1. `reloadBalanceSnapshot()`：跳过 TTL 强制重读一次上游余额，把最新快照写回
 *    进程内缓存（single-flight，失败退回旧缓存/fixture，永不 reject）；
 * 2. `revalidatePath('/', 'page')`：清掉首页的 ISR 条目。furin 的 ISR 缓存按
 *    “路径去 search”匹配（见 `pathWithoutSearch`），所以 `/?q=...` 的所有变体
 *    会一起失效，下一次请求一定会重跑 loader。
 *
 * 浏览器随后调用 `router.refresh()` 原地重跑 loader，就能拿到刚写进缓存的快照。
 * 少了这两步，ISR 的 60 秒缓存会让刷新按钮看起来“点了没反应”。
 *
 * 路径刻意放在根路径下（`/feed/refresh`）而不是 `/api/*`：客户端产物里不允许
 * 出现 `/api/`，仓库约定所有给浏览器用的接口都挂在 `/feed/` 下。
 */
export const refreshApi = new Elysia({ name: 'refresh-api' }).post(
  '/feed/refresh',
  async ({ set }) => {
    // 这是一次“让缓存失效”的动作，任何中间层都不该缓存它的响应。
    set.headers['cache-control'] = 'no-store'

    const snapshot = await reloadBalanceSnapshot()
    await revalidatePath('/', 'page')

    return {
      ok: true,
      fetchedAt: snapshot.source.fetchedAt,
      cache: snapshot.source.cache,
      mode: snapshot.source.mode,
    }
  },
)

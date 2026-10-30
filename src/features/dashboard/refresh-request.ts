/**
 * 自动 / 手动刷新时让服务端缓存失效的请求。
 *
 * 这是仓库里除 `/feed/routing` 之外唯一允许的客户端 `fetch`，而且它**不取数据**：
 * 只让服务端的 ISR 条目失效（必要时强制重读上游），真正的页面数据仍然由
 * `router.refresh()` 重跑 loader 拿回来（见 `use-dashboard-refresh.ts`）。
 *
 * 为什么必须走一次网络：ISR 的 60 秒条目与余额快照的 30 秒 TTL 都在服务端进程里，
 * 浏览器没有办法只靠一次路由刷新让它们失效——`router.refresh()` 只会打到已有条目，
 * 拿回的仍然是生成时的那份快照（这正是“页面开着却一直显示旧数据”的根因）。
 */
export const REFRESH_ENDPOINT = '/feed/refresh'

/**
 * 自动刷新用的变体：只清 ISR 条目，**不**强制重读上游。
 *
 * 余额快照仍然按 `BALANCE_CACHE_TTL_SECONDS`（默认 30 秒）决定是否真的打上游，
 * 所以 30 秒一轮的自动刷新不会把上游调用次数放大到配置之外。
 */
export const INVALIDATE_ENDPOINT = `${REFRESH_ENDPOINT}?reload=0`

export interface ServerRefreshOptions {
  /**
   * 是否跳过余额快照 TTL、强制重读上游。
   *
   * - `true`（默认，手动刷新按钮）：点一下就必须看到最新余额，值得多打一次上游；
   * - `false`（自动刷新）：只清 ISR 条目，上游读取仍受 TTL 保护。
   */
  reloadUpstream?: boolean
}

/**
 * POST `/feed/refresh`。响应体只是一份诊断信息（`ok/fetchedAt/cache/mode`），
 * 页面不使用它——调用方拿到成功响应后再 `router.refresh()`。
 */
export async function requestServerRefresh(
  options: ServerRefreshOptions = {},
): Promise<void> {
  const url = options.reloadUpstream === false ? INVALIDATE_ENDPOINT : REFRESH_ENDPOINT
  const response = await fetch(url, {
    method: 'POST',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(`刷新接口返回 HTTP ${response.status}`)
  }
}

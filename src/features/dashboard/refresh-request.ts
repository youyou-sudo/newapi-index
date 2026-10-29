/**
 * 手动刷新时让服务端缓存失效的请求。
 *
 * 这是仓库里除 `/feed/routing` 之外唯一允许的客户端 `fetch`，而且它**不取数据**：
 * 只让服务端强制重读上游并清掉首页的 ISR 条目，真正的页面数据仍然由
 * `router.refresh()` 重跑 loader 拿回来（见 `use-dashboard-refresh.ts`）。
 *
 * 为什么必须走一次网络：ISR 的 60 秒缓存与 30 秒余额 TTL 都在服务端进程里，
 * 浏览器没有办法只靠一次路由刷新让它们失效。
 */
export const REFRESH_ENDPOINT = '/feed/refresh'

/**
 * POST `/feed/refresh`。响应体只是一份诊断信息（`ok/fetchedAt/cache/mode`），
 * 页面不使用它——调用方拿到成功响应后再 `router.refresh()`。
 */
export async function requestServerRefresh(): Promise<void> {
  const response = await fetch(REFRESH_ENDPOINT, {
    method: 'POST',
    headers: { accept: 'application/json' },
    cache: 'no-store',
    credentials: 'same-origin',
  })
  if (!response.ok) {
    throw new Error(`刷新接口返回 HTTP ${response.status}`)
  }
}

import '@tanstack/react-start/server-only'

/**
 * 允许 new-api 的 sandbox iframe 读取本页面的响应。
 *
 * new-api 用 sandbox='allow-forms allow-popups ... allow-scripts ...'（没有
 * allow-same-origin）嵌入自定义首页，子文档是 opaque origin：浏览器把它发往
 * 自己源地址的请求也当成跨源请求处理（Origin: null、Sec-Fetch-Site:
 * cross-site）。因此：
 * - 文档、server function 响应需要 Access-Control-Allow-Origin；
 * - server function 的 GET 带 x-tsr-serverFn 自定义头，会先发预检，
 *   必须由 server entry 直接回答 OPTIONS（否则预检落到路由层就是 404/403）；
 * - iframe 里的 chunk 脚本与按需加载的 CSS 同样是跨源请求，静态资源也要放开
 *   （见 vite.config.ts 的 `/assets/**` 规则）。
 *
 * 这里只放开读取，不涉及凭据：面板没有登录态，数据本身就是要公开展示的。
 */
const ALLOWED_METHODS = 'GET, HEAD, POST, OPTIONS'
const DEFAULT_ALLOWED_HEADERS = 'accept, content-type, x-tsr-serverfn'

/**
 * TanStack Start 的 server function 协议依赖这些自定义响应头（见
 * @tanstack/start-client-core/constants）。跨源响应默认只暴露安全列表头，
 * 不显式 expose 时客户端读不到 x-tss-serialized，会把 seroval 线格式当成
 * 业务数据，导致 "data is undefined" 之类的加载失败。
 */
const EXPOSED_HEADERS = 'x-tss-serialized, x-tss-raw, x-tss-context'

function corsHeaders(request: Request): Headers {
  const headers = new Headers({
    'access-control-allow-origin': '*',
    'access-control-allow-methods': ALLOWED_METHODS,
    'access-control-expose-headers': EXPOSED_HEADERS,
  })
  const requested = request.headers.get('access-control-request-headers')
  headers.set(
    'access-control-allow-headers',
    requested && requested.length <= 512 ? requested : DEFAULT_ALLOWED_HEADERS,
  )
  return headers
}

/** 预检响应：不进入 SSR / CSRF 链路。 */
export function createCorsPreflightResponse(request: Request): Response {
  const headers = corsHeaders(request)
  headers.set('access-control-max-age', '600')
  return new Response(null, { status: 204, headers })
}

/** 给普通响应补上 CORS 头；响应头不可变时重建一个同源响应。 */
export function withCorsHeaders(
  request: Request,
  response: Response,
): Response {
  const origin = request.headers.get('origin')
  if (!origin) return response
  try {
    response.headers.set('access-control-allow-origin', '*')
    response.headers.set('access-control-expose-headers', EXPOSED_HEADERS)
    return response
  } catch {
    const headers = new Headers(response.headers)
    headers.set('access-control-allow-origin', '*')
    headers.set('access-control-expose-headers', EXPOSED_HEADERS)
    const body = response.body
    if (response.status === 204 || response.status === 304 || !body) {
      return new Response(null, {
        status: response.status,
        statusText: response.statusText,
        headers,
      })
    }
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    })
  }
}

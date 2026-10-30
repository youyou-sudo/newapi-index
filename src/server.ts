import { furin } from '@teyik0/furin'
import { Elysia } from 'elysia'
import { refreshApi } from './api/refresh'
import { routingApi } from './api/routing'

/**
 * 服务端入口：一个 Elysia 应用同时承载路由轨迹 API 与 furin 页面。
 *
 * 为什么 CORS 放在 onRequest 而不是某个插件里：页面会被 new-api 的 sandbox
 * iframe 嵌（`sandbox` 不带 allow-same-origin，文档是 opaque origin，Origin: null）。
 * 浏览器把文档、`/_client/*` 静态资源都当跨源请求，所以每个响应（包括 ISR 缓存
 * 命中的页面）都要带 Access-Control-Allow-Origin；预检必须在进入路由/loader 之前
 * 直接答掉。onRequest 是唯一对 furin 内部路由和静态资源都生效的钩子。
 *
 * 压缩与 CSS 内联不在这里做：furin 页面响应走自己的流式链路，onAfterHandle /
 * mapResponse 改不到；压缩交给反向代理（仓库文档已按此口径描述）。
 */

const DEFAULT_PORT = 3000
/** 健康检查最多等 4 秒（Docker --timeout=5s 留 1s 余量）：探活不能超过编排预算。 */
const HEALTHCHECK_TIMEOUT_MS = 4_000

/** CORS：iframe（opaque origin）只能用通配源，没有登录态、也不带凭据。 */
const CORS_ALLOW_METHODS = 'GET,HEAD,POST,OPTIONS'
const CORS_DEFAULT_ALLOW_HEADERS = 'accept,content-type'
const CORS_MAX_AGE = '600'
/** 跨源响应默认只暴露安全列表头：要让 iframe 读到构建 ID，必须显式 expose。 */
const CORS_EXPOSE_HEADERS = 'x-furin-build-id'

/**
 * SPA 数据响应必须让浏览器“每次都问服务端”。
 *
 * furin 给这类响应打的是 `public, max-age=0, s-maxage=60, stale-while-revalidate=60`
 * （见框架的 `navigationDataCacheControl`）。其中 `stale-while-revalidate` 会让浏览器
 * 把**上一次**的响应体直接交给 fetch——网络请求照样发出去，但页面拿到的是旧 body，
 * 于是一分钟一轮的刷新每次都拿到上一轮的快照，数据年龄一路涨到一两分钟，看起来
 * 就像“根本没有在刷新”（时间线上还夹着一条后台重新验证请求，很容易误判成没事）。
 *
 * 这个响应只服务于“我要最新数据”的原地刷新：页面只有一条路由、首屏走的是文档，
 * 缓存 SPA 数据没有任何收益，所以直接 no-store。文档本身的 ISR 缓存头不受影响。
 */
const NAVIGATION_DATA_CACHE_CONTROL = 'private, no-store'

/**
 * SPA 数据 payload 的 content-type（见 furin 的 `cachedRouteDataResponse`）。
 *
 * 不能靠 URL 里的 `?_furin=data` 判断：furin 在挂载时用 `app.wrap()` 把请求包了
 * 一层，标记在进入我们的代码之前就被剥掉了（`createRequestScope` 的
 * `stripNavigationDataRequest`），所以按响应类型认更稳。
 */
const NAVIGATION_DATA_CONTENT_TYPES = ['application/x-ndjson', 'application/x-furin-route']

function isNavigationDataResponse(response: Response): boolean {
  const contentType = response.headers.get('content-type') ?? ''
  return NAVIGATION_DATA_CONTENT_TYPES.some((type) => contentType.includes(type))
}

/** 把 SPA 数据响应的缓存头换成 no-store，其余（状态码、body 流）原样保留。 */
function withNavigationDataCacheControl(response: Response): Response {
  const headers = new Headers(response.headers)
  if (headers.get('cache-control') === NAVIGATION_DATA_CACHE_CONTROL) return response
  headers.set('cache-control', NAVIGATION_DATA_CACHE_CONTROL)
  // cache-tag 只对共享缓存有意义，no-store 下留着只会误导排查。
  headers.delete('cache-tag')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function resolvePort(): number {
  const raw = process.env.PORT?.trim()
  if (!raw) return DEFAULT_PORT
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 && value < 65_536 ? value : DEFAULT_PORT
}

const port = resolvePort()

/**
 * `--healthcheck`：给容器编排用的就绪探针。
 *
 * 编译产物是单个 `server` / `server.exe`（`furin build --compile embed`），镜像里
 * 没有 curl/wget；这个模式在构造 Elysia 应用、绑定端口之前直接请求本进程的
 * `/_furin/health/ready`，成功退 0、失败退 1（看门狗据此重启容器）。
 * 这个端点由 furin 的生产服务器提供，开发期 `bun src/server.ts` 下不注册，
 * 所以也只在成品镜像的 HEALTHCHECK 里使用。
 */
async function checkReadiness(): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HEALTHCHECK_TIMEOUT_MS)
  try {
    const response = await fetch(`http://127.0.0.1:${port}/_furin/health/ready`, {
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      console.error(`[balance] healthcheck failed: HTTP ${response.status}`)
      return false
    }
    return true
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    console.error(`[balance] healthcheck failed: ${reason}`)
    return false
  } finally {
    clearTimeout(timer)
  }
}

if (process.argv.includes('--healthcheck')) {
  const ready = await checkReadiness()
  process.exit(ready ? 0 : 1)
}

const app = new Elysia()
  .onRequest(({ request, set }) => {
    if (request.method === 'OPTIONS') {
      // 预检：不回落到 SSR / loader，直接 204。
      const requested = request.headers.get('access-control-request-headers')?.trim()
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': '*',
          'access-control-allow-methods': CORS_ALLOW_METHODS,
          'access-control-allow-headers':
            requested && requested.length <= 512 ? requested : CORS_DEFAULT_ALLOW_HEADERS,
          'access-control-max-age': CORS_MAX_AGE,
        },
      })
    }
    if (request.headers.get('origin')) {
      // 普通响应（文档、ISR 缓存页、静态资源、API、流式响应）都补读取权限。
      set.headers['access-control-allow-origin'] = '*'
      set.headers['access-control-expose-headers'] = CORS_EXPOSE_HEADERS
    }
  })
  .use(routingApi)
  .use(refreshApi)
  .use(await furin({ pagesDir: './src/pages' }))

/**
 * 给 SPA 数据响应盖上 no-store。
 *
 * 为什么必须用 `app.wrap()` 而不是生命周期钩子：furin 的页面路由在它自己的实例上，
 * 父实例的 `onAfterHandle` / `mapResponse` 不会跑在它们身上（仓库里压缩与 CSS 内联
 * 早就踩过这个坑）；`onRequest` 的 `set.headers` 又会被处理器返回的 `Response` 覆盖
 * （Elysia 的 `responseToSetHeaders` 用 `Object.assign` 把响应头并到 `set.headers`
 * 上，响应头赢）。`wrap` 是在 fetch 最外层套一层，才能既看到最终响应、又改得动它的头。
 *
 * 注意 furin 自己也在 `use()` 时注册了 `wrap`（剥掉 `?_furin=data` 标记），Elysia 按
 * “先注册的在外层”组合，所以这里拿到的是已剥标记的请求——判断只看响应类型。
 */
app.wrap((fetch) => async (request, ...rest) => {
  const response = await fetch(request, ...rest)
  return isNavigationDataResponse(response)
    ? withNavigationDataCacheControl(response)
    : response
})

if (import.meta.main) {
  app.listen(port)
  console.log(`[balance] listening on http://127.0.0.1:${port}`)
}

export type App = typeof app
export default app
import '@tanstack/react-start/server-only'

/**
 * 给 SSR 文档与 server function 响应补 gzip。
 *
 * 静态资源由 Nitro 在构建期预压缩（vite.config.ts 的 compressPublicAssets），
 * 但 TanStack Start 的 HTML 是流式响应、server function 是运行时 JSON，构建期
 * 压不到，必须在 server entry 里压。这条链路直接决定 iframe 的首字节之后的
 * 传输时间：28KB 的文档 / 500KB 的 JS 不压缩，在真实网络上就是几秒的空白。
 *
 * 只压文本类响应；已经带 Content-Encoding 的（例如 CDN 回源压缩）原样放行。
 */
const COMPRESSIBLE_TYPE =
  /^(?:text\/|application\/(?:json|javascript|xml|x-www-form-urlencoded))/i

/** 低于 1KB 的响应压缩收益为负（gzip 头 + 协商开销），直接跳过。 */
const MIN_SIZE_BYTES = 1024

/** 客户端是否接受 gzip；不支持时保持原样。 */
function acceptsGzip(request: Request): boolean {
  const header = request.headers.get('accept-encoding')
  return header !== null && /(?:^|[,\s])gzip(?:[\s;,]|$)/i.test(header)
}

function appendVary(headers: Headers, value: string): void {
  const current = headers.get('vary')
  if (!current) {
    headers.set('vary', value)
    return
  }
  if (!current.split(',').some((item) => item.trim().toLowerCase() === value)) {
    headers.set('vary', current + ', ' + value)
  }
}

/**
 * 返回一个 gzip 压缩后的响应；不满足压缩条件时原样返回。
 * 不缓冲流：SSR 文档仍然是流式的，只是流本身被 gzip 了。
 */
export function compressResponse(request: Request, response: Response): Response {
  if (request.method === 'HEAD') return response
  if (response.status !== 200) return response
  if (response.headers.has('content-encoding')) return response
  if (!response.body) return response
  if (!acceptsGzip(request)) return response

  const contentType = response.headers.get('content-type') ?? ''
  if (!COMPRESSIBLE_TYPE.test(contentType)) return response

  const declared = response.headers.get('content-length')
  const declaredLength = declared === null ? Number.NaN : Number(declared)
  if (Number.isFinite(declaredLength) && declaredLength < MIN_SIZE_BYTES) {
    return response
  }

  const headers = new Headers(response.headers)
  // 压缩后长度未知，交给运行时按 chunked 发送。
  headers.delete('content-length')
  headers.set('content-encoding', 'gzip')
  appendVary(headers, 'accept-encoding')

  return new Response(response.body.pipeThrough(new CompressionStream('gzip')), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

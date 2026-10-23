import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import { compressResponse } from './server/compress-response'
import {
  createCorsPreflightResponse,
  withCorsHeaders,
} from './server/host-cors'

/**
 * 自定义 server entry：在 TanStack Start 处理请求之前回答 sandbox iframe 的
 * CORS 预检，给所有响应补 Access-Control-Allow-Origin，并对文本响应做 gzip。
 * 背景见 src/server/host-cors.ts 与 src/server/compress-response.ts。
 */
const startHandler = createStartHandler(defaultStreamHandler)

export default createServerEntry({
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') {
      return createCorsPreflightResponse(request)
    }
    const response = await startHandler(request)
    // 先压缩再补 CORS 头：压缩会重建响应对象，顺序反了 CORS 头会被丢掉。
    return withCorsHeaders(request, compressResponse(request, response))
  },
})

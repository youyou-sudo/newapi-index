import {
  createServerEntry,
  createStartHandler,
  defaultStreamHandler,
} from '@tanstack/react-start/server'
import {
  createCorsPreflightResponse,
  withCorsHeaders,
} from './server/host-cors'

/**
 * 自定义 server entry：在 TanStack Start 处理请求之前回答 sandbox iframe 的
 * CORS 预检，并给所有响应补 Access-Control-Allow-Origin。
 * 背景见 src/server/host-cors.ts。
 */
const startHandler = createStartHandler(defaultStreamHandler)

export default createServerEntry({
  async fetch(request: Request) {
    if (request.method === 'OPTIONS') {
      return createCorsPreflightResponse(request)
    }
    return withCorsHeaders(request, await startHandler(request))
  },
})

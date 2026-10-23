import {
  createCsrfMiddleware,
  createStart,
} from '@tanstack/react-start'
import { serverFnTimingMiddleware } from './middleware/function-middleware'
import { requestContextMiddleware } from './middleware/request-middleware'

/**
 * Global server lifecycle configuration.
 * - SSR is enabled by default; individual routes opt into selective SSR.
 * - Server functions are same-origin RPC endpoints, hence the CSRF middleware.
 */
export const startInstance = createStart(() => ({
  defaultSsr: true,
  requestMiddleware: [
    requestContextMiddleware,
    createCsrfMiddleware({
      // 被 new-api 以 sandbox iframe 嵌入时文档是 opaque origin，请求表现为
      // Origin: null / Sec-Fetch-Site: cross-site。GET server function 只读、
      // 无副作用，因此只对这类请求跳过同源校验；其余请求仍按默认策略校验。
      filter: (ctx) =>
        ctx.handlerType === 'serverFn' &&
        !(
          ctx.request.method === 'GET' &&
          ctx.request.headers.get('origin') === 'null'
        ),
    }),
  ],
  functionMiddleware: [serverFnTimingMiddleware],
}))

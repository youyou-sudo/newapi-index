import { createMiddleware } from '@tanstack/react-start'

/**
 * Cross-cutting request concerns for every SSR document, server route and
 * server function request. Kept free of server-only imports because Start
 * compiles the global start instance for both environments.
 */
export const requestContextMiddleware = createMiddleware().server(
  async ({ next, request }) => {
    const startedAt = performance.now()
    const result = await next()
    const durationMs = Math.round(performance.now() - startedAt)

    if (process.env.NODE_ENV !== 'production') {
      const path = new URL(request.url).pathname
      console.info(`[balance] ${request.method} ${path} ${durationMs}ms`)
    }

    return result
  },
)

import { createMiddleware } from '@tanstack/react-start'

/**
 * Applied to every server function. Keeps a single, explicit server boundary:
 * no route or component needs to know how data is fetched.
 */
export const serverFnTimingMiddleware = createMiddleware({
  type: 'function',
}).server(async ({ next }) => {
  const startedAt = performance.now()
  try {
    return await next()
  } finally {
    if (process.env.NODE_ENV !== 'production') {
      const durationMs = Math.round(performance.now() - startedAt)
      console.info(`[balance] server function ${durationMs}ms`)
    }
  }
})

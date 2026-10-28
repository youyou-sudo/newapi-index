import * as z from 'zod/mini'

/**
 * 上游网关 web 接口（trace）的线上格式校验。只允许服务端引用。
 *
 * 上游字段会随版本增删，所以整份 schema 用 `catchall(..., z.unknown())` 放行未知
 * 字段，只钉住页面真正消费的那部分；数组字段用 `catch` + `_default` 兜住上游发
 * `null` 的情况（网关拒答的请求 `order` 就是 null）。
 */

const candidateSchema = z.catchall(
  z.object({
    id: z.string(),
    provider: z._default(z.string(), ''),
    name: z._default(z.string(), ''),
    kind: z._default(z.string(), 'provider'),
    model: z._default(z.string(), ''),
    routing: z.optional(z.string()),
    // 上游的 used 是“额度已用百分比”，tokens 才是“最近发给它的 token 数”：
    // 两个字段必须分开收，否则卡片会把 17% 写成“最近 17 token”。
    used: z.optional(z.number()),
    tokens: z.optional(z.number()),
    who: z.optional(z.string()),
    plan: z.optional(z.string()),
    renews: z.optional(z.array(z.string())),
    rank: z.optional(z.number()),
    shared: z.optional(z.boolean()),
    fallback: z.optional(z.boolean()),
  }),
  z.unknown(),
)

const attemptSchema = z.catchall(
  z.object({
    id: z.string(),
    model: z.optional(z.string()),
    // 上游在途的尝试只保证有 id 与 start；done 缺省按“未结束”处理，别让整份轨迹失效。
    start: z._default(z.string(), ''),
    done: z._default(z.boolean(), false),
    status: z.optional(z.number()),
    ms: z.optional(z.number()),
    ttft: z.optional(z.number()),
    fail: z.optional(z.string()),
    error: z.optional(z.string()),
    again: z.optional(z.number()),
    rest: z.optional(z.boolean()),
    gone: z.optional(z.boolean()),
  }),
  z.unknown(),
)

const routeSchema = z.catchall(
  z.object({
    seq: z._default(z.number(), 0),
    id: z.number(),
    time: z._default(z.string(), ''),
    agent: z._default(z.string(), ''),
    model: z._default(z.string(), ''),
    provider: z.optional(z.string()),
    done: z._default(z.boolean(), false),
    status: z.optional(z.number()),
    ms: z.optional(z.number()),
    ttft: z.optional(z.number()),
    order: z.catch(z._default(z.array(candidateSchema), []), []),
    tries: z.catch(z._default(z.array(attemptSchema), []), []),
  }),
  z.unknown(),
)

const totalsSchema = z.catchall(
  z.object({
    requests: z._default(z.number(), 0),
    rerouted: z._default(z.number(), 0),
    errors: z._default(z.number(), 0),
  }),
  z.unknown(),
)

/** 一次 trace 轮询的响应。after 之后没有新请求时 routes 是空数组。 */
export const traceResponseSchema = z.catchall(
  z.object({
    seq: z._default(z.number(), 0),
    now: z.optional(z.string()),
    mine: z._default(z.boolean(), false),
    totals: z.optional(totalsSchema),
    routes: z.catch(z._default(z.array(routeSchema), []), []),
  }),
  z.unknown(),
)

export type TraceResponse = z.infer<typeof traceResponseSchema>

import '@teyik0/furin/server-only'
import { traceResponseSchema } from '~/lib/routing/schema'
import { revealIdentities } from '~/server/reveal.server'
import type {
  RoutingFeed,
  RoutingRoute,
  RoutingSnapshot,
  RoutingSourceInfo,
  RoutingSourceState,
} from '~/lib/routing/types'

/**
 * 上游网关 web 页面的服务端客户端。
 *
 * 为什么只能在服务端：那个 web 页面用 HttpOnly cookie 认人（链接里的 `k` 只在校验
 * 后被换成一个 `Set-Cookie`），而且 `/api` 不带 CORS 头——本页面又常常跑在 new-api
 * 的 sandbox iframe 里（opaque origin），浏览器既发不出那个 cookie，也读不到跨域响应。
 * 所以浏览器只跟本仓库的服务端函数说话，服务端替它登录并转发 trace 轮询。
 *
 * 打码也在这一层完成：候选的 provider 名字既是账户身份、又是原始 `id`，所以离开服务端
 * 之前就被换成不透明的 k1/k2…，模型 id 去掉 `provider/` 前缀，展示名统一是 `***`。
 * 浏览器里拿到的东西里没有任何原始账号/供应商名字。
 */

/** 登录 cookie 的有效期比上游短：过期后自动重新换一次，不会因为一次过期就显示“被拒”。 */
const SIGN_IN_TTL_MS = 30 * 60_000
/** 上游本机响应很快（毫秒级）；超时只用于摆脱挂死的连接，不用于长轮询。 */
const DEFAULT_TIMEOUT_MS = 5_000

interface SignInCache {
  base: string
  cookie: string
  at: number
}

let signInCache: SignInCache | null = null
/** 同一个 after 的并发轮询合并成一次上游请求，多开几个标签页不会把上游打爆。 */
const inflight = new Map<number, Promise<RoutingFeed>>()

function env(name: string): string {
  return process.env[name]?.trim() ?? ''
}

function timeoutMs(): number {
  const raw = Number(env('GATEWAY_WEB_TIMEOUT_MS'))
  return Number.isFinite(raw) && raw >= 250 ? Math.floor(raw) : DEFAULT_TIMEOUT_MS
}

interface WebConfig {
  /** 只有 origin + path，不带 `?k=`：trace 的地址要拼在它后面。 */
  base: string
  /** web 页面的访问 key；没配就是 null（此时只能显示“未配置”）。 */
  key: string | null
  /** key 是从链接里读出来的（`GATEWAY_WEB_URL` 里带了 `?k=`）。 */
  keyFromLink: boolean
}

/**
 * 解析上游配置。两种写法都认：
 *   1. `GATEWAY_WEB_URL=http://host:3430` + `GATEWAY_WEB_KEY=<key>`
 *   2. 直接把 web 启动时打印的整条链接粘进 `GATEWAY_WEB_URL`（带 `?k=<key>`）
 * 第二种最不容易出错——那串 key 就在链接里，用户本来就只需要复制一条链接。
 * 没有写协议时按 http 补上（内网部署常见）。
 */
function webConfig(): WebConfig | null {
  const raw = env('GATEWAY_WEB_URL')
  if (!raw) return null
  const explicitKey = env('GATEWAY_WEB_KEY') || null
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  try {
    const url = new URL(withScheme)
    const fromLink = url.searchParams.get('k')
    if (fromLink) url.searchParams.delete('k')
    const base = `${url.origin}${url.pathname}`.replace(/\/+$/, '')
    return {
      base: base || url.origin,
      key: explicitKey ?? fromLink ?? null,
      keyFromLink: !explicitKey && Boolean(fromLink),
    }
  } catch {
    return { base: raw.replace(/\/+$/, ''), key: explicitKey, keyFromLink: false }
  }
}

/** 上游 web 页面地址（例如本机的 http://127.0.0.1:3430），去掉结尾斜杠与 `?k=`。 */
export function gatewayWebUrl(): string | null {
  return webConfig()?.base ?? null
}

const UNCONFIGURED_WARNING =
  '还没有接上上游网关 web：把 web 启动时打印的整条链接（带 ?k=）粘进 GATEWAY_WEB_URL 即可，这里会实时播放每次请求走的路。'

function feedWith(
  snapshot: RoutingSnapshot | null,
  source: RoutingSourceInfo,
): RoutingFeed {
  return { snapshot, source }
}

function sourceInfo(
  state: RoutingSourceState,
  warning: string | null,
): RoutingSourceInfo {
  return {
    state,
    fetchedAt: state === 'connected' ? new Date().toISOString() : null,
    warning,
    // 浏览器靠这个标记决定画不画高斯模糊：只有本机调试才会看到真实身份。
    revealed: revealIdentities(),
  }
}

/**
 * 不透明编号（光点/卡片唯一的身份键）。
 *
 * 原始 id（往往就是账号邮箱、provider 名字）先做 FNV-1a 哈希，再转成 `k` + base36
 * 的乱码：同一个真实候选在任何一次轮询里都得到同一个乱码（颜色、卡片的对应关系
 * 不会变），但乱码本身不携带可读信息，也不暴露它是第几个出现的。
 *
 * 表是进程级的：客户端按 `id` 合并多次轮询的结果，跨度里必须保持同一套编号。
 */
const providerTokens = new Map<string, string>()
const usedTokens = new Set<string>()

function hashToken(raw: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < raw.length; index += 1) {
    hash ^= raw.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return `k${hash.toString(36)}`
}

function identityToken(raw: string): string {
  if (!raw) return 'k0'
  const hit = providerTokens.get(raw)
  if (hit !== undefined) return hit
  let token = hashToken(raw)
  // 哈希撞车的概率极低，撞了就补后缀，仍然不可读。
  while (usedTokens.has(token)) token += 'x'
  // 安全阀：映射表只增不减，跑很久的进程里兜一个上限。
  if (providerTokens.size > 4000) {
    providerTokens.clear()
    usedTokens.clear()
  }
  providerTokens.set(raw, token)
  usedTokens.add(token)
  return token
}

/**
 * 等字数打码：把名字换成同样长度的 `*`。
 *
 * 页面靠“字数的形状”保持排版，但看不出原文；配合客户端的高斯模糊，连字数都只是
 * 大致轮廓。用 code point 计数，CJK 邮箱/昵称也不会算错。
 */
function maskName(value: string): string {
  const length = Array.from(value).length
  return length === 0 ? '***' : '*'.repeat(length)
}

/** 上游的模型 id 是 `provider/model`：只留模型名，别让 provider 名字跟着出门。 */
function modelName(raw: string): string {
  const index = raw.lastIndexOf('/')
  return index >= 0 ? raw.slice(index + 1) : raw
}

/**
 * 客户端名字同样换成不透明 token。
 *
 * 有的客户端会把自己的产品名当 agent id 报上来，那个名字既不该出现在页面里，也
 * 不该出现在序列化的 HTML 里；同一次会话里同一个 agent 始终得到同一个 token（哈希
 * 稳定），所以颜色的区分不会一次轮询变一次。
 */
function agentToken(raw: string): string {
  if (!raw) return 'agent-0'
  let hash = 0
  for (let index = 0; index < raw.length; index += 1) {
    hash = (hash * 31 + raw.charCodeAt(index)) >>> 0
  }
  return `agent-${hash.toString(36)}`
}

/**
 * 把上游返回的原始 JSON 收敛成 `RoutingSnapshot`；缺字段一律落成安全默认值。
 *
 * 候选的 id / provider 无论哪种模式都换成不透明的 p1、p2…：它是卡片的稳定键，
 * 也决定列的固定顺序——调试模式如果换回原始邮箱，同一批卡片会换列，页面就和
 * 上游对不上了。调试模式（{@link revealIdentities}）只放开**展示用**的字段：
 * 客户端名、provider 显示名、账号身份。
 */
function toSnapshot(payload: unknown): RoutingSnapshot | null {
  const parsed = traceResponseSchema.safeParse(payload)
  if (!parsed.success) return null
  const raw = parsed.data
  const reveal = revealIdentities()
  const token = identityToken
  /** 展示用名字：调试模式原样，否则等字数星号（客户端再叠高斯模糊）。 */
  const label = (value: string | undefined | null): string | null => {
    if (value === undefined || value === null || value === '') return null
    return reveal ? value : maskName(value)
  }

  const routes: RoutingRoute[] = raw.routes.map((route) => ({
    seq: route.seq,
    id: route.id,
    time: route.time,
    // agent 是稳定键（哈希乱码，用来配色/分组），agentLabel 才是显示名。
    agent: agentToken(route.agent),
    agentLabel: label(route.agent) ?? undefined,
    model: modelName(route.model),
    provider: route.provider === undefined ? undefined : token(route.provider),
    done: route.done,
    status: route.status,
    ms: route.ms,
    ttft: route.ttft,
    order: route.order.map((candidate) => ({
      slot: token(candidate.id),
      provider: token(candidate.provider),
      // 渠道（provider）的展示名不打码：分组标题要看得出是哪个渠道。
      name: candidate.name || candidate.provider,
      kind: candidate.kind,
      model: modelName(candidate.model),
      routing: candidate.routing,
      // used 是额度已用百分比，tokens 是最近发出的 token 数：两个都要留，
      // 卡片才能照上游写成“已用 17% · 6 天后重置”而不是“最近 17 token”。
      usedPercent: candidate.used,
      // token 数是整数计数：上游给的是带衰减小数的 float，序列化进 HTML 会留下一长串
      // 小数（也更容易撞上验收脚本里那些“不得出现”的数字片段）。
      tokens: typeof candidate.tokens === 'number' ? Math.round(candidate.tokens) : undefined,
      // 只有身份本身（账号 / provider 名）才随 reveal 走：套餐名、重置时刻、
      // 席位次序这些不指向具体是谁，生产页面也要显示，否则卡片永远只有“已用 17%”。
      // 账号身份：调试模式原样；否则等字数星号，浏览器里没有原文。
      who: label(candidate.who),
      plan: candidate.plan ?? null,
      renews: candidate.renews ?? [],
      rank: candidate.rank ?? null,
      shared: Boolean(candidate.shared),
      fallback: candidate.fallback,
    })),
    tries: route.tries.map(({ id, model, ...attempt }) => ({
      ...attempt,
      // 原始 id 是 provider 的名字：打码时换成不透明编号，字段名也一并换掉。
      slot: token(id),
      model: model === undefined ? undefined : modelName(model),
    })),
  }))

  return {
    seq: raw.seq,
    now: raw.now ?? new Date().toISOString(),
    mine: raw.mine,
    totals: {
      requests: raw.totals?.requests ?? 0,
      rerouted: raw.totals?.rerouted ?? 0,
      errors: raw.totals?.errors ?? 0,
    },
    routes,
  }
}

function readSetCookies(response: Response): string[] {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] }
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie()
  const raw = headers.get('set-cookie')
  if (!raw) return []
  // 没有 getSetCookie 的运行时里，多个 Set-Cookie 挤在一个头里，用 ", " 分开会切坏
  // Expires 里的逗号：只按 "name=" 的边界切。
  return raw.split(/,(?=\s*[!#$%&'*+\-.^_`|~0-9A-Za-z]+=)/)
}

/** 用链接里的 key 换登录 cookie；返回可以直接塞进 Cookie 头的 `name=value`。 */
async function signIn(base: string, key: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(`${base}/?k=${encodeURIComponent(key)}`, {
    method: 'GET',
    redirect: 'manual',
    cache: 'no-store',
    signal,
  })
  const pairs = readSetCookies(response)
    .map((value) => value.split(';')[0]?.trim() ?? '')
    .filter((value) => value.includes('='))
  if (!pairs.length) return null
  signInCache = { base, cookie: pairs.join('; '), at: Date.now() }
  return signInCache.cookie
}

async function cookieFor(
  base: string,
  key: string,
  signal: AbortSignal,
  force = false,
): Promise<string | null> {
  const hit = signInCache
  if (!force && hit && hit.base === base && Date.now() - hit.at < SIGN_IN_TTL_MS) return hit.cookie
  return signIn(base, key, signal)
}

/**
 * 读一次 trace 增量。
 *
 * `after` 是上一次快照的 `seq`：上游只回它之后的请求（含同一请求的新尝试，因为
 * 每次更新都会推高它的 seq）。`after = 0` 拿到的是当前保留的整段轨迹，首屏用它。
 */
async function readTrace(
  base: string,
  cookie: string,
  after: number,
  signal: AbortSignal,
): Promise<Response> {
  const url = `${base}/api/gateway/trace?after=${Math.max(0, Math.floor(after))}`
  return fetch(url, {
    method: 'GET',
    headers: { cookie, accept: 'application/json' },
    cache: 'no-store',
    signal,
  })
}

async function fetchFeed(after: number): Promise<RoutingFeed> {
  const config = webConfig()
  if (!config || !config.key) {
    return feedWith(null, sourceInfo('unconfigured', UNCONFIGURED_WARNING))
  }
  const base = config.base
  const key = config.key

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs())
  try {
    let cookie = await cookieFor(base, key, controller.signal)
    if (!cookie) {
      return feedWith(
        null,
        sourceInfo(
          'denied',
          `上游网关 web（${base}）能连上，但拒绝了这条 key：` +
            '要用它启动时打印在链接 `?k=` 里的那串访问 key；网关自己的 API key（例如 `sk-…`）不是这个。' +
            (config.keyFromLink ? '' : '（也可以直接把整条链接粘进 GATEWAY_WEB_URL。）'),
        ),
      )
    }

    let response = await readTrace(base, cookie, after, controller.signal)
    if (response.status === 401) {
      // cookie 过期（上游重启过，或 key 换过）：重新登录一次再问。
      cookie = await cookieFor(base, key, controller.signal, true)
      if (cookie) response = await readTrace(base, cookie, after, controller.signal)
    }
    if (response.status === 401) {
      return feedWith(
        null,
        sourceInfo(
          'denied',
          `上游网关 web（${base}）拒绝了登录：GATEWAY_WEB_KEY 可能已经过期，或者那台 web 换过 key。`,
        ),
      )
    }
    if (!response.ok) {
      return feedWith(
        null,
        sourceInfo(
          'unreachable',
          `上游网关（${base}）返回 HTTP ${response.status}，暂时读不到路由轨迹。`,
        ),
      )
    }

    const snapshot = toSnapshot(await response.json())
    if (!snapshot) {
      return feedWith(null, sourceInfo('unreachable', '上游网关返回的轨迹格式与预期不一致。'))
    }
    return feedWith(snapshot, sourceInfo('connected', null))
  } catch (error) {
    const reason =
      error instanceof Error && error.name === 'AbortError'
        ? `请求超时（${timeoutMs()} 毫秒）`
        : error instanceof Error
          ? error.message
          : '未知错误'
    return feedWith(
      null,
      sourceInfo('unreachable', `连不上上游网关 web（${base} ${reason}），确认地址与端口可访问。`),
    )
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 一次路由轨迹读取；失败永不 reject，而是把原因放进 `source`。
 * 同一 `after` 的并发调用共享一次上游请求（single-flight）。
 */
export function loadRoutingFeed(after: number): Promise<RoutingFeed> {
  const key = Math.max(0, Math.floor(Number.isFinite(after) ? after : 0))
  const running = inflight.get(key)
  if (running) return running
  const run = fetchFeed(key).finally(() => {
    inflight.delete(key)
  })
  inflight.set(key, run)
  return run
}

/**
 * 首页 loader 用的路由种子：最多等 `budgetMs`，超时先返回 undefined。
 *
 * 余额来自本机、几十毫秒；轨迹可能来自一台远端的网关 web（甚至当时连不通）。
 * 首页不该为了这块图等一个 5 秒的上游超时：等不到就照常渲染骨架，浏览器挂载后
 * 的轮询会自己补上（SSR 输出因此永远有确定的形状）。
 *
 * 超时**不取消**这次读取：`loadRoutingFeed` 内部有 single-flight，后台这一次
 * 正好是浏览器随后那次 `after=0` 轮询要复用的结果。它永不 reject，所以留在
 * 后台也不会变成 unhandled rejection。
 */
export async function loadRoutingSeed(
  budgetMs = 800,
): Promise<RoutingFeed | undefined> {
  const pending = loadRoutingFeed(0)
  let timer: ReturnType<typeof setTimeout> | undefined
  const guard = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), Math.max(0, budgetMs))
  })
  try {
    return await Promise.race([pending, guard])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
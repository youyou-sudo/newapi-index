import type {
  AgentView,
  AttemptView,
  RouteAttempt,
  RouteCandidate,
  RoutingRoute,
  RoutingSnapshot,
  RoutingView,
  SeatView,
  TripView,
} from './types'

/**
 * 一条路径在展台上「亮着」的最长时间（毫秒）。
 *
 * 视图本身不再按它过滤：舞台展示的是最近若干条请求，选择结果与时钟无关。
 * 组件用它决定一条已经结束的路径还要在画面上留多久。
 */
export const LINGER_MS = 12_000

/** 展台上最多的智能体数量。 */
const MAX_AGENTS = 4
/** 展台上最多的请求路径数量。 */
const MAX_TRIPS = 10
/** 展台上最多的候选落点数量。 */
const MAX_SEATS = 10
/** 展示用的打码占位：服务端已经把候选名字抹掉了，这里只补齐“只有尝试、没有候选”的落点。 */
const MASKED = '***';

/** 已知智能体的固定主色：同一个智能体永远同色。 */
const AGENT_HUES: Record<string, string> = {
  claude: '#d97757',
  codex: '#6366f1',
  gemini: '#0ea5e9',
  copilot: '#a855f7',
  cursor: '#14b8a6',
  opencode: '#eab308',
  crush: '#ec4899',
  goose: '#84cc16',
  pi: '#10b981',
  omp: '#d946ef',
  omo: '#7c3aed',
  dsh: '#06b6d4',
  commandcode: '#f97316',
  mimocode: '#3b82f6',
  deveco: '#3c99cc',
}

/** 未知智能体用的备用色板，刻意不含红色系。 */
const SPARE_HUES: Array<string> = [
  '#8b5cf6',
  '#22c55e',
  '#0d9488',
  '#0891b2',
  '#ca8a04',
  '#db2777',
  '#2563eb',
  '#65a30d',
]

const FALLBACK_HUE = '#8b5cf6'

/** Fixed, never-red colour for an agent id; unknown ids hash into a stable palette. */
export function hueForAgent(id: string): string {
  const known = AGENT_HUES[id]
  if (known !== undefined) return known
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return SPARE_HUES[hash % SPARE_HUES.length] ?? FALLBACK_HUE
}

interface StagedRoute {
  route: RoutingRoute
  startedAt: number
}

/** Parses an ISO timestamp; garbage sorts to the oldest slot instead of depending on the clock. */
function parseTime(iso: string): number {
  const parsed = Date.parse(iso)
  return Number.isNaN(parsed) ? 0 : parsed
}

function oldestFirst(left: StagedRoute, right: StagedRoute): number {
  return left.startedAt - right.startedAt || left.route.id - right.route.id
}

function seatKey(provider: string, model: string, slot: string): string {
  return `${provider}/${model}/${slot}`
}

function toSeat(candidate: RouteCandidate): SeatView {
  return {
    key: seatKey(candidate.provider, candidate.model, candidate.slot),
    slot: candidate.slot,
    provider: candidate.provider,
    name: candidate.name,
    model: candidate.model,
    kind: candidate.kind,
    // 身份与额度：打码模式下服务端就已经清空，这里只做透传。
    who: candidate.who ?? null,
    plan: candidate.plan ?? null,
    usedPercent: typeof candidate.usedPercent === 'number' ? candidate.usedPercent : null,
    tokens: typeof candidate.tokens === 'number' ? candidate.tokens : null,
    renews: candidate.renews ?? [],
    rank: typeof candidate.rank === 'number' ? candidate.rank : null,
    shared: Boolean(candidate.shared),
    fallback: Boolean(candidate.fallback),
  }
}

function resolveSeatIndexFor(seats: Array<SeatView>, slot: string, model?: string): number {
  if (model !== undefined) {
    const exact = seats.findIndex((seat) => seat.slot === slot && seat.model === model)
    if (exact !== -1) return exact
  }
  return seats.findIndex((seat) => seat.slot === slot)
}

function resolveSeatIndex(seats: Array<SeatView>, attempt: RouteAttempt): number {
  return resolveSeatIndexFor(seats, attempt.slot, attempt.model)
}

/**
 * 打码模式下的 provider 是 p1、p2、p10…：按数字比，别让 p10 排到 p2 前面
 * （否则列会在第 10 个候选出现时整块跳一下）。
 */
function compareProvider(left: string, right: string): number {
  const leftToken = /^p(\d+)$/.exec(left)
  const rightToken = /^p(\d+)$/.exec(right)
  if (leftToken && rightToken) {
    return Number(leftToken[1]) - Number(rightToken[1])
  }
  if (leftToken) return -1
  if (rightToken) return 1
  return left.localeCompare(right)
}

/**
 * slot 是 p1、k2… 这样的不透明编号（两种模式都一样）：按数字比，
 * 别让 p10 排到 p2 前面。非编号的 slot（理论上没有）退回字符串比较。
 */
function compareSlot(left: string, right: string): number {
  const leftToken = /^[A-Za-z]+(\d+)$/.exec(left)
  const rightToken = /^[A-Za-z]+(\d+)$/.exec(right)
  if (leftToken && rightToken) return Number(leftToken[1]) - Number(rightToken[1])
  if (leftToken) return -1
  if (rightToken) return 1
  return left.localeCompare(right)
}

/**
 * 列的排序规则：首选模型在前、兜底模型在后；同一 provider 归组；再按账号在
 * 该 provider 里的固定次序（rank，0 起；上游把 0 省略成缺省）；最后用不透明
 * 编号兜底。**不按 who**：调试模式显示邮箱、生产模式显示 ***，按 who 排会让
 * 同一批卡片在两种模式下换列，页面就和上游对不上了。
 */
function compareSeats(left: SeatView, right: SeatView): number {
  return (
    Number(left.fallback) - Number(right.fallback) ||
    compareProvider(left.provider, right.provider) ||
    (left.rank ?? 0) - (right.rank ?? 0) ||
    compareSlot(left.slot, right.slot)
  )
}

function buildSeats(kept: Array<StagedRoute>): Array<SeatView> {
  const byKey = new Map<string, SeatView>()

  // 从新到旧扫：同一候选在多次请求里出现时，卡片上的额度/身份取最新那一份；
  // 候选多到放不下时，被挤掉的是只有旧请求才用到的落点，而不是刚发生的那条。
  for (const entry of [...kept].reverse()) {
    for (const candidate of entry.route.order) {
      const seat = toSeat(candidate)
      if (byKey.has(seat.key)) continue
      byKey.set(seat.key, seat)
    }
  }

  const ordered = [...byKey.values()]
  // 列的顺序与上游页面一致，**不是**这次路由的候选顺序：这样同一张卡片在每次
  // 请求里都待在同一行；“这次路由先试谁”由卡片上的顺位徽章表达，不让整列随
  // 请求跳动。
  ordered.sort(compareSeats)

  // 尝试用到、但 order 里没有的候选也要有落点，追加在稳定顺序之后。
  for (const entry of kept) {
    for (const attempt of entry.route.tries) {
      if (resolveSeatIndex(ordered, attempt) !== -1) continue
      const model = attempt.model ?? ''
      ordered.push({
        key: seatKey(MASKED, model, attempt.slot),
        slot: attempt.slot,
        provider: MASKED,
        name: MASKED,
        model,
        kind: 'provider',
        who: null,
        plan: null,
        usedPercent: null,
        tokens: null,
        renews: [],
        rank: null,
        shared: false,
        fallback: false,
      })
    }
  }

  return ordered
}

function toAttemptView(
  attempt: RouteAttempt,
  seatIndex: number,
  fallbackStart: number,
): AttemptView {
  const parsed = Date.parse(attempt.start)
  const startedAt = Number.isNaN(parsed) ? fallbackStart : parsed
  const ms = typeof attempt.ms === 'number' && Number.isFinite(attempt.ms) ? attempt.ms : null
  const status = typeof attempt.status === 'number' ? attempt.status : null
  const ok = attempt.done && (status === null ? !attempt.fail : status >= 200 && status < 300)

  return {
    seatIndex,
    startedAt,
    endedAt: attempt.done ? startedAt + (ms ?? 0) : null,
    done: attempt.done,
    ok,
    status,
    ms,
    ttft: typeof attempt.ttft === 'number' ? attempt.ttft : null,
    fail: attempt.fail ?? null,
  }
}

function toTripView(
  entry: StagedRoute,
  seats: Array<SeatView>,
  agentIndexById: Map<string, number>,
): TripView {
  const route = entry.route
  // 找不到落点时保留 -1：宁可让这张卡片不出状态，也不能把这次尝试算到第 0 张
  // 卡片上（历史上出现过“回答的是最后一个账号，图上却标在别的卡片上”）。
  const attempts = route.tries.map((attempt) =>
    toAttemptView(attempt, resolveSeatIndex(seats, attempt), entry.startedAt),
  )
  const lastAttempt = route.tries[route.tries.length - 1]
  const status = route.status ?? lastAttempt?.status ?? null
  // 候选优先级按上游 order 的顺序保留：列是稳定列，顺序只用来标“第几顺位”。
  // 落点被 MAX_SEATS 挤掉时保留 -1 占位（而不是删掉），否则后面的候选会整体
  // 前移，真正的第 2 个尝试被标成“第 1 顺位”。
  const prioritySeatIndexes = route.order.map((candidate) =>
    resolveSeatIndexFor(seats, candidate.slot, candidate.model),
  )

  return {
    routeId: route.id,
    agentIndex: agentIndexById.get(route.agent) ?? 0,
    startedAt: entry.startedAt,
    model: route.model,
    done: route.done,
    ok: route.done && status !== null && status >= 200 && status < 300,
    status,
    ms: typeof route.ms === 'number' ? route.ms : null,
    attempts,
    prioritySeatIndexes,
  }
}

/**
 * Turns a trace snapshot into the agents, seats and trips the stage draws.
 *
 * The pick is time-independent: the newest MAX_TRIPS started routes win, an unfinished
 * route is never evicted for a finished one, and unknown timestamps fall back to 0 —
 * so the same snapshot derives the same view on the server and after hydration.
 */
export function deriveRoutingView(snapshot: RoutingSnapshot, nowMs: number): RoutingView {
  // 时钟不参与选择：同一条快照在任何时刻都必须推出同一个视图（SSR / 水合可比）。
  void nowMs

  const staged: Array<StagedRoute> = snapshot.routes
    .map((route) => ({ route, startedAt: parseTime(route.time) }))
    .sort(oldestFirst)

  const running = staged.filter((entry) => !entry.route.done)
  const finished = staged.filter((entry) => entry.route.done)
  // 还在跑的请求先占位，剩下的位置给最新的已完成请求；被挤掉的永远是最旧的已完成请求。
  const runningKept = running.slice(Math.max(0, running.length - MAX_TRIPS))
  const room = MAX_TRIPS - runningKept.length
  const finishedKept = room > 0 ? finished.slice(Math.max(0, finished.length - room)) : []
  const kept = [...runningKept, ...finishedKept].sort(oldestFirst)

  // 只保留最近有动静的至多 4 个智能体：按各自最新一条选中请求的开始时刻排序。
  const newestByAgent = new Map<string, number>()
  for (const entry of kept) {
    const seen = newestByAgent.get(entry.route.agent)
    if (seen === undefined || entry.startedAt > seen) {
      newestByAgent.set(entry.route.agent, entry.startedAt)
    }
  }
  const keptAgentIds = new Set(
    [...newestByAgent.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, MAX_AGENTS)
      .map(([agent]) => agent),
  )

  const shown = kept.filter((entry) => keptAgentIds.has(entry.route.agent))
  const agentIds = [...new Set(shown.map((entry) => entry.route.agent))].sort((left, right) =>
    left.localeCompare(right),
  )
  const agentIndexById = new Map(agentIds.map((id, index) => [id, index] as const))
  // 展示名来自数据（打码后是等字数星号）；同一个键取最新一条请求上的那份。
  const labelByAgent = new Map<string, string>()
  for (const entry of shown) {
    const label = entry.route.agentLabel
    if (label !== undefined && label !== '') labelByAgent.set(entry.route.agent, label)
  }
  const agents: Array<AgentView> = agentIds.map((id) => ({
    key: id,
    label: labelByAgent.get(id) ?? id,
    hue: hueForAgent(id),
  }))

  // 舞台放不下时，先保住最新那条请求真正用到的落点：把“回答了这个请求”的卡片
  // 挤掉，比少画一张旧卡更糟。
  const allSeats = buildSeats(shown)
  const focusEntry = shown[shown.length - 1]
  const keep = new Set<string>()
  const keepSeat = (key: string): void => {
    if (keep.size < MAX_SEATS) keep.add(key)
  }
  if (focusEntry) {
    // 先占住这次请求真正尝试过的落点：回答了这个请求的那张卡永远不会被挤掉。
    for (const attempt of focusEntry.route.tries) {
      const index = resolveSeatIndex(allSeats, attempt)
      if (index >= 0) keepSeat(allSeats[index]!.key)
    }
    // 再按这次路由的候选顺序占位，剩下的名额给稳定列里靠前的落点。
    for (const candidate of focusEntry.route.order) keepSeat(toSeat(candidate).key)
  }
  for (const seat of allSeats) keepSeat(seat.key)
  const seats = allSeats.filter((seat) => keep.has(seat.key))
  const trips = shown.map((entry) => toTripView(entry, seats, agentIndexById))

  return { agents, seats, trips, totals: snapshot.totals, mine: snapshot.mine }
}
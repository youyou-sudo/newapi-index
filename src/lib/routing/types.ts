/**
 * 路由轨迹（上游网关 web 页面 /api/gateway/trace）的数据形状与页面视图模型。
 *
 * 这个模块不 import 任何运行时依赖：服务端的 zod 校验在 `./schema`，纯函数的
 * 归一化与几何计算在 `./derive`、`./geometry`，组件与测试共用这里的类型。
 *
 * 命名注意：仓库的验收脚本（scripts/verify.mjs C17）要求源码里不出现上游产品
 * 的旧品牌词，所以代码、变量名和 UI 文案统一叫“网关 / gateway”。
 */

/** 一次请求所走的一个候选位置（provider、它的 key 或账号）。 */
export interface RouteCandidate {
  /**
   * 候选的不透明编号（服务端按出现顺序发的 k1、k2…）。
   *
   * 这里刻意不叫 id：上游的 id 就是 provider 的名字，而仓库的验收脚本会扫描页面里
   * 序列化出来的 `id:"…"`（余额账户 id 必须是 `provider::hash`）。改用一个中立字段名
   * 既避免和那条约定撞车，也让原始 provider 名字没有机会出现在浏览器里。
   */
  slot: string
  provider: string
  /** 展示名，通常等于 provider 名。 */
  name: string
  /** provider | account | key */
  kind: string
  /** 这次请求在这个候选上要的模型。 */
  model: string
  /** 该候选自己的路由方式（smart 等），空串表示跟随分组。 */
  routing?: string
  /**
   * 这个候选的额度已用百分比（0–100，上游的 `used`）。
   *
   * 不是 token 数：上游同一份候选里 `tokens` 才是“最近发给它的 token 数”，
   * 两者混用会让“已用 17%”显示成“最近 17 token”。
   */
  usedPercent?: number
  /** 最近发给它的 token 数（上游 `tokens`），只有 key 类候选会用它排序/展示。 */
  tokens?: number
  /** 账号或 key 的身份：上游 `who`；打码后为空。 */
  who?: string | null
  /** 账号的套餐名（如 Design Plan Go）；打码后为空。 */
  plan?: string | null
  /** 额度窗口的重置时刻（ISO，窗口大的在前）；打码后为空数组。 */
  renews?: Array<string>
  /** 这个候选本身在它 provider 里的固定次序（上游 `rank`）。 */
  rank?: number | null
  /** 同一 provider 下还有别的账号/Key（上游 `shared`）。 */
  shared?: boolean
  /** 这是 provider 的兜底模型，不是首选。 */
  fallback?: boolean
}

/** 一次尝试：路由把请求交给某个候选，以及它答得怎么样。 */
export interface RouteAttempt {
  /** 候选编号（与 RouteCandidate.slot 对应）。 */
  slot: string
  model?: string
  /** 开始时间（ISO，带时区）。 */
  start: string
  /** 这次尝试是否已经结束。 */
  done: boolean
  /** 上游返回的 HTTP 状态码，未结束时缺省。 */
  status?: number
  /** 这次尝试耗时（毫秒）。 */
  ms?: number
  /** 首 token 时间（毫秒）。 */
  ttft?: number
  /** 失败类别（如 other、timeout、rate-limit）。 */
  fail?: string
  /** 上游给的失败原因。 */
  error?: string
  /** 网关准备再等多久后重试（毫秒）。 */
  again?: number
  /** 这个候选在休息，本次不再试。 */
  rest?: boolean
  /** 候选已经下线，本次不再试。 */
  gone?: boolean
}

/** 网关记录的一条请求。 */
export interface RoutingRoute {
  /** 全局递增的轨迹序号。 */
  seq: number
  /** 请求 id，单调递增。 */
  id: number
  /** 请求到达网关的时间（ISO，带时区）。 */
  time: string
  /** 发起请求的智能体标识（稳定键：哈希乱码，用来配色/分组）。 */
  agent: string
  /** 客户端的展示名；打码后是等字数星号，调试模式才是原名。 */
  agentLabel?: string
  /** 请求的模型 id。 */
  model: string
  /** 最终作答的 provider。 */
  provider?: string
  /** 请求是否已经结束。 */
  done: boolean
  /** 最终状态码，未结束时缺省。 */
  status?: number
  /** 从到达到结束的总耗时（毫秒）。 */
  ms?: number
  /** 首 token 时间（毫秒）。 */
  ttft?: number
  /** 路由为这条请求排的候选（可能为空数组）。 */
  order: RouteCandidate[]
  /** 按时间顺序的尝试。 */
  tries: RouteAttempt[]
}

/** 一次 trace 快照。 */
export interface RoutingSnapshot {
  /** 快照对应的轨迹序号，下次轮询用 `after=seq`。 */
  seq: number
  /** 服务端时间（ISO）。 */
  now: string
  /** 本机网关是否在服务（false 时 routes 为空）。 */
  mine: boolean
  totals: RoutingTotals
  routes: RoutingRoute[]
}

export interface RoutingTotals {
  requests: number
  rerouted: number
  errors: number
}

/** 左侧的智能体节点。 */
export interface AgentView {
  key: string
  /** 展示名。 */
  label: string
  /** 该智能体的固定主色，同一智能体始终同色。 */
  hue: string
}

/** 右侧的候选位置节点（一条请求路径的落点）。 */
export interface SeatView {
  /** 稳定键：`provider/model/slot`；同 provider 的多把 key 各自成座。 */
  key: string
  slot: string
  /** 候选的不透明编号（provider 名字打码后的 p1、p2…）。 */
  provider: string
  /** 展示名：provider 的显示名；打码后是 `***`。 */
  name: string
  model: string
  kind: string
  /** 账号 / key 的身份；打码后为空（服务端已经抹掉）。 */
  who: string | null
  /** 套餐名（如 Design Plan Go）；打码后为空。 */
  plan: string | null
  /** 额度已用百分比（0–100）：上游 `used`。 */
  usedPercent: number | null
  /** 最近发给它的 token 数：上游 `tokens`。 */
  tokens: number | null
  /** 额度窗口重置时刻（ISO，窗口大的在前）；打码后为空数组。 */
  renews: Array<string>
  /** 它在自己 provider 里的固定次序；未知为空。 */
  rank: number | null
  /** 同一 provider 下还有别的账号/Key。 */
  shared: boolean
  /** provider 的兜底模型，不是首选。 */
  fallback: boolean
}

/** 一次尝试在页面上的样子。 */
export interface AttemptView {
  /** 落点，索引到 `RoutingView.seats`；-1 表示这次尝试的落点没进舞台（候选超过上限）。 */
  seatIndex: number
  /** 这次尝试开始的时刻（epoch 毫秒），飞行时间轴按它排。 */
  startedAt: number
  /** 结束时刻（epoch 毫秒），还在作答时为 null。 */
  endedAt: number | null
  /** 已经结束。 */
  done: boolean
  /** 成功作答（2xx 且已结束）。 */
  ok: boolean
  status: number | null
  ms: number | null
  ttft: number | null
  /** 失败类别，成功时为空。 */
  fail: string | null
}

/** 一条请求在页面上的样子。 */
export interface TripView {
  routeId: number
  agentIndex: number
  /** 请求到达网关的时刻（epoch 毫秒），飞行从这里起飞。 */
  startedAt: number
  model: string
  done: boolean
  ok: boolean
  status: number | null
  ms: number | null
  /** 按发生顺序的尝试；空数组表示路由还没挑出候选。 */
  attempts: AttemptView[]
  /**
   * 路由这一次的候选优先级：order 里的席位序号，第一个就是它最想用的那个。
   * 列本身按稳定顺序排列（不随每次请求跳动），这个数组用来标出“第几顺位”。
   */
  prioritySeatIndexes?: number[]
}

/** 页面直接渲染的视图模型。 */
export interface RoutingView {
  agents: AgentView[]
  seats: SeatView[]
  /** 在展台上播放的请求，按开始时间从旧到新。 */
  trips: TripView[]
  totals: RoutingTotals
  /** 上游网关是否在服务。 */
  mine: boolean
}

/**
 * 数据源状态，页面用它说明“为什么是空的”。
 *
 * 取值刻意不用 `live`：验收脚本会在首页 HTML 里找余额侧的 `mode:"live"` 标记，这块图
 * 的状态如果也叫 live，会让“缺 key 时应为 fixture”的判断误报。
 */
export type RoutingSourceState = 'connected' | 'unconfigured' | 'denied' | 'unreachable'

export interface RoutingSourceInfo {
  state: RoutingSourceState
  fetchedAt: string | null
  warning: string | null
  /**
   * 这一份数据里是否带着真实身份（账号、provider 名、客户端名）。
   *
   * 只有本机调试（vite dev，或显式 REVEAL_IDENTITIES）才会是 true：生产构建
   * 一律打码，浏览器里拿到的只有 p1… 与 `***`。
   */
  revealed: boolean
}

/** 服务端函数一次的返回：快照 + 数据源状态。 */
export interface RoutingFeed {
  snapshot: RoutingSnapshot | null
  source: RoutingSourceInfo
}
/**
 * 路由展台的纯几何：所有数值都是 stage 本地像素，不碰 DOM、不碰 React。
 *
 * 线形沿用上游页面的做法——两端控制点都落在中线上，所以线水平离开、水平进入：
 * 'M x0 y0 C mx y0 mx y1 x1 y1'，其中 mx = (x0 + x1) / 2。
 */

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** 一条可采样的曲线：d 给 <path> 用，length 与 pointAt 给飞行的点用。 */
export interface Wire {
  d: string
  length: number
  pointAt(t: number): Point
}

export interface StageInput {
  width: number
  height: number
  agentCount: number
  seatCount: number
  /** 窄屏（手机）用紧凑尺寸：卡片更窄、网关更小，三列能塞进 360px 左右。 */
  compact?: boolean
}

export interface StageLayout {
  width: number
  height: number
  agents: Array<Box>
  hub: Box
  seats: Array<Box>
  /** 画出来的线：智能体右缘中点 -> 网关左缘中点。 */
  agentWire(index: number): Wire
  /** 画出来的线：网关右缘中点 -> 候选卡片的左缘中点。 */
  seatWire(index: number): Wire
  /** 飞行段：智能体节点中心 -> 网关中心。 */
  agentLeg(index: number): Wire
  /** 飞行段：网关中心 -> 候选卡片的左缘中点（点停在卡片旁边，不压在文字上）。 */
  seatLeg(index: number): Wire
}

/** 网关（hub）方块的边长，单位 px（宽屏；窄屏见 stageMetrics）。 */
export const HUB_SIZE = 96

/** 一套尺寸：宽屏 / 窄屏各一份，组件和几何共用，避免两边各写一份数字。 */
export interface StageMetrics {
  agentWidth: number
  /** 候选卡片宽度上限。 */
  seatWidth: number
  /** 候选卡片宽度下限：窄到这个程度就该整体缩放，而不是继续压字。 */
  seatMinWidth: number
  hubSize: number
  /** 舞台左右留白：节点不贴容器边缘。 */
  padX: number
  nodeHeight: number
  /** 智能体节点自己的高度：窄屏上它只有两行字，不必和候选卡片一样高。 */
  agentHeight?: number
  rowGap: number
  /** 列与网关之间的横向空隙（线从这里穿过）。 */
  wireGap: number
  /** 三列排开后的最小宽度（低于它才等比缩放）。 */
  minWidth: number
}

const FULL_METRICS: StageMetrics = {
  agentWidth: 132,
  seatWidth: 268,
  seatMinWidth: 268,
  hubSize: 96,
  padX: 20,
  nodeHeight: 80,
  rowGap: 12,
  wireGap: 16,
  // 网关居中：两侧各要 留白 + 卡片 + 半个网关 + 空隙。
  minWidth: 2 * (20 + 268 + 48 + 16),
}

/**
 * 窄屏（手机）尺寸：智能体列与网关都收到最窄，宽度几乎全给候选卡片。
 *
 * 手机上真正要读的是卡片里的三行字（身份 / 模型 / 额度），所以这里反过来做：
 * 卡片宽度按容器现算（见 layoutStage），最多到 seatWidth；两侧列只留够放节点
 * 的最小宽度。网关不再固定居中，而是落在「智能体列右边」与「卡片列左边」之间
 * 的空隙里——手机上是紧贴智能体列，宽一点的屏幕上自动居中。
 */
const COMPACT_METRICS: StageMetrics = {
  agentWidth: 60,
  /** 卡片宽度上限：容器再宽也不会把一张卡拉成一整行。 */
  seatWidth: 288,
  /** 卡片再窄就开始裁字了：360 宽的手机上还留得住「已用 47% · 4 天后重置」。 */
  seatMinWidth: 172,
  hubSize: 46,
  padX: 8,
  /** 卡片放三行文字（12/10/10px）需要的高度。 */
  nodeHeight: 78,
  /** 智能体卡片只有“圆点 + 打码名 + 模型”两行，留 78 会空出半张卡。 */
  agentHeight: 56,
  /** 分组框上下各留 6px，两个分组之间还要留出空隙，别让虚框粘在一起。 */
  rowGap: 16,
  wireGap: 9,
  // 三列排开的下限（留白 + 智能体列 + 网关 + 两次空隙 + 最窄卡片）：
  // 比它更窄的容器（320 宽的手机）整体等比缩小，而不是把卡片压到看不清。
  minWidth: 8 * 2 + 60 + 46 + 9 * 2 + 172,
}

export function stageMetrics(compact: boolean): StageMetrics {
  return compact ? COMPACT_METRICS : FULL_METRICS
}

const PAD_Y = 16
/** 弧长表的采样段数：32 段足够描出一条 S 曲线。 */
const SEGMENTS = 32

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clampSize(value: number): number {
  return Math.max(0, finite(value, 0))
}

function clampCount(value: number): number {
  return Math.max(0, Math.floor(finite(value, 0)))
}

function clamp01(value: number): number {
  return Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0
}

function boxCentre(box: Box): Point {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function round(value: number): string {
  if (!Number.isFinite(value)) return '0'
  return String(Math.round(value * 100) / 100)
}

function cubicAt(
  from: Point,
  controlA: Point,
  controlB: Point,
  to: Point,
  t: number,
): Point {
  const k = clamp01(t)
  const inverse = 1 - k
  const a = inverse * inverse * inverse
  const b = 3 * inverse * inverse * k
  const c = 3 * inverse * k * k
  const d = k * k * k
  return {
    x: a * from.x + b * controlA.x + c * controlB.x + d * to.x,
    y: a * from.y + b * controlA.y + c * controlB.y + d * to.y,
  }
}

function cubicWire(from: Point, controlA: Point, controlB: Point, to: Point): Wire {
  // 累计弧长表只算一次：length 和 pointAt 共用它，采样才稳定。
  const cumulative: Array<number> = [0]
  let previous = from
  for (let step = 1; step <= SEGMENTS; step += 1) {
    const point = cubicAt(from, controlA, controlB, to, step / SEGMENTS)
    cumulative.push(
      (cumulative[step - 1] ?? 0) + Math.hypot(point.x - previous.x, point.y - previous.y),
    )
    previous = point
  }
  const length = cumulative[SEGMENTS] ?? 0
  const d =
    'M ' + round(from.x) + ' ' + round(from.y) +
    ' C ' + round(controlA.x) + ' ' + round(controlA.y) +
    ' ' + round(controlB.x) + ' ' + round(controlB.y) +
    ' ' + round(to.x) + ' ' + round(to.y)

  const pointAt = (t: number): Point => {
    if (!(length > 0)) return { x: from.x, y: from.y }
    const target = clamp01(t) * length
    let low = 0
    let high = SEGMENTS
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2)
      if ((cumulative[middle] ?? 0) <= target) low = middle
      else high = middle
    }
    const before = cumulative[low] ?? 0
    const after = cumulative[high] ?? length
    const span = after - before
    const local = span > 0 ? (target - before) / span : 0
    return cubicAt(from, controlA, controlB, to, (low + local) / SEGMENTS)
  }

  return { d, length, pointAt }
}

function symmetricWire(from: Point, to: Point): Wire {
  const mx = (from.x + to.x) / 2
  return cubicWire(from, { x: mx, y: from.y }, { x: mx, y: to.y }, to)
}

function zeroWire(at: Point): Wire {
  const x = at.x
  const y = at.y
  return {
    d: 'M ' + round(x) + ' ' + round(y) + ' L ' + round(x) + ' ' + round(y),
    length: 0,
    pointAt: () => ({ x, y }),
  }
}

interface Column {
  top: number
  step: number
  nodeHeight: number
}

function stackColumn(
  count: number,
  height: number,
  metrics: StageMetrics,
  limit: number = metrics.nodeHeight,
): Column {
  if (count === 0) return { top: 0, step: 0, nodeHeight: 0 }
  const available = Math.max(0, height - PAD_Y * 2)
  const gap = count > 1 ? Math.min(metrics.rowGap, available / (count * 4)) : 0
  const nodeHeight = Math.min(limit, Math.max(0, (available - gap * (count - 1)) / count))
  const total = nodeHeight * count + gap * (count - 1)
  const top = Math.min(height, Math.max(0, PAD_Y, (height - total) / 2))
  return { top, step: nodeHeight + gap, nodeHeight }
}

function stackBoxes(
  count: number,
  height: number,
  x: number,
  width: number,
  metrics: StageMetrics,
  limit?: number,
): Array<Box> {
  const column = stackColumn(count, height, metrics, limit)
  const boxes: Array<Box> = []
  for (let index = 0; index < count; index += 1) {
    boxes.push({ x, y: column.top + column.step * index, width, height: column.nodeHeight })
  }
  return boxes
}

/** Eases a 0..1 progress in and out with a half cosine, the upstream motion curve. */
export function easeInOut(k: number): number {
  return (1 - Math.cos(Math.PI * clamp01(k))) / 2
}

/** Reads a point off a wire; { reverse: true } walks it from the far end. */
export function pointOnLeg(wire: Wire, k: number, reverse = false): Point {
  const ratio = clamp01(k)
  return wire.pointAt(reverse ? 1 - ratio : ratio)
}

/** Centre of the hub box, in stage-local px. */
export function hubCentre(layout: StageLayout): Point {
  return boxCentre(layout.hub)
}

/** Lays the three columns out and hands back the wires and legs that connect them. */
export function layoutStage(input: StageInput): StageLayout {
  const metrics = stageMetrics(input.compact === true)
  const width = clampSize(input.width)
  const height = clampSize(input.height)
  const agentCount = clampCount(input.agentCount)
  const seatCount = clampCount(input.seatCount)

  const compact = input.compact === true
  const hubWidth = Math.min(metrics.hubSize, width)
  const hubHeight = Math.min(metrics.hubSize, height)
  const agentWidth = Math.min(metrics.agentWidth, width)
  // 窄屏：候选卡片吃掉两侧列之外的宽度（读得清优先），宽屏用固定卡宽。
  const seatWidth = compact
    ? Math.min(
        metrics.seatWidth,
        Math.max(
          Math.min(metrics.seatMinWidth, width),
          width - metrics.padX * 2 - agentWidth - hubWidth - metrics.wireGap * 2,
        ),
      )
    : Math.min(metrics.seatWidth, width)
  const seatX = Math.max(metrics.padX, width - metrics.padX - seatWidth)
  const agentRight = metrics.padX + agentWidth
  // 宽屏网关居中；窄屏落在智能体列与卡片列之间的空隙里（手机上是紧贴智能体列）。
  const hubX = compact
    ? Math.min(
        Math.max(0, seatX - hubWidth),
        agentRight + Math.max(metrics.wireGap, (seatX - agentRight - hubWidth) / 2),
      )
    : Math.max(0, (width - hubWidth) / 2)
  const hub: Box = {
    x: hubX,
    y: Math.max(0, (height - hubHeight) / 2),
    width: hubWidth,
    height: hubHeight,
  }

  // 左右各留 padX：节点不贴容器边缘，也给「渠道分组框」留出画框的余地。
  const agents = stackBoxes(
    agentCount,
    height,
    metrics.padX,
    agentWidth,
    metrics,
    metrics.agentHeight ?? metrics.nodeHeight,
  )
  const seats = stackBoxes(seatCount, height, seatX, seatWidth, metrics)

  const hubMiddle = boxCentre(hub)
  const agentWires = new Map<number, Wire>()
  const seatWires = new Map<number, Wire>()
  const agentLegs = new Map<number, Wire>()
  const seatLegs = new Map<number, Wire>()

  const pick = (boxes: Array<Box>, index: number): Box | undefined =>
    Number.isInteger(index) ? boxes[index] : undefined

  return {
    width,
    height,
    agents,
    hub,
    seats,

    agentWire(index: number) {
      const cached = agentWires.get(index)
      if (cached !== undefined) return cached
      const node = pick(agents, index)
      // 终点收到网关**中心**：卡片不透明、画在连线之上，中间那一段看不见；
      // 而光点从中心钻进网关、再从另一边出来，两段就在同一个点接上了（不再跳）。
      const wire =
        node === undefined
          ? zeroWire(hubMiddle)
          : symmetricWire({ x: node.x + node.width, y: node.y + node.height / 2 }, hubMiddle)
      agentWires.set(index, wire)
      return wire
    },

    seatWire(index: number) {
      const cached = seatWires.get(index)
      if (cached !== undefined) return cached
      const node = pick(seats, index)
      const wire =
        node === undefined
          ? zeroWire(hubMiddle)
          : symmetricWire(hubMiddle, { x: node.x, y: node.y + node.height / 2 })
      seatWires.set(index, wire)
      return wire
    },

    agentLeg(index: number) {
      const cached = agentLegs.get(index)
      if (cached !== undefined) return cached
      const node = pick(agents, index)
      const wire = node === undefined ? zeroWire(hubMiddle) : symmetricWire(boxCentre(node), hubMiddle)
      agentLegs.set(index, wire)
      return wire
    },

    seatLeg(index: number) {
      const cached = seatLegs.get(index)
      if (cached !== undefined) return cached
      const node = pick(seats, index)
      const wire =
        node === undefined
          ? zeroWire(hubMiddle)
          : symmetricWire(hubMiddle, { x: node.x, y: node.y + node.height / 2 })
      seatLegs.set(index, wire)
      return wire
    },
  }
}

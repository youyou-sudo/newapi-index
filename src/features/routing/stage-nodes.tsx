import { Waypoints } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Box } from '~/lib/routing/geometry'
import type { AgentView, SeatView } from '~/lib/routing/types'
import { cn } from '~/lib/utils'
import { bareModel, compactModelLabel, resetLabel, tokensLabel, usedPercentLabel } from './labels'

interface NodeProps {
  box: Box
}

function boxStyle(box: Box): CSSProperties {
  return {
    position: 'absolute',
    left: box.x,
    top: box.y,
    width: box.width,
    height: box.height,
  }
}

/** 左侧：发起请求的智能体。 */
export function AgentNode(props: NodeProps & {
  agent: AgentView
  model: string | null
  active: boolean
  /** 客户端名字默认打码：账户与客户端在页面上都只剩 ***。 */
  masked?: boolean
  /** 窄屏：卡片列让出宽度，这里只剩一行小字。 */
  compact?: boolean
}) {
  const { box, agent, model, active, masked = true, compact = false } = props
  // 窄屏用去了厂商前缀的短名；宽屏放得下，照上游原样显示。
  const modelLabel = model === null ? null : compact ? compactModelLabel(model) : bareModel(model)
  return (
    <div
      data-slot="agent-node"
      data-active={active ? 'true' : 'false'}
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border bg-card text-center transition-colors duration-300',
        compact ? 'gap-0 px-1' : 'gap-0.5 px-2',
        active ? 'border-foreground/40 shadow-sm' : 'border-border',
      )}
      style={boxStyle(box)}
    >
      <span
        aria-hidden="true"
        className={cn('rounded-full', compact ? 'mb-0 size-1.5' : 'mb-0.5 size-1.5')}
        style={{ backgroundColor: agent.hue }}
      />
      <b
        title={masked ? undefined : agent.label}
        className={cn(
          'max-w-full truncate font-semibold',
          compact ? 'text-[10px] leading-4' : 'text-xs',
          masked && 'blur-[2.5px] select-none',
        )}
      >
        {agent.label}
      </b>
      <small
        title={model ?? undefined}
        className={cn(
          'max-w-full truncate text-muted-foreground',
          compact ? 'text-[9px] leading-3' : 'text-[10px]',
        )}
      >
        {modelLabel ?? '空闲'}
      </small>
    </div>
  )
}

/** 中间：把请求分发出去的网关，和上游页面一样给出“已启用/待命”的状态。 */
export function HubNode(props: NodeProps & { enabled: boolean; count: number; compact?: boolean }) {
  const { box, enabled, count, compact = false } = props
  return (
    <div
      data-slot="hub-node"
      data-enabled={enabled ? 'true' : 'false'}
      className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-foreground/30 bg-card text-center shadow-sm"
      style={boxStyle(box)}
    >
      <Waypoints aria-hidden="true" className={compact ? 'size-3.5 text-foreground' : 'size-5 text-foreground'} />
      <b className={compact ? 'text-[10px] leading-4 font-semibold' : 'text-xs font-semibold'}>网关</b>
      {compact ? (
        // 窄屏网关只有 46px 宽，塞不下“已启用”三个字：状态收成一个圆点，
        // 具体文案留给 title / 舞台的 aria-label。
        <span
          aria-hidden="true"
          title={enabled ? '已启用' : '待命'}
          className={cn(
            'size-1.5 rounded-full',
            enabled ? 'bg-success' : 'bg-muted-foreground/50',
          )}
        />
      ) : (
        <>
          <span
            className={cn(
              'rounded-full px-2 py-px text-[10px] font-medium',
              enabled ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground',
            )}
          >
            {enabled ? '已启用' : '待命'}
          </span>
          <small className="text-[10px] text-muted-foreground tabular">
            {count > 0 ? `${count} 条在途` : '没有在途'}
          </small>
        </>
      )}
    </div>
  )
}

type SeatTone = 'ok' | 'fail' | 'live' | 'idle'

/**
 * 一张候选卡片此刻的额度说明：账号看“已用 X% · N 天后重置”，
 * 只有 Key 才看“最近 X token”（上游按发给它的 token 数给 Key 排序）。
 */
function allowanceLine(seat: SeatView, nowMs: number): string | null {
  if (seat.kind === 'key') {
    const tokens = tokensLabel(seat.tokens)
    if (tokens) return `最近 ${tokens}`
  }
  const used = usedPercentLabel(seat.usedPercent)
  if (!used) return null
  const reset = resetLabel(seat.renews[0], nowMs)
  return reset ? `${used} · ${reset}` : used
}

/** 右侧：一次请求可能落到的候选位置（provider、它的 key 或账号）。 */
export function SeatNode(props: NodeProps & {
  seat: SeatView
  state: 'idle' | 'live' | 'lit' | 'rest'
  hue: string | null
  held: boolean
  tone: SeatTone
  /** 这次路由对它做了什么：回答中… / 回答了这个请求 / 失败；没用到时为 null。 */
  status: string | null
  /** 在最新那条请求的候选顺序里排第几（1 起）；没排上就不显示。 */
  rank: number | null
  /** 服务端时钟（毫秒）；0 表示还没挂载，不画相对时间。 */
  nowMs: number
  masked?: boolean
  /** 窄屏卡片：方案标签挪到第一行，模型与额度各占一行。 */
  compact?: boolean
}) {
  const {
    box,
    seat,
    state,
    hue,
    held,
    tone,
    status,
    rank,
    nowMs,
    masked = true,
    compact = false,
  } = props
  // 账号身份在服务端就已经换成等字数星号；渠道名是明文（分组标题要看得出渠道）。
  const identity = seat.who ?? seat.name
  const blurIdentity = masked && seat.who !== null
  const allowance = allowanceLine(seat, nowMs)
  const statusText = status ?? allowance ?? (seat.fallback ? '兜底模型' : '')

  const rankBadge =
    rank === null ? null : (
      <span
        aria-label={`本次路由第 ${rank} 个尝试`}
        title={`本次路由第 ${rank} 个尝试（列顺序跟随账号在该 provider 里的固定次序）`}
        className="shrink-0 rounded-full border border-border px-1 text-[9px] leading-4 text-muted-foreground tabular"
      >
        {rank}
      </span>
    )
  const identityText = (
    <b
      title={blurIdentity ? undefined : identity}
      className={cn(
        'min-w-0 flex-1 truncate text-xs font-medium',
        blurIdentity && 'blur-[2.5px] select-none',
      )}
    >
      {identity}
    </b>
  )
  const planChip =
    seat.plan === null ? null : (
      <span
        title={seat.plan}
        className={cn(
          'min-w-0 shrink-0 truncate rounded border border-border px-1 text-[9px] leading-4 text-muted-foreground',
          // 窄屏那张卡把标签放在第一行：身份是星号，可以让它多让出一点宽度。
          compact ? 'max-w-[62%]' : 'max-w-[45%]',
        )}
      >
        {seat.plan}
      </span>
    )
  const statusClass = cn(
    'min-w-0 truncate text-[10px] tabular',
    status === null && 'text-muted-foreground',
    tone === 'ok' && 'text-success',
    tone === 'fail' && 'text-destructive',
    tone === 'live' && 'text-foreground',
    tone === 'idle' && 'text-muted-foreground',
  )
  const statusTitle = seat.renews[0] ? `额度窗口重置于 ${seat.renews[0]}` : undefined

  return (
    <div
      data-slot="seat-node"
      data-seat={seat.key}
      data-state={state}
      data-held={held ? 'true' : 'false'}
      data-tone={tone}
      data-identity={masked ? 'masked' : 'revealed'}
      className={cn(
        'flex flex-col justify-center gap-0.5 rounded-lg border bg-card transition-colors duration-300',
        compact ? 'px-2 pt-1.5 pb-2.5' : 'px-2.5 pt-1.5 pb-2.5',
        state === 'rest' && 'border-dashed opacity-70',
        state === 'live' && 'border-foreground/40',
      )}
      style={{
        ...boxStyle(box),
        ...(hue ? ({ '--agent': hue } as CSSProperties) : null),
        // “正在被回答”只换边框颜色，不加粗、不加光圈：边框还是 1px，视觉上不跳。
        ...(held && hue ? { borderColor: hue } : null),
      }}
    >
      <div className="flex min-w-0 items-baseline gap-1.5">
        {rankBadge}
        {identityText}
        {/* 窄屏把方案标签挪到第一行：身份是打码星号，缩短它不丢信息，
            而“额度/状态”那句必须整句读得清。 */}
        {compact ? planChip : null}
      </div>
      {compact ? (
        <>
          <code
            title={seat.model}
            className="w-fit max-w-full min-w-0 truncate rounded bg-muted px-1 text-[10px] leading-4"
          >
            {seat.model}
          </code>
          <div title={statusTitle} className={cn(statusClass, 'leading-4')}>
            {statusText}
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-1.5 text-[10px] text-muted-foreground">
            {planChip}
            <code className="min-w-0 flex-1 truncate rounded bg-muted px-1">{seat.model}</code>
          </div>
          <div title={statusTitle} className={statusClass}>
            {statusText}
          </div>
        </>
      )}
      {/* 额度条：回答中的卡片也要能看见额度。不贴卡片边，上下左右都留一点距离。 */}
      {seat.usedPercent === null ? null : (
        <div
          aria-hidden="true"
          className="bg-muted/80 absolute inset-x-2.5 bottom-1.5 h-[3px] overflow-hidden rounded-full"
        >
          <div
            className="bg-foreground/45 h-full rounded-full"
            style={{ width: `${Math.min(100, Math.max(0, seat.usedPercent))}%` }}
          />
        </div>
      )}
    </div>
  )
}

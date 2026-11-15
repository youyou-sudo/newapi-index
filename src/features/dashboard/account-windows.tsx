import { Progress } from '~/components/ui/progress'
import { formatCountdown, formatPercent, formatQuotaNumber } from '~/lib/balance/format'
import type { WindowView } from '~/lib/balance/types'
import { cn } from '~/lib/utils'
import { useLiveCountdown } from './use-live-countdown'
import { resetLabel, windowLabel } from './labels'

function resetTextFor(window: WindowView, countdown: number | null): string {
  if (countdown === null) return '无重置时间'
  if (countdown <= 0) return window.resetKind === 'expires' ? '已到期' : '等待重置'
  const verb = resetLabel(window.resetKind)
  return `${formatCountdown(countdown)}后${verb}`
}

function WindowRow(props: { window: WindowView }) {
  const window = props.window
  const countdown = useLiveCountdown(window.resetInSeconds)
  const percent = window.percent
  const label = windowLabel(window.name)

  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground min-w-0 truncate text-xs" title={props.window.name}>
          {label}
        </span>
        <span className="tabular shrink-0 text-xs font-medium" title={window.display}>
          {window.display}
        </span>
      </div>
      <Progress value={percent} label={`${label} 已用 ${formatPercent(percent)}`} />
      <div className="text-muted-foreground flex items-center justify-between gap-3 text-[11px]">
        <span className="tabular min-w-0 truncate">
          已用 {formatPercent(percent)}
          {window.remaining !== null && window.remaining > 0 ? (
            // 单位已经在上一行的“已用 / 总量”里出现过一次，这里不重复，
            // 否则一行会挤成“剩 1,286 credits”这种半截换行。
            <span className="text-muted-foreground/70">
              {' '}
              · 剩 {formatQuotaNumber(window.remaining)}
            </span>
          ) : null}
        </span>
        <span
          className={cn(
            'tabular shrink-0',
            countdown !== null && countdown <= 3600 && 'text-destructive',
          )}
        >
          {resetTextFor(window, countdown)}
        </span>
      </div>
    </li>
  )
}

interface AccountWindowsProps {
  windows: Array<WindowView>
  /**
   * 可见窗口上限。默认全部显示：额度窗口就是这个页面的全部信息，
   * 折成“另有 N 个未显示”只会把最重要的剩余额度藏起来。
   */
  max?: number
  compact?: boolean
}

/** Quota windows for one account, capped at `max` with a count of the rest. */
export function AccountWindows(props: AccountWindowsProps) {
  if (props.windows.length === 0) {
    return <p className="text-muted-foreground text-xs">该账户暂未返回额度窗口。</p>
  }

  const visible =
    props.max === undefined ? props.windows : props.windows.slice(0, props.max)
  const hidden = props.windows.length - visible.length

  return (
    <div>
      <ul
        className={cn(
          // 列表视图把窗口排成两列；不加竖分隔线——换行后的第二行会在第一列
          // 也画出一条线，看起来像多了一个空列。
          props.compact ? 'grid gap-3 sm:grid-cols-2 sm:gap-x-8' : 'space-y-3',
        )}
      >
        {visible.map((window, index) => (
          <WindowRow key={`${window.name}-${index}`} window={window} />
        ))}
      </ul>
      {hidden > 0 ? (
        <p className="text-muted-foreground mt-2 text-[11px]">
          另有 {hidden} 个额度窗口未显示。
        </p>
      ) : null}
    </div>
  )
}

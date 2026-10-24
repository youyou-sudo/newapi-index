import { Progress } from '~/components/ui/progress'
import { formatCountdown, formatPercent } from '~/lib/balance/format'
import type { WindowView } from '~/lib/balance/types'
import { cn } from '~/lib/utils'
import { useLiveCountdown } from './use-live-countdown'
import { windowLabel } from './labels'

function WindowRow(props: { window: WindowView }) {
  const window = props.window
  const countdown = useLiveCountdown(window.resetInSeconds)
  const percent = window.percent

  let resetText = '无重置时间'
  if (countdown !== null) {
    resetText = countdown <= 0 ? '等待重置' : `${formatCountdown(countdown)}后重置`
  }

  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-muted-foreground min-w-0 truncate text-xs">
          {windowLabel(window.name)}
        </span>
        <span className="tabular shrink-0 text-xs font-medium">
          {window.display}
        </span>
      </div>
      <Progress
        value={percent}
        label={`${windowLabel(window.name)} 已用 ${formatPercent(percent)}`}
      />
      <div className="text-muted-foreground flex items-center justify-between gap-3 text-[11px]">
        <span className="tabular">已用 {formatPercent(percent)}</span>
        <span
          className={cn(
            'tabular',
            countdown !== null && countdown <= 3600 && 'text-destructive',
          )}
        >
          {resetText}
        </span>
      </div>
    </li>
  )
}

interface AccountWindowsProps {
  windows: Array<WindowView>
  max?: number
  compact?: boolean
}

/** Quota windows for one account, capped at `max` with a count of the rest. */
export function AccountWindows(props: AccountWindowsProps) {
  if (props.windows.length === 0) {
    return <p className="text-muted-foreground text-xs">该账户暂未返回额度窗口。</p>
  }

  const visible = props.windows.slice(0, props.max ?? 3)
  const hidden = props.windows.length - visible.length

  return (
    <div>
      <ul
        className={cn(
          props.compact
            ? 'grid gap-3 sm:grid-cols-2 sm:gap-x-6 sm:[&>li+li]:border-l sm:[&>li+li]:pl-6'
            : 'space-y-3',
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

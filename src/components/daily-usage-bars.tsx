import { cn } from '~/lib/utils'
import type { DayView } from '~/lib/balance/types'

interface DailyUsageBarsProps {
  days: Array<DayView>
  className?: string
  maxBars?: number
}

export function DailyUsageBars(props: DailyUsageBarsProps) {
  const days = props.days.slice(-(props.maxBars ?? 14))
  const max = Math.max(1, ...days.map((day) => day.used))

  return (
    <div
      className={cn('flex h-10 items-end gap-1', props.className)}
      role="img"
      aria-label={days.length === 0 ? '暂无每日用量' : `最近 ${days.length} 天每日用量`}
    >
      {days.length === 0 ? (
        <span className="text-muted-foreground self-center text-xs">暂无每日记录</span>
      ) : (
        days.map((day) => {
          const ratio = day.used / max
          return (
            <span
              key={day.day}
              title={`${day.day} · ${day.used}`}
              className={cn(
                'min-w-1 flex-1 rounded-t-[3px] bg-primary/70 transition-colors',
                day.used === 0 && 'bg-muted',
              )}
              style={{ height: `${Math.max(8, Math.round(ratio * 100))}%` }}
            />
          )
        })
      )}
    </div>
  )
}

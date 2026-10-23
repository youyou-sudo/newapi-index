import { Activity, CalendarClock, Layers, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Card, CardContent } from '~/components/ui/card'
import {
  formatCompact,
  formatCountdown,
  formatDateTime,
  formatNumber,
} from '~/lib/balance/format'
import type { DashboardSummary } from '~/lib/balance/types'
import { cn } from '~/lib/utils'
import { secondsBetween, useLiveCountdown } from './use-live-countdown'

interface SummaryStatsProps {
  summary: DashboardSummary
  generatedAt: string
  className?: string
}

interface StatTile {
  key: string
  icon: LucideIcon
  label: string
  value: string
  valueTitle: string
  valueClassName: string
  hint: string
  hintClassName?: string
  iconClassName?: string
}

export function SummaryStats(props: SummaryStatsProps) {
  const summary = props.summary
  const resetSeconds = useLiveCountdown(
    secondsBetween(summary.nextResetAt, props.generatedAt),
  )

  let resetHint = '暂无即将重置的窗口'
  if (summary.nextResetAt) {
    resetHint =
      resetSeconds !== null && resetSeconds > 0
        ? `剩余 ${formatCountdown(resetSeconds)}`
        : '即将重置'
  }

  const tiles: Array<StatTile> = [
    {
      key: 'accounts',
      icon: Users,
      label: '魔力',
      value: formatNumber(summary.accountCount),
      valueTitle: `${summary.accountCount} 个账户`,
      valueClassName: 'text-xl sm:text-2xl',
      hint:
        summary.errorCount > 0
          ? `${summary.providerCount} 个提供方 · ${summary.errorCount} 个读取异常`
          : `${summary.providerCount} 个提供方`,
      hintClassName: summary.errorCount > 0 ? 'text-destructive' : undefined,
    },
    {
      key: 'usage',
      icon: Activity,
      label: '累计用量',
      value: formatCompact(summary.trackedUsage),
      valueTitle: formatNumber(summary.trackedUsage),
      valueClassName: 'text-xl sm:text-2xl',
      hint: `覆盖 ${summary.trackedDays} 个有记录的日子`,
    },
    {
      key: 'windows',
      icon: Layers,
      label: '额度窗口',
      value: formatNumber(summary.windowCount),
      valueTitle: `${summary.windowCount} 个额度窗口`,
      valueClassName: 'text-xl sm:text-2xl',
      hint:
        summary.warningCount > 0
          ? `${summary.warningCount} 个账户用量偏高`
          : '所有账户用量处于健康区间',
      iconClassName:
        summary.warningCount > 0 ? 'bg-warning/10 text-warning' : undefined,
    },
    {
      key: 'reset',
      icon: CalendarClock,
      label: '最近重置',
      value: summary.nextResetAt ? formatDateTime(summary.nextResetAt) : '—',
      valueTitle: summary.nextResetAt
        ? formatDateTime(summary.nextResetAt)
        : '暂无重置时间',
      valueClassName: 'text-base leading-snug sm:text-lg',
      hint: resetHint,
    },
  ]

  return (
    <div
      className={cn(
        'grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4',
        props.className,
      )}
    >
      {tiles.map((tile) => {
        const Icon = tile.icon
        return (
          <Card key={tile.key} className="gap-0 py-0">
            <CardContent className="flex h-full flex-col gap-3 px-4 py-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-muted-foreground text-[11px] font-medium tracking-wide">
                  {tile.label}
                </span>
                <span
                  className={cn(
                    'bg-primary/10 text-primary flex size-7 items-center justify-center rounded-lg',
                    tile.iconClassName,
                  )}
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                </span>
              </div>
              <p
                className={cn(
                  'tabular font-semibold tracking-tight',
                  tile.valueClassName,
                )}
                title={tile.valueTitle}
              >
                {tile.value}
              </p>
              <p
                className={cn(
                  'text-muted-foreground text-[11px] leading-snug',
                  tile.hintClassName,
                )}
              >
                {tile.hint}
              </p>
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

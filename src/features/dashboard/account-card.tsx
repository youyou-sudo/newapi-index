import { DailyUsageBars } from '~/components/daily-usage-bars'
import { CardContent, CardHeader } from '~/components/ui/card'
import { formatNumber } from '~/lib/balance/format'
import type { DashboardSearch } from '~/lib/balance/schema'
import type { AccountView } from '~/lib/balance/types'
import {
  AccountBalanceMeta,
  AccountIdentity,
} from './account-parts'
import { AccountWindows } from './account-windows'
import { RANGE_DAYS } from './labels'

interface AccountCardProps {
  account: AccountView
  range: DashboardSearch['range']
}

/** Grid variant: identity, quota windows, balance metadata and daily usage. */
export function AccountCard(props: AccountCardProps) {
  const account = props.account
  const rangeDays = RANGE_DAYS[props.range]

  return (
    <div
      data-account-card=""
      className="bg-card ring-border/70 hover:ring-foreground/25 flex h-full flex-col gap-0 overflow-hidden rounded-xl py-0 ring-1 transition-shadow hover:shadow-sm"
    >
      <CardHeader className="px-4 pt-4 pb-0">
        <AccountIdentity account={account} />
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 px-4 pt-3.5 pb-4">
        <AccountWindows windows={account.windows} max={3} />
        <AccountBalanceMeta account={account} />

        <div className="mt-auto space-y-1.5">
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-[11px]">
            <span>近 {rangeDays} 天用量</span>
            <span className="tabular">今日 {formatNumber(account.usedToday)}</span>
          </div>
          <DailyUsageBars days={account.daily.days} maxBars={rangeDays} />
        </div>
      </CardContent>
    </div>
  )
}

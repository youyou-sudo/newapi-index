import { DailyUsageBars } from '~/components/daily-usage-bars'
import { formatNumber } from '~/lib/balance/format'
import type { AccountView, DashboardFilters } from '~/lib/balance/types'
import {
  AccountBalanceMeta,
  AccountIdentity,
} from './account-parts'
import { AccountWindows } from './account-windows'
import { RANGE_DAYS } from './labels'

interface AccountRowProps {
  account: AccountView
  range: DashboardFilters['range']
}

/** Compact list variant for scanning many accounts at once. */
export function AccountRow(props: AccountRowProps) {
  const account = props.account
  const rangeDays = RANGE_DAYS[props.range]
  const hasMeta = Boolean(account.balance ?? account.until ?? account.renew)

  return (
    <div data-account-row="" className="hover:bg-muted/40 transition-colors">
      <div className="flex flex-col gap-4 px-4 py-4 lg:flex-row lg:items-center lg:gap-6">
        <div className="min-w-0 lg:w-80 lg:shrink-0">
          <AccountIdentity account={account} />
          {hasMeta ? (
            <div className="mt-2">
              <AccountBalanceMeta account={account} layout="inline" />
            </div>
          ) : null}
        </div>

        <div className="border-border/70 min-w-0 flex-1 lg:border-l lg:pl-6">
          <AccountWindows windows={account.windows} max={2} compact />
        </div>

        <div className="w-full shrink-0 lg:w-36">
          <div className="text-muted-foreground flex items-center justify-between gap-2 text-[11px]">
            <span>近 {rangeDays} 天</span>
            <span className="tabular">今日 {formatNumber(account.usedToday)}</span>
          </div>
          <DailyUsageBars
            days={account.daily.days}
            maxBars={rangeDays}
            className="mt-1.5"
          />
        </div>
      </div>
    </div>
  )
}

import { CardContent, CardHeader } from '~/components/ui/card'
import type { AccountView } from '~/lib/balance/types'
import {
  AccountBalanceMeta,
  AccountIdentity,
} from './account-parts'
import { AccountWindows } from './account-windows'

interface AccountCardProps {
  account: AccountView
}

/** Grid variant: identity, quota windows and balance metadata. */
export function AccountCard(props: AccountCardProps) {
  const account = props.account

  return (
    <div
      data-account-card=""
      data-reveal-item=""
      className="bg-card ring-border/70 hover:ring-foreground/25 flex h-full flex-col gap-0 overflow-hidden rounded-xl py-0 ring-1 transition-shadow hover:shadow-sm"
    >
      <CardHeader className="px-4 pt-4 pb-0">
        <AccountIdentity account={account} />
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 px-4 pt-3.5 pb-4">
        <AccountWindows windows={account.windows} max={3} />
        <AccountBalanceMeta account={account} />
      </CardContent>
    </div>
  )
}

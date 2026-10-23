import type { AccountView } from '~/lib/balance/types'
import {
  AccountBalanceMeta,
  AccountIdentity,
} from './account-parts'
import { AccountWindows } from './account-windows'

interface AccountRowProps {
  account: AccountView
}

/** Compact list variant for scanning many accounts at once. */
export function AccountRow(props: AccountRowProps) {
  const account = props.account
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
      </div>
    </div>
  )
}

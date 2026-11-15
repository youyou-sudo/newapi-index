import { CardContent, CardHeader } from '~/components/ui/card'
import type { AccountView } from '~/lib/balance/types'
import { AccountBalanceMeta, AccountIdentity } from './account-parts'
import { AccountWindows } from './account-windows'

interface AccountCardProps {
  account: AccountView
}

/**
 * Grid variant: identity, quota windows and balance metadata.
 *
 * 卡片高度由同一行的最高卡片决定（grid + h-full），所以元信息紧跟在额度窗口
 * 后面、不留 `mt-auto`：短账户（只有 1 个窗口、没有余额）的空白落在卡片底部，
 * 而不是在“窗口”和“余额”之间挖一个洞，看起来像少渲染了一段。
 */
export function AccountCard(props: AccountCardProps) {
  const account = props.account

  return (
    <div
      data-account-card=""
      data-account-item=""
      data-reveal-item=""
      className="bg-card ring-border/70 hover:ring-foreground/25 flex h-full flex-col gap-0 overflow-hidden rounded-xl py-0 ring-1 transition-shadow hover:shadow-sm"
    >
      <CardHeader className="px-4 pt-4 pb-0">
        <AccountIdentity account={account} />
      </CardHeader>

      <CardContent className="flex flex-1 flex-col gap-3 px-4 pt-3.5 pb-4">
        {/* 所有额度窗口都要显示：被折叠掉的那一个往往正是剩余最多的 token 额度。 */}
        <AccountWindows windows={account.windows} />
        <AccountBalanceMeta account={account} />
      </CardContent>
    </div>
  )
}

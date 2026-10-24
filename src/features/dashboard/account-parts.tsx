import { Clock3 } from 'lucide-react'
import { Badge } from '~/components/ui/badge'
import { formatDateTime } from '~/lib/balance/format'
import type { AccountView } from '~/lib/balance/types'
import { cn } from '~/lib/utils'
import { kindLabel, renewLabel } from './labels'

interface AccountIdentityProps {
  account: AccountView
  className?: string
}

function StatusBadge(props: { status: AccountView['status'] }) {
  const ok = props.status === 'ok'
  return (
    <Badge variant={ok ? 'success' : 'destructive'} className="shrink-0">
      {ok ? '正常' : '异常'}
    </Badge>
  )
}

/** Name, plan, user/kind metadata and the read status of an account. */
export function AccountIdentity(props: AccountIdentityProps) {
  const account = props.account
  // The identifier line is fully redacted; no kind/prefix/suffix remains.
  const meta = account.user ?? kindLabel(account.kind)

  return (
    <div className={cn('min-w-0 flex-1', props.className)}>
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <p className="truncate text-sm font-semibold" title={account.name}>
              {account.name}
            </p>
            {account.plan ? (
              <Badge variant="secondary" className="shrink-0">
                {account.plan}
              </Badge>
            ) : null}
          </div>
          <p className="text-muted-foreground mt-0.5 truncate text-xs" title={meta}>
            {meta}
          </p>
          {account.readAt ? (
            <p className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px]">
              <Clock3 className="size-3 shrink-0" aria-hidden="true" />
              数据更新于
              <time
                dateTime={account.readAt}
                className="tabular text-foreground/80"
              >
                {formatDateTime(account.readAt)}
              </time>
            </p>
          ) : null}
        </div>
        <StatusBadge status={account.status} />
      </div>
      {account.error ? (
        <p
          role="alert"
          className="border-destructive/25 bg-destructive/5 text-destructive mt-2.5 rounded-lg border px-2.5 py-1.5 text-xs leading-relaxed"
        >
          {account.error}
        </p>
      ) : null}
    </div>
  )
}

interface AccountBalanceMetaProps {
  account: AccountView
  layout?: 'stacked' | 'inline'
}

/** Balance / valid-until / renewal metadata, only when the API reports it. */
export function AccountBalanceMeta(props: AccountBalanceMetaProps) {
  const entries = [
    props.account.balance
      ? { label: '余额', value: props.account.balance }
      : null,
    props.account.until
      ? { label: '有效期至', value: formatDateTime(props.account.until) }
      : null,
    props.account.renew
      ? { label: '续费', value: renewLabel(props.account.renew) }
      : null,
  ].filter((entry): entry is { label: string; value: string } => entry !== null)

  if (entries.length === 0) return null

  if (props.layout === 'inline') {
    return (
      <dl className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        {entries.map((entry) => (
          <div key={entry.label} className="flex items-baseline gap-1">
            <dt>{entry.label}</dt>
            <dd className="tabular text-foreground/80">{entry.value}</dd>
          </div>
        ))}
      </dl>
    )
  }

  return (
    <dl className="border-border/70 grid grid-cols-2 gap-x-3 gap-y-2 border-t pt-3 text-xs">
      {entries.map((entry) => (
        <div key={entry.label} className="min-w-0">
          <dt className="text-muted-foreground text-[11px]">{entry.label}</dt>
          <dd className="tabular mt-0.5 truncate" title={entry.value}>
            {entry.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}


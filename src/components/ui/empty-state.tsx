import { Inbox } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '~/lib/utils'

interface EmptyStateProps {
  title: string
  description: string
  action?: ReactNode
  className?: string
}

export function EmptyState(props: EmptyStateProps) {
  return (
    <div
      className={cn(
        'border-border/70 bg-card/60 flex flex-col items-center justify-center gap-3 rounded-2xl border border-dashed px-6 py-14 text-center',
        props.className,
      )}
    >
      <span className="flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Inbox className="size-5" aria-hidden="true" />
      </span>
      <div className="space-y-1">
        <p className="font-medium">{props.title}</p>
        <p className="text-muted-foreground max-w-md text-sm">{props.description}</p>
      </div>
      {props.action}
    </div>
  )
}

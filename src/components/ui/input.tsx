import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

export function Input({ className, ...props }: ComponentProps<'input'>) {
  return (
    <input
      data-slot="input"
      className={cn(
        'border-input bg-background text-foreground placeholder:text-muted-foreground flex h-8 w-full min-w-0 rounded-lg border px-2.5 py-1 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30',
        className,
      )}
      {...props}
    />
  )
}

import { ChevronDown } from 'lucide-react'
import type { ComponentProps } from 'react'
import { cn } from '~/lib/utils'

export function Select({ className, children, ...props }: ComponentProps<'select'>) {
  return (
    <div className="relative">
      <select
        data-slot="select"
        className={cn(
          'border-input bg-background text-foreground flex h-8 w-full appearance-none rounded-lg border pr-7 pl-2.5 text-sm outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 dark:bg-input/30',
          className,
        )}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2"
      />
    </div>
  )
}

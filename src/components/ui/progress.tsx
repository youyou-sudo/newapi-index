import { cn } from '~/lib/utils'

interface ProgressProps {
  value: number | null
  className?: string
  label?: string
}

export function Progress(props: ProgressProps) {
  const value = props.value === null ? 0 : Math.max(0, Math.min(100, props.value))
  return (
    <div
      role="progressbar"
      aria-label={props.label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value)}
      data-slot="progress-track"
      className={cn('bg-muted relative flex h-1.5 w-full items-center overflow-hidden rounded-full', props.className)}
    >
      <div
        data-slot="progress-indicator"
        className={cn(
          'h-full rounded-full bg-primary transition-[width] duration-500',
          value >= 80 && 'bg-warning',
          value >= 95 && 'bg-destructive',
        )}
        style={{ width: `${value}%` }}
      />
    </div>
  )
}

import type { ErrorComponentProps } from '@tanstack/react-router'
import { Link, useRouter } from '@tanstack/react-router'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button, buttonVariants } from '~/components/ui/button'

export function DefaultCatchBoundary({ error, reset }: ErrorComponentProps) {
  const router = useRouter()

  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">页面加载失败</h1>
        <p className="text-sm text-muted-foreground">
          {error instanceof Error ? error.message : '发生未知错误，请稍后重试。'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          onClick={() => {
            reset()
            void router.invalidate()
          }}
        >
          <RotateCcw aria-hidden="true" />
          重试
        </Button>
        <Link to="/" className={buttonVariants({ variant: 'ghost' })}>
          返回首页
        </Link>
      </div>
    </main>
  )
}

import type { ErrorProps } from '@teyik0/furin'
import { Link } from '@teyik0/furin/link'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button, buttonVariants } from '~/components/ui/button'

/**
 * 错误边界的展示层。
 *
 * furin 的 ErrorProps 只给出安全的公开信息（message / digest / status），
 * 完整堆栈留在服务端日志；这里照旧只显示 message，未知错误给中文兜底。
 */
export function DefaultCatchBoundary({ error, reset }: ErrorProps) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="bg-destructive/10 text-destructive flex size-14 items-center justify-center rounded-2xl">
        <AlertTriangle className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <title>页面加载失败</title>
      <h1 className="text-xl font-semibold">页面加载失败</h1>
        <p className="text-muted-foreground text-sm">
          {error.message || '发生未知错误，请稍后重试。'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        {/* reset() 清掉边界并重跑当前路由的 loader；SSR 期间是 no-op。 */}
        <Button variant="outline" onClick={reset}>
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
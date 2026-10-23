import { Link } from '@tanstack/react-router'
import { Compass } from 'lucide-react'
import { buttonVariants } from '~/components/ui/button'

export function NotFound() {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
        <Compass className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <h1 className="text-xl font-semibold">找不到这个页面</h1>
        <p className="text-sm text-muted-foreground">
          链接可能已过期，或者对应的余额账户已从账户列表中移除。
        </p>
      </div>
      <Link to="/" className={buttonVariants()}>
        返回余额面板
      </Link>
    </main>
  )
}
import type { NotFoundProps } from '@teyik0/furin'
import { Link } from '@teyik0/furin/link'
import { Compass } from 'lucide-react'
import { buttonVariants } from '~/components/ui/button'

/** 404 的展示层：文案与样式沿用旧页面。 */
export function NotFound(_props: NotFoundProps) {
  return (
    <main className="mx-auto flex min-h-[70vh] w-full max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="bg-muted text-muted-foreground flex size-14 items-center justify-center rounded-2xl">
        <Compass className="size-7" aria-hidden="true" />
      </span>
      <div className="space-y-2">
        <title>找不到这个页面</title>
      <h1 className="text-xl font-semibold">找不到这个页面</h1>
        <p className="text-muted-foreground text-sm">
          链接可能已过期，或者对应的余额账户已从账户列表中移除。
        </p>
      </div>
      <Link to="/" className={buttonVariants()}>
        返回余额面板
      </Link>
    </main>
  )
}
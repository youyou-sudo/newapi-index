import { ChevronDown } from 'lucide-react'
import type { ComponentType } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DashboardSearch } from '~/lib/balance/schema'
import { cn } from '~/lib/utils'
import { sortLabel } from './labels'
import type { SortSelectImplProps } from './sort-select-impl'

/**
 * 排序下拉的触发器样式。SSR 降级按钮与异步加载后的 Radix trigger 共用同一份
 * class（base 与 src/components/ui/select.tsx 的 SelectTrigger 一致，w-28 覆盖
 * w-fit），这样 chunk 到位前后的互换不会改变尺寸、内边距或图标位置。
 */
export const SORT_TRIGGER_CLASS = cn(
  "border-input bg-background text-foreground flex h-8 w-fit items-center justify-between gap-1.5 rounded-lg border px-2.5 text-sm whitespace-nowrap outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/30 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-muted-foreground dark:bg-input/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  'w-28',
)

export const SORT_TRIGGER_ID = 'dashboard-sort'
export const SORT_TRIGGER_LABEL = '排序方式'

/** Radix Select 只有 4 个排序项，首次交互/空闲时才需要它的整条依赖链。 */
const IDLE_PREFETCH_TIMEOUT_MS = 1500

type SortSelectModule = { default: ComponentType<SortSelectImplProps> }

let implPromise: Promise<SortSelectModule> | null = null

function loadSortSelectImpl(): Promise<SortSelectModule> {
  implPromise ??= import('./sort-select-impl')
  return implPromise
}

interface LazySortSelectProps {
  value: DashboardSearch['sort']
  onValueChange: (value: DashboardSearch['sort']) => void
}

/**
 * 排序下拉：首屏（SSR + hydration）只渲染一个样式完全一致的按钮，Radix Select
 * 连同 collection / popper / dismissable-layer 等依赖被拆到独立异步 chunk。
 *
 * 这里手写 `useState + import()` 而不是 React.lazy：服务端渲染时 lazy 组件在
 * 服务端 bundle 里是可直接解析的，React 会在 SSR 输出真实 Radix 结构，而客户端
 * 首帧只能渲染 fallback，造成 hydration 不一致。手写方案在 SSR 与客户端首帧
 * 都渲染同一个按钮，模块只在 effect 里加载，hydration 因此完全一致。
 *
 * 加载时机（都不与首屏关键资源抢带宽）：
 * - 空闲预取：只在 window load 之后 requestIdleCallback（无 rIC 时 load 后 1.5s），
 *   因此慢网下也不会在 CSS/字体还在下载时开抢；
 * - 意图预取：pointerenter / focus / touchstart 立即开始加载；
 * - 加载未完成时点击：记录 open，chunk 到位后自动展开，不会“点了没反应”。
 */
export function LazySortSelect(props: LazySortSelectProps) {
  const { value, onValueChange } = props
  const [Impl, setImpl] = useState<ComponentType<SortSelectImplProps> | null>(
    null,
  )
  const [open, setOpen] = useState(false)
  const fallbackRef = useRef<HTMLButtonElement | null>(null)
  const shouldRestoreFocus = useRef(false)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const adopt = useCallback((module: SortSelectModule) => {
    if (!mounted.current) return
    // 记住互换前用户是否已经聚焦降级按钮，避免键盘用户丢失焦点。
    shouldRestoreFocus.current = document.activeElement === fallbackRef.current
    setImpl(() => module.default)
  }, [])

  const loadImpl = useCallback(() => {
    loadSortSelectImpl().then(adopt, () => {
      // 加载失败就保留降级按钮（待展开的 open 状态也复位），下一次 intent 重试。
      implPromise = null
      if (mounted.current) setOpen(false)
    })
  }, [adopt])

  // 空闲预取只在 load 之后进入：慢网下 load 尚未触发时（CSS/字体仍在下载），
  // 不提前下载这个 chunk；用户主动 hover/focus 时仍走 intent 预取。
  useEffect(() => {
    if (Impl) return
    let cancelled = false
    let scheduled = false
    let idleHandle: number | undefined
    let timeoutHandle: number | undefined

    const scheduleIdleLoad = () => {
      if (cancelled || scheduled) return
      scheduled = true
      if (typeof window.requestIdleCallback === 'function') {
        idleHandle = window.requestIdleCallback(
          () => {
            loadImpl()
          },
          { timeout: IDLE_PREFETCH_TIMEOUT_MS },
        )
      } else {
        timeoutHandle = window.setTimeout(() => {
          loadImpl()
        }, IDLE_PREFETCH_TIMEOUT_MS)
      }
    }

    // 只在 load 之后预取：慢网下 load 尚未触发时（CSS/字体仍在下载），
    // 空闲预取不启动，避免和首屏关键资源抢带宽；此时用户交互仍走 intent 预取。
    const onLoad = () => scheduleIdleLoad()
    if (document.readyState === 'complete') {
      scheduleIdleLoad()
    } else {
      window.addEventListener('load', onLoad, { once: true })
    }

    return () => {
      cancelled = true
      window.removeEventListener('load', onLoad)
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle)
      if (idleHandle !== undefined) {
        if (typeof window.cancelIdleCallback === 'function') {
          window.cancelIdleCallback(idleHandle)
        }
      }
    }
  }, [Impl, loadImpl])

  // 真 trigger 挂载后恢复焦点（仅当互换本身会丢掉用户已有的焦点时）。
  useEffect(() => {
    if (!Impl || !shouldRestoreFocus.current) return
    shouldRestoreFocus.current = false
    // 展开由 Radix 自己把焦点放进列表，不要在这里抢回触发器。
    if (open) return
    const trigger = document.getElementById(SORT_TRIGGER_ID)
    if (trigger instanceof HTMLElement) trigger.focus({ preventScroll: true })
  }, [Impl, open])

  if (Impl) {
    return (
      <Impl
        value={value}
        onValueChange={onValueChange}
        open={open}
        onOpenChange={setOpen}
      />
    )
  }

  return (
    <button
      ref={fallbackRef}
      type="button"
      id={SORT_TRIGGER_ID}
      aria-label={SORT_TRIGGER_LABEL}
      aria-haspopup="listbox"
      aria-expanded={open}
      className={SORT_TRIGGER_CLASS}
      onPointerEnter={loadImpl}
      onFocus={loadImpl}
      onTouchStart={loadImpl}
      onClick={() => {
        // 先开始加载，再记录待展开；chunk 到位后 Radix 以 open 状态挂载。
        loadImpl()
        setOpen(true)
      }}
    >
      <span>{sortLabel(value)}</span>
      <ChevronDown
        className="text-muted-foreground size-3.5"
        aria-hidden="true"
      />
    </button>
  )
}

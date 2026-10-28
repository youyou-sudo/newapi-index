import { useNavigate } from '@teyik0/furin/link'
import { LayoutGrid, List, Search } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Input } from '~/components/ui/input'
import { toSearch } from '~/lib/balance/search'
import type { DashboardSearch } from '~/lib/balance/search'
import { cn } from '~/lib/utils'
import { STATUS_OPTIONS } from './labels'
import { LazySortSelect } from './sort-select'

interface DashboardToolbarProps {
  search: DashboardSearch
}

interface SegmentedProps<T extends string> {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
}

function Segmented<T extends string>(props: SegmentedProps<T>) {
  return (
    <div
      role="group"
      aria-label={props.label}
      className="border-border/70 bg-muted/60 inline-flex items-center gap-0.5 rounded-full border p-0.5"
    >
      {props.options.map((option) => {
        const active = option.value === props.value
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => props.onChange(option.value)}
            className={cn(
              'h-7 rounded-full px-2.5 text-xs font-medium whitespace-nowrap transition-colors',
              active
                ? 'bg-background text-foreground ring-border/70 shadow-sm ring-1'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

interface ViewToggleProps {
  value: DashboardSearch['view']
  onChange: (value: DashboardSearch['view']) => void
}

function ViewToggle(props: ViewToggleProps) {
  const options = [
    { value: 'grid', label: '网格视图', icon: LayoutGrid },
    { value: 'list', label: '列表视图', icon: List },
  ] as const

  return (
    <div
      role="group"
      aria-label="布局方式"
      className="border-border/70 bg-muted/60 inline-flex items-center gap-0.5 rounded-full border p-0.5"
    >
      {options.map((option) => {
        const active = option.value === props.value
        const Icon = option.icon
        return (
          <button
            key={option.value}
            type="button"
            aria-label={option.label}
            aria-pressed={active}
            title={option.label}
            onClick={() => props.onChange(option.value)}
            className={cn(
              'inline-flex size-7 items-center justify-center rounded-full transition-colors',
              active
                ? 'bg-background text-foreground ring-border/70 shadow-sm ring-1'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            <Icon className="size-3.5" aria-hidden="true" />
          </button>
        )
      })}
    </div>
  )
}

export function DashboardToolbar(props: DashboardToolbarProps) {
  const navigate = useNavigate()
  const [query, setQuery] = useState(props.search.q)
  const inputFocused = useRef(false)

  // External URL changes (back/forward, empty-state reset) win only while the
  // user is not actively typing; the submit handler owns the input otherwise.
  useEffect(() => {
    if (inputFocused.current) return
    setQuery(props.search.q)
  }, [props.search.q])

  // 只写 URL 状态：非默认字段由 toSearch() 保留，默认值不落进地址栏
  // （避免出现 ?q= 这种空参数）。replace + resetScroll:false 让筛选像本地
  // 更新一样发生：不新增历史记录，也不把页面滚回顶部。
  const commitSearch = (patch: Partial<DashboardSearch>) => {
    void navigate({
      to: '/',
      search: toSearch({ ...props.search, ...patch }),
      replace: true,
      resetScroll: false,
    })
  }

  return (
    <section aria-label="筛选账户">
      <div className="border-border/70 flex flex-col gap-3 border-b p-3 sm:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <form
            role="search"
            action="/"
            method="get"
            data-server-search=""
            className="w-full lg:max-w-sm"
            onSubmit={(event) => {
              event.preventDefault()
              commitSearch({ q: query.trim() })
            }}
          >
            <input type="hidden" name="status" value={props.search.status} />
            <input type="hidden" name="sort" value={props.search.sort} />
            <input type="hidden" name="view" value={props.search.view} />
            <label htmlFor="dashboard-search" className="sr-only">
              搜索账户
            </label>
            <div className="relative">
              <Search
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2"
                aria-hidden="true"
              />
              <Input
                id="dashboard-search"
                name="q"
                type="search"
                value={query}
                maxLength={64}
                autoComplete="off"
                spellCheck={false}
                enterKeyHint="search"
                placeholder="搜索账户、提供方或套餐"
                className="h-9 pr-16 pl-8"
                onFocus={() => {
                  inputFocused.current = true
                }}
                onBlur={() => {
                  inputFocused.current = false
                }}
                onChange={(event) => setQuery(event.target.value)}
              />
              <button
                type="submit"
                className="text-muted-foreground hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-md px-1.5 py-0.5 text-[11px] transition-colors"
              >
                搜索
              </button>
            </div>
          </form>

          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <Segmented
              label="账户状态"
              value={props.search.status}
              options={STATUS_OPTIONS}
              onChange={(status) => commitSearch({ status })}
            />
            {/* Radix Select 由空闲/意图预取加载，首屏渲染的是同款按钮。 */}
            <LazySortSelect
              value={props.search.sort}
              onValueChange={(sort) => commitSearch({ sort })}
            />
            <span className="bg-border hidden h-5 w-px sm:block" aria-hidden="true" />
            <ViewToggle
              value={props.search.view}
              onChange={(view) => commitSearch({ view })}
            />
          </div>
        </div>
      </div>
    </section>
  )
}

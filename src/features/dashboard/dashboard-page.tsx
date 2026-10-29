import { useNavigate } from '@teyik0/furin/link'
import { RefreshCw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '~/components/ui/button'
import { EmptyState } from '~/components/ui/empty-state'
import { RoutingSection } from '~/features/routing/routing-section'
import { applyDashboardFilters } from '~/lib/balance/derive'
import { DEFAULT_SEARCH, toSearch } from '~/lib/balance/search'
import type { DashboardSearch } from '~/lib/balance/search'
import type { DashboardPayload } from '~/lib/balance/types'
import type { RoutingFeed } from '~/lib/routing/types'
import { cn } from '~/lib/utils'
import { AccountCard } from './account-card'
import { AccountRow } from './account-row'
import { DashboardHero } from './dashboard-hero'
import { DashboardToolbar } from './dashboard-toolbar'
import { SummaryStats } from './summary-stats'
import { useDashboardRefresh } from './use-dashboard-refresh'

interface DashboardPageProps {
  dashboard: DashboardPayload
  search: DashboardSearch
  /** 路由轨迹的首屏快照（首页 loader 里和余额一起取，超时则 undefined）。 */
  routingSeed?: RoutingFeed
}

function describeEmptyResult(search: DashboardSearch): string {
  if (search.q) {
    return `没有找到与“${search.q}”匹配的账户，试试更短的关键词或清空搜索。`
  }
  if (search.status === 'error') {
    return '当前所有账户都读取正常，没有需要处理的异常。'
  }
  if (search.status === 'ok') {
    return '当前没有状态正常的账户，请检查异常账户的报错信息。'
  }
  return '数据源还没有返回任何账户，请稍后刷新页面重试。'
}

/**
 * 账户列表的主体。
 *
 * 数据流是纯 props：loader 按 `q` 取一次数据，status/sort/view 是**浏览器本地
 * 状态**，由 `applyDashboardFilters()` 套在同一份 payload 上——所以切换筛选不会
 * 产生任何请求，直接复用“全部”的那一份数据。只有搜索词（`q`）会走路由导航，
 * 因为它是服务端的数据过滤。
 *
 * URL 里的 status/sort/view 仍然被解析（旧链接、无 JS 的表单提交、前进后退），
 * 但用户在本页点击筛选时只改本地状态、不写回 URL，避免一次点击就触发一次
 * 该 URL 的 ISR 数据请求。
 */
export function DashboardPage(props: DashboardPageProps) {
  const { dashboard, search } = props
  const navigate = useNavigate()

  // 长驻 iframe 标签页不会自己重新请求：页面是 ISR 缓存，只有主动 refresh 才能
  // 看到新数据。refresh 是原地重载，筛选/滚动/本地搜索输入都由路由契约保留。
  useDashboardRefresh()

  // 展示筛选的本地状态。URL 只是初值：外部导航（前进后退、分享链接、无 JS 的
  // 表单提交）会把它同步进来，用户点击筛选则只更新这里。
  const [status, setStatus] = useState<DashboardSearch['status']>(search.status)
  const [sort, setSort] = useState<DashboardSearch['sort']>(search.sort)
  const [view, setView] = useState<DashboardSearch['view']>(search.view)

  useEffect(() => {
    setStatus(search.status)
    setSort(search.sort)
    setView(search.view)
  }, [search.status, search.sort, search.view])

  const filters = useMemo<DashboardSearch>(
    () => ({ q: search.q, status, sort, view }),
    [search.q, status, sort, view],
  )

  // The staggered fade-in is interaction-only: first paint and hydration stay
  // still (hero copy already owns the entry animation), then every filter
  // switch replays it. The signature is compared by value because the router
  // may hand us a fresh object reference for unchanged state.
  const searchSignature = JSON.stringify([
    search.q,
    status,
    sort,
    view,
  ])
  const hydrated = useRef(false)
  const previousSearch = useRef(searchSignature)
  const [reveal, setReveal] = useState(false)

  useEffect(() => {
    hydrated.current = true
  }, [])

  if (hydrated.current && previousSearch.current !== searchSignature) {
    previousSearch.current = searchSignature
    if (!reveal) setReveal(true)
  }

  // Status and sorting are derived from the data the loader already returned;
  // they are plain string operations, never a new request.
  const accounts = useMemo(
    () => applyDashboardFilters(dashboard.accounts, filters),
    [dashboard.accounts, filters],
  )

  const errorCount = accounts.filter(
    (account) => account.status === 'error',
  ).length
  const okCount = accounts.length - errorCount
  const highUsageCount = accounts.filter(
    (account) => (account.usagePercent ?? -1) >= 80,
  ).length

  let accountSummary = `显示 ${accounts.length} / ${dashboard.totalAccounts} 个账户`
  if (accounts.length > 0) {
    if (okCount > 0) accountSummary += ` · 正常 ${okCount}`
    if (errorCount > 0) accountSummary += ` · 异常 ${errorCount}`
    if (highUsageCount > 0) accountSummary += ` · 高用量 ${highUsageCount}`
  }

  const isGrid = view === 'grid'

  // 清除筛选：先把展示筛选复位（纯本地，不发请求）；只有确实带了搜索词时才
  // 需要一次路由导航把 `q` 从 URL 里去掉。
  const resetFilters = () => {
    setStatus(DEFAULT_SEARCH.status)
    setSort(DEFAULT_SEARCH.sort)
    setView(DEFAULT_SEARCH.view)
    if (!search.q) return
    void navigate({
      to: '/',
      search: toSearch(DEFAULT_SEARCH),
      replace: true,
      resetScroll: false,
    })
  }

  return (
    <div
      data-ssr-dashboard=""
      className="mx-auto w-full max-w-6xl px-4 pt-6 pb-16 sm:px-6 sm:pt-8"
    >
      <DashboardHero
        source={dashboard.source}
        generatedAt={dashboard.generatedAt}
      />

      <div className="flex flex-wrap items-end justify-between gap-3 p-3">
        <div>
          <h2
            id="accounts-heading"
            className="text-base font-semibold tracking-tight"
          >
            魔力
          </h2>
          <p
            data-filtered-count=""
            className="text-muted-foreground mt-0.5 text-xs"
          >
            {accountSummary}
          </p>
        </div>
        {/* 状态行保留占位：筛选是本地计算，这里不再有“正在更新列表”的中间态。 */}
        <p
          role="status"
          aria-live="polite"
          className="text-muted-foreground flex min-h-4 items-center gap-1.5 text-[11px]"
        />
      </div>

      <section aria-labelledby="accounts-heading">
        <div className="bg-card ring-foreground/10 overflow-hidden rounded-2xl text-sm ring-1">
          <DashboardToolbar
            search={search}
            status={status}
            sort={sort}
            view={view}
            onFilterChange={(patch) => {
              if (patch.status !== undefined) setStatus(patch.status)
              if (patch.sort !== undefined) setSort(patch.sort)
              if (patch.view !== undefined) setView(patch.view)
            }}
          />

          {accounts.length === 0 ? (
            <div className="p-3 sm:p-4">
              <EmptyState
                className="border-0 bg-transparent"
                title="没有符合条件的账户"
                description={describeEmptyResult(filters)}
                action={
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={resetFilters}
                  >
                    <RefreshCw className="size-3.5" aria-hidden="true" />
                    清除筛选
                  </Button>
                }
              />
            </div>
          ) : (
            <div
              // Remounting on every filter switch replays the staggered fade-in
              // even when the same accounts come back in a new order.
              key={`${sort}-${status}-${view}`}
              className={cn(
                'transition-opacity duration-200',
                reveal && 'list-stagger',
                isGrid
                  ? 'grid gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3'
                  : 'divide-border/70 flex flex-col divide-y',
              )}
            >
              {accounts.map((account) =>
                isGrid ? (
                  <AccountCard key={account.id} account={account} />
                ) : (
                  <AccountRow key={account.id} account={account} />
                ),
              )}
            </div>
          )}
        </div>
      </section>

      <RoutingSection seed={props.routingSeed} />

      <section className="mt-12" aria-labelledby="usage-heading">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2
              id="usage-heading"
              className="text-base font-semibold tracking-tight"
            >
              用量概览
            </h2>
            <p className="text-muted-foreground mt-0.5 text-xs">
              按全部账户汇总额度窗口与重置时间。
            </p>
          </div>
        </div>
        <SummaryStats
          className="mt-4"
          summary={dashboard.summary}
          generatedAt={dashboard.generatedAt}
        />
      </section>
    </div>
  )
}

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
 * 数据流是纯 props：loader 已经按 `q` 取过数据，status/sort/view 在浏览器里由
 * `applyDashboardFilters()` 套在同一个 payload 上。URL 状态变化会重新请求一次路由
 * 数据（furin 的显式路由状态），页面本身保持已渲染的内容与滚动位置。
 */
export function DashboardPage(props: DashboardPageProps) {
  const { dashboard, search } = props
  const navigate = useNavigate()

  // The staggered fade-in is interaction-only: first paint and hydration stay
  // still (hero copy already owns the entry animation), then every filter
  // switch replays it. The search signature is compared by value because the
  // router may hand us a fresh object reference for unchanged state.
  const searchSignature = JSON.stringify([
    search.q,
    search.status,
    search.sort,
    search.view,
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
    () => applyDashboardFilters(dashboard.accounts, search),
    [dashboard.accounts, search],
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

  const isGrid = search.view === 'grid'

  // Clearing filters is a URL change like any other: `toSearch()` drops every
  // default value, so the canonical landing URL stays a bare "/".
  const resetFilters = () => {
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
          <DashboardToolbar search={search} />

          {accounts.length === 0 ? (
            <div className="p-3 sm:p-4">
              <EmptyState
                className="border-0 bg-transparent"
                title="没有符合条件的账户"
                description={describeEmptyResult(search)}
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
              key={`${search.sort}-${search.status}-${search.view}`}
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

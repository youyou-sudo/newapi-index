import { useNavigate } from '@tanstack/react-router'
import { RefreshCw } from 'lucide-react'
import { Button } from '~/components/ui/button'
import { EmptyState } from '~/components/ui/empty-state'
import type { DashboardFilters, DashboardPayload } from '~/lib/balance/types'
import { cn } from '~/lib/utils'
import { AccountCard } from './account-card'
import { AccountRow } from './account-row'
import { DashboardHero } from './dashboard-hero'
import { DashboardToolbar } from './dashboard-toolbar'
import { SummaryStats } from './summary-stats'
import { DEFAULT_SEARCH, sortLabel } from './labels'

interface DashboardPageProps {
  dashboard: DashboardPayload
}

function describeEmptyResult(filters: DashboardFilters): string {
  if (filters.q) {
    return `没有找到与“${filters.q}”匹配的账户，试试更短的关键词或清空搜索。`
  }
  if (filters.status === 'error') {
    return '当前所有账户都读取正常，没有需要处理的异常。'
  }
  if (filters.status === 'ok') {
    return '当前没有状态正常的账户，请检查异常账户的报错信息。'
  }
  return '数据源还没有返回任何账户，请稍后刷新页面重试。'
}

export function DashboardPage(props: DashboardPageProps) {
  const dashboard = props.dashboard
  const navigate = useNavigate({ from: '/' })
  const accounts = dashboard.accounts
  const errorCount = accounts.filter(
    (account) => account.status === 'error',
  ).length
  const highUsageCount = accounts.filter(
    (account) => (account.usagePercent ?? -1) >= 80,
  ).length

  let accountSummary = '没有符合当前筛选条件的账户'
  if (accounts.length > 0) {
    accountSummary = `共 ${accounts.length} 个账户 · 正常 ${accounts.length - errorCount}`
    if (errorCount > 0) accountSummary += ` · 异常 ${errorCount}`
    if (highUsageCount > 0) accountSummary += ` · 高用量 ${highUsageCount}`
  }

  const isGrid = dashboard.filters.view === 'grid'

  const resetFilters = () => {
    navigate({
      search: (prev) => ({ ...prev, ...DEFAULT_SEARCH }),
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

      <div className="flex flex-wrap items-end justify-between p-3">
        <div>
          <h2
            id="accounts-heading"
            className="text-base font-semibold tracking-tight"
          >
            魔力
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            {accountSummary}
          </p>
        </div>
      </div>

      <section aria-labelledby="accounts-heading">
        <div className="bg-card ring-foreground/10 overflow-hidden rounded-2xl text-sm ring-1">
          <DashboardToolbar
            filters={dashboard.filters}
            matched={accounts.length}
            total={dashboard.totalAccountsBeforeFilter}
          />

          {accounts.length === 0 ? (
            <div className="p-3 sm:p-4">
              <EmptyState
                className="border-0 bg-transparent"
                title="没有符合条件的账户"
                description={describeEmptyResult(dashboard.filters)}
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
              className={cn(
                isGrid
                  ? 'grid gap-3 p-3 sm:grid-cols-2 sm:p-4 lg:grid-cols-3'
                  : 'divide-border/70 flex flex-col divide-y',
              )}
            >
              {accounts.map((account) =>
                isGrid ? (
                  <AccountCard
                    key={account.id}
                    account={account}
                    range={dashboard.filters.range}
                  />
                ) : (
                  <AccountRow
                    key={account.id}
                    account={account}
                    range={dashboard.filters.range}
                  />
                ),
              )}
            </div>
          )}
        </div>
      </section>

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
              按全部账户汇总额度窗口、累计用量与重置时间。
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

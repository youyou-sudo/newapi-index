import type { DashboardSearch } from '~/lib/balance/schema'
import type { SourceInfo } from '~/lib/balance/types'

/** Defaults mirror the route's stripSearchParams configuration. */
export const DEFAULT_SEARCH: DashboardSearch = {
  q: '',
  status: 'all',
  sort: 'recent',
  view: 'grid',
}

export const STATUS_OPTIONS: ReadonlyArray<{
  value: DashboardSearch['status']
  label: string
}> = [
  { value: 'all', label: '全部' },
  { value: 'ok', label: '正常' },
  { value: 'error', label: '异常' },
]

export const SORT_OPTIONS: ReadonlyArray<{
  value: DashboardSearch['sort']
  label: string
}> = [
  { value: 'recent', label: '最近读取' },
  { value: 'usage', label: '用量' },
  { value: 'name', label: '名称' },
  { value: 'reset', label: '重置' },
]

export const CACHE_LABELS: Record<SourceInfo['cache'], string> = {
  hit: '缓存命中',
  miss: '已重新拉取',
  fixture: '本地示例缓存',
  stale: '缓存已过期',
}

const WINDOW_LABELS: Record<string, string> = {
  daily: '每日',
  weekly: '每周',
  monthly: '每月',
  hourly: '每小时',
  session: '会话',
  '1h': '1 小时窗口',
  '5h': '5 小时窗口',
  '1 hour': '1 小时窗口',
  '5 hours': '5 小时窗口',
  '1d': '1 天窗口',
  '7d': '7 天窗口',
  '30d': '30 天窗口',
  '1 day': '1 天窗口',
  '7 days': '7 天窗口',
  '30 days': '30 天窗口',
}

const RENEW_LABELS: Record<string, string> = {
  auto: '自动续订',
  manual: '手动续订',
  none: '不续订',
}

const KIND_LABELS: Record<string, string> = {
  subscription: '订阅',
  balance: '余额制',
  api: 'API 密钥',
  token: '令牌',
}

/** Human label for an API window key such as `daily` or `weekly`. */
export function windowLabel(name: string): string {
  return WINDOW_LABELS[name] ?? name
}

/** Human label for the account billing kind reported by the API. */
export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind
}

/** Renewal mode is an enum ("auto" / "manual"); unknown values pass through. */
export function renewLabel(renew: string): string {
  return RENEW_LABELS[renew.toLowerCase()] ?? renew
}

export function sortLabel(value: DashboardSearch['sort']): string {
  return SORT_OPTIONS.find((option) => option.value === value)?.label ?? value
}

/** Sort and view are presentation preferences; only q/status narrow results. */
export function hasActiveFilters(search: DashboardSearch): boolean {
  return search.q !== '' || search.status !== 'all'
}

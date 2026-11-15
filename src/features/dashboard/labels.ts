import type { DashboardSearch } from '~/lib/balance/schema'
import type { SourceInfo } from '~/lib/balance/types'

export const STATUS_OPTIONS: ReadonlyArray<{
  value: DashboardSearch['status']
  label: string
}> = [
  { value: 'all', label: '全部' },
  { value: 'ok', label: '正常' },
  { value: 'error', label: '异常' },
]

/**
 * 排序下拉的展示顺序（`SORT_VALUES` 只是白名单，顺序无关）。默认按名称排序，
 * 所以「最近读取」作为可选项放在最后。
 */
export const SORT_OPTIONS: ReadonlyArray<{
  value: DashboardSearch['sort']
  label: string
}> = [
  { value: 'usage', label: '用量' },
  { value: 'name', label: '名称' },
  { value: 'reset', label: '重置' },
  { value: 'recent', label: '最近读取' },
]

export const CACHE_LABELS: Record<SourceInfo['cache'], string> = {
  hit: '缓存命中',
  miss: '已重新拉取',
  fixture: '本地示例缓存',
  // stale 只在“上游读取失败、仍展示上一份缓存”时出现（服务端会同时写 warning）；
  // 它不再表示“正在后台刷新”，所以文案直接说失败原因，而不是“缓存已过期”。
  stale: '上游读取失败',
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
  // 转账站把“这一档是什么”直接写在窗口名里。原样显示会中英混排、还会被卡片
  // 宽度截断（“deepseek-v4.1-flash tokens (est.)”），所以认识的档位翻译成中文。
  credits: '积分',
  'extra credits': '额外积分',
  'total credits': '总积分',
  balance: '余额',
  'token quota': '令牌额度',
  tokens: 'Token',
  requests: '请求数',
  calls: '调用次数',
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

/**
 * Human label for an API window key such as `daily` or `weekly`. The API also
 * ships free-form labels ("Credits", "5 hours", "deepseek-v4.1-flash tokens
 * (est.)"), so the lookup is case-insensitive and falls back to the raw name.
 */
export function windowLabel(name: string): string {
  const trimmed = name.trim()
  const known = WINDOW_LABELS[trimmed.toLowerCase()]
  if (known) return known

  // “deepseek-v4.1-flash tokens (est.)”：模型名保留，尾部说明翻成中文，
  // 否则整串会被卡片宽度截断，看不出这是“估算的 token 额度”。
  const estimated = /^(.*?)\s+(?:tokens?|token)\s*\((?:est\.?|estimated)\)$/i.exec(
    trimmed,
  )
  if (estimated?.[1]) return `${estimated[1]} Token 估算`

  const credits = /^(.*?)\s+credits?$/i.exec(trimmed)
  if (credits?.[1]) {
    const base = WINDOW_LABELS[credits[1].toLowerCase()]
    return `${base ?? credits[1]}积分`
  }

  return trimmed
}

/** Footer wording for a window reset: a periodic reset vs. the quota expiring. */
export function resetLabel(kind: 'reset' | 'expires' | null): string {
  return kind === 'expires' ? '到期' : '重置'
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

export const DISPLAY_TIME_ZONE = 'Asia/Shanghai'
export const DISPLAY_LOCALE = 'zh-CN'

const numberFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  maximumFractionDigits: 2,
})

const dateTimeFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: DISPLAY_TIME_ZONE,
})

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return dateTimeFormatter.format(date)
}

export function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return `${numberFormatter.format(value)}%`
}

export function formatDuration(totalSeconds: number | null | undefined): string {
  if (totalSeconds === null || totalSeconds === undefined) return '—'
  if (totalSeconds <= 0) return '已到重置时间'
  const seconds = Math.floor(totalSeconds)
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分`
  if (minutes > 0) return `${minutes} 分钟`
  return `${seconds} 秒`
}

export function formatCountdown(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined) return '—'
  return formatDuration(seconds)
}

/** "0 / 350" or "257 / 50k credits" -> [0, 350] / [257, 50000]. */
export function parseDisplayNumbers(display: string | undefined): [number, number] | null {
  if (!display) return null
  const matches = display.match(/-?\d[\d.,]*\s*[kKmM]?/g)
  if (!matches || matches.length < 2) return null
  const parse = (raw: string): number => {
    const cleaned = raw.replace(/[,\s]/g, '')
    const suffix = cleaned.slice(-1).toLowerCase()
    const base = suffix === 'k' || suffix === 'm' ? Number(cleaned.slice(0, -1)) : Number(cleaned)
    if (!Number.isFinite(base)) return Number.NaN
    if (suffix === 'k') return base * 1_000
    if (suffix === 'm') return base * 1_000_000
    return base
  }
  const first = parse(matches[0] ?? '')
  const second = parse(matches[1] ?? '')
  if (!Number.isFinite(first) || !Number.isFinite(second) || second <= 0) return null
  return [first, second]
}

/**
 * Redact an account identifier (email, username or phone) before it crosses the
 * server -> client boundary.
 *
 * 换成**等字数**的星号：排版保持原样，但原文一个字符都不留（没有前缀、后缀、
 * 数字）。页面再叠高斯模糊，连字数的轮廓都只是大致的。
 */
export function maskAccountIdentifier(
  value: string | null | undefined,
): string | null {
  const trimmed = value?.trim()
  if (!trimmed) return null
  const length = Array.from(trimmed).length
  return length === 0 ? '***' : '*'.repeat(length)
}
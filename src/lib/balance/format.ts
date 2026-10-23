export const DISPLAY_TIME_ZONE = 'Asia/Shanghai'
export const DISPLAY_LOCALE = 'zh-CN'

const numberFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  maximumFractionDigits: 2,
})

const compactFormatter = new Intl.NumberFormat(DISPLAY_LOCALE, {
  notation: 'compact',
  maximumFractionDigits: 1,
})

const dateTimeFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: DISPLAY_TIME_ZONE,
})

const timeFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  hour: '2-digit',
  minute: '2-digit',
  timeZone: DISPLAY_TIME_ZONE,
})

const dayFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  month: 'short',
  day: 'numeric',
  timeZone: DISPLAY_TIME_ZONE,
})

const weekdayFormatter = new Intl.DateTimeFormat(DISPLAY_LOCALE, {
  weekday: 'short',
  timeZone: DISPLAY_TIME_ZONE,
})

export function formatNumber(value: number): string {
  return numberFormatter.format(value)
}

export function formatCompact(value: number): string {
  return compactFormatter.format(value)
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return dateTimeFormatter.format(date)
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return timeFormatter.format(date)
}

export function formatDay(day: string): string {
  const date = new Date(`${day}T00:00:00+08:00`)
  if (Number.isNaN(date.getTime())) return day
  return dayFormatter.format(date)
}

export function formatWeekday(day: string): string {
  const date = new Date(`${day}T00:00:00+08:00`)
  if (Number.isNaN(date.getTime())) return ''
  return weekdayFormatter.format(date)
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

export function toIsoDay(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    timeZone: DISPLAY_TIME_ZONE,
  }).formatToParts(date)
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}

/** Extract a human-friendly provider handle from the API "provider" slug. */
export function providerLabel(provider: string): string {
  return provider
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ')
}

/**
 * Fully redact an account identifier (email, username or phone) before it
 * crosses the server -> client boundary. No prefix, suffix or digit survives.
 */
export function maskAccountIdentifier(
  value: string | null | undefined,
): string | null {
  return value && value.trim() ? '***' : null
}
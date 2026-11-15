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
  // 百分比只保留一位小数：同一张卡片里出现 28.2% 和 30.93% 会显得精度失控。
  const rounded = Math.round(value * 10) / 10
  return `${numberFormatter.format(rounded)}%`
}

/**
 * Compacts an absolute quota value the way the upstream cards do ("50k", "1.1M"),
 * but with the thousands separators and rounding the UI needs: raw API strings
 * such as "3563.07 / 4849" are hard to scan and drop the unit entirely.
 */
export function formatQuotaNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value < 0 ? '-' : ''
  const abs = Math.abs(value)
  if (abs >= 1_000_000_000) return `${sign}${trimZeros(abs / 1_000_000_000, 1)}G`
  if (abs >= 1_000_000) return `${sign}${trimZeros(abs / 1_000_000, 1)}M`
  if (abs >= 10_000) return `${sign}${trimZeros(abs / 1_000, 1)}k`
  if (abs >= 100) return `${sign}${Math.round(abs).toLocaleString(DISPLAY_LOCALE)}`
  return `${sign}${trimZeros(abs, 2)}`
}

function trimZeros(value: number, digits: number): string {
  const fixed = value.toFixed(digits)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

/**
 * One canonical "used / limit unit" line for a quota window. The upstream
 * `display` strings are inconsistent (some carry units, some don't; some count
 * the remaining amount instead of the used one), so the card rebuilds the line
 * from the normalized numbers and never re-prints a "剩 193 / 193" style pair
 * next to a 100% bar.
 */
export function formatQuotaPair(
  used: number | null,
  limit: number | null,
  unit: string | null,
): string | null {
  if (used === null || limit === null || !Number.isFinite(used) || !Number.isFinite(limit)) {
    return null
  }
  const suffix = unit ? ` ${unit}` : ''
  return `${formatQuotaNumber(used)} / ${formatQuotaNumber(limit)}${suffix}`
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

/**
 * 数据快照的“年龄”：Hero 上每秒钟重算，比生成时写死的 cache 状态更能说明现在
 * 看到的数据到底有多旧。0–4 秒按“刚刚更新”处理，避免刚刷新完就显示 1 秒前。
 */
export function formatAge(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) {
    return '—'
  }
  const whole = Math.max(0, Math.floor(seconds))
  if (whole < 5) return '刚刚更新'
  if (whole < 60) return `${whole} 秒前更新`
  const minutes = Math.floor(whole / 60)
  if (minutes < 60) return `${minutes} 分钟前更新`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前更新`
  return `${Math.floor(hours / 24)} 天前更新`
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
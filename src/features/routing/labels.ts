import type { RoutingSourceState } from '~/lib/routing/types'

/** 数据源异常时的中文说明；connected 没有文案。 */
export const SOURCE_NOTICE: Record<Exclude<RoutingSourceState, 'connected'>, string> = {
  unconfigured:
    '还没有接上上游网关 web：把 web 启动时打印的整条链接（带 ?k=）粘进 GATEWAY_WEB_URL，这里就会实时播放请求走的路径。',
  denied:
    '那台 web 能连上，但 key 不对：要用它启动时打印在 ?k= 里的访问 key —— 网关自己的 API key（sk-…）不是这个。',
  unreachable: '暂时连不上上游网关 web，正在重试；拿到过的轨迹会继续留在图上。',
}

/**
 * 空舞台的文案：先按数据源状态说清楚“为什么是空的”，数据源正常时才谈等待。
 * 上游可达但网关没在服务（mine=false）与上游本身就拒绝，是两种不同的原因。
 */
export function emptyStageCopy(
  state: RoutingSourceState,
  mine: boolean,
): { title: string; description: string } {
  if (state === 'unconfigured') {
    return { title: '还没有接上上游网关', description: SOURCE_NOTICE.unconfigured }
  }
  if (state === 'denied') {
    return { title: '上游拒绝了这条 key', description: SOURCE_NOTICE.denied }
  }
  if (state === 'unreachable') {
    return {
      title: '暂时连不上上游',
      description: '确认那台 web 还开着、地址可达；这一块会自己重试。',
    }
  }
  if (!mine) {
    return {
      title: '网关没有在服务',
      description: '上游 web 能连上，但网关本身没有在监听；把网关启动后刷新即可。',
    }
  }
  return {
    title: '舞台已就绪，等一条请求',
    description: '从任何走这个网关的智能体发一条消息，请求一出现，这里就会开始飞行。',
  }
}

/** 毫秒 -> “1.2 秒”。 */
export function durationLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return '—'
  if (ms < 1000) return `${Math.round(ms)} 毫秒`
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} 秒`
}

/**
 * token 数 -> “12.7M token”。
 *
 * 上游的 `tokens` 是“最近发给它的 token 数”，动辄百万级；卡片只有一行，
 * 所以用 k/M 缩写（与上游页面的写法一致）。
 */
export function tokensLabel(tokens: number | null): string | null {
  if (tokens === null || !Number.isFinite(tokens) || tokens <= 0) return null
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M token`
  if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k token`
  return `${Math.round(tokens)} token`
}

/**
 * 额度已用百分比 -> “已用 17%”。
 *
 * 上游的 `used` 是百分比（16.9 表示 16.9%），不是 token 数；之前把它当
 * token 数显示，于是“已用 17%”被写成了“最近 17 token”。
 */
export function usedPercentLabel(usedPercent: number | null): string | null {
  if (usedPercent === null || !Number.isFinite(usedPercent)) return null
  // 上游页面写整数百分比（16.9 -> 17%）：卡片一行放不下小数，也没必要。
  return `已用 ${Math.round(usedPercent)}%`
}

/** 重置时刻 -> “6 天后重置”；已经过去/时间不可解析时返回 null。 */
export function resetLabel(iso: string | null | undefined, nowMs: number): string | null {
  if (!iso || nowMs <= 0) return null
  const at = Date.parse(iso)
  if (!Number.isFinite(at)) return null
  const seconds = Math.round((at - nowMs) / 1000)
  if (seconds <= 0) return null
  return `${formatSpan(seconds)}后重置`
}

/** 秒 -> “6 天” / “3 小时” / “12 分钟”。 */
function formatSpan(totalSeconds: number): string {
  const seconds = Math.floor(totalSeconds)
  const days = Math.floor(seconds / 86_400)
  if (days > 0) return `${days} 天`
  const hours = Math.floor((seconds % 86_400) / 3_600)
  if (hours > 0) return `${hours} 小时`
  const minutes = Math.floor((seconds % 3_600) / 60)
  if (minutes > 0) return `${minutes} 分钟`
  return `${seconds} 秒`
}

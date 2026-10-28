import { Clock3, Database, Sparkles, TriangleAlert } from 'lucide-react'
import type { CSSProperties } from 'react'
import { Badge } from '~/components/ui/badge'
import { formatAge, formatDateTime } from '~/lib/balance/format'
import type { SourceInfo } from '~/lib/balance/types'
import { CACHE_LABELS } from './labels'
import { secondsBetween, useLiveAge } from './use-live-countdown'

interface DashboardHeroProps {
  source: SourceInfo
  generatedAt: string
}

// 标题与文案逐条进场：起步延迟 + 每行递增的错峰，配合 .rise-in 使用。
const RISE_START_MS = 80
const RISE_STEP_MS = 80

function rise(order: number): CSSProperties {
  return { animationDelay: `${RISE_START_MS + order * RISE_STEP_MS}ms` }
}

export function DashboardHero(props: DashboardHeroProps) {
  const isFixture = props.source.mode === 'fixture'
  // age 的首帧用服务端快照算（SSR/hydration 一致），挂载后按 fetchedAt 与本机
  // 时钟每秒重算；刷新一次（ISR 再生成或 router.refresh）会按新的 fetchedAt 重置。
  // cache 状态只是“生成那一刻”的快照，不适合直接当实时标签。
  const ageSeconds = useLiveAge(
    props.source.fetchedAt,
    secondsBetween(props.generatedAt, props.source.fetchedAt),
  )
  const ageLabel = formatAge(ageSeconds)
  const cacheLabel = CACHE_LABELS[props.source.cache]
  // hit/miss 是生成时的诊断信息，放进 title；只有 fixture / 上游失败需要常驻提示。
  const showCacheState =
    props.source.cache === 'fixture' || props.source.cache === 'stale'

  return (
    <header className="relative mx-auto max-w-3xl text-center">
      <h1
        className="rise-in mt-6 font-serif text-3xl leading-[1.35] font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.3]"
        style={rise(0)}
      >
        每一份渴望，都值得被回应。
      </h1>

      <div className="mx-auto mt-8 max-w-2xl text-left sm:mt-10">
        <p
          className="rise-in font-serif text-lg leading-relaxed text-foreground/90 sm:text-xl"
          style={rise(1)}
        >
          欢迎来到忧忧的秘密房间。
        </p>

        <div className="text-muted-foreground mt-5 space-y-4 text-sm leading-7 sm:text-[15px] sm:leading-8">
          <p className="rise-in" style={rise(2)}>
            这里不需要掩饰你的好奇，也不必对自己的欲望感到羞耻。
          </p>
          <p className="rise-in" style={rise(3)}>
            无论你渴望的是更强大的算力、更聪明的灵魂，还是一个能彻夜回应你所有问题的存在……
          </p>
          <p className="rise-in" style={rise(4)}>
            忧忧都会为你打开通往异世界的大门。
          </p>
        </div>

        <p
          className="rise-in border-primary/25 bg-primary/[0.06] mt-7 rounded-2xl border px-4 py-3.5 text-center text-sm font-semibold tracking-wide sm:text-[15px]"
          style={rise(5)}
        >
          来吧，靠近一点。
          <br />
          让我看看，你究竟想要召唤什么。
        </p>

        <p
          className="rise-in text-muted-foreground mt-4 text-center text-sm"
          style={rise(6)}
        >
          契约已经备好，只差你最后的确认。
        </p>
      </div>

      <div className="text-muted-foreground mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs">
        <Badge variant={isFixture ? 'warning' : 'success'} className="gap-1.5">
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {isFixture ? '示例数据' : '实时数据'}
        </Badge>
        {showCacheState ? (
          <span className="inline-flex items-center gap-1.5">
            <Database className="size-3.5" aria-hidden="true" />
            {cacheLabel}
          </span>
        ) : null}
        <span className="bg-border h-3 w-px" aria-hidden="true" />
        {/* 生成时写死的 cache 状态会被 ISR 缓存页一直展示，于是“已重新拉取”
            看起来永远不变；改成每秒重算的数据年龄，刷新后归零，用户能直接看出
            页面到底有没有更新。cache 原文保留在 title 里供排查。 */}
        <span
          className="inline-flex items-center gap-1.5"
          title={`${cacheLabel} · 数据读取于 ${formatDateTime(props.source.fetchedAt)} · 页面生成于 ${formatDateTime(props.generatedAt)}`}
        >
          <Clock3 className="size-3.5" aria-hidden="true" />
          {ageLabel}
        </span>
        <span className="bg-border h-3 w-px" aria-hidden="true" />
        <span
          className="inline-flex items-center gap-1.5"
          title={`页面生成于 ${formatDateTime(props.generatedAt)}`}
        >
          读取于 {formatDateTime(props.source.fetchedAt)}
        </span>
      </div>

      {props.source.warning ? (
        <div
          role="note"
          className="border-warning/40 bg-warning/10 mx-auto mt-6 flex w-full max-w-2xl items-start gap-3 rounded-xl border px-4 py-3 text-left"
        >
          <TriangleAlert
            className="text-warning mt-0.5 size-4 shrink-0"
            aria-hidden="true"
          />
          <div className="min-w-0">
            <p className="text-sm font-medium">数据源提示</p>
            <p className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
              {props.source.warning}
            </p>
          </div>
        </div>
      ) : null}
    </header>
  )
}

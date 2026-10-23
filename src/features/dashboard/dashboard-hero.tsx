import {
  ArrowUpRight,
  Clock3,
  Database,
  Sparkles,
  TriangleAlert,
} from 'lucide-react'
import type { CSSProperties } from 'react'
import { Badge } from '~/components/ui/badge'
import { formatDateTime } from '~/lib/balance/format'
import type { SourceInfo } from '~/lib/balance/types'
import { newApiDashboardHref } from '~/lib/host-links'
import { CACHE_LABELS } from './labels'

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

  return (
    <header className="relative mx-auto max-w-3xl text-center">
      <span className="ring-foreground/10 bg-card/70 text-muted-foreground inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 backdrop-blur-sm">
        <Sparkles className="text-primary size-3.5" aria-hidden="true" />
         · 忧忧魔导局 ·
      </span>

      <h1
        className="rise-in mt-6 font-serif text-3xl leading-[1.35] font-semibold tracking-tight text-balance sm:text-5xl sm:leading-[1.3]"
        style={rise(0)}
      >
        今晚，也来索取你的专属魔力吗？
      </h1>

      <div className="mx-auto mt-8 max-w-2xl text-left sm:mt-10">
        <p
          className="rise-in font-serif text-lg leading-relaxed text-foreground/90 sm:text-xl"
          style={rise(1)}
        >
          夜深了，主人。
        </p>

        <div className="text-muted-foreground mt-5 space-y-4 text-sm leading-7 sm:text-[15px] sm:leading-8">
          <p className="rise-in" style={rise(2)}>
            外面的世界已经安静下来，而魔导局的召唤仪式，才刚刚开始。
          </p>
          <p className="rise-in" style={rise(3)}>
            这里有永不熄灭的魔力，有藏在禁书中的秘密，还有一些……不方便在白天公开的东西。
          </p>
          <p className="rise-in" style={rise(4)}>
            只要付出一点点代价，就能换取超乎想象的力量。
          </p>
          <p className="rise-in" style={rise(5)}>
            别紧张，忧忧又不会吃掉你。
          </p>
          <p className="rise-in" style={rise(6)}>
            至少，现在不会。
          </p>
        </div>

        <p
          className="rise-in border-primary/25 bg-primary/[0.06] mt-7 rounded-2xl border px-4 py-3.5 text-center text-sm font-semibold tracking-wide sm:text-[15px]"
          style={rise(7)}
        >
          请选好你的咒文，准备好你的密钥。
        </p>


        <p
          className="rise-in text-muted-foreground mt-4 text-center text-sm"
          style={rise(9)}
        >
          今晚的魔力供应，已经为你开放。
        </p>
      </div>

      <div className="text-muted-foreground mt-4  flex flex-wrap items-center justify-center gap-x-3 gap-y-2 text-xs">
        <Badge variant={isFixture ? 'warning' : 'success'} className="gap-1.5">
          <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
          {isFixture ? '示例数据' : '实时数据'}
        </Badge>
        <span className="inline-flex items-center gap-1.5">
          <Database className="size-3.5" aria-hidden="true" />
          {CACHE_LABELS[props.source.cache]}
        </span>
        <span className="bg-border h-3 w-px" aria-hidden="true" />
        <span className="inline-flex items-center gap-1.5">
          <Clock3 className="size-3.5" aria-hidden="true" />
          生成于 {formatDateTime(props.generatedAt)}
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

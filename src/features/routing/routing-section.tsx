import { Activity } from 'lucide-react'
import { Skeleton } from '~/components/ui/skeleton'
import type { RoutingFeed, RoutingView } from '~/lib/routing/types'
import { cn } from '~/lib/utils'
import { emptyStageCopy, SOURCE_NOTICE } from './labels'
import { RoutingStage } from './routing-stage'
import { useRoutingStream } from './use-routing-stream'

interface RoutingSectionProps {
  /** 首页 loader 拿到的首屏快照（800ms 预算内没等到就是 undefined）。 */
  seed?: RoutingFeed
}

type RoutingStream = ReturnType<typeof useRoutingStream>

/**
 * 首页里的一块“请求路径”图：只看图，不列请求。
 *
 * 数据通路：loader 的种子负责首屏（SSR 输出因此总是确定的形状，没有瀑布），
 * 挂载后由 useRoutingStream 接着按 `after=seq` 拉增量。种子缺失时先画骨架，
 * 第一次轮询回来就换成真的舞台。
 *
 * 身份默认在服务端就被抹成 ***，这里只把它画成高斯模糊的样子；本机调试
 * （revealed: true）时数据源会带真实账号与 provider，卡片直接显示原文，
 * 才能和上游页面逐张卡片对账。
 */
export function RoutingSection(props: RoutingSectionProps) {
  const stream = useRoutingStream(props.seed)
  const feed = stream.feed

  return (
    <section className="mt-12" aria-labelledby="routing-heading">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2
            id="routing-heading"
            className="text-base font-semibold tracking-tight"
          >
            请求路径
          </h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            每条真实调用怎么走：从智能体出发、在网关停靠、交给哪个账户，失败就退回换下一个。
            {feed?.source.revealed ? '本机调试：账户未打码。' : '账户已打码。'}
          </p>
        </div>
        {feed ? null : (
          <span className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            <Activity aria-hidden="true" className="size-3.5" />
            正在读取轨迹…
          </span>
        )}
      </div>

      <div className="bg-card ring-border/70 mt-4 overflow-hidden rounded-2xl ring-1">
        {feed ? (
          <LiveStage stream={stream} />
        ) : (
          <div className="p-3 sm:p-4" aria-hidden="true">
            <Skeleton className="h-44 rounded-xl" />
          </div>
        )}
      </div>
    </section>
  )
}

function LiveStage(props: { stream: RoutingStream }) {
  const { view, source, live, clockOffset } = props.stream
  const hasTrips = view.trips.length > 0

  return (
    <>
      <div className="border-border/70 text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b px-3 py-2 text-[11px] sm:px-4">
        <span className="inline-flex items-center gap-1.5">
          <Activity aria-hidden="true" className="size-3.5" />
          实时
          <i
            aria-hidden="true"
            className={cn(
              'ml-0.5 size-1.5 rounded-full',
              live ? 'bg-success' : 'bg-muted-foreground/50',
            )}
          />
          {live ? '已连上游' : '等待上游'}
        </span>
        <span className="tabular">
          <LiveCount view={view} />
        </span>
      </div>

      {hasTrips ? (
        <RoutingStage
          view={view}
          clockOffset={clockOffset}
          connected={live}
          masked={!source.revealed}
        />
      ) : (
        <p className="text-muted-foreground px-4 py-10 text-center text-sm">
          {emptyStageCopy(source.state, view.mine).description}
        </p>
      )}

      <Narrative view={view} masked={!source.revealed} />

      {source.state === 'connected' ? null : (
        <p className="border-border/70 text-muted-foreground border-t px-3 py-2 text-[11px] leading-5 sm:px-4">
          {SOURCE_NOTICE[source.state]}
        </p>
      )}
    </>
  )
}

/** 在途 / 累计：放在同一个节点里，免得每秒重排两处文本。 */
function LiveCount(props: { view: RoutingView }) {
  const running = props.view.trips.filter((trip) => !trip.done).length
  return (
    <>
      在途 {running} · 累计 {props.view.totals.requests}
    </>
  )
}

/**
 * 最近一个请求是怎么被路由的——上游页面底部也有一句同样的说明。
 *
 * 名字都打了码，所以这里只讲“路由做了什么”：第几个候选、失败后退去哪、
 * 最后由谁回答、花了多久。没有在途请求时显示上一条。
 */
function Narrative(props: { view: RoutingView; masked: boolean }) {
  const trip = props.view.trips.reduce<(typeof props.view.trips)[number] | null>(
    (newest, candidate) => (!newest || candidate.startedAt >= newest.startedAt ? candidate : newest),
    null,
  )
  if (!trip) return null

  const last = trip.attempts[trip.attempts.length - 1]
  const seatName = (index: number) => {
    const seat = props.view.seats[index]
    if (!seat) return '未知位置'
    if (props.masked) return '***'
    return seat.who ?? seat.name ?? '未知位置'
  }
  const seconds = trip.ms ? `${(trip.ms / 1000).toFixed(trip.ms < 10_000 ? 1 : 0)} 秒` : null

  let sentence: string
  if (!last) {
    sentence = '路由还在挑候选。'
  } else if (!trip.done) {
    sentence = `路由把请求交给了第 ${trip.attempts.length} 个候选，正在等它作答。`
  } else if (trip.attempts.length === 1 && last.ok) {
    sentence = `路由把请求交给第一个候选（${seatName(last.seatIndex)}），它回答了这个请求${seconds ? `，用时 ${seconds}` : ''}。`
  } else if (last.ok) {
    sentence = `前 ${trip.attempts.length - 1} 个候选没答上来，路由退回网关后转给第 ${trip.attempts.length} 个（${seatName(last.seatIndex)}），由它回答${seconds ? `，共 ${seconds}` : ''}。`
  } else {
    sentence = `所有候选都没答上来（最后一个是 ${seatName(last.seatIndex)}：${last.status ?? '失败'}），请求以失败结束。`
  }

  return (
    <p className="border-border/70 text-muted-foreground border-t px-3 py-2 text-[11px] leading-5 sm:px-4">
      最近一个请求：{sentence}
    </p>
  )
}

import type { ErrorProps } from '@teyik0/furin'
import { DefaultCatchBoundary } from '~/components/default-catch-boundary'

/**
 * 最近作用域的错误边界：页面 / loader / head 抛错时渲染。
 * UI 与文案沿用原来的 DefaultCatchBoundary，reset() 会重跑当前路由的 loader。
 */
export default function PageError(props: ErrorProps) {
  return <DefaultCatchBoundary error={props.error} reset={props.reset} />
}

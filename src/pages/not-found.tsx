import type { NotFoundProps } from '@teyik0/furin'
import { NotFound } from '~/components/not-found'

/**
 * 404 边界：未匹配的 URL 或 loader 里的 notFound() 都落到这里。
 */
export default function PageNotFound(props: NotFoundProps) {
  return <NotFound error={props.error} />
}

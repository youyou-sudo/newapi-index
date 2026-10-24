import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select'
import type { DashboardSearch } from '~/lib/balance/schema'
import { SORT_OPTIONS, sortLabel } from './labels'
import {
  SORT_TRIGGER_CLASS,
  SORT_TRIGGER_ID,
  SORT_TRIGGER_LABEL,
} from './sort-select'

export interface SortSelectImplProps {
  value: DashboardSearch['sort']
  onValueChange: (value: DashboardSearch['sort']) => void
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

/**
 * 排序下拉的 Radix 实现。这个模块只会被 `sort-select.tsx` 动态 import，
 * 因此 @radix-ui/react-select（collection / popper / dismissable-layer /
 * focus-scope / react-remove-scroll）整条依赖链都留在异步 chunk 里，
 * 不进入首屏 JS。
 *
 * trigger 的 class / id / aria-label 与 SSR 降级按钮来自同一处常量，
 * 加载完成后的互换因此不会改变任何视觉或可访问性信息。
 */
export default function SortSelectImpl(props: SortSelectImplProps) {
  const { value, onValueChange, open, onOpenChange } = props

  return (
    <Select
      value={value}
      onValueChange={(next) => onValueChange(next as DashboardSearch['sort'])}
      open={open}
      onOpenChange={onOpenChange}
    >
      <SelectTrigger
        id={SORT_TRIGGER_ID}
        aria-label={SORT_TRIGGER_LABEL}
        className={SORT_TRIGGER_CLASS}
      >
        <SelectValue>{sortLabel(value)}</SelectValue>
      </SelectTrigger>
      <SelectContent
        position="popper"
        align="end"
        sideOffset={6}
        className="w-[var(--radix-select-trigger-width)]"
      >
        {SORT_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

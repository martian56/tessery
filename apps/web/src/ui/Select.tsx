import { Select as R } from 'radix-ui'
import { Check, ChevronDown } from 'lucide-react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import s from './Popup.module.css'

export interface SelectOption<V extends string = string> {
  value: V
  label: ReactNode
  hint?: ReactNode
  icon?: ReactNode
  disabled?: boolean
  group?: string
}

interface SelectProps<V extends string> {
  value: V | undefined
  options: SelectOption<V>[]
  onChange: (value: V) => void
  placeholder?: string
  disabled?: boolean
  className?: string
  'aria-label'?: string
}

export function Select<V extends string>({ value, options, onChange, placeholder = 'Select…', disabled, className, ...aria }: SelectProps<V>) {
  const groups = new Map<string, SelectOption<V>[]>()
  options.forEach((o) => {
    const g = o.group ?? ''
    if (!groups.has(g)) groups.set(g, [])
    groups.get(g)!.push(o)
  })
  const current = options.find((o) => o.value === value)
  return (
    <R.Root value={value ?? ''} onValueChange={(v) => onChange(v as V)} disabled={disabled}>
      <R.Trigger className={clsx(s.trigger, className)} aria-label={aria['aria-label']}>
        <span className={s.triggerValue}>
          {current ? <>{current.icon}{current.label}</> : <R.Value placeholder={placeholder} />}
        </span>
        <R.Icon className={s.triggerArrow}><ChevronDown /></R.Icon>
      </R.Trigger>
      <R.Portal>
        <R.Content className={clsx(s.content, s.selectContent)} position="popper" sideOffset={4} collisionPadding={8}>
          <R.Viewport className={s.viewport}>
            {[...groups.entries()].map(([g, opts], gi) => (
              <R.Group key={g || gi}>
                {gi > 0 && <R.Separator className={s.sep} />}
                {g && <R.Label className={s.heading}>{g}</R.Label>}
                {opts.map((o) => (
                  <R.Item key={o.value} value={o.value} disabled={o.disabled} className={s.item}>
                    <span className={s.check}><R.ItemIndicator><Check /></R.ItemIndicator></span>
                    {o.icon && <span className={s.itemIcon}>{o.icon}</span>}
                    <R.ItemText asChild><span className={s.itemLabel}>{o.label}</span></R.ItemText>
                    {o.hint && <span className={s.hint}>{o.hint}</span>}
                  </R.Item>
                ))}
              </R.Group>
            ))}
          </R.Viewport>
        </R.Content>
      </R.Portal>
    </R.Root>
  )
}

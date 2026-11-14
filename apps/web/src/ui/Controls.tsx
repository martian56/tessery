import { Checkbox as RC, Slider as RS, Switch as RSw, Tabs as RT, ToggleGroup as RTG } from 'radix-ui'
import { Check } from 'lucide-react'
import clsx from 'clsx'
import type { ReactNode } from 'react'
import { Tooltip } from './Tooltip'
import s from './Controls.module.css'

export function Switch({ checked, onChange, label, disabled, ariaLabel }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean; ariaLabel?: string }) {
  return (
    <label className={clsx(s.inline, disabled && s.disabled)}>
      <RSw.Root className={s.switch} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-label={ariaLabel}>
        <RSw.Thumb className={s.thumb} />
      </RSw.Root>
      {label && <span>{label}</span>}
    </label>
  )
}

export function Checkbox({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; disabled?: boolean }) {
  return (
    <label className={clsx(s.inline, disabled && s.disabled)}>
      <RC.Root className={s.checkbox} checked={checked} onCheckedChange={(v) => onChange(v === true)} disabled={disabled}>
        <RC.Indicator className={s.checkIcon}><Check /></RC.Indicator>
      </RC.Root>
      {label && <span>{label}</span>}
    </label>
  )
}

export function Slider({ value, onChange, onCommit, min = 0, max = 100, step = 1, width }: { value: number; onChange: (v: number) => void; onCommit?: (v: number) => void; min?: number; max?: number; step?: number; width?: number }) {
  return (
    <RS.Root className={s.slider} style={{ width }} value={[value]} min={min} max={max} step={step}
      onValueChange={(v) => onChange(v[0])} onValueCommit={(v) => onCommit?.(v[0])}>
      <RS.Track className={s.track}><RS.Range className={s.range} /></RS.Track>
      <RS.Thumb className={s.sliderThumb} aria-label="value" />
    </RS.Root>
  )
}

export interface SegmentOption<V extends string> { value: V; label?: ReactNode; icon?: ReactNode; tooltip?: string }

export function Segmented<V extends string>({ value, options, onChange, size = 'sm' }: { value: V; options: SegmentOption<V>[]; onChange: (v: V) => void; size?: 'xs' | 'sm' }) {
  return (
    <RTG.Root type="single" value={value} onValueChange={(v) => v && onChange(v as V)} className={clsx(s.segmented, s[size])}>
      {options.map((o) => (
        <Tooltip key={o.value} content={o.tooltip}>
          <RTG.Item value={o.value} className={s.segment} aria-label={o.tooltip ?? String(o.value)}>
            {o.icon}{o.label}
          </RTG.Item>
        </Tooltip>
      ))}
    </RTG.Root>
  )
}

export interface TabDef<V extends string> { value: V; label: ReactNode; icon?: ReactNode; badge?: ReactNode }

export function TabStrip<V extends string>({ value, tabs, onChange, right, className }: { value: V; tabs: TabDef<V>[]; onChange: (v: V) => void; right?: ReactNode; className?: string }) {
  return (
    <RT.Root value={value} onValueChange={(v) => onChange(v as V)} className={clsx(s.tabsRoot, className)}>
      <RT.List className={s.tabList}>
        {tabs.map((t) => (
          <RT.Trigger key={t.value} value={t.value} className={s.tab}>
            {t.icon}{t.label}{t.badge !== undefined && t.badge !== null && t.badge !== '' && <span className={s.tabBadge}>{t.badge}</span>}
          </RT.Trigger>
        ))}
      </RT.List>
      {right && <div className={s.tabRight}>{right}</div>}
    </RT.Root>
  )
}

export type Tone = 'neutral' | 'accent' | 'ok' | 'warn' | 'err' | 'info'

export function Badge({ children, tone = 'neutral', color, mono }: { children: ReactNode; tone?: Tone; color?: string; mono?: boolean }) {
  return <span className={clsx(s.badge, s[tone], mono && s.mono)} style={color ? { color, background: `color-mix(in srgb, ${color} 18%, transparent)` } : undefined}>{children}</span>
}

export function Dot({ color, pulse, size = 7 }: { color: string; pulse?: boolean; size?: number }) {
  return <span className={clsx(s.dot, pulse && s.pulse)} style={{ background: color, width: size, height: size }} />
}

export function Swatch({ color, size = 10 }: { color: string; size?: number }) {
  return <span className={s.swatch} style={{ background: color, width: size, height: size }} />
}

import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode, type TextareaHTMLAttributes } from 'react'
import clsx from 'clsx'
import s from './Input.module.css'

interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange' | 'value'> {
  value?: string | number
  onChange?: (value: string) => void
  onCommit?: (value: string) => void
  icon?: ReactNode
  suffix?: ReactNode
  size?: 'sm' | 'md'
  mono?: boolean
  invalid?: boolean
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { value, onChange, onCommit, icon, suffix, size = 'sm', mono, invalid, className, onKeyDown, onBlur, ...rest },
  ref,
) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  return (
    <label className={clsx(s.wrap, s[size], invalid && s.invalid, rest.disabled && s.disabled, className)}>
      {icon && <span className={s.icon}>{icon}</span>}
      <input
        ref={ref}
        className={clsx(s.input, mono && s.mono)}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => { setDraft(e.target.value); onChange?.(e.target.value) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && onCommit) onCommit(String(draft))
          if (e.key === 'Escape') { setDraft(value ?? ''); (e.target as HTMLInputElement).blur() }
          e.stopPropagation()
          onKeyDown?.(e)
        }}
        onBlur={(e) => { if (onCommit && String(draft) !== String(value ?? '')) onCommit(String(draft)); onBlur?.(e) }}
        {...rest}
      />
      {suffix && <span className={s.suffix}>{suffix}</span>}
    </label>
  )
})

interface NumberInputProps extends Omit<InputProps, 'value' | 'onChange' | 'onCommit' | 'type'> {
  value: number
  onCommit: (value: number) => void
  min?: number
  max?: number
  step?: number
}

export function NumberInput({ value, onCommit, min = -Infinity, max = Infinity, step = 1, ...rest }: NumberInputProps) {
  const clamp = (n: number) => Math.min(max, Math.max(min, n))
  return (
    <Input
      {...rest}
      mono
      value={value}
      inputMode="decimal"
      onCommit={(v) => { const n = parseFloat(v); if (!Number.isNaN(n)) onCommit(clamp(n)) }}
      onKeyDown={(e) => {
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const mult = e.shiftKey ? 10 : 1
          onCommit(clamp(+(value + (e.key === 'ArrowUp' ? step : -step) * mult).toFixed(4)))
        }
      }}
    />
  )
}

interface TextareaProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'> {
  value?: string
  onChange?: (value: string) => void
  onCommit?: (value: string) => void
  mono?: boolean
}

export function Textarea({ value, onChange, onCommit, mono, className, ...rest }: TextareaProps) {
  const [draft, setDraft] = useState(value ?? '')
  useEffect(() => setDraft(value ?? ''), [value])
  return (
    <textarea
      className={clsx(s.textarea, mono && s.mono, className)}
      value={draft}
      spellCheck={false}
      onChange={(e) => { setDraft(e.target.value); onChange?.(e.target.value) }}
      onBlur={() => { if (onCommit && draft !== (value ?? '')) onCommit(draft) }}
      onKeyDown={(e) => e.stopPropagation()}
      {...rest}
    />
  )
}

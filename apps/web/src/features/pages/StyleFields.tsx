import { useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import type { StyleMap } from '@tessery/core/domain/types'
import s from './StyleFields.module.css'

const UNITLESS = new Set(['lineHeight', 'opacity', 'fontWeight', 'zIndex', 'flexGrow', 'flexShrink', 'order'])

/** Turns what was typed into a style value: plain numbers are pixels (or unitless where that is the CSS norm). */
export function parseStyle(key: string, raw: string): string | number | null {
  const v = raw.trim()
  if (!v) return null
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  if (UNITLESS.has(key) && /^-?\d+(\.\d+)?$/.test(v)) return Number(v)
  return v
}

export interface StyleCtx {
  /** What this breakpoint sets. */
  own: StyleMap
  /** What applies here from the base style and wider breakpoints, shown as placeholders. */
  inherited: StyleMap
  set: (key: string, value: string | number | null) => void
}

function Text({ k, c, placeholder, list }: { k: string; c: StyleCtx; placeholder?: string; list?: string }) {
  const own = c.own[k]
  const [v, setV] = useState(own === undefined ? '' : String(own))
  useEffect(() => { setV(own === undefined ? '' : String(own)) }, [own])
  return (
    <input className={s.input} value={v} list={list} placeholder={c.inherited[k] !== undefined ? String(c.inherited[k]) : placeholder}
      onChange={(e) => setV(e.target.value)} onBlur={() => c.set(k, parseStyle(k, v))} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} aria-label={k} />
  )
}

export function Prop({ label, k, c, placeholder, list, children }: { label: string; k: string | string[]; c: StyleCtx; placeholder?: string; list?: string; children?: React.ReactNode }) {
  const keys = Array.isArray(k) ? k : [k]
  const overridden = keys.some((x) => c.own[x] !== undefined)
  return (
    <label className={s.row}>
      <span className={s.label}>{overridden && <i className={s.dot} />}{label}</span>
      {children ?? <Text k={keys[0]} c={c} placeholder={placeholder} list={list} />}
      {overridden && <button type="button" className={s.reset} aria-label={`Reset ${label}`} onClick={(e) => { e.preventDefault(); keys.forEach((x) => c.set(x, null)) }}><RotateCcw /></button>}
    </label>
  )
}

export function Choice({ k, c, options }: { k: string; c: StyleCtx; options: { value: string; label: React.ReactNode; title?: string }[] }) {
  const cur = String(c.own[k] ?? c.inherited[k] ?? '')
  return (
    <div className={s.choice} role="radiogroup">
      {options.map((o) => <button type="button" key={o.value} role="radio" aria-checked={cur === o.value} title={o.title ?? o.value} className={cur === o.value ? s.on : undefined} onClick={() => c.set(k, cur === o.value && c.own[k] !== undefined ? null : o.value)}>{o.label}</button>)}
    </div>
  )
}

const TOKENS = ['primary', 'onPrimary', 'text', 'muted', 'bg', 'surface', 'border']

export function Color({ k, c, colors }: { k: string; c: StyleCtx; colors: Record<string, string> }) {
  const cur = String(c.own[k] ?? c.inherited[k] ?? '')
  const token = /^var\(--c-([\w-]+)\)$/.exec(cur)?.[1]
  const resolved = token ? colors[token] : cur
  return (
    <div className={s.color}>
      <label className={s.swatch} style={{ background: resolved || 'transparent' }}>
        <input type="color" value={/^#[0-9a-f]{6}$/i.test(resolved ?? '') ? resolved : '#000000'} onChange={(e) => c.set(k, e.target.value)} aria-label={`${k} color`} />
      </label>
      <Text k={k} c={c} placeholder="none" />
      <div className={s.tokens}>{TOKENS.filter((t) => colors[t]).map((t) => <button type="button" key={t} title={`Theme ${t}`} className={token === t ? s.on : undefined} style={{ background: colors[t] }} onClick={() => c.set(k, `var(--c-${t})`)} />)}</div>
    </div>
  )
}

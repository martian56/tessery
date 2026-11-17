import type { ComponentType } from 'react'
import { TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { API_ICONS, NAV_ICONS, TECH_ICONS } from './set'
import { BRAND_PATHS, GRAPHQL_PATH } from './brands'

interface IconProps { size?: number; className?: string; title?: string }

/** Draws one icon from Tessery's set. The markup comes from our own constants, never from user input. */
export function Glyph({ svg, size = 16, className, title }: IconProps & { svg: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"
      className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}
      dangerouslySetInnerHTML={{ __html: svg }} />
  )
}

/** A product's logo as one solid shape in the current colour, sized a little smaller than line icons so both weigh the same. */
export function Logo({ path, size = 16, className, title }: IconProps & { path: string }) {
  const d = Math.round(size * 0.88)
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" className={className} role={title ? 'img' : undefined} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d={path} fill="currentColor" transform={`translate(${(24 - (24 * d) / size) / 2} ${(24 - (24 * d) / size) / 2}) scale(${d / size})`} />
    </svg>
  )
}

/** A technology's logo when it is a specific product, otherwise its pictogram, otherwise its short name. */
export function TechIcon({ id, ...rest }: IconProps & { id: string }) {
  if (BRAND_PATHS[id]) return <Logo path={BRAND_PATHS[id]} {...rest} />
  const svg = TECH_ICONS[id]
  return svg ? <Glyph svg={svg} {...rest} /> : <span className={rest.className}>{TECH_BY_ID[id]?.glyph ?? '?'}</span>
}

/** An API style or connection type. */
export function ApiIcon({ style, ...rest }: IconProps & { style: string }) {
  if (style === 'graphql') return <Logo path={GRAPHQL_PATH} {...rest} />
  return <Glyph svg={API_ICONS[style] ?? NAV_ICONS.api} {...rest} />
}

/** A sidebar or workspace icon as a component, for places that take an icon type rather than an element. */
export function navIcon(name: keyof typeof NAV_ICONS): ComponentType<IconProps> {
  const C = (p: IconProps) => <Glyph svg={NAV_ICONS[name]} {...p} />
  C.displayName = `NavIcon(${String(name)})`
  return C
}

/** A sidebar or workspace icon as an element. */
export function NavIcon({ name, ...rest }: IconProps & { name: keyof typeof NAV_ICONS }) {
  return <Glyph svg={NAV_ICONS[name]} {...rest} />
}

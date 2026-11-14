// Renders a page's element tree. Shared by the Tessery editor and every generated web app, so both draw the same
// page. Plain components without hooks: they run as React Server Components in Next.js and inside the editor.
/* eslint-disable @typescript-eslint/no-explicit-any */
type Value = string | number | boolean
type Style = Record<string, string | number>
export interface El {
  id: string
  type: string
  name?: string
  props: Record<string, Value>
  style?: Style
  tablet?: Style
  mobile?: Style
  hover?: Style
  hidden?: boolean
  children?: El[]
}
export interface PageTheme { colors: Record<string, string>; fonts: { heading: string; body: string }; radius: number }
export interface TreeProps {
  root: El
  theme: PageTheme
  /** Components for block elements, by block type (navbar, table, form, ...). */
  blocks: Record<string, (p: any) => any>
  /** Default props of each block type, so a block shows the same content in the editor and the app. */
  defaults?: Record<string, Record<string, Value>>
  /** Loaded data for bound blocks, by element id. */
  data?: Record<string, unknown>
  /** Resolved form actions, by element id. */
  actions?: Record<string, unknown>
  /** Where `asset:<id>/<name>` references point: /assets/ in apps, the Tessery API in the editor. */
  assetBase?: string
}

const PX = new Set(['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'gap', 'rowGap', 'columnGap', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'top', 'right', 'bottom', 'left', 'fontSize', 'borderRadius', 'borderWidth', 'letterSpacing', 'strokeWidth', 'outlineOffset', 'flexBasis'])
const ALLOWED = new Set([...PX, 'display', 'flexDirection', 'flexWrap', 'alignItems', 'alignContent', 'justifyContent', 'justifyItems', 'alignSelf', 'justifySelf', 'gridTemplateColumns', 'gridTemplateRows', 'gridColumn', 'gridRow', 'gridAutoFlow', 'position', 'zIndex', 'inset', 'aspectRatio', 'overflow', 'overflowX', 'overflowY', 'background', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundClip', 'color', 'fontFamily', 'fontWeight', 'fontStyle', 'lineHeight', 'textAlign', 'textTransform', 'textDecoration', 'textWrap', 'whiteSpace', 'wordBreak', 'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderColor', 'borderStyle', 'boxShadow', 'opacity', 'transform', 'transformOrigin', 'transition', 'filter', 'backdropFilter', 'mixBlendMode', 'objectFit', 'objectPosition', 'cursor', 'flex', 'flexGrow', 'flexShrink', 'order', 'fill', 'stroke', 'outline', 'clipPath', 'listStyle', 'pointerEvents', 'userSelect', 'visibility', 'isolation', 'WebkitTextFillColor', 'WebkitBackgroundClip', 'textShadow', 'scrollSnapType', 'scrollSnapAlign'])
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'small', 'strong', 'em', 'blockquote', 'label', 'li', 'code'])
const FRAME_TAGS = new Set(['div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside', 'ul', 'ol', 'figure'])
const SYSTEM_FONTS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'Georgia', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New'])

const kebab = (k: string) => (k.startsWith('Webkit') ? '-webkit-' + k.slice(6) : k).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-webkit--/, '-webkit-')
export const cls = (id: string) => `n-${id.replace(/[^A-Za-z0-9_-]/g, '-')}`

/** Resolves `asset:` references to the app's own copy. */
export const asset = (v: Value | undefined, base: string) => (typeof v === 'string' && v.startsWith('asset:') ? base + v.slice(6) : v)

/** Keeps a style value from closing the rule or loading anything but this app's assets and https URLs. */
function cssValue(key: string, v: string | number, base: string): string | null {
  if (typeof v === 'number') return Number.isFinite(v) ? (PX.has(key) && v !== 0 ? `${v}px` : String(v)) : null
  let s = String(v).trim()
  if (!s || /[<>{};\\]|\/\*|expression\(|javascript:/i.test(s)) return null
  s = s.replace(/asset:([A-Za-z0-9-]+\/[A-Za-z0-9._-]+)/g, (_m, ref: string) => `url("${base}${ref}")`)
  if (/url\(/i.test(s) && ![...s.matchAll(/url\(\s*"?([^")]*)"?\s*\)/gi)].every((m) => m[1].startsWith(base) || m[1].startsWith('https://') || m[1].startsWith('/'))) return null
  return s
}

function decls(style: Style | undefined, base: string): string {
  if (!style) return ''
  return Object.entries(style).flatMap(([k, v]) => {
    if (!ALLOWED.has(k)) return []
    const value = cssValue(k, v, base)
    return value === null ? [] : [`${kebab(k)}:${value}`]
  }).join(';')
}

const fontName = (f: string) => f.split(',')[0].trim().replace(/^["']|["']$/g, '')
const fontStack = (f: string) => (SYSTEM_FONTS.has(fontName(f)) ? `${f}, system-ui, sans-serif` : `"${fontName(f)}", system-ui, sans-serif`)

/** The stylesheet for a page: theme variables, then one rule per element, its hover state and its breakpoints. */
export function treeCss(root: El, theme: PageTheme, base = '/assets/'): string {
  const fonts = [...new Set([theme.fonts.heading, theme.fonts.body].map(fontName))].filter((f) => f && !SYSTEM_FONTS.has(f) && /^[A-Za-z0-9 ]+$/.test(f))
  const head = fonts.length ? `@import url("https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${f.replace(/ /g, '+')}:ital,wght@0,300..900;1,300..900`).join('&')}&display=swap");\n` : ''
  const vars = [
    ...Object.entries(theme.colors).filter(([k, v]) => /^[A-Za-z0-9-]+$/.test(k) && cssValue('color', v, base) !== null).map(([k, v]) => `--c-${k}:${v}`),
    `--font-heading:${fontStack(theme.fonts.heading)}`,
    `--font-body:${fontStack(theme.fonts.body)}`,
    `--radius:${Number(theme.radius) || 0}px`,
  ].join(';')
  const rules: string[] = [`.tsp-tree{${vars};background:var(--c-bg);color:var(--c-text);font-family:var(--font-body)}`, '.tsp-tree :is(h1,h2,h3,h4,h5,h6){font-family:var(--font-heading)}']
  const tablet: string[] = []
  const mobile: string[] = []
  const visit = (e: El) => {
    const c = cls(e.id)
    const d = decls(e.style, base)
    if (d) rules.push(`.${c}{${d}}`)
    const h = decls(e.hover, base)
    if (h) rules.push(`.${c}:hover{${h}}`)
    const t = decls(e.tablet, base)
    if (t) tablet.push(`.${c}{${t}}`)
    const m = decls(e.mobile, base)
    if (m) mobile.push(`.${c}{${m}}`)
    e.children?.forEach(visit)
  }
  visit(root)
  return head + rules.join('\n') + (tablet.length ? `\n@container (max-width: 900px){${tablet.join('')}}` : '') + (mobile.length ? `\n@container (max-width: 600px){${mobile.join('')}}` : '')
}

const safeHref = (v: unknown) => {
  const s = String(v ?? '').trim()
  return /^(https?:\/\/|mailto:|tel:|\/|#)/i.test(s) ? s : undefined
}
const safeEmbed = (v: unknown) => {
  const s = String(v ?? '').trim()
  return /^https:\/\//i.test(s) ? s : undefined
}
const safePath = (v: unknown) => String(v ?? '').replace(/[^MLHVCSQTAZmlhvcsqtaz0-9.,\-\se]/g, '')

function Node({ e, t }: { e: El; t: Required<Omit<TreeProps, 'root' | 'theme'>> }): any {
  if (e.hidden) return null
  const p = e.props ?? {}
  const base = { className: `${cls(e.id)} tsp-el tsp-el-${e.type}`, 'data-node': e.id }
  const kids = e.children?.map((c) => <Node key={c.id} e={c} t={t} />)
  switch (e.type) {
    case 'frame': {
      const href = safeHref(p.href)
      if (href) return <a {...base} href={href}>{kids}</a>
      const Tag = (FRAME_TAGS.has(String(p.tag)) ? String(p.tag) : 'div') as any
      return <Tag {...base}>{kids}</Tag>
    }
    case 'text': {
      const Tag = (TEXT_TAGS.has(String(p.tag)) ? String(p.tag) : 'p') as any
      return <Tag {...base}>{String(p.text ?? '')}</Tag>
    }
    case 'image': {
      const src = asset(p.src, t.assetBase)
      return src ? <img {...base} src={String(src)} alt={String(p.alt ?? '')} loading={p.eager ? 'eager' : 'lazy'} /> : <div {...base} role="presentation" />
    }
    case 'video': {
      const src = asset(p.src, t.assetBase)
      return <video {...base} src={src ? String(src) : undefined} poster={p.poster ? String(asset(p.poster, t.assetBase)) : undefined} autoPlay={p.autoplay !== false} muted={p.muted !== false} loop={p.loop !== false} playsInline controls={!!p.controls} />
    }
    case 'button':
      return <a {...base} href={safeHref(p.href) ?? '#'}>{String(p.text ?? '')}</a>
    case 'shape':
      return <div {...base} role="presentation" />
    case 'path':
      return (
        <svg {...base} viewBox={String(p.viewBox ?? '0 0 100 100').replace(/[^0-9.\s-]/g, '')} preserveAspectRatio={p.keepRatio ? 'xMidYMid meet' : 'none'} aria-hidden>
          <path d={safePath(p.d)} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )
    case 'embed': {
      const src = safeEmbed(p.src)
      return src ? <iframe {...base} src={src} title={String(p.title ?? 'Embedded content')} loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-presentation" allow="fullscreen; picture-in-picture" /> : <div {...base} />
    }
    case 'block': {
      const Block = t.blocks[String(p.block)]
      if (!Block) return <div {...base} />
      const props: Record<string, unknown> = {}
      for (const [k, v] of Object.entries({ ...(t.defaults[String(p.block)] ?? {}), ...p })) if (k !== 'block' && k !== 'source' && k !== 'action') props[k] = asset(v, t.assetBase)
      if (e.id in t.data) props.data = t.data[e.id]
      if (e.id in t.actions) props.action = t.actions[e.id]
      return <div {...base}><Block {...props} /></div>
    }
    default:
      return null
  }
}

export function Tree({ root, theme, blocks, defaults = {}, data = {}, actions = {}, assetBase = '/assets/' }: TreeProps) {
  return (
    <div className="tsp tsp-tree">
      <style>{treeCss(root, theme, assetBase)}</style>
      <Node e={root} t={{ blocks, defaults, data, actions, assetBase }} />
    </div>
  )
}

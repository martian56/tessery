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
  focus?: Style
  active?: Style
  current?: Style
  hidden?: boolean
  children?: El[]
}
export interface PageTheme { colors: Record<string, string>; fonts: { heading: string; body: string; mono?: string }; radius: number; dark?: Record<string, string>; logo?: string }
export interface TreeProps {
  root: El
  theme: PageTheme
  /** Components for block elements, by block type (navbar, table, form, ...). */
  blocks: Record<string, (p: any) => any>
  /** Default props of each block type, so a block shows the same content in the editor and the app. */
  defaults?: Record<string, Record<string, Value>>
  /** Loaded data for bound blocks and record frames, by element id. */
  data?: Record<string, unknown>
  /** Resolved form actions, by element id. */
  actions?: Record<string, unknown>
  /** Where `asset:<id>/<name>` references point: /assets/ in apps, the Tessery API in the editor. */
  assetBase?: string
  /** Draws an icon by its Lucide name, such as "git-branch". */
  icon?: (p: { name: string; className: string; 'aria-hidden'?: boolean; 'aria-label'?: string; 'data-node'?: string }) => any
  /** The path being shown, so links to it get aria-current and their `current` style. */
  path?: string
  /** In the editor, popovers and disclosures render open so their contents can be edited. */
  editing?: boolean
  /** The page's query string values, for {?name} placeholders and for marking ?filter links current. */
  query?: Record<string, string | string[] | undefined>
}
type Ctx = Required<Omit<TreeProps, 'root' | 'theme' | 'icon' | 'path' | 'query'>> & Pick<TreeProps, 'icon' | 'path' | 'query'> & { logo?: string }
type Row = Record<string, unknown>

const PX = new Set(['width', 'height', 'minWidth', 'minHeight', 'maxWidth', 'maxHeight', 'gap', 'rowGap', 'columnGap', 'padding', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'paddingInline', 'paddingBlock', 'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft', 'marginInline', 'marginBlock', 'top', 'right', 'bottom', 'left', 'fontSize', 'borderRadius', 'borderTopLeftRadius', 'borderTopRightRadius', 'borderBottomLeftRadius', 'borderBottomRightRadius', 'borderWidth', 'letterSpacing', 'strokeWidth', 'outlineOffset', 'outlineWidth', 'flexBasis', 'textIndent', 'textUnderlineOffset', 'scrollPaddingTop', 'scrollMarginTop'])
const ALLOWED = new Set([...PX, 'display', 'flexDirection', 'flexWrap', 'alignItems', 'alignContent', 'justifyContent', 'justifyItems', 'alignSelf', 'justifySelf', 'placeItems', 'placeContent', 'placeSelf', 'gridTemplateColumns', 'gridTemplateRows', 'gridTemplateAreas', 'gridArea', 'gridColumn', 'gridRow', 'gridAutoFlow', 'gridAutoRows', 'gridAutoColumns', 'position', 'zIndex', 'inset', 'aspectRatio', 'overflow', 'overflowX', 'overflowY', 'overscrollBehavior', 'scrollBehavior', 'scrollbarWidth', 'scrollbarColor', 'scrollbarGutter', 'background', 'backgroundColor', 'backgroundImage', 'backgroundSize', 'backgroundPosition', 'backgroundRepeat', 'backgroundClip', 'backgroundAttachment', 'backgroundBlendMode', 'color', 'fontFamily', 'fontWeight', 'fontStyle', 'fontVariantNumeric', 'fontFeatureSettings', 'lineHeight', 'textAlign', 'textTransform', 'textDecoration', 'textDecorationColor', 'textDecorationThickness', 'textWrap', 'textOverflow', 'whiteSpace', 'wordBreak', 'hyphens', 'verticalAlign', 'WebkitLineClamp', 'WebkitBoxOrient', 'lineClamp', 'columnCount', 'border', 'borderTop', 'borderRight', 'borderBottom', 'borderLeft', 'borderColor', 'borderStyle', 'boxShadow', 'opacity', 'transform', 'transformOrigin', 'rotate', 'scale', 'translate', 'transition', 'animation', 'animationDelay', 'animationDuration', 'filter', 'backdropFilter', 'mixBlendMode', 'objectFit', 'objectPosition', 'cursor', 'flex', 'flexGrow', 'flexShrink', 'order', 'fill', 'stroke', 'outline', 'outlineColor', 'accentColor', 'caretColor', 'clipPath', 'maskImage', 'WebkitMaskImage', 'listStyle', 'pointerEvents', 'userSelect', 'touchAction', 'visibility', 'isolation', 'contain', 'containerType', 'WebkitTextFillColor', 'WebkitBackgroundClip', 'textShadow', 'scrollSnapType', 'scrollSnapAlign', 'boxSizing', 'positionArea', 'positionTryFallbacks', 'anchorName', 'positionAnchor'])
const TEXT_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'span', 'small', 'strong', 'em', 'blockquote', 'label', 'li', 'code', 'pre', 'kbd', 'time', 'mark', 'del', 's', 'figcaption'])
const FRAME_TAGS = new Set(['div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside', 'ul', 'ol', 'li', 'figure', 'form', 'details', 'summary', 'label', 'search'])
const INPUT_KINDS = new Set(['text', 'search', 'email', 'tel', 'url', 'number', 'password', 'date', 'checkbox', 'radio', 'range', 'textarea', 'hidden'])
const SYSTEM_FONTS = new Set(['system-ui', 'sans-serif', 'serif', 'monospace', 'ui-serif', 'ui-sans-serif', 'ui-monospace', 'Georgia', 'Arial', 'Helvetica', 'Times New Roman', 'Courier New'])
/** Where each state's style applies. Frames take focus while anything inside them has it, so a search bar can light up. */
const STATES: [keyof El, (c: string, frame: boolean) => string][] = [
  ['hover', (c) => `.${c}:hover`],
  ['focus', (c, frame) => (frame ? `.${c}:focus-within` : `.${c}:focus-visible`)],
  ['active', (c) => `.${c}:active`],
  ['current', (c) => `.${c}[aria-current="page"],.${c}[open],.${c}:checked`],
]

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
const fontStack = (f: string, fallback = 'system-ui, sans-serif') => (SYSTEM_FONTS.has(fontName(f)) ? `${f}, ${fallback}` : `"${fontName(f)}", ${fallback}`)
const colorVars = (colors: Record<string, string>, base: string) =>
  Object.entries(colors).filter(([k, v]) => /^[A-Za-z0-9-]+$/.test(k) && cssValue('color', v, base) !== null).map(([k, v]) => `--c-${k}:${v}`)

/** The theme as CSS: its font import and variables on `selector`, with the dark palette under prefers-color-scheme. */
export function themeCss(theme: PageTheme, selector = '.tsp-tree', base = '/assets/'): string {
  const mono = theme.fonts.mono || 'ui-monospace'
  const fonts = [...new Set([theme.fonts.heading, theme.fonts.body, mono].map(fontName))].filter((f) => f && !SYSTEM_FONTS.has(f) && /^[A-Za-z0-9 ]+$/.test(f))
  const head = fonts.length ? `@import url("https://fonts.googleapis.com/css2?${fonts.map((f) => `family=${f.replace(/ /g, '+')}:wght@400;500;600;700`).join('&')}&display=swap");\n` : ''
  const vars = [
    ...colorVars(theme.colors, base),
    `--font-heading:${fontStack(theme.fonts.heading)}`,
    `--font-body:${fontStack(theme.fonts.body)}`,
    `--font-mono:${fontStack(mono, 'ui-monospace, monospace')}`,
    `--radius:${Number(theme.radius) || 0}px`,
  ].join(';')
  const dark = theme.dark && Object.keys(theme.dark).length ? colorVars(theme.dark, base) : []
  return head + [
    `${selector}{${vars};background:var(--c-bg);color:var(--c-text);font-family:var(--font-body)}`,
    `${selector} :is(h1,h2,h3,h4,h5,h6){font-family:var(--font-heading)}`,
    `${selector} :is(code,pre,kbd){font-family:var(--font-mono)}`,
  ].join('\n') + (dark.length ? `\n@media (prefers-color-scheme: dark){${selector}{${dark.join(';')};color-scheme:dark}}` : '')
}

/** The stylesheet for a page: theme variables, then one rule per element, its states and its breakpoints. */
export function treeCss(root: El, theme: PageTheme, base = '/assets/'): string {
  const rules: string[] = []
  const tablet: string[] = []
  const mobile: string[] = []
  const visit = (e: El) => {
    const c = cls(e.id)
    const d = decls(e.style, base)
    if (d) rules.push(`.${c}{${d}}`)
    for (const [k, sel] of STATES) {
      const s = decls(e[k] as Style | undefined, base)
      if (s) rules.push(`:is(${sel(c, e.type === 'frame')}){${s}}`)
    }
    const t = decls(e.tablet, base)
    if (t) tablet.push(`.${c}{${t}}`)
    const m = decls(e.mobile, base)
    if (m) mobile.push(`.${c}{${m}}`)
    e.children?.forEach(visit)
  }
  visit(root)
  return themeCss(theme, '.tsp-tree', base) + '\n' + rules.join('\n')
    + (tablet.length ? `\n@container (max-width: 900px){${tablet.join('')}}` : '')
    + (mobile.length ? `\n@container (max-width: 600px){${mobile.join('')}}` : '')
}

const safeHref = (v: unknown) => {
  const s = String(v ?? '').trim()
  return /^(https?:\/\/|mailto:|tel:|\/|#|\?)/i.test(s) ? s : undefined
}
const safeEmbed = (v: unknown) => {
  const s = String(v ?? '').trim()
  return /^https:\/\//i.test(s) ? s : undefined
}
const safePath = (v: unknown) => String(v ?? '').replace(/[^MLHVCSQTAZmlhvcsqtaz0-9.,\-\se]/g, '')

function walkIds(e: El, out: Set<string>) {
  out.add(e.id)
  e.children?.forEach((c) => walkIds(c, out))
}

/** Fills an action path: each {name} from the record being drawn, else the page's route param of that name, else the one in its position. */
export function actionPath(path: string, row: Row | undefined, params: Record<string, string> = {}): string {
  const given = Object.values(params)
  let i = 0
  return path.replace(/\{(\w+)\}/g, (_m, k: string) => {
    const at = i++
    const v = row && row !== SAMPLE && row[k] !== undefined && row[k] !== null ? row[k] : params[k] ?? given[at]
    return encodeURIComponent(String(v ?? ''))
  })
}

/** Whether the page shows a search or filter, so an empty list means nothing matched rather than nothing exists. */
export const filtered = (query: TreeProps['query']) => Object.entries(query ?? {}).some(([k, v]) => k !== 'page' && one(v) !== '')

/** Whether a `?a=b` link describes the query being shown; a bare `?` matches a page with no filters. */
export function sameQuery(href: string, query: TreeProps['query']): boolean {
  const want = new URLSearchParams(href.slice(1))
  const have = Object.entries(query ?? {}).filter(([k, v]) => k !== 'page' && one(v) !== '')
  return have.length === [...want.keys()].filter((k) => k !== 'page').length && have.every(([k, v]) => want.get(k) === one(v))
}

/** The records a bound frame repeats over: the response when it is a list, its first list field, or one record for a detail page. */
export function records(data: unknown): Row[] {
  if (Array.isArray(data)) return data as Row[]
  if (data && typeof data === 'object') {
    for (const k of ['items', 'data', 'results', 'rows', 'nodes']) { const v = (data as Row)[k]; if (Array.isArray(v)) return v as Row[] }
    return [data as Row]
  }
  return []
}

const human = (k: string) => k.split('.').pop()!.replace(/[_-]+/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^\w/, (c) => c.toUpperCase())
/** In the editor a record frame has no data yet, so each field shows its own name. */
const SAMPLE: Row = new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? human(k) : undefined) })

function lookup(row: Row, path: string): unknown {
  if (row === SAMPLE) return human(path)
  return path.split('.').reduce<unknown>((v, k) => (v && typeof v === 'object' ? (v as Row)[k] : undefined), row)
}

function format(v: unknown, how: string): string {
  if (v === null || v === undefined) return ''
  const n = typeof v === 'number' ? v : Number(v)
  const d = new Date(String(v))
  switch (how) {
    case 'money': return Number.isFinite(n) && v !== '' ? n.toLocaleString('en-US', { style: 'currency', currency: 'USD' }) : String(v)
    case 'number': return Number.isFinite(n) && v !== '' ? n.toLocaleString('en-US') : String(v)
    case 'date': return isNaN(d.getTime()) ? String(v) : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    case 'upper': return String(v).toUpperCase()
    case 'initials': return String(v).split(/\s+/).map((w) => w[0] ?? '').join('').slice(0, 2).toUpperCase()
    default: return typeof v === 'object' ? JSON.stringify(v) : String(v)
  }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? ''

/** Fills `{field}`, `{author.name}` and `{price|money}` from the record being rendered, and `{?q}` from the page's query. */
export function fill(text: unknown, row: Row | undefined, encode = false, query?: TreeProps['query']): string {
  const s = String(text ?? '')
  if (!row && !s.includes('{?')) return s
  return s.replace(/\{(\?)?([A-Za-z_][\w.-]*)(?:\|(\w+))?\}/g, (m, q: string | undefined, path: string, how = '') => {
    if (q) return encode ? encodeURIComponent(one(query?.[path])) : one(query?.[path])
    if (!row) return m
    const out = format(lookup(row, path), how)
    return encode && row !== SAMPLE ? encodeURIComponent(out) : out
  })
}

/** Inside a record frame, ids of the template's elements and the record being drawn, so popovers and their buttons pair up per record. */
type Scope = { ids: Set<string>; key: string }
const popId = (id: string, scope?: Scope) => cls(id) + (scope?.ids.has(id) ? `-${scope.key}` : '')

/** Whether an element with props.when shows: "?key" when the query has it, "field" or "!field" on a record field, "field=value" or "field!=value" to compare. */
export function shows(when: unknown, row: Row | undefined, query: TreeProps['query']): boolean {
  const w = String(when ?? '').trim()
  if (!w) return true
  if (w.startsWith('?')) return one(query?.[w.slice(1)]) !== ''
  const m = /^(!?)([A-Za-z_][\w.]*)(?:(!?=)(.*))?$/.exec(w)
  if (!m) return true
  const v = row ? lookup(row, m[2]) : undefined
  if (m[3]) return (String(v ?? '') === m[4].trim()) === (m[3] === '=')
  const truthy = v !== undefined && v !== null && v !== false && v !== '' && v !== 0 && v !== '0' && v !== 'false'
  return m[1] ? !truthy : truthy
}

function Node({ e, t, row, copy, scope }: { e: El; t: Ctx; row?: Row; copy?: boolean; scope?: Scope }): any {
  if (e.hidden) return null
  if (e.props?.when && !t.editing && !shows(e.props.when, row === SAMPLE ? undefined : row, t.query)) return null
  const p = e.props ?? {}
  const base: Record<string, unknown> = { className: `${cls(e.id)} tsp-el tsp-el-${e.type}` }
  if (!copy) base['data-node'] = e.id
  const f = (v: unknown) => fill(v, row, false, t.query)
  if (p.label) base['aria-label'] = f(p.label)
  if (p.tooltip) base.title = f(p.tooltip)
  const link = (v: unknown) => {
    const href = safeHref(fill(v, row, true, t.query))
    if (href && (href.startsWith('?') ? sameQuery(href, t.query) : t.path && href === t.path)) base['aria-current'] = 'page'
    return href
  }
  const kids = (r: Row | undefined, c?: boolean) => e.children?.map((x) => <Node key={x.id} e={x} t={t} row={r} copy={c} scope={scope} />)
  switch (e.type) {
    case 'frame': {
      const tag = FRAME_TAGS.has(String(p.tag)) ? String(p.tag) : 'div'
      let body: any = kids(row, copy)
      if ('source' in p) {
        const loaded = t.data[e.id]
        const list = loaded === undefined && t.editing ? Array.from({ length: Math.max(1, Number(p.preview) || 3) }, () => SAMPLE) : records(loaded)
        const shown = list.slice(0, Number(p.limit) || 50)
        body = shown.length
          ? shown.map((r, i) => {
            const ids = new Set<string>()
            e.children?.forEach((x) => walkIds(x, ids))
            const inner: Scope = { ids: new Set([...(scope?.ids ?? []), ...ids]), key: `${scope ? `${scope.key}-` : ''}${i}` }
            return e.children?.map((x) => <Node key={`${x.id}:${r === SAMPLE ? i : String(r.id ?? i)}`} e={x} t={t} row={r} copy={copy || i > 0} scope={inner} />)
          })
          : <p className="tsp-empty">{String((p.emptyFiltered && filtered(t.query) ? p.emptyFiltered : p.empty) ?? 'Nothing here yet.')}</p>
      }
      if (p.popover && !t.editing) { base.id = popId(e.id, scope); base.popover = 'auto' }
      if (p.popover && t.editing) base['data-popover'] = ''
      if (tag === 'details' && (t.editing || p.open)) base.open = true
      if (tag === 'form') {
        const act = p.action ? (t.actions[e.id] as { service?: string; method?: string; path?: string; params?: Record<string, string> } | undefined) : undefined
        if (act?.service && act.path && act.method) {
          const back = (t.path ?? '/') + (Object.keys(t.query ?? {}).length ? `?${new URLSearchParams(Object.entries(t.query ?? {}).filter(([k, v]) => k !== 'error' && one(v) !== '').map(([k, v]) => [k, one(v)])).toString()}` : '')
          return (
            <form {...base} action={`/form-action/${act.service}${actionPath(act.path, row, act.params)}`} method="post">
              <input type="hidden" name="_method" value={act.method} />
              <input type="hidden" name="_back" value={back} />
              {body}
            </form>
          )
        }
        const action = link(p.href)
        return <form {...base} action={action} method="get" role={p.role === 'search' ? 'search' : undefined}>{body}</form>
      }
      const href = link(p.href)
      if (href && tag !== 'summary') return <a {...base} href={href}>{body}</a>
      const Tag = tag as any
      return <Tag {...base}>{body}</Tag>
    }
    case 'text': {
      const text = f(p.text)
      const href = link(p.href)
      if (href) return <a {...base} href={href}>{text}</a>
      const Tag = (TEXT_TAGS.has(String(p.tag)) ? String(p.tag) : 'p') as any
      return <Tag {...base}>{text}</Tag>
    }
    case 'image': {
      const raw = fill(p.src, row === SAMPLE ? undefined : row, false, t.query)
      const src = asset(raw === 'theme:logo' ? t.logo ?? '' : raw, t.assetBase)
      return src && !String(src).includes('{') ? <img {...base} src={String(src)} alt={f(p.alt)} loading={p.eager ? 'eager' : 'lazy'} /> : <div {...base} role="presentation" />

    }
    case 'video': {
      const src = asset(p.src, t.assetBase)
      return <video {...base} src={src ? String(src) : undefined} poster={p.poster ? String(asset(p.poster, t.assetBase)) : undefined} autoPlay={p.autoplay !== false} muted={p.muted !== false} loop={p.loop !== false} playsInline controls={!!p.controls} />
    }
    case 'button': {
      const icon = p.icon && t.icon ? t.icon({ name: String(p.icon), className: 'tsp-el-button-icon', 'aria-hidden': true }) : null
      const text = f(p.text)
      const inner = <>{icon}{text && <span>{text}</span>}</>
      if (p.disabled) base['aria-disabled'] = true
      if (p.opens) return <button {...base} type="button" disabled={!!p.disabled} popoverTarget={t.editing ? undefined : popId(String(p.opens), scope)}>{inner}</button>
      if (p.submit) return <button {...base} type="submit" disabled={!!p.disabled}>{inner}</button>
      const href = p.disabled ? undefined : link(p.href) ?? '#'
      return <a {...base} href={href}>{inner}</a>
    }
    case 'icon': {
      const name = fill(p.name, row === SAMPLE ? undefined : row, false, t.query)
      if (!t.icon || !name) return <span {...base} aria-hidden />
      return t.icon({ name, className: String(base.className), ...(p.label ? { 'aria-label': String(base['aria-label']) } : { 'aria-hidden': true }), ...(copy ? {} : { 'data-node': e.id }) })
    }
    case 'input': {
      const kind = INPUT_KINDS.has(String(p.kind)) ? String(p.kind) : 'text'
      const field = { ...base, name: p.name ? String(p.name) : undefined, placeholder: p.placeholder ? f(p.placeholder) : undefined, disabled: !!p.disabled, required: !!p.required, 'aria-label': (base['aria-label'] as string | undefined) ?? (p.placeholder ? String(p.placeholder) : undefined) }
      if (kind === 'textarea') return <textarea {...field} defaultValue={p.value === undefined ? undefined : f(p.value)} rows={Number(p.rows) || 4} />
      if (kind === 'checkbox' || kind === 'radio') return <input {...field} type={kind} defaultChecked={!!p.checked} value={p.value === undefined ? undefined : String(p.value)} />
      return <input {...field} type={kind} defaultValue={p.value === undefined ? undefined : f(p.value)} min={p.min as any} max={p.max as any} step={p.step as any} />
    }
    case 'select': {
      const options = String(p.options ?? '').split(',').map((x) => x.trim()).filter(Boolean)
      return <select {...base} name={p.name ? String(p.name) : undefined} defaultValue={p.value ? f(p.value) || undefined : undefined} disabled={!!p.disabled} aria-label={(base['aria-label'] as string) ?? (p.name ? String(p.name) : 'Choose')}>{options.map((o) => <option key={o} value={o}>{o}</option>)}</select>
    }
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

export function Tree({ root, theme, blocks, defaults = {}, data = {}, actions = {}, assetBase = '/assets/', icon, path, editing = false, query }: TreeProps) {
  return (
    <div className="tsp tsp-tree">
      <style>{treeCss(root, theme, assetBase)}</style>
      <Node e={root} t={{ blocks, defaults, data, actions, assetBase, icon, path, editing, query, logo: theme.logo }} />
    </div>
  )
}

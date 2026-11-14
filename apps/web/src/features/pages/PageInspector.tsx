import { useState } from 'react'
import { AlignCenter, AlignLeft, AlignRight, ArrowDown, ArrowRight, Copy, Group, ImagePlus, Trash2 } from 'lucide-react'
import type { ConfigValue, Page, StyleMap, UIElement } from '@tessery/core/domain/types'
import { find, themeOf } from '@tessery/core/domain/tree'
import { BLOCK_META } from '@tessery/core/render/catalog'
import { primaryKey, tableForOperation } from '@tessery/core/codegen/services/crud'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import { Button, Empty, Field, Input, NumberInput, Section, Select, Switch, Textarea } from '@/ui'
import { AssetPicker } from '@/features/assets/AssetPicker'
import ins from '@/features/design/Inspector.module.css'
import { elementLabel } from './Layers'
import { Choice, Color, Prop, type StyleCtx } from './StyleFields'
import { useBindableOps, useCurrentPage } from './usePage'
import f from './StyleFields.module.css'

const FONTS = ['system-ui', 'Inter', 'Geist', 'Manrope', 'DM Sans', 'Instrument Sans', 'Space Grotesk', 'Bricolage Grotesque', 'Sora', 'Archivo', 'IBM Plex Sans', 'Fraunces', 'Instrument Serif', 'Newsreader', 'Playfair Display', 'EB Garamond', 'JetBrains Mono', 'IBM Plex Mono']
const WEIGHTS = ['300', '400', '500', '600', '700', '800']
const SHADOWS: Record<string, string> = { none: 'none', soft: '0 1px 2px rgb(0 0 0 / 6%), 0 4px 12px rgb(0 0 0 / 6%)', lifted: '0 10px 30px -10px rgb(0 0 0 / 25%)', deep: '0 30px 60px -20px rgb(0 0 0 / 35%)' }

export function PageInspector() {
  const { page, device } = useCurrentPage()
  const { blockId, hover } = useUi((u) => u.pages)
  if (!page) return <Empty title="No page selected" />
  const el = blockId ? find(page.root, blockId)?.el : null
  return el && el.id !== page.root.id ? <ElementInspector page={page} el={el} device={device} hover={hover} /> : <PageSettings page={page} />
}

function ElementInspector({ page, el, device, hover }: { page: Page; el: UIElement; device: 'desktop' | 'tablet' | 'mobile'; hover: boolean }) {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const theme = themeOf(doc, page.appNodeId)
  const [picking, setPicking] = useState<null | 'src' | 'poster' | 'bg'>(null)
  const key = hover ? 'hover' : device === 'desktop' ? 'style' : device
  const inherited: StyleMap = hover ? { ...el.style } : device === 'desktop' ? {} : device === 'tablet' ? { ...el.style } : { ...el.style, ...el.tablet }
  const own: StyleMap = (el[key] ?? {}) as StyleMap
  const c: StyleCtx = { own, inherited, set: (k, v) => edit('updateElement', { pageId: page.id, elementId: el.id, patch: { [key]: { [k]: v } } }, { coalesce: `${el.id}:${key}:${k}` }) }
  const v = (k: string) => own[k] ?? inherited[k]
  const prop = (k: string, value: ConfigValue | null, coalesce = true) => edit('updateElement', { pageId: page.id, elementId: el.id, patch: { props: { [k]: value } } }, coalesce ? { coalesce: `${el.id}:props:${k}` } : {})
  const isFrame = el.type === 'frame'
  const display = String(v('display') ?? (isFrame ? 'block' : ''))
  const typed = el.type === 'text' || el.type === 'button' || isFrame
  const where = hover ? 'the hover state' : device === 'desktop' ? 'all screens' : device === 'tablet' ? 'tablets and phones' : 'phones'

  return (
    <div className={ins.wrap}>
      <div className={ins.title}><span className={ins.glyph}>{el.type.slice(0, 3)}</span><div><b>{elementLabel(el)}</b><span>Styles apply to {where}</span></div></div>
      <Content page={page} el={el} prop={prop} pick={setPicking} />
      {isFrame && (
        <Section title="Layout">
          <div className={f.stack}>
            <Prop label="Display" k="display" c={c}><Choice k="display" c={c} options={[{ value: 'flex', label: 'Flex' }, { value: 'grid', label: 'Grid' }, { value: 'block', label: 'Block' }, { value: 'none', label: 'Hide' }]} /></Prop>
            {display === 'flex' && <>
              <Prop label="Direction" k="flexDirection" c={c}><Choice k="flexDirection" c={c} options={[{ value: 'row', label: <ArrowRight />, title: 'Row' }, { value: 'column', label: <ArrowDown />, title: 'Column' }, { value: 'row-reverse', label: '⇠', title: 'Row reversed' }, { value: 'column-reverse', label: '⇡', title: 'Column reversed' }]} /></Prop>
              <Prop label="Align" k="alignItems" c={c}><Choice k="alignItems" c={c} options={['flex-start', 'center', 'flex-end', 'stretch', 'baseline'].map((x) => ({ value: x, label: x.replace('flex-', '').slice(0, 5) }))} /></Prop>
              <Prop label="Justify" k="justifyContent" c={c}><Choice k="justifyContent" c={c} options={['flex-start', 'center', 'flex-end', 'space-between'].map((x) => ({ value: x, label: x.replace('flex-', '').replace('space-', '').slice(0, 7) }))} /></Prop>
              <Prop label="Wrap" k="flexWrap" c={c}><Choice k="flexWrap" c={c} options={[{ value: 'nowrap', label: 'No' }, { value: 'wrap', label: 'Wrap' }]} /></Prop>
            </>}
            {display === 'grid' && <>
              <Prop label="Columns" k="gridTemplateColumns" c={c} placeholder="repeat(3, minmax(0, 1fr))" />
              <Prop label="Rows" k="gridTemplateRows" c={c} placeholder="auto" />
              <Prop label="Align" k="alignItems" c={c}><Choice k="alignItems" c={c} options={['start', 'center', 'end', 'stretch'].map((x) => ({ value: x, label: x }))} /></Prop>
            </>}
            {(display === 'flex' || display === 'grid') && <Prop label="Gap" k="gap" c={c} placeholder="0" />}
          </div>
        </Section>
      )}
      <Section title="Position" defaultOpen={v('position') === 'absolute'}>
        <div className={f.stack}>
          <Prop label="Position" k="position" c={c}><Choice k="position" c={c} options={[{ value: 'static', label: 'Flow' }, { value: 'relative', label: 'Relative' }, { value: 'absolute', label: 'Free' }, { value: 'sticky', label: 'Sticky' }]} /></Prop>
          {(v('position') === 'absolute' || v('position') === 'relative' || v('position') === 'sticky') && <>
            <Prop label="Left" k="left" c={c} /><Prop label="Top" k="top" c={c} /><Prop label="Right" k="right" c={c} /><Prop label="Bottom" k="bottom" c={c} />
          </>}
          <Prop label="Layer" k="zIndex" c={c} placeholder="auto" />
          <Prop label="Grid span" k="gridColumn" c={c} placeholder="span 2" />
          <Prop label="Align self" k="alignSelf" c={c}><Choice k="alignSelf" c={c} options={['auto', 'flex-start', 'center', 'flex-end', 'stretch'].map((x) => ({ value: x, label: x.replace('flex-', '').slice(0, 5) }))} /></Prop>
        </div>
      </Section>
      <Section title="Size">
        <div className={f.stack}>
          <Prop label="Width" k="width" c={c} placeholder="auto" /><Prop label="Height" k="height" c={c} placeholder="auto" />
          <Prop label="Min height" k="minHeight" c={c} /><Prop label="Max width" k="maxWidth" c={c} />
          <Prop label="Aspect" k="aspectRatio" c={c} placeholder="16 / 9" />
          {(el.type === 'image' || el.type === 'video') && <Prop label="Fit" k="objectFit" c={c}><Choice k="objectFit" c={c} options={['cover', 'contain', 'fill'].map((x) => ({ value: x, label: x }))} /></Prop>}
          <Prop label="Grow" k="flexGrow" c={c} placeholder="0" />
        </div>
      </Section>
      <Section title="Spacing">
        <div className={f.stack}><Prop label="Padding" k="padding" c={c} placeholder="24 or 24px 32px" /><Prop label="Margin" k="margin" c={c} placeholder="0 auto" /></div>
      </Section>
      {typed && (
        <Section title="Type">
          <div className={f.stack}>
            <Prop label="Font" k="fontFamily" c={c} list="tsp-fonts" placeholder="from the theme" />
            <datalist id="tsp-fonts"><option value="var(--font-heading)" /><option value="var(--font-body)" />{FONTS.map((x) => <option key={x} value={x} />)}</datalist>
            <Prop label="Size" k="fontSize" c={c} placeholder="16" />
            <Prop label="Weight" k="fontWeight" c={c}><Choice k="fontWeight" c={c} options={WEIGHTS.map((w) => ({ value: w, label: w }))} /></Prop>
            <Prop label="Line height" k="lineHeight" c={c} placeholder="1.5" />
            <Prop label="Tracking" k="letterSpacing" c={c} placeholder="0" />
            <Prop label="Align" k="textAlign" c={c}><Choice k="textAlign" c={c} options={[{ value: 'left', label: <AlignLeft /> }, { value: 'center', label: <AlignCenter /> }, { value: 'right', label: <AlignRight /> }]} /></Prop>
            <Prop label="Case" k="textTransform" c={c}><Choice k="textTransform" c={c} options={[{ value: 'none', label: 'Aa' }, { value: 'uppercase', label: 'AA' }, { value: 'lowercase', label: 'aa' }]} /></Prop>
            <Prop label="Color" k="color" c={c}><Color k="color" c={c} colors={theme.colors} /></Prop>
          </div>
        </Section>
      )}
      <Section title={el.type === 'path' ? 'Fill and stroke' : 'Fill'}>
        <div className={f.stack}>
          {el.type === 'path' ? <>
            <Prop label="Fill" k="fill" c={c}><Color k="fill" c={c} colors={theme.colors} /></Prop>
            <Prop label="Stroke" k="stroke" c={c}><Color k="stroke" c={c} colors={theme.colors} /></Prop>
            <Prop label="Stroke width" k="strokeWidth" c={c} placeholder="2" />
          </> : <>
            <Prop label="Background" k="background" c={c}><Color k="background" c={c} colors={theme.colors} /></Prop>
            <Prop label="Image" k="backgroundImage" c={c}>
              <div style={{ display: 'flex', gap: 4 }}><Input mono value={String(own.backgroundImage ?? '')} onCommit={(x) => c.set('backgroundImage', x || null)} placeholder="linear-gradient(...)" /><Button size="sm" icon={<ImagePlus />} aria-label="Background image" onClick={() => setPicking('bg')} /></div>
            </Prop>
            {v('backgroundImage') !== undefined && <Prop label="Image size" k="backgroundSize" c={c}><Choice k="backgroundSize" c={c} options={['cover', 'contain', 'auto'].map((x) => ({ value: x, label: x }))} /></Prop>}
          </>}
          <Prop label="Opacity" k="opacity" c={c} placeholder="1" />
        </div>
      </Section>
      <Section title="Border and shadow" defaultOpen={false}>
        <div className={f.stack}>
          <Prop label="Radius" k="borderRadius" c={c} placeholder="0" />
          <Prop label="Border" k="border" c={c} placeholder="1px solid var(--c-border)" />
          <Prop label="Shadow" k="boxShadow" c={c}><Choice k="boxShadow" c={c} options={Object.entries(SHADOWS).map(([n, x]) => ({ value: x, label: n }))} /></Prop>
        </div>
      </Section>
      <Section title="Effects" defaultOpen={false}>
        <div className={f.stack}>
          <Prop label="Transform" k="transform" c={c} placeholder="rotate(-4deg)" />
          <Prop label="Blur" k="filter" c={c} placeholder="blur(8px)" />
          <Prop label="Glass" k="backdropFilter" c={c} placeholder="blur(16px) saturate(1.4)" />
          <Prop label="Blend" k="mixBlendMode" c={c} placeholder="normal" />
          <Prop label="Transition" k="transition" c={c} placeholder="all .2s ease" />
          <Prop label="Overflow" k="overflow" c={c}><Choice k="overflow" c={c} options={['visible', 'hidden', 'auto'].map((x) => ({ value: x, label: x }))} /></Prop>
        </div>
      </Section>
      <div className={ins.actions}>
        <Button size="sm" icon={<Copy />} onClick={() => { const id = edit('duplicateElement', { pageId: page.id, elementId: el.id }); if (id) dispatch(ui.setPages({ blockId: id })) }}>Duplicate</Button>
        <Button size="sm" icon={<Group />} onClick={() => { const id = edit('groupElements', { pageId: page.id, elementIds: [el.id] }); if (id) dispatch(ui.setPages({ blockId: id })) }}>Wrap in frame</Button>
        <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => { edit('removeElement', { pageId: page.id, elementId: el.id }); dispatch(ui.setPages({ blockId: null })) }}>Delete</Button>
      </div>
      <AssetPicker pid={doc.id} open={picking !== null} accept={picking === 'src' && el.type === 'video' ? 'video' : 'image'} onClose={() => setPicking(null)}
        onPick={(a) => { if (picking === 'bg') { c.set('backgroundImage', a.reference); if (!v('backgroundSize')) c.set('backgroundSize', 'cover') } else if (picking) prop(picking, a.reference, false) }} />
    </div>
  )
}

function Content({ page, el, prop, pick }: { page: Page; el: UIElement; prop: (k: string, v: ConfigValue | null, coalesce?: boolean) => void; pick: (k: 'src' | 'poster') => void }) {
  const ops = useBindableOps()
  const doc = useDoc()
  const edit = useEdit()
  const p = el.props
  const str = (k: string) => String(p[k] ?? '')
  switch (el.type) {
    case 'text':
      return <Section title="Text"><Field label="Text"><Textarea value={str('text')} onChange={(x) => prop('text', x)} /></Field>
        <Field label="Tag"><Select value={str('tag') || 'p'} onChange={(x) => prop('tag', x, false)} aria-label="Tag" options={['h1', 'h2', 'h3', 'h4', 'p', 'span', 'small', 'strong', 'blockquote', 'label', 'code'].map((x) => ({ value: x, label: x }))} /></Field></Section>
    case 'button':
      return <Section title="Button"><Field label="Label"><Input value={str('text')} onChange={(x) => prop('text', x)} /></Field><Field label="Link"><Input mono value={str('href')} onChange={(x) => prop('href', x)} placeholder="/pricing or https://…" /></Field></Section>
    case 'image':
    case 'video':
      return (
        <Section title={el.type === 'image' ? 'Image' : 'Video'}>
          <Field label="Source"><div style={{ display: 'flex', gap: 4, width: '100%' }}><Input mono value={str('src')} onCommit={(x) => prop('src', x, false)} placeholder="asset or https://…" /><Button size="sm" icon={<ImagePlus />} aria-label="Choose from assets" onClick={() => pick('src')} /></div></Field>
          {el.type === 'image' && <Field label="Alt text"><Input value={str('alt')} onChange={(x) => prop('alt', x)} placeholder="Describe the image" /></Field>}
          {el.type === 'video' && <>
            <Field label="Poster"><div style={{ display: 'flex', gap: 4, width: '100%' }}><Input mono value={str('poster')} onCommit={(x) => prop('poster', x, false)} /><Button size="sm" icon={<ImagePlus />} aria-label="Choose a poster" onClick={() => pick('poster')} /></div></Field>
            {(['autoplay', 'loop', 'muted', 'controls'] as const).map((k) => <Field key={k} label={k}><Switch checked={k === 'controls' ? !!p[k] : p[k] !== false} onChange={(x) => prop(k, x, false)} /></Field>)}
          </>}
        </Section>
      )
    case 'embed':
      return <Section title="Embed"><Field label="URL"><Input mono value={str('src')} onCommit={(x) => prop('src', x, false)} placeholder="https://www.youtube.com/embed/…" /></Field><Field label="Title"><Input value={str('title')} onChange={(x) => prop('title', x)} /></Field></Section>
    case 'frame':
      return <Section title="Frame" defaultOpen={false}><Field label="Tag"><Select value={str('tag') || 'div'} onChange={(x) => prop('tag', x, false)} aria-label="Tag" options={['div', 'section', 'header', 'footer', 'nav', 'main', 'article', 'aside', 'figure'].map((x) => ({ value: x, label: x }))} /></Field><Field label="Link" hint="Makes the whole frame a link, for cards."><Input mono value={str('href')} onChange={(x) => prop('href', x)} placeholder="none" /></Field></Section>
    case 'block': {
      const meta = BLOCK_META[str('block')]
      const props = { ...meta?.defaults, ...p }
      const fill = (k: 'source' | 'action', binding: string) => {
        const [nodeId, opName] = binding.split(':')
        const hit = nodeId && opName ? tableForOperation(doc, nodeId, opName) : undefined
        if (!hit) return
        const pk = primaryKey(hit.table)?.name
        const title = (x: string) => x.replace(/_/g, ' ').replace(/^\w/, (y) => y.toUpperCase())
        if (k === 'source' && 'columns' in props && hit.action === 'list') prop('columns', hit.table.columns.map((x) => x.name).filter((x) => x !== pk).map(title).join(', '), false)
        if (k === 'action' && 'fields' in props && (hit.action === 'create' || hit.action === 'update')) prop('fields', hit.table.columns.filter((x) => x.name !== pk && !x.default && x.name !== hit.parent?.column).map((x) => title(x.name)).join(', '), false)
      }
      return (
        <>
          <Section title={meta?.label ?? 'Block'}>
            {Object.entries(props).filter(([k]) => k !== 'block' && k !== 'source' && k !== 'action').map(([k, val]) => (
              <Field key={k} label={k}>
                {typeof val === 'boolean' ? <Switch checked={val} onChange={(x) => prop(k, x, false)} /> : typeof val === 'number' ? <NumberInput value={val} min={1} max={48} onCommit={(x) => prop(k, x, false)} />
                  : ['body', 'sub', 'items', 'quote', 'tiers'].includes(k) ? <Textarea value={String(val)} onChange={(x) => prop(k, x)} /> : <Input value={String(val)} onChange={(x) => prop(k, x)} />}
              </Field>
            ))}
          </Section>
          {meta?.dataKeys && (
            <Section title="Data">
              {meta.dataKeys.map((k) => (
                <Field key={k} label={k === 'source' ? 'Reads from' : 'Submits to'}>
                  <Select value={String(p[k] ?? '')} onChange={(x) => { edit('updateElement', { pageId: page.id, elementId: el.id, patch: { props: { [k]: x || null } } }); if (x) fill(k, x) }} aria-label={k === 'source' ? 'Reads from' : 'Submits to'}
                    options={[{ value: '', label: 'Not bound' }, ...ops.map((o) => ({ value: o.key, label: o.label, group: o.style.toUpperCase() }))]} />
                </Field>
              ))}
            </Section>
          )}
        </>
      )
    }
    default:
      return null
  }
}

function PageSettings({ page }: { page: Page }) {
  const edit = useEdit()
  const doc = useDoc()
  const theme = themeOf(doc, page.appNodeId)
  const up = (patch: Parameters<typeof edit<'updatePage'>>[1]['patch']) => edit('updatePage', { pageId: page.id, patch })
  const setColor = (name: string, value: string) => edit('setTheme', { appNodeId: page.appNodeId, colors: { [name]: value } }, { coalesce: `theme:${page.appNodeId}:${name}` })
  const app = doc.nodes.find((n) => n.id === page.appNodeId)
  return (
    <div className={ins.wrap}>
      <div className={ins.title}><span className={ins.glyph}>pg</span><div><b>{page.name}</b><span>{page.route}</span></div></div>
      <Section title="Page">
        <Field label="Name"><Input value={page.name} onCommit={(x) => up({ name: x })} /></Field>
        <Field label="Route"><Input mono value={page.route} onCommit={(x) => up({ route: x.startsWith('/') ? x : `/${x}` })} /></Field>
        <Field label="Rendering"><Select value={page.render} onChange={(x) => up({ render: x })} aria-label="Rendering" options={[{ value: 'ssr', label: 'SSR, per request' }, { value: 'ssg', label: 'SSG, build time' }, { value: 'isr', label: 'ISR, revalidate 60s' }, { value: 'csr', label: 'CSR, client only' }]} /></Field>
        <Field label="Access"><Select value={page.access} onChange={(x) => up({ access: x })} aria-label="Access" options={[{ value: 'public', label: 'public' }, { value: 'user', label: 'signed-in users' }, { value: 'admin', label: 'admins' }]} /></Field>
        <Field label="Title" hint="Shown in the browser tab and search results."><Input value={page.title} onCommit={(x) => up({ title: x })} /></Field>
      </Section>
      <Section title={`Theme · ${app?.name ?? ''}`}>
        <div className="muted" style={{ fontSize: 11, marginBottom: 6 }}>Every page of this app uses it. Elements refer to these as var(--c-name).</div>
        <div className={f.stack}>
          {Object.entries(theme.colors).map(([name, value]) => (
            <label key={name} className={f.row}>
              <span className={f.label}>{name}</span>
              <div className={f.color}><span className={f.swatch} style={{ background: value }}><input type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#000000'} onChange={(e) => setColor(name, e.target.value)} aria-label={`${name} color`} /></span>
                <input className={f.input} defaultValue={value} key={value} onBlur={(e) => e.target.value !== value && setColor(name, e.target.value)} /></div>
              <span />
            </label>
          ))}
          <label className={f.row}><span className={f.label}>Heading font</span><input className={f.input} list="tsp-theme-fonts" defaultValue={theme.fonts.heading} key={`h${theme.fonts.heading}`} onBlur={(e) => edit('setTheme', { appNodeId: page.appNodeId, fonts: { heading: e.target.value.trim() || 'system-ui' } })} /><span /></label>
          <label className={f.row}><span className={f.label}>Body font</span><input className={f.input} list="tsp-theme-fonts" defaultValue={theme.fonts.body} key={`b${theme.fonts.body}`} onBlur={(e) => edit('setTheme', { appNodeId: page.appNodeId, fonts: { body: e.target.value.trim() || 'system-ui' } })} /><span /></label>
          <datalist id="tsp-theme-fonts">{FONTS.map((x) => <option key={x} value={x} />)}</datalist>
          <label className={f.row}><span className={f.label}>Radius</span><input className={f.input} defaultValue={theme.radius} key={`r${theme.radius}`} onBlur={(e) => edit('setTheme', { appNodeId: page.appNodeId, radius: Math.max(0, Number(e.target.value) || 0) })} /><span /></label>
        </div>
      </Section>
    </div>
  )
}

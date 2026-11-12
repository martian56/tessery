import { Copy, Trash2 } from 'lucide-react'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import type { ApiStyle, Operation } from '@tessery/core/domain/types'
import { API_STYLE_META, LANGUAGES, frameworksFor } from '@tessery/core/catalog/languages'
import { Button, Empty, Field, Input, Section, Select, Textarea } from '@/ui'
import { KIND_OPTIONS, isPathStyle } from './apiMeta'
import s from '@/features/design/Inspector.module.css'

export function ApiInspector() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const doc = useDoc()
  const cur = useUi((u) => u.api)
  const spec = (cur.nodeId && doc.apis[cur.nodeId]) || Object.values(doc.apis)[0]
  if (!spec) return <Empty title="Nothing selected" />
  const node = doc.nodes.find((n) => n.id === spec.nodeId)!
  const op = spec.operations.find((o) => o.id === cur.opId) ?? spec.operations[0]
  const up = (patch: Partial<Operation>, coalesce?: string) => op && edit('updateOperation', { nodeId: spec.nodeId, opId: op.id, patch }, { coalesce })
  const typeNames = spec.types.map((t) => t.name)
  const pathStyle = isPathStyle(spec.style)
  const [method, path] = op ? op.kind.split(' ') : ['', '']
  const wsDir = spec.style === 'websocket' && op ? op.kind.split(' ')[0] : ''
  const wsEvent = spec.style === 'websocket' && op ? op.kind.split(' ').slice(1).join(' ') : ''
  const fws = frameworksFor(spec.language, spec.style)

  return (
    <div className={s.wrap}>
      {op ? <>
        <div className={s.title}><span className={s.glyph}>{pathStyle ? method : spec.style === 'grpc' ? 'rpc' : op.kind.slice(0, 4)}</span><div><b>{op.name}</b><span>{node.name} · {API_STYLE_META[spec.style].label}</span></div></div>
        <Section title="Operation">
          {pathStyle && <>
            <Field label="Method"><Select value={method} onChange={(m) => up({ kind: `${m} ${path}` })} options={KIND_OPTIONS[spec.style].map((k) => ({ value: k, label: k }))} /></Field>
            <Field label="Path"><Input mono value={path} onCommit={(p) => up({ kind: `${method} ${p.startsWith('/') ? p : `/${p}`}` })} /></Field>
          </>}
          {(spec.style === 'graphql' || spec.style === 'trpc') && <Field label="Type"><Select value={op.kind} onChange={(k) => up({ kind: k, streaming: k === 'subscription' ? 'server' : 'none' })} options={KIND_OPTIONS[spec.style].map((k) => ({ value: k, label: k }))} /></Field>}
          {spec.style === 'websocket' && <>
            <Field label="Direction"><Select value={wsDir} onChange={(d) => up({ kind: `${d} ${wsEvent}` })} options={[{ value: 'join', label: 'join (client → channel)' }, { value: 'push', label: 'push (client → server)' }, { value: 'event', label: 'event (server → client)' }]} /></Field>
            <Field label="Event"><Input mono value={wsEvent} onCommit={(v) => up({ kind: `${wsDir} ${v}` })} /></Field>
          </>}
          <Field label="Name"><Input mono value={op.name} onCommit={(v) => up({ name: v.replace(/\s+/g, '') || op.name })} /></Field>
          <Field label="Summary"><Input value={op.summary} onChange={(v) => up({ summary: v }, `sum:${op.id}`)} /></Field>
          <Field label="Auth"><Select value={op.auth} onChange={(v) => up({ auth: v })} options={(['public', 'user', 'admin', 'service', 'api-key'] as const).map((a) => ({ value: a, label: a }))} /></Field>
        </Section>
        <Section title="Payload">
          <Field label={spec.style === 'graphql' ? 'Arguments' : 'Input'} hint={spec.style === 'graphql' ? 'e.g. id: ID!, first: Int' : undefined}>
            {spec.style === 'graphql' ? <Input mono value={op.input ?? ''} onCommit={(v) => up({ input: v || undefined })} />
              : <Select value={op.input ?? ''} onChange={(v) => up({ input: v || undefined })} options={[{ value: '', label: 'None' }, ...typeNames.map((t) => ({ value: t, label: t })), ...(op.input && !typeNames.includes(op.input) ? [{ value: op.input, label: op.input }] : [])]} />}
          </Field>
          <Field label="Output">
            <Select value={op.output ?? ''} onChange={(v) => up({ output: v || undefined })} options={[{ value: '', label: 'None' }, ...typeNames.flatMap((t) => [{ value: t, label: t }, { value: spec.style === 'graphql' ? `[${t}!]!` : `${t}[]`, label: `list of ${t}` }]), ...(op.output && !typeNames.some((t) => op.output!.includes(t)) ? [{ value: op.output, label: op.output }] : [])]} />
          </Field>
          {(spec.style === 'grpc' || spec.style === 'sse' || spec.style === 'websocket') && <Field label="Streaming"><Select value={op.streaming ?? 'none'} onChange={(v) => up({ streaming: v })} options={(['none', 'server', 'client', 'bidi'] as const).map((x) => ({ value: x, label: x }))} /></Field>}
        </Section>
        <Section title="Policies">
          <Field label="Rate limit"><Input mono value={op.rateLimit ?? ''} placeholder="e.g. 100/min" onCommit={(v) => up({ rateLimit: v || undefined })} /></Field>
          <Field label="Cache"><Select value={op.cache ?? 'none'} onChange={(v) => up({ cache: v === 'none' ? undefined : v })} options={['none', '15s', '30s', '60s', '5m', '1h'].map((x) => ({ value: x, label: x }))} /></Field>
        </Section>
        <div className={s.actions}>
          <Button size="sm" icon={<Copy />} onClick={() => { const id = edit('duplicateOperation', { nodeId: spec.nodeId, opId: op.id }); dispatch(ui.setApi({ opId: id ?? null })) }}>Duplicate</Button>
          <Button size="sm" variant="danger" icon={<Trash2 />} onClick={() => { edit('removeOperation', { nodeId: spec.nodeId, opId: op.id }); dispatch(ui.setApi({ opId: null })) }}>Delete</Button>
        </div>
      </> : <div className={s.title}><span className={s.glyph}>api</span><div><b>{node.name}</b><span>No operations yet</span></div></div>}
      <Section title="Service">
        <Field label="Style"><Select value={spec.style} onChange={(v) => edit('updateApi', { nodeId: spec.nodeId, patch: { style: v, framework: frameworksFor(spec.language, v)[0]?.name ?? spec.framework } })} options={(Object.keys(API_STYLE_META) as ApiStyle[]).map((k) => ({ value: k, label: API_STYLE_META[k].label }))} /></Field>
        <Field label="Language"><Select value={spec.language} onChange={(v) => edit('updateApi', { nodeId: spec.nodeId, patch: { language: v, framework: frameworksFor(v, spec.style)[0]?.name ?? spec.framework } })} options={LANGUAGES.map((l) => ({ value: l.id, label: l.name, disabled: !frameworksFor(l.id, spec.style).length }))} /></Field>
        <Field label="Framework">{fws.length ? <Select value={spec.framework} onChange={(v) => edit('updateApi', { nodeId: spec.nodeId, patch: { framework: v } })} options={fws.map((f) => ({ value: f.name, label: f.name }))} /> : <Input value={spec.framework} onCommit={(v) => edit('updateApi', { nodeId: spec.nodeId, patch: { framework: v } })} />}</Field>
        <Field label={spec.style === 'grpc' ? 'Service' : 'Base path'}><Input mono value={spec.basePath} onCommit={(v) => edit('updateApi', { nodeId: spec.nodeId, patch: { basePath: v } })} /></Field>
        {node.notes !== undefined && <Field label="Notes" wide><Textarea value={node.notes} onCommit={(v) => edit('updateNode', { id: node.id, patch: { notes: v } })} /></Field>}
      </Section>
    </div>
  )
}

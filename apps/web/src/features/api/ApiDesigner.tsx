import { useMemo, useState } from 'react'
import { ArrowLeft, ArrowRight, Braces, Copy, Network, Play, Plus, Trash2, X } from 'lucide-react'
import clsx from 'clsx'
import { useAppDispatch, useDoc, useEdit, useUi } from '@/store'
import { ui } from '@/store/uiSlice'
import type { ApiSpec, SystemNode, Operation, ProjectDoc, TypeDef } from '@tessery/core/domain/types'
import { API_STYLE_META } from '@tessery/core/catalog/languages'
import { Badge, Button, Checkbox, CodeView, DropdownMenu, Empty, Input, Segmented, Toolbar, Spacer, Tooltip, Select, type MenuEntry } from '@/ui'
import { graphqlSchema, openapi, protoFile, serviceFiles } from '@tessery/core/codegen/backend'
import { useLiveResult } from '@/features/live/useLiveSimulation'
import { fmtMs } from '@/lib/format'
import { STEP_TEMPLATES, exampleFor, isPathStyle, newOperation, opView } from './apiMeta'
import s from './Api.module.css'

export function ApiDesigner() {
  const dispatch = useAppDispatch()
  const doc = useDoc()
  const cur = useUi((u) => u.api)
  const spec = (cur.nodeId && doc.apis[cur.nodeId]) || Object.values(doc.apis)[0]
  if (!spec) return <Empty icon={<Network />} title="No APIs in this project">Add a <b>Service</b> on the Design canvas and it gets an API you can design here (REST, GraphQL, gRPC, WebSocket, tRPC, SSE, webhooks).</Empty>
  const node = doc.nodes.find((n) => n.id === spec.nodeId)!
  const st = API_STYLE_META[spec.style]
  return (
    <div className={s.center}>
      <Toolbar>
        <b className={s.h}>{node.name}</b>
        <Badge color={st.color}>{st.label}</Badge>
        <span className="muted mono" style={{ fontSize: 11 }}>{spec.language} · {spec.framework} · {spec.basePath}</span>
        <Spacer />
        <Segmented value={cur.tab} onChange={(v) => dispatch(ui.setApi({ tab: v }))} options={[{ value: 'operations', label: `Operations · ${spec.operations.length}` }, { value: 'types', label: `Types · ${spec.types.length}` }, { value: 'schema', label: 'Contract' }]} />
      </Toolbar>
      <div className={s.body}>
        {cur.tab === 'types' ? <TypesView spec={spec} /> : cur.tab === 'schema' ? <ContractView spec={spec} /> : <OperationsView spec={spec} />}
      </div>
    </div>
  )
}

function OperationsView({ spec }: { spec: ApiSpec }) {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const cur = useUi((u) => u.api)
  const op = spec.operations.find((o) => o.id === cur.opId) ?? spec.operations[0]
  return (
    <div className={s.opsView}>
      <div className={s.table}>
        {spec.operations.map((o) => {
          const v = opView(spec.style, o)
          return (
            <button key={o.id} className={clsx(s.tr, op?.id === o.id && s.on)} onClick={() => dispatch(ui.setApi({ opId: o.id }))}>
              <span className={s.method} style={{ background: v.color }}>{v.badge}</span>
              <span className={s.path}>{v.title.split(/(\{\w+\})/).map((p, i) => (p.startsWith('{') ? <em key={i}>{p}</em> : p))}</span>
              <span className={s.summary}>{o.summary}</span>
              <span className={s.auth}>{o.auth}</span>
              {o.streaming && o.streaming !== 'none' && <Badge tone="info">{o.streaming} stream</Badge>}
            </button>
          )
        })}
        <button className={s.addRow} onClick={() => { const id = edit('addOperation', { nodeId: spec.nodeId, ...newOperation(spec) }); dispatch(ui.setApi({ opId: id ?? null })) }}><Plus size={13} /> Add operation</button>
      </div>
      {op ? <>
        <HandlerFlow spec={spec} op={op} />
        <TryIt spec={spec} op={op} />
      </> : <Empty title="No operations">Add one to start designing the contract.</Empty>}
    </div>
  )
}

function HandlerFlow({ spec, op }: { spec: ApiSpec; op: Operation }) {
  const edit = useEdit()
  const [editing, setEditing] = useState<number | null>(null)
  const set = (steps: string[]) => edit('setSteps', { nodeId: spec.nodeId, opId: op.id, steps })
  const insert = (step: string, at = op.steps.length) => { const s2 = [...op.steps]; s2.splice(at, 0, step); set(s2) }
  const menu: MenuEntry[] = Object.entries(STEP_TEMPLATES).map(([g, items]) => ({ kind: 'sub' as const, label: g, items: items.map((it) => ({ label: it, onSelect: () => insert(it) })) }))
  return (
    <section className={s.block}>
      <div className={s.blockHead}>Handler flow<span className="muted">what happens when {opView(spec.style, op).title} is called</span></div>
      <div className={s.flow}>
        {op.steps.map((st, i) => (
          <div key={`${i}-${st}`} className={s.stepWrap}>
            {i > 0 && <span className={s.arrow} />}
            <div className={clsx(s.step, editing === i && s.editing)} onDoubleClick={() => setEditing(i)}>
              {editing === i ? (
                <Input autoFocus value={st} mono onCommit={(v) => { const s2 = [...op.steps]; s2[i] = v.trim() || st; set(s2); setEditing(null) }} onBlur={() => setEditing(null)} />
              ) : <>
                <span className={s.stepOp}>{st.split(' ')[0]}</span>
                <span className={s.stepArg}>{st.split(' ').slice(1).join(' ') || '-'}</span>
                <span className={s.stepTools}>
                  <button aria-label="Move left" onClick={() => { if (!i) return; const s2 = [...op.steps]; [s2[i - 1], s2[i]] = [s2[i], s2[i - 1]]; set(s2) }}><ArrowLeft size={11} /></button>
                  <button aria-label="Move right" onClick={() => { if (i === op.steps.length - 1) return; const s2 = [...op.steps]; [s2[i + 1], s2[i]] = [s2[i], s2[i + 1]]; set(s2) }}><ArrowRight size={11} /></button>
                  <button aria-label="Remove step" onClick={() => set(op.steps.filter((_, j) => j !== i))}><X size={11} /></button>
                </span>
              </>}
            </div>
          </div>
        ))}
        <span className={s.arrow} />
        <DropdownMenu trigger={<button className={s.addStep}><Plus size={12} /> step</button>} items={menu} />
      </div>
      <div className="muted" style={{ fontSize: 11 }}>Double-click a step to edit. Steps become code in the generated handler.</div>
    </section>
  )
}

function TryIt({ spec, op }: { spec: ApiSpec; op: Operation }) {
  const doc = useDoc()
  const live = useLiveResult()
  const [sent, setSent] = useState<{ at: number; latency: number; status: number } | null>(null)
  const node = doc.nodes.find((n) => n.id === spec.nodeId)!
  const req = useMemo(() => {
    if (isPathStyle(spec.style)) { const [m, p] = op.kind.split(' '); return `curl -X ${m} https://api.${doc.name}.dev${(p ?? '').replace(/\{(\w+)\}/g, (_, k: string) => (k === 'slug' ? 'example' : '3f2a9c'))}${op.auth === 'api-key' ? " \\\n  -H 'X-API-Key: $KEY'" : op.auth !== 'public' ? " \\\n  -H 'Authorization: Bearer $TOKEN'" : ''}${['POST', 'PUT', 'PATCH'].includes(m) ? ` \\\n  -d '${JSON.stringify(exampleFor(op.input, spec.types))}'` : ''}` }
    if (spec.style === 'graphql') return `${op.kind} {\n  ${op.name}${op.input ? `(${op.input.split(',').map((a) => `${a.trim().split(':')[0]}: …`).join(', ')})` : ''} {\n    id\n  }\n}`
    if (spec.style === 'grpc') return `grpcurl -d '${JSON.stringify(exampleFor(op.input, spec.types))}' api.${doc.name}.dev:443 ${spec.basePath}/${op.name}`
    if (spec.style === 'websocket') return `wscat -c wss://api.${doc.name}.dev${spec.basePath}\n> ${JSON.stringify({ event: op.kind.split(' ').slice(1).join(' '), payload: {} })}`
    return `${op.kind} ${op.name}`
  }, [spec, op, doc.name])
  const status = op.kind.startsWith('POST') ? 201 : op.kind.startsWith('DELETE') ? 204 : 200
  const res = status === 204 ? null : spec.style === 'graphql' ? { data: { [op.name]: exampleFor(op.output, spec.types) } } : exampleFor(op.output, spec.types)
  const l = live?.nodes[node.id]
  const send = () => {
    const err = l ? Math.random() * 100 < l.errorRate || l.down : false
    setSent({ at: Date.now(), latency: Math.round((l ? l.latency : 20 + op.steps.length * 6) * (0.8 + Math.random() * 0.4)), status: err ? (l?.down ? 503 : 500) : status })
  }
  return (
    <section className={s.block}>
      <div className={s.blockHead}>Try it<span className="muted">example request and response from the contract</span><Spacer /><Button size="xs" variant="primary" icon={<Play />} onClick={send}>Send</Button></div>
      <div className={s.tryGrid}>
        <div className={s.codeBox}><div className={s.codeHead}>request</div><CodeView code={req} lang="ts" /></div>
        <div className={s.codeBox}>
          <div className={s.codeHead}>response{sent && <><Badge tone={sent.status < 400 ? 'ok' : 'err'} mono>{sent.status}</Badge><span className="mono">{fmtMs(sent.latency)}</span>{l && <span className="muted">(live simulation)</span>}</>}</div>
          <CodeView code={sent && sent.status >= 500 ? JSON.stringify({ error: sent.status === 503 ? 'Service Unavailable' : 'Internal Server Error', service: node.name }, null, 2) : res === null ? '(no content)' : JSON.stringify(res, null, 2)} lang="ts" />
        </div>
      </div>
    </section>
  )
}

function TypesView({ spec }: { spec: ApiSpec }) {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const cur = useUi((u) => u.api)
  const t = spec.types.find((x) => x.id === cur.typeId) ?? spec.types[0]
  const known = ['ID', 'String', 'Int', 'Float', 'Boolean', 'DateTime', ...spec.types.map((x) => x.name)]
  const upFields = (fields: TypeDef['fields']) => t && edit('updateType', { nodeId: spec.nodeId, typeId: t.id, patch: { fields } })
  return (
    <div className={s.typesView}>
      <div className={s.typeList}>
        {spec.types.map((x) => (
          <button key={x.id} className={clsx(s.typeRow, t?.id === x.id && s.on)} onClick={() => dispatch(ui.setApi({ typeId: x.id }))}>
            <Braces size={12} /><span>{x.name}</span><span className={s.kind}>{x.kind}</span>
          </button>
        ))}
        <DropdownMenu trigger={<button className={s.addRow}><Plus size={13} /> New type</button>} items={(['object', 'input', 'enum'] as const).map((k) => ({ label: k, onSelect: () => { const id = edit('addType', { nodeId: spec.nodeId, name: `New${k[0].toUpperCase()}${k.slice(1)}${spec.types.length + 1}`, kind: k }); dispatch(ui.setApi({ typeId: id ?? null })) } }))} />
      </div>
      {t ? (
        <div className={s.typeEdit}>
          <div className={s.typeHead}>
            <Input value={t.name} mono onCommit={(v) => edit('updateType', { nodeId: spec.nodeId, typeId: t.id, patch: { name: v.replace(/\W/g, '') || t.name } })} />
            <Select value={t.kind} onChange={(k) => edit('updateType', { nodeId: spec.nodeId, typeId: t.id, patch: { kind: k } })} options={['object', 'input', 'enum'].map((k) => ({ value: k as TypeDef['kind'], label: k }))} />
            <Tooltip content="Delete type"><Button variant="danger" size="sm" icon={<Trash2 />} aria-label="Delete type" onClick={() => { edit('removeType', { nodeId: spec.nodeId, typeId: t.id }); dispatch(ui.setApi({ typeId: null })) }} /></Tooltip>
          </div>
          <div className={s.fieldGrid}>
            <span>{t.kind === 'enum' ? 'value' : 'field'}</span>{t.kind !== 'enum' && <><span>type</span><span>required</span><span>list</span></>}<span />
            {t.fields.map((f, i) => (
              <div key={i} className={s.fieldRow} style={{ display: 'contents' }}>
                <Input value={f.name} mono onCommit={(v) => upFields(t.fields.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                {t.kind !== 'enum' && <>
                  <Select value={known.includes(f.type) ? f.type : f.type} onChange={(v) => upFields(t.fields.map((x, j) => (j === i ? { ...x, type: v } : x)))} options={[...new Set([...known, f.type])].map((k) => ({ value: k, label: k }))} />
                  <Checkbox checked={f.required} onChange={(v) => upFields(t.fields.map((x, j) => (j === i ? { ...x, required: v } : x)))} />
                  <Checkbox checked={!!f.list} onChange={(v) => upFields(t.fields.map((x, j) => (j === i ? { ...x, list: v } : x)))} />
                </>}
                <Button variant="ghost" size="xs" icon={<X />} aria-label="Remove field" onClick={() => upFields(t.fields.filter((_, j) => j !== i))} />
              </div>
            ))}
          </div>
          <Button size="xs" icon={<Plus />} onClick={() => upFields([...t.fields, { name: t.kind === 'enum' ? 'VALUE' : `field${t.fields.length + 1}`, type: 'String', required: false }])}>Add {t.kind === 'enum' ? 'value' : 'field'}</Button>
          <div className={s.codeBox}><div className={s.codeHead}>example</div><CodeView code={JSON.stringify(exampleFor(t.name, spec.types), null, 2)} lang="ts" /></div>
        </div>
      ) : <Empty title="No types">Types describe request and response payloads (GraphQL types, proto messages, JSON schemas).</Empty>}
    </div>
  )
}

function entrySource(doc: ProjectDoc, node: SystemNode): [string, string] {
  const files = Object.entries(serviceFiles(doc, node)).filter(([path]) => !/(Dockerfile|README\.md|\.env\.example|\.json|\.toml|\.xml|\.mod)$/.test(path))
  const entry = files.find(([path]) => /\/(main|routes|Program|app|index|entrypoint)\.[a-z]+$/.test(path)) ?? files[0]
  return entry ? [entry[0].split('/').slice(2).join('/'), entry[1]] : ['handlers', '']
}

function ContractView({ spec }: { spec: ApiSpec }) {
  const doc = useDoc()
  const node = doc.nodes.find((n) => n.id === spec.nodeId)!
  const [file, code] = spec.style === 'graphql' ? ['schema.graphql', graphqlSchema(spec)] : spec.style === 'grpc' ? [`${node.name}.proto`, protoFile(spec, node)] : isPathStyle(spec.style) ? ['openapi.yaml', openapi(spec, node)] : entrySource(doc, node)
  return (
    <div className={s.contract}>
      <div className={s.codeHead}>{file}<Spacer /><Button size="xs" variant="ghost" icon={<Copy />} onClick={() => navigator.clipboard?.writeText(code)}>Copy</Button></div>
      <CodeView code={code} lang={file.endsWith('.yaml') ? 'yaml' : 'ts'} />
    </div>
  )
}

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useStore } from 'react-redux'
import type { RootState } from '@/store'
import { useAppDispatch, useEdit } from '@/store'
import { ui } from '@/store/uiSlice'
import { TECHNOLOGIES, TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { PROVIDERS } from '@tessery/core/catalog/providers'
import { analyze } from '@/features/problems/useProblems'
import { deliveryApi, useCreateReleaseMutation } from '@/api/endpoints/delivery'
import { errorMessage } from '@/api/types'
import { useCreateCheckpoint } from '@/features/delivery/useCheckpoint'
import { useCommands } from '@/features/shell/commands'
import s from './Terminal.module.css'

type Line = { kind: 'in' | 'out' | 'ok' | 'err' | 'muted'; text: ReactNode }
const lines: Line[] = [{ kind: 'muted', text: 'Tessery terminal. Type help. Commands edit the same design as the canvas and connected agents.' }]
const history: string[] = []

const HELP = `ls                              list nodes
add <technology> [name]         e.g. add postgres orders-db · add kafka
rm <node>                       remove a node
link <from> <to>                connect two nodes (first compatible ports)
scale <node> <replicas>         set replicas
move <node> <provider> [mode]   mode: managed | self-hosted | external
techs [filter]                  list technologies
providers                       list providers
sim on|off · load <x>           live traffic simulation
validate                        list problems
checkpoint <name>               commit the design and generated code
deploy [env]                    release the next checkpoint into env
export                          download the generated project zip
undo · redo · clear`

export function Terminal() {
  const dispatch = useAppDispatch()
  const edit = useEdit()
  const st = useStore<RootState>()
  const commands = useCommands()
  const [release] = useCreateReleaseMutation()
  const [checkpoint] = useCreateCheckpoint()
  const [, force] = useState(0)
  const [value, setValue] = useState('')
  const [hi, setHi] = useState(history.length)
  const end = useRef<HTMLDivElement>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }) })
  const out = (kind: Line['kind'], text: ReactNode) => { lines.push({ kind, text }); if (lines.length > 500) lines.shift(); force((x) => x + 1) }

  const run = async (raw: string) => {
    const doc = st.getState().project.doc!
    const [cmd, ...args] = raw.trim().split(/\s+/)
    const node = (name?: string) => doc.nodes.find((n) => n.name === name) ?? doc.nodes.find((n) => name && n.name.startsWith(name))
    switch ((cmd ?? '').toLowerCase()) {
      case '': return
      case 'help': return out('muted', HELP)
      case 'clear': lines.length = 0; return force((x) => x + 1)
      case 'ls': return doc.nodes.forEach((n) => out('out', `${n.name.padEnd(20)} ${TECH_BY_ID[n.techId].name.padEnd(24)} ×${n.replicas}  ${n.placement.providerId}/${n.placement.mode}`))
      case 'techs': return out('out', TECHNOLOGIES.filter((t) => !args[0] || `${t.id} ${t.name}`.toLowerCase().includes(args[0].toLowerCase())).map((t) => `${t.id.padEnd(18)} ${t.name}`).join('\n'))
      case 'providers': return out('out', PROVIDERS.map((p) => `${p.id.padEnd(14)} ${p.name.padEnd(20)} ${p.kind.padEnd(12)} ${Object.keys(p.offers).length} managed services`).join('\n'))
      case 'add': {
        const t = TECHNOLOGIES.find((x) => x.id === args[0]) ?? TECHNOLOGIES.find((x) => x.name.toLowerCase().includes((args[0] ?? '').toLowerCase()))
        if (!t) return out('err', `unknown technology "${args[0] ?? ''}". Try: techs`)
        const xs = doc.nodes.map((n) => n.x)
        const id = edit('addNode', { techId: t.id, name: args[1], x: xs.length ? Math.max(...xs) + 280 : 0, y: 0 })
        dispatch(ui.select({ kind: 'nodes', ids: [id] }))
        return out('ok', `+ ${st.getState().project.doc!.nodes.find((n) => n.id === id)?.name} (${t.name})`)
      }
      case 'rm': { const n = node(args[0]); if (!n) return out('err', `no node "${args[0] ?? ''}"`); edit('removeNodes', { ids: [n.id] }); return out('ok', `- ${n.name}`) }
      case 'link': { const a = node(args[0]), b = node(args[1]); if (!a || !b) return out('err', 'usage: link <from> <to>'); const id = edit('connect', { source: a.id, target: b.id }); return id ? out('ok', `~ ${a.name} → ${b.name}`) : out('err', 'no compatible ports, or already connected') }
      case 'scale': { const n = node(args[0]); const r = parseInt(args[1]); if (!n || !(r > 0)) return out('err', 'usage: scale <node> <replicas>'); edit('updateNode', { id: n.id, patch: { replicas: r } }); return out('ok', `${n.name} ×${r}`) }
      case 'move': {
        const n = node(args[0]); const p = PROVIDERS.find((x) => x.id === args[1] || x.name.toLowerCase() === (args[1] ?? '').toLowerCase())
        if (!n || !p) return out('err', 'usage: move <node> <provider> [managed|self-hosted|external]')
        const mode = (args[2] as 'managed' | 'self-hosted' | 'external') ?? (p.offers[TECH_BY_ID[n.techId].capability ?? 'vm'] ? 'managed' : 'self-hosted')
        edit('setPlacement', { id: n.id, placement: { providerId: p.id, regionId: p.regions[0]?.id, mode } }); return out('ok', `${n.name} → ${p.name} (${mode})`)
      }
      case 'sim': dispatch(ui.setLive({ on: args[0] !== 'off' })); return out('ok', `simulation ${args[0] === 'off' ? 'stopped' : 'running'}`)
      case 'load': { const x = Math.max(0.5, Math.min(12, parseFloat(args[0]) || 1)); dispatch(ui.setLive({ on: true, load: x })); return out('ok', `traffic ×${x}`) }
      case 'validate': { const ps = analyze(doc, doc.environments.find((e) => e.id === st.getState().ui.envId), null); if (!ps.length) return out('ok', '✓ valid'); return ps.forEach((p) => out(p.severity === 'error' ? 'err' : 'out', `${p.severity === 'error' ? '✕' : p.severity === 'warning' ? '⚠' : 'i'} ${p.message}`)) }
      case 'checkpoint': { if (!args.length) return out('err', 'usage: checkpoint <name>'); const c = await checkpoint(args.join(' ')); return c ? out('ok', `checkpoint ${c.seq} ${c.commit.slice(0, 8)} (${c.files} files)`) : out('err', 'checkpoint failed') }
      case 'deploy': {
        const envId = args[0] ?? st.getState().ui.envId
        const pipe = await dispatch(deliveryApi.endpoints.pipeline.initiate(doc.id, { forceRefetch: true }))
        const stage = pipe.data?.stages.find((x) => x.key === envId)
        if (!stage) return out('err', `unknown env "${envId}"`)
        if (!stage.candidate) return out('muted', `${stage.name} is up to date; create a checkpoint or promote the stage before it`)
        const r = await release({ pid: doc.id, env: stage.key, checkpointId: stage.candidate.id })
        if ('error' in r) return out('err', errorMessage(r.error))
        return out('ok', r.data.status === 'pending' ? `checkpoint ${stage.candidate.seq} is waiting for approval in ${stage.name}` : `${stage.name} now runs checkpoint ${stage.candidate.seq}`)
      }
      case 'export': commands.find((c) => c.id === 'export')?.run(); return out('ok', 'export started')
      case 'undo': commands.find((c) => c.id === 'undo')?.run(); return out('muted', 'undo')
      case 'redo': commands.find((c) => c.id === 'redo')?.run(); return out('muted', 'redo')
      case 'ask': return out('muted', 'Agents connect over MCP now. Open the Agent tab in the right panel to set one up.')
      default: return out('err', `unknown command "${cmd}". Type help`)
    }
  }

  return (
    <div className={s.term} onClick={() => !getSelection()?.toString() && input.current?.focus()}>
      {lines.map((l, i) => <div key={i} className={s[l.kind]}>{l.text}</div>)}
      <div className={s.prompt} ref={end}>
        <span>tessery ›</span>
        <input ref={input} value={value} spellCheck={false} autoComplete="off" placeholder="type help"
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') { const v = value; setValue(''); if (v.trim()) { history.push(v); setHi(history.length) } out('in', v); run(v) }
            if (e.key === 'ArrowUp') { e.preventDefault(); const i = Math.max(0, hi - 1); setHi(i); setValue(history[i] ?? '') }
            if (e.key === 'ArrowDown') { e.preventDefault(); const i = Math.min(history.length, hi + 1); setHi(i); setValue(history[i] ?? '') }
            if (e.key === 'Tab') {
              e.preventDefault()
              const parts = value.split(' '), last = parts.pop() ?? ''
              const doc = st.getState().project.doc!
              const pool = parts.length ? [...doc.nodes.map((n) => n.name), ...TECHNOLOGIES.map((t) => t.id), ...PROVIDERS.map((p) => p.id), ...doc.environments.map((x) => x.id)] : HELP.split('\n').map((l) => l.split(/\s/)[0])
              const m = [...new Set(pool.filter((x) => x.startsWith(last)))]
              if (m.length === 1) setValue([...parts, m[0]].join(' ') + ' ')
              else if (m.length) out('muted', m.join('  '))
            }
          }} />
      </div>
    </div>
  )
}

import { memo } from 'react'
import { Handle, Position, type NodeProps, type Node } from '@xyflow/react'
import { AlertTriangle } from 'lucide-react'
import clsx from 'clsx'
import type { SystemNode, Environment } from '@tessery/core/domain/types'
import { CATEGORY_META, PORT_COLORS, TECH_BY_ID } from '@tessery/core/catalog/technologies'
import { PROVIDER_BY_ID } from '@tessery/core/catalog/providers'
import { API_STYLE_META } from '@tessery/core/catalog/languages'
import { checkPlacement, effectivePlacement } from '@tessery/core/catalog/placement'
import { inputType } from '@tessery/core/domain/ops/graph'
import type { NodeLoad } from '@tessery/core/domain/simulate'
import { fmtMs, fmtNum } from '@/lib/format'
import { Tooltip } from '@/ui'
import s from './NodeView.module.css'

export type CanvasNode = Node<{ node: SystemNode; env?: Environment; live?: NodeLoad; dim: boolean; showProvider: boolean }, 'tessery'>

function keyFields(n: SystemNode): [string, string][] {
  const c = n.config, t = TECH_BY_ID[n.techId]
  if (t.id === 'service') return [['', `${c.language} · ${c.framework}`], ['port', String(c.port)]]
  if (t.category === 'client') return [['', String(c.framework ?? c.protocol ?? c.language ?? '')], ['traffic', `${c.trafficRps} ${t.id === 'iot-device' ? 'msg/s' : 'rps'}`]]
  const pick = t.config.filter((f) => f.type !== 'bool').slice(0, 2)
  return pick.map((f) => [f.label.toLowerCase(), `${c[f.key]}${f.unit ? ` ${f.unit}` : ''}`])
}

export const NodeView = memo(function NodeView({ data, selected }: NodeProps<CanvasNode>) {
  const { node, env, live, dim, showProvider } = data
  const tech = TECH_BY_ID[node.techId]
  const cat = CATEGORY_META[tech.category]
  const pl = effectivePlacement(node, env)
  const provider = PROVIDER_BY_ID[pl.providerId]
  const check = checkPlacement(node, env)
  const style = node.techId === 'service' ? API_STYLE_META[node.config.apiStyle as keyof typeof API_STYLE_META] : undefined
  const health = live ? (live.down || live.errorRate > 5 ? 'err' : live.errorRate > 2 || live.util > 0.85 ? 'warn' : 'ok') : undefined
  const showReplicas = tech.category === 'compute' || tech.category === 'network'

  return (
    <div className={clsx(s.node, selected && s.selected, dim && s.dim, live?.down && s.down)} style={{ '--cat': cat.color } as React.CSSProperties}>
      <div className={s.head}>
        <span className={s.glyph}>{tech.glyph}</span>
        <span className={s.name}>{node.name}</span>
        {showReplicas && node.replicas > 1 && <span className={s.rep}>×{node.replicas}</span>}
        {style && <span className={s.style} style={{ color: style.color }}>{style.label}</span>}
      </div>
      <div className={s.tech}>{tech.name}</div>
      {live && (
        <div className={s.live}>
          <div className={s.util}><i style={{ transform: `scaleX(${Math.min(1, live.util)})`, background: live.util > 1 ? 'var(--err)' : live.util > 0.8 ? 'var(--warn)' : 'var(--ok)' }} /></div>
          <div className={s.metrics}>
            <span>{fmtNum(live.rps)}/s</span>
            <span>{live.down ? 'down' : fmtMs(live.latency)}</span>
            <span className={live.errorRate > 5 ? s.bad : live.errorRate > 1 ? s.warnTxt : ''}>{live.errorRate.toFixed(live.errorRate < 10 ? 1 : 0)}%</span>
          </div>
        </div>
      )}
      <div className={s.fields}>{keyFields(node).map(([k, v], i) => <div key={i} className={s.field}>{k && <span>{k}</span>}<b>{v}</b></div>)}</div>
      {showProvider && (
        <div className={s.provider}>
          <span className={s.pdot} style={{ background: provider?.color }} />
          <span className={s.pname}>{provider?.name}</span>
          <span className={s.mode}>{pl.mode === 'self-hosted' ? 'self-hosted' : pl.mode === 'external' ? 'SaaS' : 'managed'}</span>
          {!check.ok && <Tooltip content={`${check.issue}${check.suggestion ? `. ${check.suggestion}` : ''}`}><AlertTriangle className={s.warnIcon} /></Tooltip>}
        </div>
      )}
      {health && health !== 'ok' && <span className={clsx(s.health, s[health])} />}

      {tech.inputs.map((p, i) => {
        const type = inputType(node, p.id)
        return <Handle key={p.id} id={p.id} type="target" position={Position.Left} className={s.handle} style={{ top: 22 + i * 18, background: PORT_COLORS[type] }} title={`${p.label ?? p.id} (${type})`} />
      })}
      {tech.outputs.map((p, i) => <Handle key={p.id} id={p.id} type="source" position={Position.Right} className={s.handle} style={{ top: 22 + i * 18, background: PORT_COLORS[p.type] }} title={p.label ?? p.id} />)}
    </div>
  )
})

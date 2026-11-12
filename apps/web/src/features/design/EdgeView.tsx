import { memo } from 'react'
import { BaseEdge, EdgeLabelRenderer, getBezierPath, type Edge, type EdgeProps } from '@xyflow/react'
import type { SystemEdge } from '@tessery/core/domain/types'
import { fmtNum } from '@/lib/format'
import s from './EdgeView.module.css'

export type CanvasEdge = Edge<{ edge: SystemEdge; color: string; flow?: number; broken?: boolean; animate: boolean; dim: boolean; showLabel: boolean }, 'tessery'>

export const EdgeView = memo(function EdgeView(p: EdgeProps<CanvasEdge>) {
  const [path, lx, ly] = getBezierPath(p)
  const d = p.data!
  const color = p.selected ? 'var(--acc)' : d.broken ? 'var(--err)' : d.color
  const w = d.flow !== undefined ? 1.4 + Math.min(4, Math.log10(d.flow + 1) * 1.1) : 1.6
  const dur = d.flow !== undefined ? Math.max(0.25, 2.4 - Math.log10(d.flow + 1) * 0.7) : d.edge.async ? 1.6 : 1
  return (
    <>
      <BaseEdge id={p.id} path={path} interactionWidth={14} style={{ stroke: color, strokeWidth: p.selected ? w + 1 : w, opacity: d.dim ? 0.12 : p.selected ? 1 : 0.55, strokeDasharray: d.edge.async ? '6 4' : undefined }} />
      {d.animate && !d.dim && (d.flow === undefined || d.flow > 0.3) && (
        <path d={path} fill="none" stroke={color} strokeWidth={Math.max(2, w)} className={s.flow} style={{ animationDuration: `${dur.toFixed(1)}s` }} />
      )}
      {d.showLabel && !d.dim && (
        <EdgeLabelRenderer>
          <div className={s.label} style={{ transform: `translate(-50%, -50%) translate(${lx}px, ${ly}px)`, color }}>
            {d.edge.protocol}{d.flow !== undefined && d.flow > 0.3 ? ` · ${fmtNum(d.flow)}/s` : ''}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})

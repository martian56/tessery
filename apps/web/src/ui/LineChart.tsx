import { useMemo, useRef, useState } from 'react'
import s from './LineChart.module.css'

export interface Series { name: string; color: string; points: { t: number; v: number }[] }

const nice = (max: number) => { if (max <= 0) return 1; const p = 10 ** Math.floor(Math.log10(max)); const n = max / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p }
const tfmt = (t: number, span: number) => { const d = new Date(t); return span > 86400e3 * 1.5 ? `${d.getMonth() + 1}/${d.getDate()}` : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }

export function LineChart({ series, height = 160, unit = '', format = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v >= 10 ? v.toFixed(0) : v.toFixed(2)), threshold }: { series: Series[]; height?: number; unit?: string; format?: (v: number) => string; threshold?: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const [hover, setHover] = useState<number | null>(null)
  const W = 600, H = height, PL = 44, PR = 10, PT = 8, PB = 20
  const { t0, t1, max, times } = useMemo(() => {
    const all = series.flatMap((x) => x.points)
    const ts = series[0]?.points.map((p) => p.t) ?? []
    return { t0: Math.min(...all.map((p) => p.t)), t1: Math.max(...all.map((p) => p.t)), max: nice(Math.max(threshold ?? 0, ...all.map((p) => p.v)) * 1.1), times: ts }
  }, [series, threshold])
  if (!series.length || !times.length) return <div className={s.empty} style={{ height }}>no data</div>
  const x = (t: number) => PL + ((t - t0) / Math.max(1, t1 - t0)) * (W - PL - PR)
  const y = (v: number) => PT + (1 - v / max) * (H - PT - PB)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * max)
  const xt = [0, 0.25, 0.5, 0.75, 1].map((f) => t0 + f * (t1 - t0))
  const hi = hover !== null ? times[hover] : null
  return (
    <div className={s.wrap} ref={ref}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={s.svg} style={{ height }}
        onMouseMove={(e) => { const r = ref.current!.getBoundingClientRect(); const px = ((e.clientX - r.left) / r.width) * W; const t = t0 + ((px - PL) / (W - PL - PR)) * (t1 - t0); let best = 0; times.forEach((tt, i) => { if (Math.abs(tt - t) < Math.abs(times[best] - t)) best = i }); setHover(best) }}
        onMouseLeave={() => setHover(null)}>
        {ticks.map((v) => <g key={v}><line x1={PL} x2={W - PR} y1={y(v)} y2={y(v)} className={s.grid} /><text x={PL - 6} y={y(v) + 3} className={s.ylab}>{format(v)}</text></g>)}
        {xt.map((t) => <text key={t} x={x(t)} y={H - 5} className={s.xlab}>{tfmt(t, t1 - t0)}</text>)}
        {threshold !== undefined && <line x1={PL} x2={W - PR} y1={y(threshold)} y2={y(threshold)} className={s.threshold} />}
        {series.map((sr) => {
          const d = sr.points.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`).join('')
          return <g key={sr.name}><path d={`${d}L${x(sr.points[sr.points.length - 1].t)},${y(0)}L${x(sr.points[0].t)},${y(0)}Z`} fill={sr.color} opacity={series.length === 1 ? 0.1 : 0} /><path d={d} fill="none" stroke={sr.color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" /></g>
        })}
        {hi !== null && <line x1={x(hi)} x2={x(hi)} y1={PT} y2={H - PB} className={s.cursor} />}
      </svg>
      {hi !== null && hover !== null && (
        <div className={s.tip} style={{ left: `${(x(hi) / W) * 100}%` }}>
          <div className={s.tipT}>{new Date(hi).toLocaleString()}</div>
          {series.slice(0, 8).map((sr) => <div key={sr.name} className={s.tipRow}><i style={{ background: sr.color }} />{sr.name}<b>{format(sr.points[hover]?.v ?? 0)}{unit}</b></div>)}
        </div>
      )}
    </div>
  )
}

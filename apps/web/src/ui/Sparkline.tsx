export function Sparkline({ values, color = 'var(--info)', height = 34, max, fill = true }: { values: number[]; color?: string; height?: number; max?: number; fill?: boolean }) {
  const w = 240
  if (values.length < 2) return <svg width="100%" height={height} style={{ display: 'block', background: 'var(--bg-0)', borderRadius: 3 }} />
  const top = max ?? Math.max(...values, 1e-6)
  const pts = values.map((v, i) => [(i / (values.length - 1)) * w, height - 2 - (v / top) * (height - 6)])
  const line = pts.map((p) => p.join(',')).join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" width="100%" height={height} style={{ display: 'block', background: 'var(--bg-0)', borderRadius: 3, border: '1px solid var(--line-1)' }}>
      {fill && <polygon points={`0,${height} ${line} ${w},${height}`} fill={color} opacity={0.12} />}
      <polyline points={line} fill="none" stroke={color} strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

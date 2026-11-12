export function timeAgo(t: number) {
  const s = (Date.now() - t) / 1000
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}
export function fmtNum(n: number) {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`
  if (n >= 10) return String(Math.round(n))
  return n.toFixed(1)
}
export const fmtMs = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(2)}s` : `${Math.round(n)}ms`)
export const fmtUsd = (n: number) => `$${Math.round(n).toLocaleString()}`
export const pct = (n: number, d = 1) => `${n.toFixed(d)}%`

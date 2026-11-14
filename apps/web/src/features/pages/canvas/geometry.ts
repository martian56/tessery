import type { StyleMap, UIElement } from '@tessery/core/domain/types'

export interface Pt { x: number; y: number }
export interface Box { x: number; y: number; w: number; h: number }

export type Breakpoint = 'style' | 'tablet' | 'mobile' | 'hover' | 'focus' | 'active' | 'current'

export const DEVICE_WIDTH = { desktop: 1280, tablet: 820, mobile: 390 } as const

/** The style an element shows at a device: its base style with the tablet and mobile overrides that apply. */
export function effective(e: UIElement, device: keyof typeof DEVICE_WIDTH): StyleMap {
  return { ...e.style, ...(device !== 'desktop' ? e.tablet : {}), ...(device === 'mobile' ? e.mobile : {}) }
}

export const px = (v: unknown): number | null => {
  if (typeof v === 'number') return v
  const m = typeof v === 'string' ? /^(-?\d+(?:\.\d+)?)px$/.exec(v.trim()) : null
  return m ? Number(m[1]) : null
}

/** Ramer-Douglas-Peucker: drops points that add less than `eps` of detail. */
export function simplify(points: Pt[], eps: number): Pt[] {
  if (points.length < 3) return points
  const [a, b] = [points[0], points[points.length - 1]]
  let far = 0
  let index = 0
  for (let i = 1; i < points.length - 1; i++) {
    const p = points[i]
    const d = Math.abs((b.y - a.y) * p.x - (b.x - a.x) * p.y + b.x * a.y - b.y * a.x) / (Math.hypot(b.y - a.y, b.x - a.x) || 1)
    if (d > far) { far = d; index = i }
  }
  if (far <= eps) return [a, b]
  return [...simplify(points.slice(0, index + 1), eps).slice(0, -1), ...simplify(points.slice(index), eps)]
}

const r = (n: number) => Math.round(n * 10) / 10

/** A smooth curve through the points (Catmull-Rom turned into cubic Bezier segments). */
export function smoothPath(points: Pt[], closed = false): string {
  if (!points.length) return ''
  if (points.length < 3) return `M${r(points[0].x)} ${r(points[0].y)}` + points.slice(1).map((p) => ` L${r(p.x)} ${r(p.y)}`).join('')
  const pts = closed ? [points[points.length - 1], ...points, points[0], points[1]] : [points[0], ...points, points[points.length - 1]]
  let d = `M${r(pts[1].x)} ${r(pts[1].y)}`
  for (let i = 1; i < pts.length - 2; i++) {
    const [p0, p1, p2, p3] = [pts[i - 1], pts[i], pts[i + 1], pts[i + 2]]
    d += ` C${r(p1.x + (p2.x - p0.x) / 6)} ${r(p1.y + (p2.y - p0.y) / 6)} ${r(p2.x - (p3.x - p1.x) / 6)} ${r(p2.y - (p3.y - p1.y) / 6)} ${r(p2.x)} ${r(p2.y)}`
  }
  return closed ? `${d} Z` : d
}

/** Pen anchors: a point with an optional outgoing handle; a dragged anchor makes a smooth curve. */
export interface Anchor { p: Pt; h?: Pt }

export function penPath(anchors: Anchor[], closed: boolean): string {
  if (!anchors.length) return ''
  const mirror = (a: Anchor) => (a.h ? { x: 2 * a.p.x - a.h.x, y: 2 * a.p.y - a.h.y } : a.p)
  let d = `M${r(anchors[0].p.x)} ${r(anchors[0].p.y)}`
  const seg = (a: Anchor, b: Anchor) => (a.h || b.h ? ` C${r((a.h ?? a.p).x)} ${r((a.h ?? a.p).y)} ${r(mirror(b).x)} ${r(mirror(b).y)} ${r(b.p.x)} ${r(b.p.y)}` : ` L${r(b.p.x)} ${r(b.p.y)}`)
  for (let i = 1; i < anchors.length; i++) d += seg(anchors[i - 1], anchors[i])
  if (closed && anchors.length > 2) d += seg(anchors[anchors.length - 1], anchors[0]) + ' Z'
  return d
}

/** Moves a path so its box starts at 0,0 and returns the box it occupied. */
export function normalizePath(points: Pt[], pad: number): { box: Box; shift: (p: Pt) => Pt } {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const box = { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 }
  return { box: { ...box, w: Math.max(box.w, 1), h: Math.max(box.h, 1) }, shift: (p) => ({ x: p.x - box.x, y: p.y - box.y }) }
}

export function boxFrom(a: Pt, b: Pt): Box {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) }
}

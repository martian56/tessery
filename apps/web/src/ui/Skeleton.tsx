import type { CSSProperties } from 'react'
import s from './Skeleton.module.css'

/** A placeholder block in the shape of content that is still loading. Screen readers skip it; give the region aria-busy. */
export function Skeleton({ w, h = 12, r, className, style }: { w?: number | string; h?: number | string; r?: number | string; className?: string; style?: CSSProperties }) {
  return <span aria-hidden="true" className={className ? `${s.block} ${className}` : s.block} style={{ width: w ?? '100%', height: h, borderRadius: r, ...style }} />
}

/** Lines of placeholder text, the last one shorter. */
export function SkeletonText({ lines = 2, size = 12, gap = 8 }: { lines?: number; size?: number; gap?: number }) {
  return (
    <span aria-hidden="true" className={s.text} style={{ gap }}>
      {Array.from({ length: lines }, (_, i) => <Skeleton key={i} h={size} w={i === lines - 1 && lines > 1 ? '62%' : '100%'} />)}
    </span>
  )
}

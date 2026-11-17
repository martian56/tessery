import { CATEGORY_META, TECH_BY_ID } from '@tessery/core/catalog/technologies'
import s from './ProjectHome.module.css'

/** A project drawn as mosaic tiles: one per node, in its category's colour, ordered the way the canvas flows. */
export function Mosaic({ techIds }: { techIds: string[] }) {
  const tiles = techIds
    .map((id) => TECH_BY_ID[id])
    .filter((t) => !!t)
    .sort((a, b) => CATEGORY_META[a.category].order - CATEGORY_META[b.category].order)
  const size = tiles.length <= 6 ? 'lg' : tiles.length <= 16 ? 'md' : 'sm'
  return (
    <div className={s.mosaic} data-size={size} aria-hidden="true">
      {tiles.length === 0 && <span className={s.mosaicEmpty}>Empty canvas</span>}
      {tiles.map((t, i) => (
        <span key={i} className={s.tile} style={{ background: CATEGORY_META[t.category].color }} title={t.name}>
          {size === 'lg' && t.glyph}
        </span>
      ))}
    </div>
  )
}

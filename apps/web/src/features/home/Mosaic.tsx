import { CATEGORY_META, TECH_BY_ID } from '@tessery/core/catalog/technologies'
import s from './ProjectHome.module.css'

/** The project's design at a glance: one chip per node, in its category's colour, in the order the canvas flows. */
export function Mosaic({ techIds }: { techIds: string[] }) {
  const nodes = techIds.map((id) => TECH_BY_ID[id]).filter((t) => !!t).sort((a, b) => CATEGORY_META[a.category].order - CATEGORY_META[b.category].order)
  const shown = nodes.slice(0, 10)
  return (
    <div className={s.preview} aria-hidden="true">
      {nodes.length === 0 ? <span className={s.previewEmpty}>Empty canvas</span> : (
        <div className={s.chips}>
          {shown.map((t, i) => (
            <span key={i} className={s.chip} style={{ '--cat': CATEGORY_META[t.category].color } as React.CSSProperties} title={t.name}>{t.glyph}</span>
          ))}
          {nodes.length > shown.length && <span className={s.more}>+{nodes.length - shown.length}</span>}
        </div>
      )}
    </div>
  )
}

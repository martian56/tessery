import { ArrowDown, ArrowUp } from 'lucide-react'
import s from './DataGrid.module.css'

function cell(v: unknown) {
  if (v === null || v === undefined) return <span className={s.null}>NULL</span>
  if (typeof v === 'boolean') return <span className={s.bool}>{String(v)}</span>
  if (typeof v === 'number') return <span className={s.num}>{v}</span>
  if (typeof v === 'object') return <span className={s.json}>{JSON.stringify(v)}</span>
  return String(v)
}

export function DataGrid({ columns, rows, sort, onSort, rowOffset = 0, types }: {
  columns: string[]; rows: Record<string, unknown>[]; sort?: string; onSort?: (col: string) => void; rowOffset?: number; types?: Record<string, string>
}) {
  const [sc, dir] = (sort ?? '').split(':')
  return (
    <div className={s.wrap}>
      <table className={s.table}>
        <thead>
          <tr>
            <th className={s.idx}>#</th>
            {columns.map((c) => (
              <th key={c} onClick={() => onSort?.(c)} className={onSort ? s.sortable : undefined}>
                <span>{c}</span>{types?.[c] && <small>{types[c]}</small>}
                {sc === c && (dir === 'desc' ? <ArrowDown size={11} /> : <ArrowUp size={11} />)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className={s.idx}>{rowOffset + i + 1}</td>
              {columns.map((c) => <td key={c} title={typeof r[c] === 'object' ? JSON.stringify(r[c]) : String(r[c] ?? '')}>{cell(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

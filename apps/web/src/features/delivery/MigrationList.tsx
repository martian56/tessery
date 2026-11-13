import type { ReleasePreview } from '@/api/types'
import { CodeView } from '@/ui'
import s from './Delivery.module.css'

export function MigrationList({ migrations }: { migrations: ReleasePreview['migrations'] }) {
  return (
    <div className={s.migrations}>
      <p>These database migrations run before the new services start. Back up the data first if you need it.</p>
      {migrations.map((m) => (
        <div key={`${m.database}/${m.file}`} className={s.migration}>
          <div className={s.migrationHead}><span className={s.mono}>{m.database}</span> {m.file}</div>
          <ul className={s.migrationRisks}>{m.destructive.map((d) => <li key={d}>{d}</li>)}</ul>
          <div className={s.migrationSql}><CodeView code={m.sql} lang="sql" /></div>
        </div>
      ))}
    </div>
  )
}

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { planMigrations, type MigrationState } from '../src/codegen/migrations'
import { runOp } from '../src/domain/ops'
import { blankTemplate } from '../src/templates/blank'

const NAME = `tessery-migrations-${process.pid}`

const docker = (...args: string[]) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] })
const psql = (sql: string) => execFileSync('docker', ['exec', '-i', NAME, 'psql', '-U', 'app', '-d', 'app', '-v', 'ON_ERROR_STOP=1', '-1', '-qtA'], { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim()

const doc = blankTemplate('shop', 'self', 'onprem')
const db = runOp(doc, 'addNode', { techId: 'postgres', x: 0, y: 0, name: 'shop-db' }) as string
const orders = runOp(doc, 'addTable', { nodeId: db, name: 'orders' }) as string
const total = runOp(doc, 'addColumn', { nodeId: db, tableId: orders, column: { name: 'total', type: 'int', nullable: false } }) as string
const note = runOp(doc, 'addColumn', { nodeId: db, tableId: orders, column: { name: 'note', type: 'text', nullable: true } }) as string
const code = runOp(doc, 'addColumn', { nodeId: db, tableId: orders, column: { name: 'code', type: 'text', nullable: true, default: '0' } }) as string
const column = (name: string) => doc.databases[db].tables.find((t) => t.id === orders)!.columns.find((c) => c.name === name)!.id

let state: MigrationState | undefined
let applied = 0
function release(label: string) {
  state = planMigrations(doc, state)
  const all = state.databases[db].migrations
  for (const m of all.slice(applied)) {
    psql(m.sql)
    console.log(`${label}: applied ${m.file}${m.destructive.length ? ` (destructive: ${m.destructive.join('; ')})` : ''}`)
  }
  applied = all.length
}

docker('run', '-d', '--rm', '--name', NAME, '-e', 'POSTGRES_USER=app', '-e', 'POSTGRES_PASSWORD=app', '-e', 'POSTGRES_DB=app', 'postgres:17-alpine')
try {
  for (let i = 0; ; i++) {
    try { psql('SELECT 1'); break } catch (e) { if (i > 60) throw e; execFileSync(process.platform === 'win32' ? 'powershell' : 'sleep', process.platform === 'win32' ? ['-c', 'Start-Sleep 1'] : ['1']) }
  }

  release('create')
  psql("INSERT INTO orders (id, created_at, total, note) VALUES (gen_random_uuid(), now(), 10, 'a'), (gen_random_uuid(), now(), 20, 'b');")

  runOp(doc, 'updateColumn', { nodeId: db, tableId: orders, columnId: total, patch: { name: 'amount' } })
  runOp(doc, 'addColumn', { nodeId: db, tableId: orders, column: { name: 'status', type: 'enum', enumValues: ['open', 'paid'], nullable: false, default: 'open' } })
  runOp(doc, 'addIndex', { nodeId: db, tableId: orders, columns: ['status'] })
  const status = () => column('status')
  release('rename and add')
  assert.equal(psql('SELECT sum(amount) FROM orders'), '30', 'renaming kept the values')
  assert.equal(psql("SELECT count(*) FROM orders WHERE status = 'open'"), '2', 'the new required column got its default')

  runOp(doc, 'updateColumn', { nodeId: db, tableId: orders, columnId: total, patch: { type: 'bigint' } })
  runOp(doc, 'updateColumn', { nodeId: db, tableId: orders, columnId: note, patch: { nullable: false, default: 'none' } })
  runOp(doc, 'updateTable', { nodeId: db, tableId: orders, patch: { name: 'purchases' } })
  const items = runOp(doc, 'addTable', { nodeId: db, name: 'items' }) as string
  runOp(doc, 'addColumn', { nodeId: db, tableId: items, column: { name: 'purchase_id', type: 'uuid', nullable: false, ref: { table: 'purchases', column: 'id', onDelete: 'cascade' } } })
  release('change types and rename table')

  const state = status()
  runOp(doc, 'updateColumn', { nodeId: db, tableId: orders, columnId: state, patch: { name: 'state' } })
  release('rename a checked column')
  runOp(doc, 'updateColumn', { nodeId: db, tableId: orders, columnId: state, patch: { enumValues: ['open', 'paid', 'refunded'] } })
  runOp(doc, 'updateColumn', { nodeId: db, tableId: orders, columnId: code, patch: { type: 'int', default: undefined } })
  release('widen the check and retype a defaulted column')
  psql("UPDATE purchases SET state = 'refunded' WHERE amount = 10;")
  assert.equal(psql("SELECT count(*) FROM pg_constraint WHERE conname = 'purchases_status_check'"), '0', 'the old check is gone, not left behind')
  assert.equal(psql("SELECT data_type FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = 'code'"), 'integer')
  assert.equal(psql('SELECT sum(amount) FROM purchases'), '30', 'the table rename and type change kept the rows')
  assert.equal(psql("SELECT data_type FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = 'amount'"), 'bigint')
  psql('INSERT INTO items (id, created_at, purchase_id) SELECT gen_random_uuid(), now(), id FROM purchases;')

  runOp(doc, 'updateColumn', { nodeId: db, tableId: orders, columnId: total, patch: { unique: true } })
  runOp(doc, 'removeColumn', { nodeId: db, tableId: orders, columnId: note })
  runOp(doc, 'removeTable', { nodeId: db, tableId: items })
  release('drop')
  assert.equal(psql('SELECT count(*) FROM purchases'), '2')
  assert.equal(psql("SELECT count(*) FROM information_schema.columns WHERE table_name = 'purchases' AND column_name = 'note'"), '0')
  assert.equal(psql("SELECT to_regclass('items') IS NULL"), 't')
  assert.throws(() => psql('UPDATE purchases SET amount = 10;'), 'amount is unique now')

  console.log(`${applied} migrations applied to a real Postgres with data kept`)
} finally {
  docker('rm', '-f', NAME)
}

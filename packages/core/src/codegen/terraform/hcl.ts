/** A Terraform expression written as is, like `var.region` or `aws_s3_bucket.assets.arn`. */
export class Raw {
  constructor(readonly expr: string) {}
}
/** A nested block, like `vpc_config { ... }`, as opposed to a map argument. */
export class Nested {
  constructor(readonly body: Body) {}
}

export type Value = string | number | boolean | Raw | Value[] | { [key: string]: Value } | undefined
export type Entry = Value | Nested | Nested[]
export type Body = { [key: string]: Entry }

export const raw = (expr: string) => new Raw(expr)
export const nested = (body: Body) => new Nested(body)

const quote = (s: string) => JSON.stringify(s).replace(/\$\{/g, '$${').replace(/%\{/g, '%%{')
const isNested = (v: Entry): v is Nested | Nested[] => v instanceof Nested || (Array.isArray(v) && v.length > 0 && v.every((x) => x instanceof Nested))

function value(v: Value, ind: string): string {
  if (v instanceof Raw) return v.expr
  if (typeof v === 'string') return quote(v)
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  if (Array.isArray(v)) return `[${v.filter((x) => x !== undefined).map((x) => value(x, ind)).join(', ')}]`
  if (v && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined)
    if (!entries.length) return '{}'
    const key = (k: string) => (/^[A-Za-z_][\w-]*$/.test(k) ? k : quote(k))
    return `{\n${aligned(entries.map(([k, x]) => [key(k), value(x, `${ind}  `)]), `${ind}  `)}${ind}}`
  }
  return 'null'
}

function aligned(pairs: [string, string][], ind: string): string {
  let out = ''
  for (let i = 0; i < pairs.length; ) {
    let j = i
    while (j < pairs.length && !pairs[j][1].includes('\n')) j++
    const group = pairs.slice(i, Math.max(j, i + 1))
    const width = Math.max(...group.map(([k]) => k.length))
    for (const [k, v] of group) out += `${ind}${k.padEnd(v.includes('\n') ? k.length : width)} = ${v}\n`
    i += group.length
  }
  return out
}

function body(b: Body, ind: string): string {
  const attrs: [string, string][] = []
  const blocks: string[] = []
  for (const [k, v] of Object.entries(b)) {
    if (v === undefined) continue
    if (isNested(v)) for (const n of Array.isArray(v) ? v : [v]) blocks.push(`${ind}${k} {\n${body(n.body, `${ind}  `)}${ind}}\n`)
    else attrs.push([k, value(v as Value, ind)])
  }
  return aligned(attrs, ind) + (attrs.length && blocks.length ? '\n' : '') + blocks.join('\n')
}

/** One top-level block: `resource "aws_s3_bucket" "assets" { ... }`. */
export function block(kind: string, labels: string[], b: Body): string {
  return `${kind}${labels.map((l) => ` ${quote(l)}`).join('')} {\n${body(b, '  ')}}\n`
}

export const resource = (type: string, name: string, b: Body) => block('resource', [type, name], b)
export const data = (type: string, name: string, b: Body) => block('data', [type, name], b)

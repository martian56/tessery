type Value = string | number | boolean | null | undefined | Value[] | { [k: string]: Value }

const PLAIN = /^[A-Za-z_][A-Za-z0-9_./-]*$/
const RESERVED = /^(true|false|yes|no|on|off|null|y|n|~)$/i

function scalar(v: string | number | boolean | null): string {
  if (typeof v === 'string') return PLAIN.test(v) && !RESERVED.test(v) ? v : JSON.stringify(v)
  return String(v)
}

const key = (k: string) => (PLAIN.test(k) && !RESERVED.test(k) ? k : JSON.stringify(k))

export function toYaml(v: Value, indent = ''): string {
  if (Array.isArray(v)) {
    const items = v.filter((x) => x !== undefined)
    if (!items.length) return '[]'
    return items.map((x) => {
      if (x !== null && typeof x === 'object' && !Array.isArray(x)) {
        const body = toYaml(x, indent + '  ')
        return `\n${indent}- ${body.trimStart()}`
      }
      return `\n${indent}- ${toYaml(x, indent + '  ').trimStart()}`
    }).join('')
  }
  if (v !== null && typeof v === 'object') {
    const entries = Object.entries(v).filter(([, x]) => x !== undefined && !(x !== null && typeof x === 'object' && !Array.isArray(x) && !Object.keys(x).length))
    if (!entries.length) return '{}'
    return entries.map(([k, x]) => {
      if (x !== null && typeof x === 'object') {
        const body = toYaml(x, indent + '  ')
        return `\n${indent}${key(k)}:${body === '[]' || body === '{}' ? ' ' + body : body}`
      }
      return `\n${indent}${key(k)}: ${scalar(x as string)}`
    }).join('')
  }
  return scalar(v as string)
}

export const yamlDoc = (v: Value) => toYaml(v).replace(/^\n/, '') + '\n'

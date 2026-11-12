import type { ConfigField, ConfigValue } from '@tessery/core/domain/types'
import { Field, Input, NumberInput, Select, Switch } from '@/ui'

export function ConfigEditor({ fields, values, onChange, coalesceKey }: { fields: ConfigField[]; values: Record<string, ConfigValue>; onChange: (key: string, value: ConfigValue, coalesce?: string) => void; coalesceKey: string }) {
  return (
    <>
      {fields.map((f) => {
        const v = values[f.key] ?? f.default
        let control
        if (f.type === 'bool') control = <Switch checked={Boolean(v)} onChange={(x) => onChange(f.key, x)} label={v ? 'on' : 'off'} />
        else if (f.type === 'select') control = <Select value={String(v)} onChange={(x) => onChange(f.key, x)} options={(f.options ?? []).map((o) => ({ value: o, label: o }))} />
        else if (f.type === 'number') control = <NumberInput value={Number(v)} min={0} onCommit={(x) => onChange(f.key, x)} suffix={f.unit} />
        else control = <Input value={String(v)} mono onChange={(x) => onChange(f.key, x, `${coalesceKey}:${f.key}`)} />
        return <Field key={f.key} label={f.label} hint={f.hint}>{control}</Field>
      })}
    </>
  )
}

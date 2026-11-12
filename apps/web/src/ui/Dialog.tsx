import { Dialog as D } from 'radix-ui'
import { X } from 'lucide-react'
import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Button } from './Button'
import { Input } from './Input'
import { Field } from './Layout'
import s from './Dialog.module.css'

export function Dialog({ open, onOpenChange, title, description, children, footer, width = 460 }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children?: ReactNode; footer?: ReactNode; width?: number
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={s.overlay} />
        <D.Content className={s.content} style={{ width }} onKeyDown={(e) => e.stopPropagation()} {...(description ? {} : { 'aria-describedby': undefined })}>
          <div className={s.head}>
            <D.Title className={s.title}>{title}</D.Title>
            <D.Close asChild><Button variant="ghost" size="xs" icon={<X />} aria-label="Close" /></D.Close>
          </div>
          {description && <D.Description className={s.desc}>{description}</D.Description>}
          {children && <div className={s.body}>{children}</div>}
          {footer && <div className={s.foot}>{footer}</div>}
        </D.Content>
      </D.Portal>
    </D.Root>
  )
}

interface PromptField { name: string; label: string; value?: string; placeholder?: string }
type Req =
  | { kind: 'confirm'; title: string; body?: ReactNode; ok?: string; danger?: boolean; resolve: (v: boolean) => void }
  | { kind: 'prompt'; title: string; body?: ReactNode; ok?: string; fields: PromptField[]; resolve: (v: Record<string, string> | null) => void }

interface DialogApi {
  confirm: (o: { title: string; body?: ReactNode; ok?: string; danger?: boolean }) => Promise<boolean>
  prompt: (o: { title: string; body?: ReactNode; ok?: string; fields: PromptField[] }) => Promise<Record<string, string> | null>
}
const Ctx = createContext<DialogApi | null>(null)
export const useDialogs = () => {
  const c = useContext(Ctx)
  if (!c) throw new Error('useDialogs outside DialogProvider')
  return c
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<Req | null>(null)
  const values = useRef<Record<string, string>>({})
  const confirm = useCallback<DialogApi['confirm']>((o) => new Promise((resolve) => setReq({ kind: 'confirm', ...o, resolve })), [])
  const prompt = useCallback<DialogApi['prompt']>((o) => new Promise((resolve) => {
    values.current = Object.fromEntries(o.fields.map((f) => [f.name, f.value ?? '']))
    setReq({ kind: 'prompt', ...o, resolve })
  }), [])
  const close = (ok: boolean) => {
    if (!req) return
    if (req.kind === 'confirm') req.resolve(ok)
    else req.resolve(ok ? { ...values.current } : null)
    setReq(null)
  }
  return (
    <Ctx.Provider value={{ confirm, prompt }}>
      {children}
      <Dialog
        open={!!req}
        onOpenChange={(o) => !o && close(false)}
        title={req?.title}
        footer={<>
          <Button onClick={() => close(false)}>Cancel</Button>
          <Button variant={req?.kind === 'confirm' && req.danger ? 'danger' : 'primary'} className={clsx(req?.kind === 'confirm' && req.danger && s.dangerBtn)} onClick={() => close(true)}>{req?.ok ?? 'OK'}</Button>
        </>}
      >
        {req?.body && <div className={s.text}>{req.body}</div>}
        {req?.kind === 'prompt' && (
          <form className={s.form} onSubmit={(e) => { e.preventDefault(); close(true) }}>
            {req.fields.map((f, i) => (
              <Field key={f.name} label={f.label} wide>
                <Input size="md" autoFocus={i === 0} defaultValue={undefined} value={values.current[f.name]} placeholder={f.placeholder}
                  onChange={(v) => { values.current[f.name] = v }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); close(true) } }} />
              </Field>
            ))}
          </form>
        )}
      </Dialog>
    </Ctx.Provider>
  )
}

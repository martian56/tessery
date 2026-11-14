import { useState } from 'react'
import { ExternalLink, Github } from 'lucide-react'
import { useForgetGithubMutation, useGithubSettingsQuery } from '@/api/endpoints/github'
import { errorMessage } from '@/api/types'
import { Badge, Button, Field, Input, toast, useDialogs } from '@/ui'
import { Card, PageTitle, muted } from '@/features/chrome/PageLayout'

export function GithubView() {
  const [org, setOrg] = useState('')
  const [owner, setOwner] = useState('')
  const { data } = useGithubSettingsQuery(owner || undefined)
  const [forget] = useForgetGithubMutation()
  const dialogs = useDialogs()
  const app = data?.app as { slug: string; name: string; htmlUrl: string; owner: string } | null | undefined
  const created = new URLSearchParams(window.location.search).has('created')
  const local = /^https?:\/\/(localhost|127\.|\[::1\])/.test(data?.webhookUrl ?? '')

  const create = () => {
    if (!data) return
    const form = document.createElement('form')
    form.method = 'post'
    form.action = data.createUrl
    const field = document.createElement('input')
    field.type = 'hidden'
    field.name = 'manifest'
    field.value = JSON.stringify(data.manifest)
    form.appendChild(field)
    document.body.appendChild(form)
    form.submit()
  }
  const remove = async () => {
    if (!(await dialogs.confirm({ title: 'Forget the GitHub App?', body: 'Linked projects stop syncing. The app itself stays on GitHub; delete it there if you no longer need it.', ok: 'Forget', danger: true }))) return
    const r = await forget()
    toast('error' in r ? errorMessage(r.error) : 'GitHub App removed', 'error' in r ? 'err' : 'ok')
  }

  return (
    <>
      <PageTitle title="GitHub" description="A GitHub App lets projects mirror main to a repository, turn pushes into checkpoints and report releases as commit statuses." />
      {app ? (
        <Card title={app.name} actions={<Badge tone="ok">connected</Badge>}>
          {created && <p className={muted}>Created. Install it on the repositories your projects should use, then link them from each project's Git repository dialog.</p>}
          <p className={muted}>Owned by {app.owner}. Webhooks go to <code>{data?.webhookUrl}</code>.</p>
          <div style={{ display: 'flex', gap: 4 }}>
            <Button variant="primary" icon={<ExternalLink />} onClick={() => window.open(`${app.htmlUrl}/installations/new`, '_blank', 'noopener')}>Install on repositories</Button>
            <Button icon={<ExternalLink />} onClick={() => window.open(app.htmlUrl, '_blank', 'noopener')}>Open on GitHub</Button>
            <Button variant="ghost" onClick={remove}>Forget</Button>
          </div>
        </Card>
      ) : (
        <Card title="Create the GitHub App" actions={<Badge>not set up</Badge>}>
          <p className={muted}>
            GitHub creates an app for this Tessery in one step and sends you back here with its keys. It asks for contents (read and write), commit statuses (write) and push events.
          </p>
          {local && <p className={muted} style={{ color: 'var(--warn)' }}>This instance is reached at {data?.webhookUrl.replace('/api/github/webhook', '')}. GitHub cannot deliver webhooks there, so pushes on GitHub will only arrive after Tessery's next sync. Set TESSERY_PUBLIC_URL to a public address for live imports.</p>}
          <Field label="Create it in" hint="A GitHub organization login, or leave empty for your personal account.">
            <Input value={org} onChange={setOrg} onCommit={(v) => setOwner(v.trim())} placeholder="your account" />
          </Field>
          <div><Button variant="primary" icon={<Github />} disabled={!data || org.trim() !== owner} onClick={create}>Create GitHub App</Button></div>
        </Card>
      )}
    </>
  )
}

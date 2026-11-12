import { useState } from 'react'
import { Bot, Copy, KeyRound } from 'lucide-react'
import { useCreateTokenMutation } from '@/api/endpoints/tokens'
import { errorMessage } from '@/api/types'
import { usePermissions } from '@/app/usePermissions'
import { useAppSelector, useDoc } from '@/store'
import { Badge, Button, Section, Segmented, toast } from '@/ui'
import s from './AgentPanel.module.css'

type Client = 'claude' | 'cursor' | 'other'

const TOOLS = ['design_reference', 'edit_design', 'validate_design', 'list_files', 'read_file', 'create_checkpoint', 'get_pipeline', 'deploy', 'deploy_status', 'set_secret']

function snippet(client: Client, url: string, token: string): string {
  if (client === 'claude') return `claude mcp add --transport http tessery ${url} --header "Authorization: Bearer ${token}"`
  const config = { mcpServers: { tessery: { url, headers: { Authorization: `Bearer ${token}` } } } }
  return JSON.stringify(config, null, 2)
}

export function AgentPanel() {
  const doc = useDoc()
  const org = useAppSelector((st) => st.project.orgId) ?? undefined
  const perms = usePermissions({ org, project: doc.id })
  const [create, { isLoading }] = useCreateTokenMutation()
  const [token, setToken] = useState<string | null>(null)
  const [client, setClient] = useState<Client>('claude')
  const url = `${window.location.origin}/api/mcp`
  const placeholder = 'tessery_your_token'

  const makeToken = async () => {
    const permissions = ['project:read', 'project:edit', 'deployment:read', ...(perms.can('deployment:run') ? ['deployment:run'] : []), ...(perms.can('secret:write') ? ['secret:write'] : [])]
    const r = await create({ name: `agent for ${doc.name}`, projectId: doc.id, permissions, expiresInDays: 30 })
    if ('error' in r) return toast(errorMessage(r.error), 'err')
    setToken(r.data.secret)
  }
  const text = snippet(client, url, token ?? placeholder)

  return (
    <div className={s.wrap}>
      <div className={s.intro}>
        <Bot size={16} />
        <p>Let Claude Code, Cursor or any MCP client design, build and deploy this project. It works on the same design you see here, and every change it saves shows up live and in the version history.</p>
      </div>
      <Section title="1. Create a token">
        <p className={s.muted}>Scoped to <b>{doc.name}</b>, valid for 30 days. It can never do more than you can.</p>
        {token
          ? <div className={s.token}><KeyRound size={12} /><code>{token.slice(0, 14)}...</code><Badge tone="ok">created</Badge></div>
          : <Button size="sm" variant="primary" icon={<KeyRound />} disabled={isLoading || !perms.can('project:edit')} onClick={makeToken}>Create agent token</Button>}
      </Section>
      <Section title="2. Add the server">
        <Segmented<Client> value={client} onChange={setClient} options={[{ value: 'claude', label: 'Claude Code' }, { value: 'cursor', label: 'Cursor' }, { value: 'other', label: 'Other' }]} />
        {client !== 'claude' && <p className={s.muted}>{client === 'cursor' ? 'Add to .cursor/mcp.json:' : 'Streamable HTTP server. Most clients accept this shape:'}</p>}
        <pre className={s.code}>{text}</pre>
        <Button size="sm" icon={<Copy />} onClick={() => { navigator.clipboard.writeText(text); toast(token ? 'Copied' : 'Copied. Create a token and replace the placeholder.', 'ok') }}>Copy</Button>
      </Section>
      <Section title="3. Ask for something">
        <p className={s.muted}>For example: "Add a comments service in Go with its own Postgres, expose list and create endpoints, show them on the post page, then checkpoint and deploy to development."</p>
        <div className={s.tools}>{TOOLS.map((t) => <Badge key={t} mono>{t}</Badge>)}</div>
      </Section>
    </div>
  )
}

import { Activity, Lock, Rocket } from 'lucide-react'
import { SaveState } from './SaveState'
import { useAppDispatch, useAppSelector, useDoc, useUi } from '@/store'
import { useProjectPermissions } from '@/app/useProjectPermissions'
import { ui } from '@/store/uiSlice'
import { Badge, Button, MenuBar, Select, Slider, Tooltip, type MenuEntry } from '@/ui'
import { navigate } from '@/app/router'
import { useCommands, type Command } from './commands'
import { WORKSPACES } from './workspaces'
import s from './TopBar.module.css'

const MENU_GROUPS = ['File', 'Edit', 'View', 'Simulate', 'Deploy', 'Agents', 'Help']

export function TopBar() {
  const dispatch = useAppDispatch()
  const doc = useDoc()
  const workspace = useUi((u) => u.workspace)
  const envId = useUi((u) => u.envId)
  const live = useUi((u) => u.live)
  const readOnly = useAppSelector((st) => st.project.readOnly)
  const canDeploy = useProjectPermissions().can('deployment:run')
  const commands = useCommands()
  const toEntry = (c: Command): MenuEntry => ({ label: c.label, shortcut: c.shortcut, onSelect: c.run, disabled: c.enabled ? !c.enabled() : false })
  const menus = MENU_GROUPS.map((g) => ({
    label: g,
    items: g === 'View'
      ? [...commands.filter((c) => c.group === 'View').map(toEntry), { kind: 'separator' as const }, ...commands.filter((c) => c.group === 'Go').map(toEntry)]
      : commands.filter((c) => c.group === g).map(toEntry),
  }))
  const deploy = commands.find((c) => c.id === 'deploy')!

  return (
    <header className={s.bar}>
      <button className={s.logo} onClick={() => navigate('/')} aria-label="All projects">
        <svg width="15" height="15" viewBox="0 0 16 16"><path d="M2 14 L8 2 L14 14" fill="none" stroke="var(--acc)" strokeWidth="2" /><path d="M5 10 H11" stroke="var(--tx-1)" strokeWidth="1.6" /></svg>
        <span>{doc.name}</span>
      </button>
      <MenuBar menus={menus} />
      <nav className={s.tabs}>
        {WORKSPACES.map((w, i) => (
          <Tooltip key={w.id} content={w.hint} shortcut={String(i + 1)}>
            <button className={s.tab} data-on={workspace === w.id || undefined} onClick={() => dispatch(ui.setWorkspace(w.id))}>
              <w.icon size={13} /><span className={s.tabLabel}>{w.label}</span>
            </button>
          </Tooltip>
        ))}
      </nav>
      <div className={s.right}>
        {readOnly ? <Tooltip content="You can view this project but not change it"><span><Badge tone="warn"><Lock size={9} /> read-only</Badge></span></Tooltip> : <SaveState className={s.save} />}
        {live.on && (
          <div className={s.load}>
            <span>Load</span>
            <Slider value={live.load} min={0.5} max={12} step={0.5} width={84} onChange={(v) => dispatch(ui.setLive({ load: v }))} />
            <b>×{live.load}</b>
          </div>
        )}
        <Tooltip content="Simulate traffic through the design" shortcut="R">
          <Button size="sm" variant={live.on ? 'danger' : 'default'} className={live.on ? s.liveOn : undefined} icon={<Activity />} onClick={() => dispatch(ui.setLive({ on: !live.on }))}>{live.on ? 'Live' : 'Simulate'}</Button>
        </Tooltip>
        <div className={s.env}>
          <Select aria-label="Environment" value={envId} onChange={(v) => dispatch(ui.setEnv(v))} options={doc.environments.map((e) => ({ value: e.id, label: e.name }))} />
        </div>
        <Tooltip content={canDeploy ? 'Deploy the selected environment' : 'You are not allowed to deploy to this environment'}><span><Button size="sm" variant="primary" icon={<Rocket />} disabled={!canDeploy} onClick={deploy.run}>Deploy</Button></span></Tooltip>
      </div>
    </header>
  )
}

import { useEffect, useState, type ComponentType } from 'react'
import { Bot, SlidersHorizontal } from 'lucide-react'
import { TabStrip } from '@/ui'
import { AgentPanel } from '@/features/agent/AgentPanel'
import { bus } from '@/lib/bus'
import s from './RightPanel.module.css'

export function RightPanel({ Inspector }: { Inspector: ComponentType }) {
  const [tab, setTab] = useState<'inspect' | 'agent'>('inspect')
  useEffect(() => bus.on('focus-agent', () => setTab('agent')), [])
  return (
    <div className={s.wrap}>
      <TabStrip className={s.tabs} value={tab} onChange={setTab} tabs={[{ value: 'inspect', label: 'Inspector', icon: <SlidersHorizontal /> }, { value: 'agent', label: 'Agent', icon: <Bot /> }]} />
      <div className={s.body}>{tab === 'inspect' ? <Inspector /> : <AgentPanel />}</div>
    </div>
  )
}

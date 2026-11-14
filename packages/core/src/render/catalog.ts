import type { Block, ConfigValue } from '../domain/types'

export type BlockGroup = 'Layout' | 'Content' | 'Data' | 'Forms' | 'Marketing'

export interface BlockMeta {
  type: string
  /** The component exported by blocks.tsx. */
  component: string
  label: string
  group: BlockGroup
  defaults: Record<string, ConfigValue>
  dataKeys?: ('source' | 'action')[]
}

export const BLOCK_CATALOG: BlockMeta[] = [
  { type: 'navbar', component: 'Navbar', label: 'Navigation bar', group: 'Layout', defaults: { brand: 'Brand', links: 'Product, Pricing, Docs', cta: 'Sign in' } },
  { type: 'banner', component: 'Banner', label: 'Announcement banner', group: 'Layout', defaults: { text: 'New: something worth announcing', bg: '#1a1a1a' } },
  { type: 'hero', component: 'Hero', label: 'Hero', group: 'Marketing', defaults: { headline: 'A clear headline that says what this is.', sub: 'One or two sentences of supporting copy.', cta: 'Get started', image: '#cfc8bc' } },
  { type: 'features', component: 'Features', label: 'Feature list', group: 'Marketing', defaults: { title: 'Why teams choose us', items: 'Fast:Built for speed, Secure:SOC 2 ready, Flexible:Runs anywhere' } },
  { type: 'stats', component: 'Stats', label: 'Stat tiles', group: 'Data', defaults: { items: 'Users:12,408, Active today:1,982, Revenue:$48.2k' }, dataKeys: ['source'] },
  { type: 'grid', component: 'Grid', label: 'Card grid', group: 'Data', defaults: { title: 'Items', columns: 4, limit: 8 }, dataKeys: ['source'] },
  { type: 'table', component: 'Table', label: 'Data table', group: 'Data', defaults: { title: 'Records', columns: 'Name, Status, Owner, Updated', rows: 6 }, dataKeys: ['source'] },
  { type: 'kanban', component: 'Kanban', label: 'Kanban board', group: 'Data', defaults: { columns: 'Todo, Doing, Done' }, dataKeys: ['source', 'action'] },
  { type: 'detail', component: 'Detail', label: 'Detail view', group: 'Data', defaults: { title: 'Item title', cta: 'Primary action', live: false }, dataKeys: ['source', 'action'] },
  { type: 'cart', component: 'Cart', label: 'Line items + checkout', group: 'Forms', defaults: { cta: 'Checkout' }, dataKeys: ['action'] },
  { type: 'form', component: 'Form', label: 'Form', group: 'Forms', defaults: { title: 'Form', fields: 'Name, Email', submit: 'Save' }, dataKeys: ['action'] },
  { type: 'upload', component: 'Upload', label: 'File upload', group: 'Forms', defaults: { label: 'Drop files here or browse' }, dataKeys: ['action'] },
  { type: 'chat', component: 'Chat', label: 'Chat / conversation', group: 'Data', defaults: { title: 'Conversation' }, dataKeys: ['source', 'action'] },
  { type: 'pricing', component: 'Pricing', label: 'Pricing table', group: 'Marketing', defaults: { tiers: 'Free:$0, Pro:$12, Enterprise:Contact' } },
  { type: 'testimonial', component: 'Testimonial', label: 'Testimonial', group: 'Marketing', defaults: { quote: 'It changed how our team ships.', author: 'Alex Rivera, CTO' } },
  { type: 'faq', component: 'Faq', label: 'FAQ', group: 'Content', defaults: { title: 'Questions', items: 'Is there a free plan?:Yes, Can I self-host?:Yes, on any VPS' } },
  { type: 'text', component: 'Text', label: 'Text section', group: 'Content', defaults: { heading: 'Heading', body: 'Body copy.' } },
  { type: 'footer', component: 'Footer', label: 'Footer', group: 'Layout', defaults: { text: '© 2026 Company' } },
]

export const BLOCK_META: Record<string, BlockMeta> = Object.fromEntries(BLOCK_CATALOG.map((b) => [b.type, b]))

/** The props a block renders with: its defaults, overridden by what was set in the editor. Data bindings are left out. */
export function blockProps(b: Block): Record<string, ConfigValue> {
  const merged = { ...(BLOCK_META[b.type]?.defaults ?? {}), ...b.props }
  delete merged.source
  delete merged.action
  return merged
}

export const isBound = (b: Block) => typeof b.props.source === 'string' && b.props.source.includes(':')

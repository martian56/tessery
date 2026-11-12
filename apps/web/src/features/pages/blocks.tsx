import type { ReactNode } from 'react'
import type { Block, ConfigValue } from '@tessery/core/domain/types'
import s from './Preview.module.css'

export type Device = 'desktop' | 'tablet' | 'mobile'
export interface BlockDef { type: string; label: string; group: 'Layout' | 'Content' | 'Data' | 'Forms' | 'Marketing'; defaults: Record<string, ConfigValue>; dataKeys?: ('source' | 'action')[]; render: (p: Record<string, ConfigValue>, d: Device) => ReactNode }

const list = (v: ConfigValue | undefined) => String(v ?? '').split(',').map((x) => x.trim()).filter(Boolean)
const pairs = (v: ConfigValue | undefined) => list(v).map((x) => { const i = x.indexOf(':'); return i < 0 ? [x, ''] : [x.slice(0, i).trim(), x.slice(i + 1).trim()] })
const SW = ['#d9d2c5', '#b9c4bd', '#c9c2d6', '#e0d4bf', '#bcc8d8', '#d6c3bd', '#c6d2c2', '#d8cfd9']
const cols = (want: number, d: Device) => (d === 'mobile' ? Math.min(2, want) : d === 'tablet' ? Math.min(3, want) : want)

export const BLOCKS: BlockDef[] = [
  { type: 'navbar', label: 'Navigation bar', group: 'Layout', defaults: { brand: 'Brand', links: 'Product, Pricing, Docs', cta: 'Sign in' },
    render: (p, d) => <div className={s.nav}><b>{p.brand}</b>{d !== 'mobile' && list(p.links).map((l) => <span key={l}>{l}</span>)}{p.cta && <span className={s.navCta}>{p.cta}</span>}{d === 'mobile' && <span className={s.burger}>☰</span>}</div> },
  { type: 'banner', label: 'Announcement banner', group: 'Layout', defaults: { text: 'New: something worth announcing', bg: '#1a1a1a' },
    render: (p) => <div className={s.banner} style={{ background: String(p.bg) }}>{p.text}</div> },
  { type: 'hero', label: 'Hero', group: 'Marketing', defaults: { headline: 'A clear headline that says what this is.', sub: 'One or two sentences of supporting copy.', cta: 'Get started', image: '#cfc8bc' },
    render: (p, d) => <div className={s.hero} style={{ gridTemplateColumns: d === 'mobile' ? '1fr' : '1.1fr 1fr' }}><div><h1>{p.headline}</h1><p>{p.sub}</p>{p.cta && <span className={s.cta}>{p.cta}</span>}</div><div className={s.img} style={{ background: `linear-gradient(135deg, ${p.image}, #9e968a)` }} /></div> },
  { type: 'features', label: 'Feature list', group: 'Marketing', defaults: { title: 'Why teams choose us', items: 'Fast:Built for speed, Secure:SOC 2 ready, Flexible:Runs anywhere' },
    render: (p, d) => <div className={s.sec}><h3>{p.title}</h3><div className={s.grid} style={{ gridTemplateColumns: `repeat(${cols(3, d)}, 1fr)` }}>{pairs(p.items).map(([t, x]) => <div key={t} className={s.feature}><b>{t}</b><span>{x}</span></div>)}</div></div> },
  { type: 'stats', label: 'Stat tiles', group: 'Data', defaults: { items: 'Users:12,408, Active today:1,982, Revenue:$48.2k' }, dataKeys: ['source'],
    render: (p, d) => <div className={s.sec}><div className={s.grid} style={{ gridTemplateColumns: `repeat(${cols(pairs(p.items).length || 3, d)}, 1fr)` }}>{pairs(p.items).map(([k, v]) => <div key={k} className={s.stat}><span>{k}</span><b>{v}</b></div>)}</div></div> },
  { type: 'grid', label: 'Card grid', group: 'Data', defaults: { title: 'Items', columns: 4, limit: 8 }, dataKeys: ['source'],
    render: (p, d) => <div className={s.sec}>{p.title && <h3>{p.title}</h3>}<div className={s.grid} style={{ gridTemplateColumns: `repeat(${cols(Number(p.columns) || 4, d)}, 1fr)` }}>{Array.from({ length: Math.max(1, Number(p.limit) || 4) }, (_, i) => <div key={i} className={s.card}><div className={s.cardImg} style={{ background: SW[i % SW.length] }} /><b>Item {i + 1}</b><span>Short description</span></div>)}</div></div> },
  { type: 'table', label: 'Data table', group: 'Data', defaults: { title: 'Records', columns: 'Name, Status, Owner, Updated', rows: 6 }, dataKeys: ['source'],
    render: (p) => <div className={s.sec}>{p.title && <h3>{p.title}</h3>}<table className={s.table}><thead><tr>{list(p.columns).map((c) => <th key={c}>{c}</th>)}</tr></thead><tbody>{Array.from({ length: Number(p.rows) || 5 }, (_, i) => <tr key={i}>{list(p.columns).map((c, j) => <td key={c}>{j === 0 ? `Record ${i + 1}` : j === 1 ? ['Active', 'Pending', 'Done'][i % 3] : j === 2 ? ['Ada', 'Lin', 'Omar', 'Sofia'][i % 4] : `${i + 1}h ago`}</td>)}</tr>)}</tbody></table></div> },
  { type: 'kanban', label: 'Kanban board', group: 'Data', defaults: { columns: 'Todo, Doing, Done' }, dataKeys: ['source', 'action'],
    render: (p, d) => <div className={s.sec}><div className={s.grid} style={{ gridTemplateColumns: `repeat(${d === 'mobile' ? 1 : list(p.columns).length}, 1fr)` }}>{list(p.columns).map((c, i) => <div key={c} className={s.lane}><b>{c}</b>{Array.from({ length: 3 - (i % 2) }, (_, j) => <div key={j} className={s.ticket}>Task {i * 3 + j + 1}</div>)}</div>)}</div></div> },
  { type: 'detail', label: 'Detail view', group: 'Data', defaults: { title: 'Item title', cta: 'Primary action', live: false }, dataKeys: ['source', 'action'],
    render: (p, d) => <div className={s.hero} style={{ gridTemplateColumns: d === 'mobile' ? '1fr' : '1fr 1fr' }}><div className={s.img} style={{ background: SW[2], height: 260 }} /><div><h1 style={{ fontSize: 26 }}>{p.title}</h1><p>Descriptive text pulled from the bound data source.</p>{p.live && <span className={s.live}>● live via WebSocket</span>}<br /><br /><span className={s.cta}>{p.cta}</span></div></div> },
  { type: 'cart', label: 'Line items + checkout', group: 'Forms', defaults: { cta: 'Checkout' }, dataKeys: ['action'],
    render: (p) => <div className={s.sec}>{[0, 1].map((i) => <div key={i} className={s.line}><div className={s.thumb} style={{ background: SW[i] }} /><b>Line item {i + 1}</b><span>${(i + 1) * 49}</span></div>)}<div style={{ textAlign: 'right', marginTop: 16 }}><span className={s.cta}>{p.cta} · $147</span></div></div> },
  { type: 'form', label: 'Form', group: 'Forms', defaults: { title: 'Form', fields: 'Name, Email', submit: 'Save' }, dataKeys: ['action'],
    render: (p) => <div className={s.sec} style={{ maxWidth: 440 }}>{p.title && <h3>{p.title}</h3>}{list(p.fields).map((f) => <label key={f} className={s.field}>{f}<div className={s.input}>{/mail/i.test(f) ? 'ada@example.com' : ''}</div></label>)}<span className={s.cta}>{p.submit}</span></div> },
  { type: 'upload', label: 'File upload', group: 'Forms', defaults: { label: 'Drop files here or browse' }, dataKeys: ['action'],
    render: (p) => <div className={s.sec}><div className={s.drop}>{p.label}</div></div> },
  { type: 'chat', label: 'Chat / conversation', group: 'Data', defaults: { title: 'Conversation' }, dataKeys: ['source', 'action'],
    render: (p) => <div className={s.sec}><h3>{p.title}</h3><div className={s.chat}><div className={s.bubble}>How do I rotate my API key?</div><div className={`${s.bubble} ${s.me}`}>Settings → API keys → Rotate. The old key stays valid for 24h.</div><div className={s.chatInput}>Type a message…</div></div></div> },
  { type: 'pricing', label: 'Pricing table', group: 'Marketing', defaults: { tiers: 'Free:$0, Pro:$12, Enterprise:Contact' },
    render: (p, d) => <div className={s.sec}><div className={s.grid} style={{ gridTemplateColumns: `repeat(${cols(pairs(p.tiers).length, d)}, 1fr)` }}>{pairs(p.tiers).map(([n, v], i) => <div key={n} className={s.tier} data-hl={i === 1 || undefined}><span>{n}</span><b>{v}</b><span className={s.cta}>Choose</span></div>)}</div></div> },
  { type: 'testimonial', label: 'Testimonial', group: 'Marketing', defaults: { quote: 'It changed how our team ships.', author: 'Alex Rivera, CTO' },
    render: (p) => <div className={s.sec}><blockquote className={s.quote}>“{p.quote}”<cite>{p.author}</cite></blockquote></div> },
  { type: 'faq', label: 'FAQ', group: 'Content', defaults: { items: 'Is there a free plan?:Yes, Can I self-host?:Yes, on any VPS' },
    render: (p) => <div className={s.sec}><h3>Questions</h3>{pairs(p.items).map(([q, a]) => <div key={q} className={s.faq}><b>{q}</b><span>{a}</span></div>)}</div> },
  { type: 'text', label: 'Text section', group: 'Content', defaults: { heading: 'Heading', body: 'Body copy.' },
    render: (p) => <div className={s.sec}><h3>{p.heading}</h3><p className={s.body}>{p.body}</p></div> },
  { type: 'footer', label: 'Footer', group: 'Layout', defaults: { text: '© 2026 Company' },
    render: (p) => <div className={s.footer}>{p.text}</div> },
]
export const BLOCK_BY_TYPE: Record<string, BlockDef> = Object.fromEntries(BLOCKS.map((b) => [b.type, b]))

export function renderBlock(b: Block, d: Device) {
  const def = BLOCK_BY_TYPE[b.type]
  if (!def) return <div className={s.sec}><i>Unknown block “{b.type}”</i></div>
  return def.render({ ...def.defaults, ...b.props }, d)
}

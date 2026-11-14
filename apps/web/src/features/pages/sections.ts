import type { ElementSeed } from './canvas/tools'

const container = { width: '100%', maxWidth: 1120, marginLeft: 'auto', marginRight: 'auto' }
const heading = (text: string, size = 44, tag = 'h2'): ElementSeed => ({ type: 'text', name: 'Heading', props: { tag, text }, style: { fontSize: size, lineHeight: 1.08, letterSpacing: -1, fontWeight: 700, color: 'var(--c-text)', textWrap: 'balance' } })
const body = (text: string, size = 18): ElementSeed => ({ type: 'text', name: 'Body', props: { tag: 'p', text }, style: { fontSize: size, lineHeight: 1.6, color: 'var(--c-muted)', maxWidth: 620 } })
const search = (placeholder: string, action: string): ElementSeed => ({ type: 'frame', name: 'Search', props: { tag: 'form', href: action, role: 'search' }, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '0 12px', height: 40, border: '1px solid var(--c-border)', borderRadius: 'var(--radius)', background: 'var(--c-surface)', width: '100%', maxWidth: 420 }, focus: { borderColor: 'var(--c-primary)', boxShadow: '0 0 0 3px color-mix(in srgb, var(--c-primary) 22%, transparent)' }, children: [
  { type: 'icon', name: 'Search icon', props: { name: 'search' }, style: { width: 16, height: 16, color: 'var(--c-muted)' } },
  { type: 'input', name: 'Query', props: { kind: 'search', name: 'q', placeholder }, style: { flex: 1, border: 0, background: 'transparent', outline: 'none', fontSize: 14, height: '100%' } },
] })
const navItem = (icon: string, text: string, href: string, count?: string): ElementSeed => ({ type: 'frame', name: text, props: { href }, style: { display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, fontSize: 14, color: 'var(--c-muted)' }, hover: { background: 'color-mix(in srgb, var(--c-text) 5%, transparent)', color: 'var(--c-text)' }, current: { background: 'color-mix(in srgb, var(--c-text) 8%, transparent)', color: 'var(--c-text)', fontWeight: 500 }, children: [
  { type: 'icon', props: { name: icon }, style: { width: 16, height: 16 } },
  { type: 'text', props: { tag: 'span', text }, style: { flex: 1 } },
  ...(count ? [{ type: 'text' as const, props: { tag: 'span', text: count }, style: { fontSize: 12, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' } }] : []),
] })
const tab = (text: string, href: string, count: string): ElementSeed => ({ type: 'frame', name: text, props: { href }, style: { display: 'flex', alignItems: 'center', gap: 8, padding: '12px 4px', fontSize: 14, color: 'var(--c-muted)', borderBottom: '2px solid transparent', marginBottom: -1 }, hover: { color: 'var(--c-text)' }, current: { color: 'var(--c-text)', fontWeight: 600, borderBottom: '2px solid var(--c-primary)' }, children: [
  { type: 'text', props: { tag: 'span', text } },
  { type: 'text', name: 'Count', props: { tag: 'span', text: count }, style: { fontSize: 12, padding: '1px 7px', borderRadius: 999, background: 'color-mix(in srgb, var(--c-text) 8%, transparent)', fontVariantNumeric: 'tabular-nums' } },
] })
const button = (text: string, primary = true): ElementSeed => ({ type: 'button', name: 'Button', props: { text, href: '#' }, style: primary ? { padding: '14px 24px', background: 'var(--c-primary)', color: 'var(--c-onPrimary)', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: 15 } : { padding: '14px 24px', border: '1px solid var(--c-border)', color: 'var(--c-text)', borderRadius: 'var(--radius)', fontWeight: 600, fontSize: 15 } })

export const ELEMENTS: { label: string; seed: ElementSeed }[] = [
  { label: 'Frame', seed: { type: 'frame', name: 'Frame', style: { display: 'flex', flexDirection: 'column', gap: 16, padding: 24 } } },
  { label: 'Row', seed: { type: 'frame', name: 'Row', style: { display: 'flex', flexDirection: 'row', gap: 16, alignItems: 'center', flexWrap: 'wrap' } } },
  { label: 'Grid', seed: { type: 'frame', name: 'Grid', style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 24 }, children: [] } },
  { label: 'Heading', seed: heading('A heading with intent', 40) },
  { label: 'Paragraph', seed: body('Supporting copy that explains the idea in one or two sentences.') },
  { label: 'Button', seed: button('Get started') },
  { label: 'Image', seed: { type: 'image', name: 'Image', props: { src: '', alt: '' }, style: { width: '100%', height: 320, objectFit: 'cover', borderRadius: 'var(--radius)', background: 'var(--c-border)' } } },
  { label: 'Divider', seed: { type: 'shape', name: 'Divider', style: { width: '100%', height: 1, background: 'var(--c-border)' } } },
  { label: 'Icon', seed: { type: 'icon', name: 'Icon', props: { name: 'sparkles' }, style: { width: 20, height: 20, color: 'var(--c-text)' } } },
  { label: 'Input', seed: { type: 'input', name: 'Input', props: { kind: 'text', name: 'q', placeholder: 'Type here' }, style: { padding: '10px 12px', border: '1px solid var(--c-border)', borderRadius: 'var(--radius)', background: 'var(--c-surface)', fontSize: 15, width: '100%' }, focus: { borderColor: 'var(--c-primary)', outline: 'none', boxShadow: '0 0 0 3px color-mix(in srgb, var(--c-primary) 25%, transparent)' } } },
  { label: 'Checkbox', seed: { type: 'frame', name: 'Checkbox', props: { tag: 'label' }, style: { display: 'flex', alignItems: 'center', gap: 8, fontSize: 15, cursor: 'pointer' }, children: [{ type: 'input', name: 'Box', props: { kind: 'checkbox', name: 'agree' }, style: { width: 16, height: 16 } }, { type: 'text', name: 'Label', props: { tag: 'span', text: 'Email me about changes' } }] } },
  { label: 'Select', seed: { type: 'select', name: 'Select', props: { options: 'Newest, Oldest, Most active', name: 'sort' }, style: { padding: '9px 12px', border: '1px solid var(--c-border)', borderRadius: 'var(--radius)', background: 'var(--c-surface)', fontSize: 14 } } },
  { label: 'Search field', seed: search('Search', '/search') },
  { label: 'Disclosure', seed: { type: 'frame', name: 'Disclosure', props: { tag: 'details' }, style: { borderBottom: '1px solid var(--c-border)', padding: '14px 0' }, children: [
    { type: 'frame', name: 'Summary', props: { tag: 'summary' }, style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontWeight: 600, fontSize: 16 }, children: [{ type: 'text', props: { tag: 'span', text: 'What happens to my data?' } }, { type: 'icon', props: { name: 'chevron-down' }, style: { width: 18, height: 18, color: 'var(--c-muted)', transition: 'rotate .2s' } }] },
    { type: 'text', name: 'Answer', props: { text: 'It stays in your workspace. Export it or delete it at any time.' }, style: { marginTop: 8, color: 'var(--c-muted)', maxWidth: '65ch' } },
  ] } },
  { label: 'Menu', seed: { type: 'frame', name: 'Menu', style: { display: 'flex', flexDirection: 'column' }, children: [
    { type: 'button', name: 'Menu button', props: { text: 'Options', icon: 'chevron-down' }, style: { display: 'inline-flex', flexDirection: 'row-reverse', gap: 6, padding: '8px 12px', border: '1px solid var(--c-border)', borderRadius: 'var(--radius)', fontSize: 14 } },
    { type: 'frame', name: 'Menu list', props: { popover: true }, style: { positionArea: 'bottom span-right', marginTop: 6, minWidth: 200, display: 'flex', flexDirection: 'column', padding: 6, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 'var(--radius)', boxShadow: '0 12px 32px -12px rgb(0 0 0 / 30%)' }, children: ['Rename', 'Duplicate', 'Archive'].map((t) => ({ type: 'button' as const, name: t, props: { text: t, href: '#' }, style: { justifyContent: 'flex-start', padding: '8px 10px', borderRadius: 6, fontSize: 14 }, hover: { background: 'color-mix(in srgb, var(--c-text) 6%, transparent)' } })) },
  ] } },
  { label: 'Record list', seed: { type: 'frame', name: 'Records', props: { tag: 'ul', source: '' }, style: { display: 'flex', flexDirection: 'column', listStyle: 'none', padding: 0, margin: 0 }, children: [
    { type: 'frame', name: 'Row', props: { tag: 'li' }, style: { display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid var(--c-border)' }, children: [{ type: 'text', name: 'Title', props: { tag: 'span', text: '{title}' }, style: { fontWeight: 500 } }, { type: 'text', name: 'Date', props: { tag: 'span', text: '{created_at|date}' }, style: { marginLeft: 'auto', color: 'var(--c-muted)', fontSize: 13, fontVariantNumeric: 'tabular-nums' } }] },
  ] } },
]

export const SECTIONS: { label: string; seed: ElementSeed }[] = [
  {
    label: 'Navigation',
    seed: { type: 'frame', name: 'Navigation', props: { tag: 'header' }, style: { display: 'flex', alignItems: 'center', gap: 32, padding: '20px 32px', borderBottom: '1px solid var(--c-border)' }, children: [
      { type: 'text', name: 'Logo', props: { tag: 'strong', text: 'Brand' }, style: { fontSize: 18, fontWeight: 700, letterSpacing: -0.3, marginRight: 'auto' } },
      { type: 'frame', name: 'Links', props: { tag: 'nav' }, style: { display: 'flex', gap: 28 }, children: ['Product', 'Pricing', 'Customers'].map((t) => ({ type: 'button' as const, name: t, props: { text: t, href: '#' }, style: { color: 'var(--c-muted)', fontSize: 15 } })) },
      button('Start free'),
    ] },
  },
  {
    label: 'Hero, split',
    seed: { type: 'frame', name: 'Hero', props: { tag: 'section' }, style: { display: 'grid', gridTemplateColumns: '1.05fr 1fr', gap: 56, alignItems: 'center', padding: '96px 32px', ...container }, tablet: { gridTemplateColumns: '1fr', padding: '64px 28px' }, children: [
      { type: 'frame', name: 'Copy', style: { display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start' }, children: [heading('Say what it does in eight words or less.', 60, 'h1'), body('Then one sentence on who it is for and why it is better than what they use today.'), { type: 'frame', name: 'Actions', style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }, children: [button('Start free'), button('See how it works', false)] }] },
      { type: 'image', name: 'Visual', props: { src: '', alt: '' }, style: { width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 16, background: 'var(--c-border)' } },
    ] },
  },
  {
    label: 'Feature grid',
    seed: { type: 'frame', name: 'Features', props: { tag: 'section' }, style: { display: 'flex', flexDirection: 'column', gap: 48, padding: '96px 32px', ...container }, children: [
      { type: 'frame', name: 'Intro', style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }, children: [heading('Three reasons teams switch.')] },
      { type: 'frame', name: 'Grid', style: { display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 32 }, tablet: { gridTemplateColumns: '1fr' }, children: ['Fast by default', 'Built to be trusted', 'Yours to change'].map((t, i) => ({
        type: 'frame' as const, name: t, style: { display: 'flex', flexDirection: 'column', gap: 10, paddingTop: 20, borderTop: '1px solid var(--c-border)' }, children: [
          { type: 'text' as const, name: 'Number', props: { tag: 'span', text: `0${i + 1}` }, style: { fontSize: 13, fontWeight: 600, color: 'var(--c-primary)' } },
          { type: 'text' as const, name: 'Title', props: { tag: 'h3', text: t }, style: { fontSize: 22, fontWeight: 650, letterSpacing: -0.4, color: 'var(--c-text)' } },
          body('A specific, concrete benefit with a number in it if you have one.', 16),
        ] })) },
    ] },
  },
  {
    label: 'Stats band',
    seed: { type: 'frame', name: 'Stats', props: { tag: 'section' }, style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 24, padding: '56px 32px', background: 'var(--c-text)', color: 'var(--c-bg)' }, tablet: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' }, children: [['12k', 'teams'], ['99.98%', 'uptime'], ['4.2x', 'faster releases'], ['30 days', 'to payback']].map(([n, l]): ElementSeed => ({
      type: 'frame' as const, name: l, style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
        { type: 'text' as const, name: 'Number', props: { tag: 'strong', text: n }, style: { fontSize: 44, fontWeight: 700, letterSpacing: -1.2 } },
        { type: 'text' as const, name: 'Label', props: { tag: 'span', text: l }, style: { fontSize: 15, opacity: 0.7 } },
      ] })) },
  },
  {
    label: 'Quote',
    seed: { type: 'frame', name: 'Quote', props: { tag: 'section' }, style: { display: 'flex', flexDirection: 'column', gap: 24, padding: '96px 32px', maxWidth: 860, marginLeft: 'auto', marginRight: 'auto' }, children: [
      { type: 'text', name: 'Quote', props: { tag: 'blockquote', text: '“We shipped in a week what had been on the roadmap for a quarter.”' }, style: { fontSize: 34, lineHeight: 1.25, letterSpacing: -0.6, fontWeight: 500, color: 'var(--c-text)' } },
      { type: 'text', name: 'Author', props: { tag: 'span', text: 'Ana Ruiz, Head of Platform at Northwind' }, style: { fontSize: 15, color: 'var(--c-muted)' } },
    ] },
  },
  {
    label: 'Call to action',
    seed: { type: 'frame', name: 'Call to action', props: { tag: 'section' }, style: { display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: 20, padding: '80px 32px', margin: '48px 32px', borderRadius: 24, background: 'var(--c-primary)', color: 'var(--c-onPrimary)' }, children: [
      { type: 'text', name: 'Heading', props: { tag: 'h2', text: 'Ready when you are.' }, style: { fontSize: 48, fontWeight: 700, letterSpacing: -1.2 } },
      { type: 'text', name: 'Body', props: { tag: 'p', text: 'Start free. No card, no sales call.' }, style: { fontSize: 18, opacity: 0.85 } },
      { type: 'button', name: 'Button', props: { text: 'Create an account', href: '#' }, style: { padding: '14px 26px', background: 'var(--c-onPrimary)', color: 'var(--c-primary)', borderRadius: 'var(--radius)', fontWeight: 650 } },
    ] },
  },
  {
    label: 'Footer',
    seed: { type: 'frame', name: 'Footer', props: { tag: 'footer' }, style: { display: 'flex', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', padding: '40px 32px', borderTop: '1px solid var(--c-border)', color: 'var(--c-muted)', fontSize: 14 }, children: [
      { type: 'text', name: 'Copyright', props: { tag: 'span', text: '© 2026 Brand, Inc.' } },
      { type: 'frame', name: 'Links', style: { display: 'flex', gap: 24 }, children: ['Privacy', 'Terms', 'Contact'].map((t) => ({ type: 'button' as const, name: t, props: { text: t, href: '#' }, style: { color: 'var(--c-muted)' } })) },
    ] },
  },
  {
    label: 'App shell, sidebar',
    seed: { type: 'frame', name: 'App shell', style: { display: 'grid', gridTemplateColumns: '240px minmax(0, 1fr)', minHeight: '100vh' }, mobile: { gridTemplateColumns: '1fr' }, children: [
      { type: 'frame', name: 'Sidebar', props: { tag: 'aside' }, style: { position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column', gap: 2, padding: 12, borderRight: '1px solid var(--c-border)', background: 'var(--c-surface)' }, mobile: { display: 'none' }, children: [
        { type: 'text', name: 'Workspace', props: { tag: 'strong', text: 'Workspace' }, style: { padding: '6px 10px 14px', fontSize: 15 } },
        navItem('inbox', 'Inbox', '/inbox', '4'), navItem('circle-dot', 'My issues', '/'), navItem('layers', 'Projects', '/projects'), navItem('settings', 'Settings', '/settings'),
      ] },
      { type: 'frame', name: 'Main', props: { tag: 'main' }, style: { display: 'flex', flexDirection: 'column', minWidth: 0 }, children: [
        { type: 'frame', name: 'Top bar', props: { tag: 'header' }, style: { display: 'flex', alignItems: 'center', gap: 12, height: 52, padding: '0 20px', borderBottom: '1px solid var(--c-border)' }, children: [{ type: 'text', props: { tag: 'h1', text: 'My issues' }, style: { fontSize: 15, fontWeight: 600 } }] },
        { type: 'frame', name: 'Content', style: { padding: 20, display: 'flex', flexDirection: 'column', gap: 16 } },
      ] },
    ] },
  },
  {
    label: 'Issue list',
    seed: { type: 'frame', name: 'Issues', props: { tag: 'ul', source: '' }, style: { display: 'flex', flexDirection: 'column', listStyle: 'none', margin: 0, padding: 0 }, children: [
      { type: 'frame', name: 'Issue row', props: { tag: 'li', href: '/issues/{id}' }, style: { display: 'grid', gridTemplateColumns: '20px 72px minmax(0, 1fr) auto auto', alignItems: 'center', gap: 12, height: 44, padding: '0 20px', borderBottom: '1px solid var(--c-border)', fontSize: 14 }, hover: { background: 'color-mix(in srgb, var(--c-text) 4%, transparent)' }, mobile: { gridTemplateColumns: '20px minmax(0, 1fr) auto' }, children: [
        { type: 'icon', name: 'Status', props: { name: 'circle-dashed' }, style: { width: 16, height: 16, color: 'var(--c-muted)' } },
        { type: 'text', name: 'Key', props: { tag: 'code', text: '{key}' }, style: { fontSize: 12, color: 'var(--c-muted)' }, mobile: { display: 'none' } },
        { type: 'text', name: 'Title', props: { tag: 'span', text: '{title}' }, style: { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
        { type: 'text', name: 'Label', props: { tag: 'span', text: '{label}' }, style: { fontSize: 12, padding: '2px 8px', border: '1px solid var(--c-border)', borderRadius: 999, color: 'var(--c-muted)' }, mobile: { display: 'none' } },
        { type: 'text', name: 'Date', props: { tag: 'time', text: '{created_at|date}' }, style: { fontSize: 12, color: 'var(--c-muted)', fontVariantNumeric: 'tabular-nums' } },
      ] },
    ] },
  },
  {
    label: 'Tabs with counts',
    seed: { type: 'frame', name: 'Tabs', props: { tag: 'nav' }, style: { display: 'flex', gap: 24, padding: '0 24px', borderBottom: '1px solid var(--c-border)', overflowX: 'auto' }, children: [tab('Code', '/', '12'), tab('Issues', '/issues', '48'), tab('Pull requests', '/pulls', '6'), tab('Releases', '/releases', '9')] },
  },
  {
    label: 'Store header',
    seed: { type: 'frame', name: 'Store header', props: { tag: 'header' }, style: { display: 'flex', alignItems: 'center', gap: 20, padding: '12px 24px', background: 'var(--c-text)', color: 'var(--c-bg)' }, children: [
      { type: 'text', name: 'Logo', props: { tag: 'strong', text: 'Store', href: '/' }, style: { fontSize: 20, letterSpacing: -0.5 } },
      { type: 'frame', name: 'Search', props: { tag: 'form', href: '/search', role: 'search' }, style: { display: 'flex', flex: 1, height: 42, borderRadius: 'var(--radius)', overflow: 'hidden', background: 'var(--c-surface)', color: 'var(--c-text)' }, focus: { boxShadow: '0 0 0 3px var(--c-primary)' }, mobile: { display: 'none' }, children: [
        { type: 'select', name: 'Department', props: { options: 'All, Books, Electronics, Home, Toys', name: 'dept' }, style: { border: 0, padding: '0 10px', background: 'color-mix(in srgb, var(--c-text) 6%, var(--c-surface))', fontSize: 13 } },
        { type: 'input', name: 'Query', props: { kind: 'search', name: 'q', placeholder: 'Search the store' }, style: { flex: 1, border: 0, padding: '0 12px', outline: 'none', fontSize: 15 } },
        { type: 'button', name: 'Search button', props: { icon: 'search', submit: true, label: 'Search' }, style: { width: 48, background: 'var(--c-primary)', color: 'var(--c-onPrimary)' } },
      ] },
      { type: 'button', name: 'Account', props: { text: 'Account', icon: 'user', href: '/account' }, style: { fontSize: 14 } },
      { type: 'button', name: 'Cart', props: { text: 'Cart', icon: 'shopping-cart', href: '/cart' }, style: { fontSize: 14, fontWeight: 600 } },
    ] },
  },
  {
    label: 'Product grid',
    seed: { type: 'frame', name: 'Products', props: { source: '' }, style: { display: 'grid', gridTemplateColumns: 'repeat(4, minmax(0, 1fr))', gap: 24, padding: 24 }, tablet: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }, mobile: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14, padding: 14 }, children: [
      { type: 'frame', name: 'Product card', props: { tag: 'article', href: '/products/{id}' }, style: { display: 'flex', flexDirection: 'column', gap: 6 }, children: [
        { type: 'image', name: 'Photo', props: { src: '{image_url}', alt: '{name}' }, style: { width: '100%', aspectRatio: '1', objectFit: 'contain', background: 'color-mix(in srgb, var(--c-text) 4%, var(--c-bg))', borderRadius: 'var(--radius)', marginBottom: 6 } },
        { type: 'text', name: 'Name', props: { tag: 'h3', text: '{name}' }, style: { fontSize: 15, fontWeight: 500, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' } },
        { type: 'frame', name: 'Rating', style: { display: 'flex', alignItems: 'center', gap: 4, fontSize: 13, color: 'var(--c-muted)' }, children: [{ type: 'icon', props: { name: 'star' }, style: { width: 14, height: 14, color: '#e3a008', fill: '#e3a008' } }, { type: 'text', props: { tag: 'span', text: '{rating} ({reviews|number})' } }] },
        { type: 'text', name: 'Price', props: { tag: 'strong', text: '{price|money}' }, style: { fontSize: 20, fontVariantNumeric: 'tabular-nums' } },
      ] },
    ] },
  },
]

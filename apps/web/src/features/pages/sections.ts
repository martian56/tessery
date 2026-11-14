import type { ElementSeed } from './canvas/tools'

const container = { width: '100%', maxWidth: 1120, marginLeft: 'auto', marginRight: 'auto' }
const eyebrow = (text: string): ElementSeed => ({ type: 'text', name: 'Eyebrow', props: { tag: 'span', text }, style: { fontSize: 13, fontWeight: 600, letterSpacing: 1.2, textTransform: 'uppercase', color: 'var(--c-primary)' } })
const heading = (text: string, size = 44, tag = 'h2'): ElementSeed => ({ type: 'text', name: 'Heading', props: { tag, text }, style: { fontSize: size, lineHeight: 1.08, letterSpacing: -1, fontWeight: 700, color: 'var(--c-text)', textWrap: 'balance' } })
const body = (text: string, size = 18): ElementSeed => ({ type: 'text', name: 'Body', props: { tag: 'p', text }, style: { fontSize: size, lineHeight: 1.6, color: 'var(--c-muted)', maxWidth: 620 } })
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
      { type: 'frame', name: 'Copy', style: { display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'flex-start' }, children: [eyebrow('New'), heading('Say what it does in eight words or less.', 60, 'h1'), body('Then one sentence on who it is for and why it is better than what they use today.'), { type: 'frame', name: 'Actions', style: { display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 8 }, children: [button('Start free'), button('See how it works', false)] }] },
      { type: 'image', name: 'Visual', props: { src: '', alt: '' }, style: { width: '100%', aspectRatio: '4 / 3', objectFit: 'cover', borderRadius: 16, background: 'var(--c-border)' } },
    ] },
  },
  {
    label: 'Feature grid',
    seed: { type: 'frame', name: 'Features', props: { tag: 'section' }, style: { display: 'flex', flexDirection: 'column', gap: 48, padding: '96px 32px', ...container }, children: [
      { type: 'frame', name: 'Intro', style: { display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 640 }, children: [eyebrow('Why it works'), heading('Three reasons teams switch.')] },
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
]

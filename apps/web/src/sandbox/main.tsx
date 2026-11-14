// Runs hand-written page components for the page builder's preview. The page builder loads this page in an iframe
// sandboxed without allow-same-origin, so the code here runs with an opaque origin: it cannot read Tessery's
// cookies, storage or pages, and requests it makes do not carry the user's session.
import { Component, type ComponentType, type ReactNode } from 'react'
import * as React from 'react'
import { createRoot } from 'react-dom/client'
import * as Lucide from 'lucide-react'
import { transform } from 'sucrase'

type Render = { type: 'render'; source: string; props: Record<string, unknown>; css: string }

const MODULES: Record<string, unknown> = { react: React, 'lucide-react': Lucide }

function compile(source: string): ComponentType<Record<string, unknown>> {
  const code = transform(source, { transforms: ['typescript', 'jsx', 'imports'], jsxRuntime: 'classic', production: true }).code
  const module = { exports: {} as Record<string, unknown> }
  const require = (name: string) => {
    if (name in MODULES) return MODULES[name]
    throw new Error(`${name} cannot be imported here. Components may import react and lucide-react.`)
  }
  new Function('require', 'module', 'exports', 'React', code)(require, module, module.exports, React)
  const C = module.exports.default
  if (typeof C !== 'function') throw new Error('The component needs a default export, such as export default function Chart() {}.')
  return C as ComponentType<Record<string, unknown>>
}

function Problem({ error }: { error: unknown }) {
  return (
    <pre style={{ margin: 0, padding: 12, font: '12px/1.5 ui-monospace, monospace', color: '#b42318', background: '#fef3f2', border: '1px solid #fecdca', borderRadius: 6, whiteSpace: 'pre-wrap' }}>
      {error instanceof Error ? error.message : String(error)}
    </pre>
  )
}

class Boundary extends Component<{ children: ReactNode }, { error: unknown }> {
  state = { error: null as unknown }
  static getDerivedStateFromError(error: unknown) { return { error } }
  render() { return this.state.error ? <Problem error={this.state.error} /> : this.props.children }
}

const root = createRoot(document.getElementById('root')!)
const style = document.createElement('style')
document.head.append(style)

window.addEventListener('message', (e) => {
  if (e.source !== window.parent) return
  const m = e.data as Render
  if (m?.type !== 'render') return
  style.textContent = `html,body{margin:0;background:transparent}${m.css}`
  try {
    const C = compile(m.source)
    root.render(<Boundary key={m.source}><C {...m.props} /></Boundary>)
  } catch (err) {
    root.render(<Problem error={err} />)
  }
})

new ResizeObserver(() => window.parent.postMessage({ type: 'size', height: document.documentElement.scrollHeight }, '*')).observe(document.body)
window.parent.postMessage({ type: 'ready' }, '*')

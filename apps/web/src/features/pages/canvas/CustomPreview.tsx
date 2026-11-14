import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CustomComponent } from '@tessery/core/domain/types'

/** Renders a hand-written component inside the sandboxed preview page, which has no access to Tessery itself. */
function SandboxFrame({ source, props, css }: { source: string; props: Record<string, unknown>; css: string }) {
  const ref = useRef<HTMLIFrameElement>(null)
  const ready = useRef(false)
  const [height, setHeight] = useState(120)
  const key = JSON.stringify(props)
  const post = useCallback(() => {
    ref.current?.contentWindow?.postMessage({ type: 'render', source, props: JSON.parse(key), css }, '*')
  }, [source, key, css])

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.source !== ref.current?.contentWindow) return
      if (e.data?.type === 'ready') { ready.current = true; post() }
      if (e.data?.type === 'size') setHeight(Math.min(Math.max(Number(e.data.height) || 0, 24), 4000))
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [post])
  useEffect(() => { if (ready.current) post() }, [post])

  return <iframe ref={ref} src="/sandbox.html" sandbox="allow-scripts" title="Component preview" style={{ display: 'block', width: '100%', height, border: 0, pointerEvents: 'none', background: 'transparent' }} />
}

/** The components of one app, as the page tree's custom map, drawn in sandboxes. */
export function useCustomPreviews(components: Record<string, CustomComponent> | undefined, appNodeId: string, css: string) {
  return useMemo(() => {
    const out: Record<string, (p: Record<string, unknown>) => React.ReactNode> = {}
    for (const c of Object.values(components ?? {})) {
      if (c.appNodeId !== appNodeId) continue
      out[c.id] = (props) => <SandboxFrame source={c.source} props={props} css={css} />
    }
    return out
  }, [components, appNodeId, css])
}

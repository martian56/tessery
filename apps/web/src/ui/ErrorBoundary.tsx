import { Component, type ReactNode } from 'react'
import { Button } from './Button'
import { Empty } from './Layout'

export class ErrorBoundary extends Component<{ children: ReactNode; label?: string; resetKey?: unknown }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidUpdate(prev: { resetKey?: unknown }) { if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null }) }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <Empty title={`${this.props.label ?? 'This view'} crashed`} action={<Button variant="primary" onClick={() => this.setState({ error: null })}>Try again</Button>}>
        <span className="mono" style={{ fontSize: 11 }}>{this.state.error.message}</span>
      </Empty>
    )
  }
}

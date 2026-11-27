import { Component, type ReactNode } from 'react'

/** Fängt Darstellungsfehler ab und zeigt sie an, statt dass die Oberfläche leer bleibt. */
export class ErrorBoundary extends Component<{ children: ReactNode; onClose?: () => void }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(error: Error) { console.error('UI-Fehler:', error) }
  render() {
    const { error } = this.state
    if (!error) return this.props.children
    return (
      <div role="alert" className="fixed inset-0 z-50 grid place-items-center bg-bg/80 p-6">
        <div className="glass w-full max-w-lg rounded-card p-6">
          <h2 className="font-display text-[17px] font-semibold">Hier ist ein Fehler aufgetreten</h2>
          <pre className="mt-3 max-h-48 select-text overflow-auto whitespace-pre-wrap rounded-ctl bg-raised/60 p-3 font-mono text-[12px] text-danger">{error.message}{error.stack ? `\n\n${error.stack.split('\n').slice(0, 4).join('\n')}` : ''}</pre>
          <div className="mt-4 flex gap-2">
            <button className="no-drag rounded-ctl bg-accent px-4 py-2 text-[13px] font-medium text-accent-fg" onClick={() => { this.setState({ error: null }); this.props.onClose?.() }}>Schließen</button>
          </div>
        </div>
      </div>
    )
  }
}

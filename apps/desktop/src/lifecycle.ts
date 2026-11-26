/**
 * Hooks, damit Server vor einem Update sauber gestoppt werden.
 * Der Server-Manager (ab Meilenstein 3) registriert sich hier.
 */
export interface ShutdownHook {
  name: string
  /** Anzahl laufender Server, die ein Update unterbrechen würde. */
  activeCount(): number
  /** Warnung im Spiel-Chat, z. B. "Server startet in 60 Sekunden neu". */
  announce(secondsLeft: number): Promise<void> | void
  /** Server sauber stoppen (Welt speichern). */
  stop(): Promise<void>
}

const hooks: ShutdownHook[] = []

export function registerShutdownHook(h: ShutdownHook): () => void {
  hooks.push(h)
  return () => {
    const i = hooks.indexOf(h)
    if (i >= 0) hooks.splice(i, 1)
  }
}

export const activeServerCount = () => hooks.reduce((n, h) => n + h.activeCount(), 0)
export const announceAll = (s: number) => Promise.all(hooks.map((h) => h.announce(s)))
export const stopAll = async () => {
  for (const h of hooks) await h.stop()
}

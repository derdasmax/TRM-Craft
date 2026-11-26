export type UpdaterPhase =
  | 'idle'
  | 'checking'
  | 'uptodate'
  | 'available'
  | 'downloading'
  | 'ready'
  | 'countdown'
  | 'installing'
  | 'error'

export interface UpdaterState {
  phase: UpdaterPhase
  currentVersion: string
  version?: string
  /** Release-Notes als Markdown/Text (aus dem Changelog des GitHub-Releases). */
  notes?: string
  percent?: number
  bytesPerSecond?: number
  secondsLeft?: number
  error?: string
  lastChecked?: number
  /** Wurde zuletzt automatisch auf eine ältere Version zurückgesetzt? */
  rolledBackFrom?: string
}

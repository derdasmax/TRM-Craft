/**
 * Entscheidungslogik für den automatischen Rollback.
 * Reine Funktionen, damit sie ohne Electron testbar sind.
 */
export interface GuardState {
  /** Version, die zuletzt gestartet wurde. */
  version: string
  /** Letzte Version, die nachweislich stabil lief. */
  lastGoodVersion: string | null
  /** Aufeinanderfolgende Starts dieser Version ohne "gesund"-Meldung. */
  failedStarts: number
  /** Versionen, die zurückgerollt wurden und nicht erneut installiert werden dürfen. */
  badVersions: string[]
  /** Version, von der zurückgerollt wurde. Wird beim nächsten Start gemeldet und gelöscht. */
  rollbackNotice: string | null
}

export const MAX_FAILED_STARTS = 3

export const emptyGuardState = (version: string): GuardState => ({
  version,
  lastGoodVersion: null,
  failedStarts: 0,
  badVersions: [],
  rollbackNotice: null,
})

export type GuardAction =
  | { type: 'ok'; state: GuardState }
  | { type: 'rollback'; state: GuardState; target: string; from: string }

/** Wird bei jedem Start aufgerufen, bevor die App als gesund gilt. */
export function onStart(prev: GuardState | null, currentVersion: string): GuardAction {
  const base = prev ?? emptyGuardState(currentVersion)
  const sameVersion = base.version === currentVersion
  const failedStarts = sameVersion ? base.failedStarts + 1 : 1
  const state: GuardState = { ...base, version: currentVersion, failedStarts }

  const canRollback = state.lastGoodVersion !== null && state.lastGoodVersion !== currentVersion
  if (failedStarts > MAX_FAILED_STARTS && canRollback) {
    return {
      type: 'rollback',
      from: currentVersion,
      target: state.lastGoodVersion as string,
      state: { ...state, badVersions: [...new Set([...state.badVersions, currentVersion])], failedStarts: 0, rollbackNotice: currentVersion },
    }
  }
  return { type: 'ok', state }
}

/** Wird aufgerufen, sobald die App lange genug stabil lief. */
export function onHealthy(state: GuardState): GuardState {
  return { ...state, failedStarts: 0, lastGoodVersion: state.version }
}

export function isBadVersion(state: GuardState | null, version: string): boolean {
  return !!state && state.badVersions.includes(version)
}

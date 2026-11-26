import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { emptyGuardState, type GuardState } from '@trm/core'
import { dataDir } from './paths'

const file = () => join(dataDir(), 'guard.json')

export function loadGuard(): GuardState | null {
  try {
    if (!existsSync(file())) return null
    const raw = JSON.parse(readFileSync(file(), 'utf8')) as Partial<GuardState>
    return { ...emptyGuardState(String(raw.version ?? '0.0.0')), ...raw } as GuardState
  } catch {
    return null
  }
}

export function saveGuard(state: GuardState): void {
  const tmp = `${file()}.tmp`
  writeFileSync(tmp, JSON.stringify(state), 'utf8')
  renameSync(tmp, file())
}

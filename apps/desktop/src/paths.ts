import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Alle Nutzerdaten liegen in %APPDATA%/TRM-Craft, nie im Installationsordner. */
export function dataDir(): string {
  const dir = join(app.getPath('appData'), 'TRM-Craft')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function settingsFile(): string {
  return join(dataDir(), 'settings.json')
}

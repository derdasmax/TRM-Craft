import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { defaultSettings, mergeSettings, parseSettings, type DeepPartial, type Settings } from '@trm/core'

/** Einfacher, atomarer JSON-Speicher. Ungültige Dateien fallen auf Defaults zurück. */
export class SettingsStore {
  private current: Settings

  constructor(private readonly file: string) {
    this.current = this.load()
  }

  private load(): Settings {
    if (!existsSync(this.file)) return defaultSettings
    try {
      return parseSettings(JSON.parse(readFileSync(this.file, 'utf8')))
    } catch {
      return defaultSettings
    }
  }

  get(): Settings {
    return this.current
  }

  update(patch: DeepPartial<Settings>): Settings {
    this.current = mergeSettings(this.current, patch)
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(this.current, null, 2), 'utf8')
    renameSync(tmp, this.file)
    return this.current
  }
}

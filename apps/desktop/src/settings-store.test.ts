import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SettingsStore } from './settings-store'

const tmp = () => join(mkdtempSync(join(tmpdir(), 'trm-')), 'settings.json')

describe('SettingsStore', () => {
  it('startet mit Defaults und speichert Änderungen', () => {
    const f = tmp()
    const s = new SettingsStore(f)
    expect(s.get().language).toBe('de')
    s.update({ language: 'en' })
    expect(JSON.parse(readFileSync(f, 'utf8')).language).toBe('en')
    expect(new SettingsStore(f).get().language).toBe('en')
  })

  it('übersteht eine kaputte Datei', () => {
    const f = tmp()
    writeFileSync(f, '{nicht json')
    expect(new SettingsStore(f).get().theme).toBe('dark')
  })
})

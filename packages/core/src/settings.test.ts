import { describe, expect, it } from 'vitest'
import { defaultSettings, mergeSettings, parseSettings } from './settings'
import { roleAllows } from './commands'

describe('settings', () => {
  it('liefert Defaults bei leerem Input', () => {
    expect(parseSettings(undefined)).toEqual(defaultSettings)
    expect(defaultSettings.updates.autoInstall).toBe(true)
    expect(defaultSettings.updates.channel).toBe('stable')
  })

  it('behält gültige Werte und ersetzt nur ungültige', () => {
    const s = parseSettings({ language: 'en', theme: 'kaputt', accent: 'rose' })
    expect(s.language).toBe('en')
    expect(s.accent).toBe('rose')
    expect(s.theme).toBe('dark')
  })

  it('merged verschachtelte Patches', () => {
    const s = mergeSettings(defaultSettings, { updates: { channel: 'beta' } })
    expect(s.updates.channel).toBe('beta')
    expect(s.updates.autoInstall).toBe(true)
  })

  it('Fernzugriff ist standardmäßig aus und prüft Werte', () => {
    expect(defaultSettings.remote).toMatchObject({ enabled: false, mode: 'tunnel', port: 47821, allowedOrigins: [], maxRole: 'admin' })
    expect(parseSettings({ remote: { maxRole: 'owner' } }).remote.maxRole).toBe('admin')
    expect(mergeSettings(defaultSettings, { remote: { enabled: true } }).remote.port).toBe(47821)
    // Nur exakte https-Origins (oder localhost) sind erlaubt, keine Pfade und keine Platzhalter.
    expect(parseSettings({ remote: { allowedOrigins: ['https://trm.beispiel.net'] } }).remote.allowedOrigins).toEqual(['https://trm.beispiel.net'])
    for (const bad of ['*', 'http://trm.beispiel.net', 'https://trm.beispiel.net/pfad', 'trm.beispiel.net']) expect(parseSettings({ remote: { allowedOrigins: [bad] } }).remote.allowedOrigins, bad).toEqual([])
  })

  it('begrenzt das Update-Intervall', () => {
    const s = parseSettings({ updates: { checkIntervalHours: 9999 } })
    expect(s.updates.checkIntervalHours).toBe(6)
  })
})

describe('roles', () => {
  it('viewer darf nur lesen', () => {
    expect(roleAllows('viewer', 'settings.get')).toBe(true)
    expect(roleAllows('viewer', 'settings.update')).toBe(false)
    expect(roleAllows('admin', 'settings.update')).toBe(true)
    expect(roleAllows('admin', 'shell.openExternal')).toBe(false)
  })
})

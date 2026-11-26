import { describe, expect, it } from 'vitest'
import { safeJoin, safeRelativePath, sanitizeFilename } from './sanitize'

describe('sanitizeFilename', () => {
  it('lässt normale Mod-Namen durch', () => expect(sanitizeFilename('sodium-fabric-0.6.0+mc1.21.jar')).toBe('sodium-fabric-0.6.0+mc1.21.jar'))
  it('entfernt Pfade', () => {
    expect(sanitizeFilename('../../evil.jar')).toBe('evil.jar')
    expect(sanitizeFilename('C:\\Windows\\x.jar')).toBe('x.jar')
  })
  it('lehnt falsche Endungen und reservierte Namen ab', () => {
    expect(() => sanitizeFilename('x.exe')).toThrow()
    expect(() => sanitizeFilename('CON.jar')).toThrow()
    expect(() => sanitizeFilename('')).toThrow()
  })
  it('ersetzt Sonderzeichen', () => expect(sanitizeFilename('a<b>:c.jar')).toBe('a_b__c.jar'))
})

describe('safeJoin / safeRelativePath', () => {
  it('blockiert Ausbrüche', () => {
    expect(() => safeJoin('/srv/a', '..', 'b')).toThrow()
    expect(() => safeJoin('/srv/a', '/etc/passwd')).toThrow()
    expect(safeJoin('/srv/a', 'mods', 'x.jar')).toMatch(/mods[\\/]x\.jar$/)
  })
  it('prüft Modpack-Pfade', () => {
    expect(safeRelativePath('mods/a.jar')).toBe('mods/a.jar')
    for (const bad of ['../x', '/x', 'C:/x', 'a/../b', 'a//b', '']) expect(() => safeRelativePath(bad), bad).toThrow()
  })
})

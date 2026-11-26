import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SecretStore, type Cipher } from './secrets'

const xor: Cipher = {
  isAvailable: () => true,
  encrypt: (s) => Buffer.from([...Buffer.from(s)].map((b) => b ^ 0x5a)),
  decrypt: (d) => Buffer.from([...d].map((b) => b ^ 0x5a)).toString(),
}
const file = () => join(mkdtempSync(join(tmpdir(), 'trm-sec-')), 's.json')

describe('SecretStore', () => {
  it('speichert nie im Klartext und liest zurück', () => {
    const f = file()
    const s = new SecretStore(f, xor)
    s.set('curseforge', 'geheim-key-123')
    expect(readFileSync(f, 'utf8')).not.toContain('geheim-key-123')
    expect(new SecretStore(f, xor).get('curseforge')).toBe('geheim-key-123')
    expect(s.has('curseforge')).toBe(true)
  })
  it('löscht Einträge', () => {
    const s = new SecretStore(file(), xor)
    s.set('x', 'v')
    s.delete('x')
    expect(s.has('x')).toBe(false)
    expect(s.get('x')).toBeNull()
  })
  it('weigert sich ohne Verschlüsselung (kein Klartext-Fallback)', () => {
    const f = file()
    const s = new SecretStore(f, { ...xor, isAvailable: () => false })
    expect(() => s.set('x', 'v')).toThrow(/nicht verfügbar/)
    expect(() => s.set('x', '   ')).toThrow()
  })
})

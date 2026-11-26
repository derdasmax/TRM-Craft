import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { DeviceStore, minRole, PairingCodes, SessionStore } from './devices'

describe('Geräte und Sitzungen', () => {
  it('speichert nur den Hash des Gerät-Tokens und kann widerrufen', () => {
    const file = join(mkdtempSync(join(tmpdir(), 'trm-dev-')), 'd.json')
    const s = new DeviceStore(file)
    const { device, token } = s.add('Webseite', { upload: true }, 'moderator')
    expect(readFileSync(file, 'utf8')).not.toContain(token)
    expect(s.verify(token)?.id).toBe(device.id)
    expect(s.verify(`${token}x`)).toBeNull()
    expect(new DeviceStore(file).verify(token)?.id).toBe(device.id) // übersteht Neustart
    s.revoke(device.id)
    expect(s.verify(token)).toBeNull()
  })

  it('Sitzungsrolle ist nie höher als Gerät oder Obergrenze, und Sitzungen laufen ab', () => {
    let t = 1000
    const devs = new DeviceStore(join(mkdtempSync(join(tmpdir(), 'trm-dev-')), 'd.json'), () => t)
    const ss = new SessionStore(() => t)
    const { device } = devs.add('x', { upload: false }, 'admin')
    expect(ss.mint(device, 'a', 'owner', 'admin').session.role).toBe('admin')
    expect(ss.mint(device, 'a', 'owner', 'viewer').session.role).toBe('viewer')
    expect(ss.mint(device, 'a', 'viewer', 'admin').session.role).toBe('viewer')
    const m = ss.mint(device, 'a', 'admin', 'admin', 60)
    expect(ss.verify(m.token)).not.toBeNull()
    t += 61_000
    expect(ss.verify(m.token)).toBeNull()
    expect(minRole('moderator', 'admin')).toBe('moderator')
  })

  it('Kopplungscode ist einmalig, läuft ab und wird bei Fehlversuchen gedrosselt', () => {
    let t = 0
    const p = new PairingCodes(() => t)
    const o = p.start({ upload: true })
    expect(o.code).toMatch(/^[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/)
    expect(p.attempt(o.code.toLowerCase(), '1.1.1.1')).toEqual({ perms: { upload: true } })
    expect(p.attempt(o.code, '1.1.1.1')).toBeNull()
    const o2 = p.start({ upload: false })
    t += 10 * 60_000 + 1
    expect(p.attempt(o2.code, '2.2.2.2')).toBeNull()
    p.start({ upload: false })
    for (let i = 0; i < 8; i++) p.attempt('AAAA-BBBB', '3.3.3.3')
    expect(p.attempt('AAAA-BBBB', '3.3.3.3')).toBe('limited')
  })
})

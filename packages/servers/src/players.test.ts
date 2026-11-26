import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PlayerTracker, playerCommand } from './players'

const file = () => join(mkdtempSync(join(tmpdir(), 'trm-pl-')), 'players.json')

describe('PlayerTracker', () => {
  it('zählt Sitzungen und Spielzeit', () => {
    let t = 1000
    const p = new PlayerTracker(file(), () => t)
    p.join('Steve')
    t += 60_000
    expect(p.list()[0]).toMatchObject({ name: 'Steve', online: true, playMs: 60_000, sessions: 1 })
    p.leave('Steve')
    t += 5000
    p.join('Steve')
    t += 30_000
    p.leaveAll()
    const e = p.list()[0]!
    expect(e).toMatchObject({ online: false, sessions: 2, playMs: 90_000, firstSeen: 1000 })
  })
  it('bleibt nach einem Neustart erhalten', () => {
    const f = file()
    const a = new PlayerTracker(f, () => 5)
    a.join('Alex')
    a.leave('Alex')
    expect(new PlayerTracker(f).list()[0]?.name).toBe('Alex')
  })
  it('sortiert Online-Spieler zuerst', () => {
    let t = 0
    const p = new PlayerTracker(file(), () => t)
    p.join('A'); t = 10; p.leave('A'); t = 20; p.join('B')
    expect(p.list().map((x) => x.name)).toEqual(['B', 'A'])
  })
})

describe('playerCommand', () => {
  it('baut Java-Befehle', () => {
    expect(playerCommand('java', 'kick', 'Steve', 'AFK')).toBe('kick Steve AFK')
    expect(playerCommand('java', 'gamemode', 'Steve', 'creative')).toBe('gamemode creative Steve')
    expect(playerCommand('java', 'whitelistAdd', 'Steve')).toBe('whitelist add Steve')
    expect(playerCommand('java', 'tp', 'Steve', 'Alex')).toBe('tp Steve Alex')
  })
  it('baut Bedrock-Befehle mit Leerzeichen im Namen', () => {
    expect(playerCommand('bedrock', 'op', 'Steve Smith')).toBe('op "Steve Smith"')
    expect(playerCommand('bedrock', 'whitelistAdd', 'Steve')).toBe('allowlist add Steve')
  })
  it('verhindert Befehls-Einschleusung', () => {
    expect(() => playerCommand('java', 'op', 'Steve\nstop')).toThrow()
    expect(() => playerCommand('java', 'op', 'Steve; stop')).toThrow()
    expect(() => playerCommand('java', 'op', 'a b')).toThrow()
    expect(() => playerCommand('java', 'gamemode', 'Steve', 'creative\nstop')).toThrow()
    expect(playerCommand('java', 'kick', 'Steve', 'grund\nop evil')).toBe('kick Steve grund op evil')
    expect(playerCommand('java', 'say', 'Hallo\nstop')).toBe('say Hallo stop')
  })
})

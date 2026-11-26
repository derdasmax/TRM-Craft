import { describe, expect, it } from 'vitest'
import { parseProperties, updateProperties } from './properties'

const sample = '#Minecraft server properties\r\n#Mon Jan 01\r\nmotd=A Minecraft Server\r\nserver-port=25565\r\npvp=true\r\n'

describe('properties', () => {
  it('parst Schlüssel und ignoriert Kommentare', () => {
    expect(parseProperties(sample)).toEqual({ motd: 'A Minecraft Server', 'server-port': '25565', pvp: 'true' })
  })
  it('aktualisiert vorhandene und hängt neue Werte an, Kommentare bleiben', () => {
    const out = updateProperties(sample, { pvp: 'false', 'level-seed': '42' })
    expect(out).toContain('#Minecraft server properties')
    expect(parseProperties(out)).toMatchObject({ pvp: 'false', 'level-seed': '42', 'server-port': '25565' })
  })
  it('verweigert Injection über Zeilenumbrüche und fremde Schlüssel', () => {
    expect(() => updateProperties('', { motd: 'a\nop=true' })).toThrow()
    expect(() => updateProperties('', { 'a b': 'x' })).toThrow()
  })
})

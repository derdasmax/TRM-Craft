import { describe, expect, it } from 'vitest'
import { lineLevel, parseColored } from './mccolors'

describe('parseColored', () => {
  it('parst ANSI-Farben und Reset', () => {
    expect(parseColored('\x1b[31mRot\x1b[0m Normal')).toEqual([{ text: 'Rot', color: '#ff6b6b' }, { text: ' Normal' }])
  })
  it('parst Minecraft-§-Codes', () => {
    expect(parseColored('§aGrün§r!')).toEqual([{ text: 'Grün', color: '#55ff55' }, { text: '!' }])
    expect(parseColored('§lFett')).toEqual([{ text: 'Fett', bold: true }])
  })
  it('lässt normalen Text unverändert', () => expect(parseColored('hallo')).toEqual([{ text: 'hallo' }]))
})

describe('lineLevel', () => {
  it('erkennt Warnungen und Fehler', () => {
    expect(lineLevel('[12:00:00] [Server thread/WARN]: x')).toBe('warn')
    expect(lineLevel('[12:00:00] [Server thread/ERROR]: x')).toBe('error')
    expect(lineLevel('\tat net.minecraft.Foo.bar(Foo.java:1)')).toBe('error')
    expect(lineLevel('[12:00:00] [Server thread/INFO]: ok')).toBe('info')
  })
})

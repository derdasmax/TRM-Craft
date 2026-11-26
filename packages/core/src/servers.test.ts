import { describe, expect, it } from 'vitest'
import { CreateServerInputSchema, SERVER_ID, recommendRamMb } from './servers'

describe('CreateServerInput', () => {
  const ok = { name: 'Survival', loader: 'paper', mcVersion: '1.21.4', ramMb: 4096, acceptEula: true }
  it('akzeptiert gültige Eingaben', () => expect(CreateServerInputSchema.safeParse(ok).success).toBe(true))
  it('verlangt aktive EULA-Zustimmung', () => {
    expect(CreateServerInputSchema.safeParse({ ...ok, acceptEula: false }).success).toBe(false)
    expect(CreateServerInputSchema.safeParse({ ...ok, acceptEula: undefined }).success).toBe(false)
  })
  it('lehnt zu wenig RAM und ungültige Ports ab', () => {
    expect(CreateServerInputSchema.safeParse({ ...ok, ramMb: 128 }).success).toBe(false)
    expect(CreateServerInputSchema.safeParse({ ...ok, port: 80 }).success).toBe(false)
  })
})

describe('SERVER_ID', () => {
  it('verhindert Path-Traversal', () => {
    expect(SERVER_ID.test('mein-server-1')).toBe(true)
    for (const bad of ['../x', 'a/b', 'a\\b', '', '.hidden', 'A']) expect(SERVER_ID.test(bad)).toBe(false)
  })
})

describe('recommendRamMb', () => {
  it('nimmt etwa die Hälfte, mindestens 1 GB, höchstens 16 GB', () => {
    expect(recommendRamMb(16384)).toBe(8192)
    expect(recommendRamMb(2048)).toBe(1024)
    expect(recommendRamMb(131072)).toBe(16384)
  })
})

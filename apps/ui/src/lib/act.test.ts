import { describe, expect, it } from 'vitest'
import { formatUptime } from './act'

describe('formatUptime', () => {
  it('formatiert Sekunden, Minuten und Stunden', () => {
    expect(formatUptime(5_000)).toBe('5 s')
    expect(formatUptime(125_000)).toBe('2 min 5 s')
    expect(formatUptime(3_900_000)).toBe('1 h 5 min')
  })
})

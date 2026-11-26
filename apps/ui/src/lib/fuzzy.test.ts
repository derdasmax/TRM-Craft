import { describe, expect, it } from 'vitest'
import { fuzzyScore, rank } from './fuzzy'

describe('fuzzy', () => {
  it('findet zusammenhängende und verstreute Treffer, aber keine falschen', () => {
    expect(fuzzyScore('surv', 'Survival mit Freunden')).toBeGreaterThan(0)
    expect(fuzzyScore('smf', 'Survival mit Freunden')).toBeGreaterThan(0)
    expect(fuzzyScore('xyz', 'Survival')).toBe(-1)
    expect(fuzzyScore('', 'egal')).toBe(0)
  })
  it('sortiert bessere Treffer nach vorn', () => {
    const items = ['Server stoppen', 'Einstellungen', 'Server starten', 'Zum Dashboard']
    expect(rank(items, 'start', (x) => x)[0]).toBe('Server starten')
    expect(rank(items, 'ein', (x) => x)[0]).toBe('Einstellungen')
    expect(rank(items, 'zzz', (x) => x)).toEqual([])
    expect(rank(items, '', (x) => x)).toEqual(items)
  })
})

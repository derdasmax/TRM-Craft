import { describe, expect, it } from 'vitest'
import { runCountdown } from './countdown'

describe('runCountdown', () => {
  it('zählt jede Sekunde herunter', async () => {
    const ticks: number[] = []
    await runCountdown({ seconds: 3, onTick: (s) => ticks.push(s), sleep: async () => {}, shouldSkip: () => false })
    expect(ticks).toEqual([3, 2, 1])
  })
  it('kann übersprungen werden', async () => {
    const ticks: number[] = []
    let n = 0
    await runCountdown({ seconds: 60, onTick: (s) => ticks.push(s), sleep: async () => { n++ }, shouldSkip: () => n >= 2 })
    expect(ticks).toEqual([60, 59])
  })
})

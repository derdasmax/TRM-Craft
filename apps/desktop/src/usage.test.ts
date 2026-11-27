import { describe, expect, it } from 'vitest'
import { cpuPercent, readCpu } from './usage'

describe('CPU-Auslastung', () => {
  it('rechnet aus zwei Messungen Prozent aus', () => {
    expect(cpuPercent({ idle: 100, total: 200 }, { idle: 150, total: 300 })).toBe(50)
    expect(cpuPercent({ idle: 0, total: 0 }, { idle: 0, total: 100 })).toBe(100)
    expect(cpuPercent({ idle: 10, total: 10 }, { idle: 10, total: 10 })).toBe(0)
  })
  it('liest die Zeiten aller Kerne', () => {
    const t = readCpu([{ model: 'x', speed: 1, times: { user: 1, nice: 2, sys: 3, idle: 4, irq: 5 } }, { model: 'x', speed: 1, times: { user: 1, nice: 0, sys: 0, idle: 6, irq: 0 } }])
    expect(t).toEqual({ idle: 10, total: 22 })
  })
})

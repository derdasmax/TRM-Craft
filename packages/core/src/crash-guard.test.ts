import { describe, expect, it } from 'vitest'
import { emptyGuardState, isBadVersion, onHealthy, onStart, MAX_FAILED_STARTS } from './crash-guard'

describe('crash-guard', () => {
  it('erster Start ist ok', () => {
    const a = onStart(null, '1.0.0')
    expect(a.type).toBe('ok')
    expect(a.state.failedStarts).toBe(1)
  })

  it('gesunder Start setzt Zähler zurück und merkt die Version', () => {
    const a = onStart(null, '1.0.0')
    const healthy = onHealthy(a.state)
    expect(healthy.failedStarts).toBe(0)
    expect(healthy.lastGoodVersion).toBe('1.0.0')
  })

  it('rollt zurück, wenn die neue Version wiederholt nicht gesund wird', () => {
    let state = onHealthy(onStart(null, '1.0.0').state)
    let action = onStart(state, '1.1.0')
    for (let i = 0; i < MAX_FAILED_STARTS; i++) {
      expect(action.type).toBe('ok')
      action = onStart(action.state, '1.1.0')
    }
    expect(action.type).toBe('rollback')
    if (action.type === 'rollback') {
      expect(action.target).toBe('1.0.0')
      expect(action.from).toBe('1.1.0')
      expect(isBadVersion(action.state, '1.1.0')).toBe(true)
    }
  })

  it('rollt nie zurück, wenn es keine bekannte gute Version gibt', () => {
    let action = onStart(null, '1.0.0')
    for (let i = 0; i < 10; i++) action = onStart(action.state, '1.0.0')
    expect(action.type).toBe('ok')
  })

  it('rollt nicht auf sich selbst zurück', () => {
    const state = { ...emptyGuardState('1.0.0'), lastGoodVersion: '1.0.0', failedStarts: 9 }
    expect(onStart(state, '1.0.0').type).toBe('ok')
  })

  it('Versionswechsel setzt den Zähler auf 1', () => {
    const state = { ...emptyGuardState('1.0.0'), lastGoodVersion: '1.0.0', failedStarts: 2 }
    expect(onStart(state, '1.2.0').state.failedStarts).toBe(1)
  })
})

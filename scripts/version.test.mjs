import { describe, expect, it } from 'vitest'
import { bump, bumpLevel, changelog, nextVersion, parseCommit } from './version.mjs'

describe('parseCommit', () => {
  it('liest Typ, Scope und Breaking', () => {
    expect(parseCommit('feat(ui): neue Karte')).toMatchObject({ type: 'feat', scope: 'ui', breaking: false })
    expect(parseCommit('fix!: kaputt')).toMatchObject({ type: 'fix', breaking: true })
    expect(parseCommit('chore: x\n\nBREAKING CHANGE: weg')).toMatchObject({ breaking: true })
    expect(parseCommit('irgendwas')).toMatchObject({ type: 'other' })
  })
})

describe('nextVersion', () => {
  const base = { lastStable: '1.4.2', channel: 'stable' }
  it('fix = Patch', () => expect(nextVersion({ ...base, messages: ['fix: a'] })).toBe('1.4.3'))
  it('feat = Minor', () => expect(nextVersion({ ...base, messages: ['fix: a', 'feat: b'] })).toBe('1.5.0'))
  it('BREAKING = Major', () => expect(nextVersion({ ...base, messages: ['feat!: c', 'fix: a'] })).toBe('2.0.0'))
  it('nur chore/docs = kein Release', () => expect(nextVersion({ ...base, messages: ['chore: x', 'docs: y', 'ci: z'] })).toBeNull())
  it('erster Release', () => expect(nextVersion({ lastStable: null, messages: ['feat: a'], channel: 'stable' })).toBe('0.1.0'))
  it('Beta zählt hoch', () => {
    expect(nextVersion({ ...base, channel: 'beta', messages: ['fix: a'], existingBetaTags: [] })).toBe('1.4.3-beta.1')
    expect(nextVersion({ ...base, channel: 'beta', messages: ['fix: a'], existingBetaTags: ['1.4.3-beta.1', '1.4.3-beta.2', '1.5.0-beta.9'] })).toBe('1.4.3-beta.3')
  })
})

describe('bump & changelog', () => {
  it('bump setzt niedrigere Stellen zurück', () => {
    expect(bump('1.4.2', 'minor')).toBe('1.5.0')
    expect(bump('1.4.2', 'major')).toBe('2.0.0')
  })
  it('bumpLevel ohne Treffer ist null', () => expect(bumpLevel([parseCommit('docs: a')])).toBeNull())
  it('gruppiert das Changelog', () => {
    const c = changelog(['feat(ui): Dark Mode', 'fix: Absturz beim Start', 'chore: x'])
    expect(c).toContain('### Neu')
    expect(c).toContain('- **ui:** Dark Mode')
    expect(c).toContain('### Fehlerbehebungen')
    expect(c).not.toContain('chore')
  })
})

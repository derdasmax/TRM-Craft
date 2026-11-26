import { describe, expect, it } from 'vitest'
import { parseChangelog } from './markdown'

describe('parseChangelog', () => {
  it('erkennt Überschriften, Listen und Absätze', () => {
    expect(parseChangelog('### Neu\n- **ui:** Dark Mode\nText')).toEqual([
      { type: 'h', text: 'Neu' },
      { type: 'li', text: 'ui: Dark Mode' },
      { type: 'p', text: 'Text' },
    ])
  })
  it('gibt kein HTML weiter, sondern nur Text', () => {
    expect(parseChangelog('- <img src=x onerror=alert(1)>')[0]).toEqual({ type: 'li', text: '<img src=x onerror=alert(1)>' })
  })
  it('entfernt Link-Ziele', () => expect(parseChangelog('- [a](http://x)')[0]).toEqual({ type: 'li', text: 'a' }))
})

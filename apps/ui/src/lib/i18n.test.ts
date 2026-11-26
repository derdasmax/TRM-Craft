import { describe, expect, it } from 'vitest'
import { dictionaries } from './i18n'

describe('i18n', () => {
  it('Deutsch und Englisch haben dieselben Schlüssel', () => {
    expect(Object.keys(dictionaries.en).sort()).toEqual(Object.keys(dictionaries.de).sort())
  })
  it('keine leeren Übersetzungen', () => {
    for (const lang of ['de', 'en'] as const)
      for (const v of Object.values(dictionaries[lang])) expect(v.trim().length).toBeGreaterThan(0)
  })
})

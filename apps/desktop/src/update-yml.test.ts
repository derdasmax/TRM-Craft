import { describe, expect, it } from 'vitest'
import { parseUpdateYml, releaseNotesToText } from './update-yml'

const yml = `version: 1.2.3
files:
  - url: TRM-Craft-Setup-1.2.3.exe
    sha512: AAAA
    size: 123
path: TRM-Craft-Setup-1.2.3.exe
sha512: BBBB==
releaseDate: '2026-01-01T00:00:00.000Z'
`

describe('update-yml', () => {
  it('liest Version, Pfad und Prüfsumme der obersten Ebene', () => {
    expect(parseUpdateYml(yml)).toEqual({ version: '1.2.3', path: 'TRM-Craft-Setup-1.2.3.exe', sha512: 'BBBB==' })
  })
  it('lehnt Pfade mit Verzeichnissen ab', () => {
    expect(parseUpdateYml(yml.replace('path: TRM-Craft-Setup-1.2.3.exe', 'path: ../evil.exe'))).toBeNull()
  })
  it('lehnt unvollständige Dateien ab', () => expect(parseUpdateYml('version: 1.0.0')).toBeNull())
  it('wandelt Release-Notes um', () => {
    expect(releaseNotesToText('a')).toBe('a')
    expect(releaseNotesToText([{ version: '1', note: 'x' }, { version: '2', note: 'y' }])).toBe('x\n\ny')
    expect(releaseNotesToText(null)).toBe('')
  })
})

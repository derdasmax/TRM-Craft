import { describe, expect, it } from 'vitest'
import { analyzeCrash } from './crash'

describe('analyzeCrash', () => {
  it.each([
    ['java.net.BindException: Address already in use', 'port-in-use'],
    ['**** FAILED TO BIND TO PORT!', 'port-in-use'],
    ['java.lang.UnsupportedClassVersionError: x has been compiled by a more recent version', 'java-too-old'],
    ['java.lang.OutOfMemoryError: Java heap space', 'out-of-memory'],
    ['You need to agree to the EULA in order to run the server.', 'eula'],
    ['Error: Invalid or corrupt jarfile server.jar', 'corrupt-jar'],
    ['Incompatible mod set!', 'mod-incompatible'],
  ])('erkennt %s', (line, kind) => expect(analyzeCrash(['x', line], 1)?.kind).toBe(kind))
  it('meldet unbekannte Abstürze mit Exit-Code', () => expect(analyzeCrash(['nichts'], 3)?.kind).toBe('unknown'))
  it('meldet nichts bei sauberem Ende', () => expect(analyzeCrash(['ok'], 0)).toBeUndefined())
})

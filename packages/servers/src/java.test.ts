import archiver from 'archiver'
import { createWriteStream, existsSync, mkdtempSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { allowHost } from './download'
import { ensureJava } from './java'

let srv: Server
let zipPath = ''
let base = ''
beforeAll(async () => {
  const dir = mkdtempSync(join(tmpdir(), 'trm-java-'))
  zipPath = join(dir, 'jre.zip')
  await new Promise<void>((resolve) => {
    const out = createWriteStream(zipPath)
    out.on('close', () => resolve())
    const a = archiver('zip')
    a.pipe(out)
    a.append('fake', { name: 'jdk-21.0.1+1-jre/bin/java.exe' })
    void a.finalize()
  })
  const data = readFileSync(zipPath)
  srv = createServer((_, res) => res.end(data))
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as { port: number }).port
  base = `http://127.0.0.1:${port}/jre.zip`
  allowHost(`127.0.0.1:${port}`)
})
afterAll(() => srv.close())

describe('ensureJava', () => {
  it('lädt und entpackt die Laufzeit nur einmal', async () => {
    const sha = createHash('sha256').update(readFileSync(zipPath)).digest('hex')
    let apiCalls = 0
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('api.adoptium.net')) {
        apiCalls++
        return new Response(JSON.stringify([{ binary: { package: { link: base, checksum: sha, name: 'jre.zip' } } }]))
      }
      return fetch(input, init)
    }
    const runtimesDir = mkdtempSync(join(tmpdir(), 'trm-rt-'))
    const first = await ensureJava({ runtimesDir, major: 21, platform: 'win32', fetchImpl })
    expect(first.endsWith('java.exe')).toBe(true)
    expect(existsSync(first)).toBe(true)
    const second = await ensureJava({ runtimesDir, major: 21, platform: 'win32', fetchImpl })
    expect(second).toBe(first)
    expect(apiCalls).toBe(1)
  })
  it('nutzt außerhalb von Windows das System-Java', async () => {
    expect(await ensureJava({ runtimesDir: tmpdir(), major: 21, platform: 'linux' })).toBe('java')
  })
})

import { mkdtempSync as mk, mkdirSync as md, writeFileSync as wf, existsSync as ex } from 'node:fs'
import { tmpdir as td } from 'node:os'
import { join as jn } from 'node:path'
import { moveDir } from './java'

describe('moveDir', () => {
  it('verschiebt einen Ordner samt Inhalt', async () => {
    const base = mk(jn(td(), 'trm-mv-'))
    md(jn(base, 'a', 'bin'), { recursive: true })
    wf(jn(base, 'a', 'bin', 'java.exe'), 'x')
    await moveDir(jn(base, 'a'), jn(base, 'b'))
    expect(ex(jn(base, 'b', 'bin', 'java.exe'))).toBe(true)
    expect(ex(jn(base, 'a'))).toBe(false)
  })
})

import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { allowHost, assertAllowedUrl, downloadFile } from './download'

const body = Buffer.from('hallo minecraft'.repeat(1000))
let srv: Server
let base = ''
beforeAll(async () => {
  srv = createServer((_, res) => { res.setHeader('content-length', body.length); res.end(body) })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as { port: number }).port
  base = `http://127.0.0.1:${port}`
  allowHost(`127.0.0.1:${port}`)
})
afterAll(() => srv.close())
const tmp = () => join(mkdtempSync(join(tmpdir(), 'trm-dl-')), 'file.bin')

describe('downloadFile', () => {
  it('lädt, meldet Fortschritt und prüft SHA-256', async () => {
    const dest = tmp()
    let last = 0
    await downloadFile({ url: base, dest, sha256: createHash('sha256').update(body).digest('hex'), onProgress: (d) => (last = d) })
    expect(readFileSync(dest).equals(body)).toBe(true)
    expect(last).toBe(body.length)
  })
  it('verwirft die Datei bei falscher Prüfsumme', async () => {
    const dest = tmp()
    await expect(downloadFile({ url: base, dest, sha1: '0'.repeat(40) })).rejects.toThrow(/Prüfsumme/)
    expect(existsSync(dest)).toBe(false)
    expect(existsSync(`${dest}.part`)).toBe(false)
  })
})

describe('assertAllowedUrl', () => {
  it('erlaubt nur offizielle https-Hosts', () => {
    expect(() => assertAllowedUrl('https://piston-data.mojang.com/x')).not.toThrow()
    expect(() => assertAllowedUrl('https://evil.example.com/x')).toThrow()
    expect(() => assertAllowedUrl('http://piston-data.mojang.com/x')).toThrow()
  })
})

import { mkdtempSync as mkt, readFileSync as rf, readdirSync as rd } from 'node:fs'
import { tmpdir as tdir } from 'node:os'
import { join as pj } from 'node:path'

describe('downloadFile: gleichzeitige Downloads', () => {
  it('beschädigen sich nicht gegenseitig', async () => {
    const data = Buffer.alloc(300_000, 7)
    const make = () => (async () => new Response(new ReadableStream({ async start(c) { for (let i = 0; i < data.length; i += 50_000) { c.enqueue(data.subarray(i, i + 50_000)); await new Promise((r) => setTimeout(r, 5)) } c.close() } }), { headers: { 'content-length': String(data.length) } })) as never
    allowHost('example.test')
    const dir = mkt(pj(tdir(), 'trm-dl-'))
    const dest = pj(dir, 'f.bin')
    await Promise.all([1, 2].map(() => downloadFile({ url: 'https://github.com/x', dest, fetchImpl: make() })))
    expect(rf(dest).length).toBe(data.length)
    expect(rd(dir)).toEqual(['f.bin'])
  })
})

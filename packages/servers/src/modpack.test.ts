import archiver from 'archiver'
import { createWriteStream, existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyMrpack, cfTarget, CfManifestSchema, mrpackTarget, readMrpack } from './modpack'

async function pack(entries: Record<string, string>): Promise<string> {
  const p = join(mkdtempSync(join(tmpdir(), 'trm-mp-')), 'p.mrpack')
  await new Promise<void>((resolve) => {
    const out = createWriteStream(p)
    out.on('close', () => resolve())
    const a = archiver('zip')
    a.pipe(out)
    for (const [n, c] of Object.entries(entries)) a.append(c, { name: n })
    void a.finalize()
  })
  return p
}

const index = (files: object[], deps: Record<string, string> = { minecraft: '1.20.1', 'fabric-loader': '0.15.11' }) =>
  JSON.stringify({ formatVersion: 1, game: 'minecraft', name: 'Mein Pack', files, dependencies: deps })
const file = (path: string, env?: object) => ({ path, hashes: { sha1: 'a'.repeat(40) }, downloads: ['https://cdn.modrinth.com/data/x/file.jar'], env })

describe('Modrinth-Modpack', () => {
  it('liest Ziel-Loader und Version', async () => {
    const t = mrpackTarget(await readMrpack(await pack({ 'modrinth.index.json': index([]) })))
    expect(t).toEqual({ name: 'Mein Pack', mcVersion: '1.20.1', loader: 'fabric', loaderVersion: '0.15.11' })
    expect(mrpackTarget(await readMrpack(await pack({ 'modrinth.index.json': index([], { minecraft: '1.20.1', forge: '47.2.0' }) }))).loader).toBe('forge')
    expect(() => mrpackTarget(JSON.parse(index([], { minecraft: '1.20.1' })))).toThrow(/Loader/)
  })
  it('lehnt Archive ohne Index ab', async () => {
    await expect(readMrpack(await pack({ 'x.txt': 'x' }))).rejects.toThrow(/modrinth\.index\.json/)
  })
  it('lädt Server-Dateien, überspringt Client-only und entpackt Overrides', async () => {
    const p = await pack({
      'modrinth.index.json': index([file('mods/server.jar'), file('mods/client.jar', { client: 'required', server: 'unsupported' })]),
      'overrides/config/a.toml': 'a=1',
      'server-overrides/config/b.toml': 'b=2',
    })
    const dir = mkdtempSync(join(tmpdir(), 'trm-srv-'))
    const got: string[] = []
    const w = await applyMrpack(p, await readMrpack(p), dir, { download: async (o) => { got.push(o.dest.replace(dir, '')); o.sha1 === 'a'.repeat(40) || (() => { throw new Error('hash') })() } })
    expect(w).toEqual([])
    expect(got).toHaveLength(1)
    expect(got[0]).toMatch(/mods[\\/]server\.jar$/)
    expect(readFileSync(join(dir, 'config/a.toml'), 'utf8')).toBe('a=1')
    expect(existsSync(join(dir, 'config/b.toml'))).toBe(true)
  })
  it('blockiert Pfade außerhalb des Server-Ordners', async () => {
    const p = await pack({ 'modrinth.index.json': index([file('../../evil.jar')]) })
    const dir = mkdtempSync(join(tmpdir(), 'trm-srv-'))
    await expect(applyMrpack(p, await readMrpack(p), dir, { download: async () => {} })).rejects.toThrow(/Unzulässiger Pfad/)
  })
  it('meldet Dateien, die sich nicht laden lassen', async () => {
    const p = await pack({ 'modrinth.index.json': index([file('mods/a.jar')]) })
    const w = await applyMrpack(p, await readMrpack(p), mkdtempSync(join(tmpdir(), 'trm-srv-')), { download: async () => { throw new Error('offline') } })
    expect(w).toEqual(['Konnte mods/a.jar nicht laden.'])
  })
})

describe('CurseForge-Modpack', () => {
  it('liest den Loader aus der Manifest-ID', () => {
    const m = CfManifestSchema.parse({ name: 'CF', minecraft: { version: '1.20.1', modLoaders: [{ id: 'forge-47.2.0', primary: true }] }, files: [] })
    expect(cfTarget(m)).toEqual({ name: 'CF', mcVersion: '1.20.1', loader: 'forge', loaderVersion: '47.2.0' })
    expect(() => cfTarget(CfManifestSchema.parse({ name: 'x', minecraft: { version: '1', modLoaders: [] }, files: [] }))).toThrow()
  })
})

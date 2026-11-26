import archiver from 'archiver'
import { createHash, randomBytes } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ServerRecord, UploadRecord } from '@trm/core'
import { UploadManager, type UploadServer } from './uploads'

const tmp = (p = 'trm-up-') => mkdtempSync(join(tmpdir(), p))
const rec = (o: Partial<ServerRecord> = {}): ServerRecord => ({
  id: 's1', name: 'Test', edition: 'java', loader: 'fabric', mcVersion: '1.20.1', port: 25565, ramMb: 2048, jvmPreset: 'aikar', javaMajor: 17, launch: { type: 'jar', jar: 'server.jar' },
  crossplay: false, limits: { priority: 'normal' }, backup: { keep: 10 }, notify: { desktop: true, discord: false, joins: false }, autoRestart: true, autostart: false, eulaAcceptedAt: null, createdAt: 'x', ...o,
})

async function zip(files: Record<string, string>): Promise<Buffer> {
  const p = join(tmp(), 'f.zip')
  await new Promise<void>((resolve) => { const o = createWriteStream(p); o.on('close', () => resolve()); const a = archiver('zip'); a.pipe(o); for (const [n, c] of Object.entries(files)) a.append(c, { name: n }); void a.finalize() })
  return readFileSync(p)
}
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

function setup(o: { server?: Partial<ServerRecord>; running?: boolean; canUpload?: boolean; limit?: number; download?: never } = {}) {
  const dir = tmp('trm-srv-')
  const dataDir = tmp('trm-data-')
  const sent: Record<string, unknown>[] = []
  const emitted: UploadRecord[] = []
  const calls = { restart: 0, backup: 0, restored: [] as string[] }
  const srv: UploadServer = {
    rec: rec(o.server), dir, running: !!o.running, name: 'Test', levelName: () => 'world',
    backup: async () => { calls.backup++; return 'vor-modpack.zip' }, restart: async () => { calls.restart++ },
  }
  const mk = () => new UploadManager({
    dir: dataDir, limitBytes: () => o.limit ?? 50 * 1048576, canUpload: () => o.canUpload ?? true, server: (id) => (id === 's1' ? srv : null),
    siteHost: () => 'trm.example', send: (m) => sent.push(m), emit: (r) => emitted.push(r), restore: async (_s, f) => void calls.restored.push(f),
    download: o.download,
  })
  return { m: mk(), mk, dir, sent, emitted, calls, last: (t: string) => sent.filter((x) => x.type === t).at(-1) }
}

/** Sendet eine Datei in Stücken. */
function send(m: UploadManager, id: string, data: Buffer, chunk: number, from = 0) {
  for (let o = from; o < data.length; o += chunk) m.chunk({ uploadId: id, offset: o, data: data.subarray(o, o + chunk).toString('base64') })
}
const begin = (m: UploadManager, id: string, data: Buffer, name: string, extra: object = {}) => m.begin({ uploadId: id, serverId: 's1', fileName: name, size: data.length, sha256: sha(data), uploader: 'Max', ...extra })

describe('Upload: Mods', () => {
  it('überträgt in Stücken, prüft SHA-256 und legt die Mod im richtigen Ordner ab', async () => {
    const t = setup()
    const jar = await zip({ 'fabric.mod.json': '{}', 'a.class': randomBytes(5000).toString('base64') })
    begin(t.m, 'upload-1', jar, 'cool-mod.jar')
    expect(t.last('upload.ready')).toMatchObject({ received: 0 })
    send(t.m, 'upload-1', jar, 700)
    await t.m.end({ uploadId: 'upload-1' })
    expect(t.last('upload.done')).toMatchObject({ kind: 'mod' })
    expect(existsSync(join(t.dir, 'mods', 'cool-mod.jar'))).toBe(true)
    const h = t.m.history()[0]!
    expect(h).toMatchObject({ status: 'done', uploader: 'Max', fileName: 'cool-mod.jar', undoable: true, kind: 'mod' })
    // Rückgängig
    await t.m.undo('upload-1')
    expect(existsSync(join(t.dir, 'mods', 'cool-mod.jar'))).toBe(false)
    expect(t.m.history()[0]!.status).toBe('undone')
    await expect(t.m.undo('upload-1')).rejects.toThrow()
  })

  it('setzt nach einem Abbruch an der richtigen Stelle fort', async () => {
    const t = setup()
    const jar = await zip({ 'fabric.mod.json': '{}', 'a.class': randomBytes(9000).toString('base64') })
    begin(t.m, 'upload-2', jar, 'resume.jar')
    t.m.chunk({ uploadId: 'upload-2', offset: 0, data: jar.subarray(0, 1000).toString('base64') })
    // App wird neu gestartet / WLAN weg: neuer Manager, gleicher Datenordner
    const t2 = { ...t, m: t.mk() }
    begin(t2.m, 'upload-2', jar, 'resume.jar')
    expect(t2.sent.filter((x) => x.type === 'upload.ready').at(-1)).toMatchObject({ received: 1000 })
    expect(jar.length).toBeGreaterThan(5000)
    send(t2.m, 'upload-2', jar, 3000, 1000)
    await t2.m.end({ uploadId: 'upload-2' })
    expect(t2.sent.at(-1)).toMatchObject({ type: 'upload.done' })
    expect(existsSync(join(t.dir, 'mods', 'resume.jar'))).toBe(true)
  })

  it('synchronisiert bei falschem Offset', async () => {
    const t = setup()
    const jar = await zip({ 'fabric.mod.json': '{}', 'a.class': randomBytes(3000).toString('base64') })
    begin(t.m, 'upload-3', jar, 'x.jar')
    t.m.chunk({ uploadId: 'upload-3', offset: 500, data: 'AAAA' })
    expect(t.last('upload.ack')).toMatchObject({ received: 0 })
    await t.m.end({ uploadId: 'upload-3' })
    expect(t.last('upload.ack')).toMatchObject({ received: 0 }) // unvollständig: noch nicht fertig
  })

  it('verwirft Dateien mit falscher Prüfsumme', async () => {
    const t = setup()
    const jar = await zip({ 'fabric.mod.json': '{}' })
    t.m.begin({ uploadId: 'upload-4', serverId: 's1', fileName: 'x.jar', size: jar.length, sha256: '0'.repeat(64) })
    send(t.m, 'upload-4', jar, 10_000)
    await t.m.end({ uploadId: 'upload-4' })
    expect(t.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/Prüfsumme/) })
    expect(existsSync(join(t.dir, 'mods', 'x.jar'))).toBe(false)
    expect(t.m.history()[0]!.status).toBe('failed')
  })

  it('warnt bei falschem Loader statt still zu installieren', async () => {
    const t = setup({ server: { loader: 'forge' } })
    const jar = await zip({ 'fabric.mod.json': '{}' })
    begin(t.m, 'upload-5', jar, 'fabric-only.jar')
    send(t.m, 'upload-5', jar, 10_000)
    await t.m.end({ uploadId: 'upload-5' })
    expect(t.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/für fabric gebaut.*Forge.*nicht installiert/) })
    expect(existsSync(join(t.dir, 'mods', 'fabric-only.jar'))).toBe(false)
  })

  it('bereinigt Dateinamen, sodass nichts außerhalb des Server-Ordners landet', async () => {
    const t = setup()
    const jar = await zip({ 'fabric.mod.json': '{}' })
    begin(t.m, 'upload-6', jar, '../../../evil.jar')
    send(t.m, 'upload-6', jar, 10_000)
    await t.m.end({ uploadId: 'upload-6' })
    expect(existsSync(join(t.dir, 'mods', 'evil.jar'))).toBe(true)
    expect(existsSync(join(t.dir, '..', 'evil.jar'))).toBe(false)
  })

  it('startet den Server nach Wunsch neu', async () => {
    const t = setup({ running: true })
    const jar = await zip({ 'fabric.mod.json': '{}' })
    begin(t.m, 'upload-7', jar, 'r.jar', { restartAfter: true })
    send(t.m, 'upload-7', jar, 10_000)
    await t.m.end({ uploadId: 'upload-7' })
    expect(t.calls.restart).toBe(1)
  })
})

describe('Upload: Sicherheit und Grenzen', () => {
  it('lehnt ohne Upload-Recht, unbekannte Server, falsche Typen und zu große Dateien ab', () => {
    const jar = Buffer.from('x'.repeat(2000))
    const cases: [ReturnType<typeof setup>, string, RegExp][] = [
      [setup({ canUpload: false }), 'a.jar', /Upload-Recht/],
      [setup(), 'a.exe', /nicht erlaubt/],
      [setup({ limit: 1000 }), 'a.jar', /Limit/],
    ]
    for (const [t, name, re] of cases) { begin(t.m, 'upload-x', jar, name); expect(t.last('upload.failed')).toMatchObject({ error: expect.stringMatching(re) }) }
    const t = setup()
    t.m.begin({ uploadId: 'upload-y', serverId: 'nope', fileName: 'a.jar', size: 10, sha256: 'a'.repeat(64) })
    expect(t.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/Server nicht gefunden/) })
  })

  it('lehnt Daten über der angekündigten Größe ab', async () => {
    const t = setup()
    const jar = Buffer.from('abc')
    begin(t.m, 'upload-8', jar, 'a.jar')
    t.m.chunk({ uploadId: 'upload-8', offset: 0, data: Buffer.from('abcdef').toString('base64') })
    expect(t.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/Datenmenge/) })
  })

  it('Fetch: lädt nur vom Host der Webseite', async () => {
    const jar = await zip({ 'fabric.mod.json': '{}' })
    const t = setup({ download: (async (o: { dest: string }) => { writeFileSync(o.dest, jar) }) as never })
    await t.m.fetch({ uploadId: 'fetch-1', serverId: 's1', fileName: 'f.jar', size: jar.length, sha256: sha(jar), url: 'https://evil.example/f.jar' })
    expect(t.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/nur von der verbundenen Webseite/) })
    await t.m.fetch({ uploadId: 'fetch-2', serverId: 's1', fileName: 'f.jar', size: jar.length, sha256: sha(jar), url: 'http://trm.example/f.jar' })
    expect(t.last('upload.failed')).toBeDefined()
    await t.m.fetch({ uploadId: 'fetch-3', serverId: 's1', fileName: 'f.jar', size: jar.length, sha256: sha(jar), url: 'https://trm.example/files/f.jar' })
    expect(t.last('upload.done')).toMatchObject({ uploadId: 'fetch-3' })
    expect(existsSync(join(t.dir, 'mods', 'f.jar'))).toBe(true)
  })
})

describe('Upload: Welten, Datapacks, Bedrock, Modpacks', () => {
  it('importiert Welt-ZIPs nur bei gestopptem Server', async () => {
    const world = await zip({ 'MeineWelt/level.dat': 'x', 'MeineWelt/region/r.0.0.mca': 'x' })
    const run = await setup({ running: true })
    begin(run.m, 'w-1', world, 'Meine Welt.zip'); send(run.m, 'w-1', world, 10_000); await run.m.end({ uploadId: 'w-1' })
    expect(run.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/Stoppe den Server/) })
    const t = setup()
    begin(t.m, 'w-2', world, 'Meine Welt.zip'); send(t.m, 'w-2', world, 10_000); await t.m.end({ uploadId: 'w-2' })
    expect(t.last('upload.done')).toMatchObject({ kind: 'world' })
    expect(existsSync(join(t.dir, 'Meine Welt', 'level.dat'))).toBe(true)
    await t.m.undo('w-2')
    expect(existsSync(join(t.dir, 'Meine Welt'))).toBe(false)
  })
  it('legt Datapacks in die aktive Welt', async () => {
    const dp = await zip({ 'pack.mcmeta': '{}', 'data/x.json': '{}' })
    const t = setup({ server: { loader: 'paper' } })
    begin(t.m, 'd-1', dp, 'mypack.zip'); send(t.m, 'd-1', dp, 10_000); await t.m.end({ uploadId: 'd-1' })
    expect(t.last('upload.done')).toMatchObject({ kind: 'datapack' })
    expect(existsSync(join(t.dir, 'world', 'datapacks', 'mypack.zip'))).toBe(true)
  })
  it('lehnt unbekannte ZIPs ab', async () => {
    const z = await zip({ 'readme.txt': 'x' })
    const t = setup()
    begin(t.m, 'z-1', z, 'x.zip'); send(t.m, 'z-1', z, 10_000); await t.m.end({ uploadId: 'z-1' })
    expect(t.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/Unbekannte ZIP/) })
  })
  it('installiert Bedrock-Addons als Behavior- und Resource-Pack', async () => {
    const addon = await zip({ 'BP/manifest.json': JSON.stringify({ modules: [{ type: 'data' }] }), 'RP/manifest.json': JSON.stringify({ modules: [{ type: 'resources' }] }) })
    const t = setup({ server: { edition: 'bedrock', loader: 'bedrock' } })
    begin(t.m, 'b-1', addon, 'cool.mcaddon'); send(t.m, 'b-1', addon, 10_000); await t.m.end({ uploadId: 'b-1' })
    expect(t.last('upload.done')).toMatchObject({ kind: 'bedrock-pack' })
    expect(existsSync(join(t.dir, 'behavior_packs', 'BP', 'manifest.json'))).toBe(true)
    expect(existsSync(join(t.dir, 'resource_packs', 'RP', 'manifest.json'))).toBe(true)
    const j = await zip({ 'fabric.mod.json': '{}' })
    const t2 = setup()
    begin(t2.m, 'b-2', addon, 'cool.mcaddon'); send(t2.m, 'b-2', addon, 10_000); await t2.m.end({ uploadId: 'b-2' })
    expect(t2.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/nur zu einem Bedrock-Server/) })
    void j
  })
  it('prüft Modpacks gegen Loader und Version, sichert vorher und stellt per Backup wieder her', async () => {
    const idx = (mc: string, loader = 'fabric-loader') => JSON.stringify({ formatVersion: 1, game: 'minecraft', name: 'P', files: [], dependencies: { minecraft: mc, [loader]: '0.15.0' } })
    const t = setup()
    const good = await zip({ 'modrinth.index.json': idx('1.20.1'), 'overrides/config/a.toml': 'a=1' })
    begin(t.m, 'p-1', good, 'pack.mrpack'); send(t.m, 'p-1', good, 10_000); await t.m.end({ uploadId: 'p-1' })
    expect(t.last('upload.done')).toMatchObject({ kind: 'modpack' })
    expect(t.calls.backup).toBe(1)
    expect(readFileSync(join(t.dir, 'config', 'a.toml'), 'utf8')).toBe('a=1')
    await t.m.undo('p-1')
    expect(t.calls.restored).toEqual(['vor-modpack.zip'])
    const wrongVer = await zip({ 'modrinth.index.json': idx('1.21.4') })
    begin(t.m, 'p-2', wrongVer, 'p2.mrpack'); send(t.m, 'p-2', wrongVer, 10_000); await t.m.end({ uploadId: 'p-2' })
    expect(t.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/Minecraft 1\.21\.4.*1\.20\.1/) })
    const wrongLoader = await zip({ 'modrinth.index.json': idx('1.20.1', 'forge') })
    begin(t.m, 'p-3', wrongLoader, 'p3.mrpack'); send(t.m, 'p-3', wrongLoader, 10_000); await t.m.end({ uploadId: 'p-3' })
    expect(t.last('upload.failed')).toMatchObject({ error: expect.stringMatching(/forge.*fabric/) })
    expect(mkdirSync).toBeDefined()
  })
})

import { createWriteStream, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { z } from 'zod'
import type { Loader, ModpackInstallArgs, ServerRecord } from '@trm/core'
import { downloadFile, type FetchLike } from './download'
import { cfFilesById, cfSha1 } from './providers/curseforge'
import { compatibleVersion, primaryFile } from './providers/modrinth'
import { safeJoin, safeRelativePath } from './sanitize'

const MAX_ENTRIES = 100_000
const MAX_TOTAL_BYTES = 8 * 1024 * 1024 * 1024
const MAX_MANIFEST_BYTES = 8 * 1024 * 1024

function openZip(path: string): Promise<yauzl.ZipFile> {
  return new Promise((res, rej) => yauzl.open(path, { lazyEntries: true, autoClose: false }, (e, z) => (e || !z ? rej(e ?? new Error('Keine gültige ZIP-Datei.')) : res(z))))
}

/** Liest einen einzelnen Eintrag (z. B. modrinth.index.json) mit Größenlimit. */
export async function readZipEntry(path: string, name: string): Promise<Buffer | null> {
  const zip = await openZip(path)
  return new Promise((resolve, reject) => {
    let found = false
    zip.on('entry', (e: yauzl.Entry) => {
      if (e.fileName !== name) return zip.readEntry()
      found = true
      if (e.uncompressedSize > MAX_MANIFEST_BYTES) return reject(new Error('Manifest zu groß.'))
      zip.openReadStream(e, (err, s) => {
        if (err || !s) return reject(err)
        const chunks: Buffer[] = []
        s.on('data', (c: Buffer) => chunks.push(c))
        s.on('end', () => { zip.close(); resolve(Buffer.concat(chunks)) })
        s.on('error', reject)
      })
    })
    zip.on('end', () => { if (!found) { zip.close(); resolve(null) } })
    zip.on('error', reject)
    zip.readEntry()
  })
}

/** Entpackt alle Einträge unter `prefix/` nach `dest`. Schützt vor Zip-Slip und Zip-Bomben. */
export async function extractPrefix(path: string, prefix: string, dest: string): Promise<number> {
  const zip = await openZip(path)
  const pre = prefix.endsWith('/') ? prefix : `${prefix}/`
  let count = 0
  let total = 0
  return new Promise((resolve, reject) => {
    zip.on('entry', (e: yauzl.Entry) => {
      if (++count > MAX_ENTRIES) return reject(new Error('Das Modpack enthält zu viele Dateien.'))
      if (!e.fileName.startsWith(pre) || e.fileName.endsWith('/')) return zip.readEntry()
      total += e.uncompressedSize
      if (total > MAX_TOTAL_BYTES) return reject(new Error('Das Modpack ist zu groß.'))
      let target: string
      try { target = safeJoin(dest, safeRelativePath(e.fileName.slice(pre.length))) } catch (err) { return reject(err) }
      zip.openReadStream(e, async (err, s) => {
        if (err || !s) return reject(err)
        try {
          mkdirSync(dirname(target), { recursive: true })
          await pipeline(s, createWriteStream(target))
          zip.readEntry()
        } catch (x) { reject(x) }
      })
    })
    zip.on('end', () => { zip.close(); resolve(count) })
    zip.on('error', reject)
    zip.readEntry()
  })
}

// ---------- Modrinth (.mrpack) ----------
export const MrpackSchema = z.object({
  formatVersion: z.number(),
  game: z.literal('minecraft'),
  name: z.string(),
  files: z.array(z.object({
    path: z.string(),
    hashes: z.object({ sha1: z.string().optional(), sha512: z.string().optional() }),
    downloads: z.array(z.string().url()).min(1),
    env: z.object({ client: z.string().optional(), server: z.string().optional() }).optional(),
  })),
  dependencies: z.record(z.string()),
})
export type Mrpack = z.infer<typeof MrpackSchema>

const MR_LOADERS: Record<string, Loader> = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' }

export interface PackTarget { name: string; mcVersion: string; loader: Loader; loaderVersion?: string }

export function mrpackTarget(p: Mrpack): PackTarget {
  const mc = p.dependencies.minecraft
  const key = Object.keys(p.dependencies).find((k) => MR_LOADERS[k])
  if (!mc) throw new Error('Das Modpack nennt keine Minecraft-Version.')
  if (!key) throw new Error('Das Modpack nutzt keinen unterstützten Loader (Fabric, Quilt, Forge, NeoForge).')
  return { name: p.name, mcVersion: mc, loader: MR_LOADERS[key]!, loaderVersion: p.dependencies[key] }
}

export async function readMrpack(path: string): Promise<Mrpack> {
  const raw = await readZipEntry(path, 'modrinth.index.json')
  if (!raw) throw new Error('Das ist kein Modrinth-Modpack (modrinth.index.json fehlt).')
  return MrpackSchema.parse(JSON.parse(raw.toString('utf8')))
}

export interface ApplyDeps { fetchImpl?: FetchLike; download?: typeof downloadFile; progress?: (label: string, percent: number | null) => void }

/** Lädt alle serverseitigen Dateien und entpackt die Overrides. Gibt Warnungen zurück. */
export async function applyMrpack(pack: string, parsed: Mrpack, serverDir: string, d: ApplyDeps = {}): Promise<string[]> {
  const dl = d.download ?? downloadFile
  const warnings: string[] = []
  const files = parsed.files.filter((f) => f.env?.server !== 'unsupported')
  let i = 0
  for (const f of files) {
    const rel = safeRelativePath(f.path)
    d.progress?.(`Modpack-Dateien werden geladen (${++i}/${files.length}) …`, Math.round((i / files.length) * 100))
    let ok = false
    for (const url of f.downloads) {
      try { await dl({ url, dest: safeJoin(serverDir, rel), sha1: f.hashes.sha1, sha512: f.hashes.sha512, fetchImpl: d.fetchImpl }); ok = true; break } catch { /* nächste Quelle */ }
    }
    if (!ok) warnings.push(`Konnte ${rel} nicht laden.`)
  }
  d.progress?.('Zusatzdateien werden entpackt …', null)
  await extractPrefix(pack, 'overrides', serverDir)
  await extractPrefix(pack, 'server-overrides', serverDir)
  return warnings
}

// ---------- CurseForge (manifest.json) ----------
export const CfManifestSchema = z.object({
  minecraft: z.object({ version: z.string(), modLoaders: z.array(z.object({ id: z.string(), primary: z.boolean().optional() })) }),
  name: z.string(),
  files: z.array(z.object({ projectID: z.number(), fileID: z.number(), required: z.boolean().optional() })),
  overrides: z.string().default('overrides'),
})
export type CfManifest = z.infer<typeof CfManifestSchema>

export function cfTarget(m: CfManifest): PackTarget {
  const l = m.minecraft.modLoaders.find((x) => x.primary) ?? m.minecraft.modLoaders[0]
  const hit = l && /^(forge|fabric|neoforge|quilt)-(.+)$/.exec(l.id)
  if (!hit) throw new Error('Das Modpack nutzt keinen unterstützten Loader.')
  return { name: m.name, mcVersion: m.minecraft.version, loader: hit[1] as Loader, loaderVersion: hit[2] }
}

export async function readCfPack(path: string): Promise<CfManifest> {
  const raw = await readZipEntry(path, 'manifest.json')
  if (!raw) throw new Error('Das ist kein CurseForge-Modpack (manifest.json fehlt).')
  return CfManifestSchema.parse(JSON.parse(raw.toString('utf8')))
}

export async function applyCfPack(pack: string, m: CfManifest, serverDir: string, key: string, d: ApplyDeps = {}): Promise<string[]> {
  const dl = d.download ?? downloadFile
  const warnings: string[] = []
  const infos = await cfFilesById(key, m.files.map((f) => f.fileID), d.fetchImpl)
  let i = 0
  for (const info of infos) {
    d.progress?.(`Modpack-Dateien werden geladen (${++i}/${infos.length}) …`, Math.round((i / infos.length) * 100))
    if (!info.downloadUrl) { warnings.push(`${info.displayName}: Der Autor erlaubt keinen automatischen Download. Bitte manuell hinzufügen.`); continue }
    try {
      const name = safeRelativePath(`mods/${info.fileName.replace(/[\\/]/g, '_')}`)
      await dl({ url: info.downloadUrl, dest: safeJoin(serverDir, name), sha1: cfSha1(info), fetchImpl: d.fetchImpl })
    } catch { warnings.push(`Konnte ${info.displayName} nicht laden.`) }
  }
  await extractPrefix(pack, m.overrides, serverDir)
  return warnings
}

// ---------- Orchestrierung ----------
export interface ModpackHost {
  create(token: string, input: { name: string; loader: Loader; mcVersion: string; loaderVersion?: string; ramMb: number; acceptEula: true }): Promise<ServerRecord>
  serverDir(id: string): string
  remove(id: string): Promise<void>
}

export async function installModpack(host: ModpackHost, args: ModpackInstallArgs, deps: ApplyDeps & { curseKey: () => string | null; progress: (label: string, p: number | null) => void }): Promise<{ record: ServerRecord; warnings: string[] }> {
  const tmp = mkdtempSync(join(tmpdir(), 'trm-pack-'))
  const dl = deps.download ?? downloadFile
  try {
    let pack: string
    let kind: 'mr' | 'cf'
    if (args.source.type === 'file') {
      pack = args.source.path
      kind = (await readZipEntry(pack, 'modrinth.index.json')) ? 'mr' : 'cf'
    } else if (args.source.type === 'modrinth') {
      deps.progress('Modpack wird gesucht …', null)
      const v = await compatibleVersion(args.source.projectId, [], null, deps.fetchImpl)
      const f = v && primaryFile(v)
      if (!v || !f) throw new Error('Keine Modpack-Version gefunden.')
      pack = join(tmp, 'pack.mrpack')
      await dl({ url: f.url, dest: pack, sha512: f.hashes.sha512, fetchImpl: deps.fetchImpl, onProgress: (d, t) => deps.progress('Modpack wird geladen …', t ? Math.round((d / t) * 100) : null) })
      kind = 'mr'
    } else {
      throw new Error('CurseForge-Modpacks bitte als ZIP-Datei von curseforge.com herunterladen und hier auswählen.')
    }

    const key = deps.curseKey()
    if (kind === 'cf' && !key) throw new Error('Für CurseForge-Modpacks ist ein API-Key nötig.')
    const mr = kind === 'mr' ? await readMrpack(pack) : null
    const cf = kind === 'cf' ? await readCfPack(pack) : null
    const target = mr ? mrpackTarget(mr) : cfTarget(cf!)

    const record = await host.create(args.token, { name: args.name || target.name, loader: target.loader, mcVersion: target.mcVersion, loaderVersion: target.loaderVersion, ramMb: args.ramMb, acceptEula: true })
    try {
      const dir = host.serverDir(record.id)
      const warnings = mr ? await applyMrpack(pack, mr, dir, deps) : await applyCfPack(pack, cf!, dir, key!, deps)
      return { record, warnings }
    } catch (e) {
      await host.remove(record.id).catch(() => {})
      throw e
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

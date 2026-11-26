import extract from 'extract-zip'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, extname, join } from 'node:path'
import yauzl from 'yauzl'
import {
  LOADER_INFO, extensionKind, type ServerRecord,
} from '@trm/core'
import { applyMrpack, importWorldZip, inspectJar, isCompatible, mrpackTarget, readMrpack, safeJoin, sanitizeFilename } from '@trm/servers'

/** Was zum Platzieren einer Datei gebraucht wird. */
export interface PlaceHost {
  rec: ServerRecord
  dir: string
  running: boolean
  /** Backup anlegen (für Rückgängig bei Modpacks). Gibt den Dateinamen zurück. */
  backup: (label: string) => Promise<string>
  levelName: () => string
}

export type Undo = { type: 'files'; paths: string[] } | { type: 'backup'; file: string }
export interface Placed { kind: string; undo: Undo; warnings: string[] }

function zipNames(path: string): Promise<string[]> {
  return new Promise((res, rej) => yauzl.open(path, { lazyEntries: true, autoClose: true }, (e, z) => {
    if (e || !z) return rej(e ?? new Error('Keine gültige ZIP-Datei.'))
    const out: string[] = []
    z.on('entry', (en: yauzl.Entry) => { out.push(en.fileName); if (out.length > 200_000) return rej(new Error('Zu viele Einträge.')); z.readEntry() })
    z.on('end', () => res(out)); z.on('error', rej); z.readEntry()
  }))
}

/** Sucht in einem Ordner nach Bedrock-Packs (manifest.json) und gibt Ordner samt Typ zurück. */
function findBedrockPacks(root: string, depth = 3): { dir: string; kind: 'behavior' | 'resource' }[] {
  const out: { dir: string; kind: 'behavior' | 'resource' }[] = []
  const walk = (d: string, left: number) => {
    const m = join(d, 'manifest.json')
    if (existsSync(m)) {
      try {
        const j = JSON.parse(readFileSync(m, 'utf8')) as { modules?: { type?: string }[] }
        const types = (j.modules ?? []).map((x) => x.type)
        out.push({ dir: d, kind: types.includes('resources') ? 'resource' : 'behavior' })
        return
      } catch { /* ignorieren */ }
    }
    if (left === 0) return
    for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) walk(join(d, e.name), left - 1)
  }
  walk(root, depth)
  return out
}

/**
 * Legt eine hochgeladene Datei am richtigen Ort im Server-Ordner ab. Passt sie nicht zum Server
 * (falscher Loader, falsche Version, Server läuft), gibt es einen Fehler statt einer stillen Installation.
 */
export async function placeUpload(host: PlaceHost, file: string, fileName: string): Promise<Placed> {
  const ext = extname(fileName).toLowerCase()
  const { rec, dir } = host
  const info = LOADER_INFO[rec.loader]
  const warnings: string[] = []

  if (ext === '.jar') {
    const folder = info.extFolder
    if (!folder || !extensionKind(rec.loader)) throw new Error(`${info.label} unterstützt keine Mods oder Plugins.`)
    const jar = await inspectJar(file)
    if (!isCompatible(rec.loader, jar)) throw new Error(`Die Datei ist für ${jar.kinds.join('/')} gebaut, dieser Server nutzt ${info.label}. Sie wurde nicht installiert.`)
    if (jar.kinds.includes('unknown')) warnings.push('Der Typ der Datei konnte nicht erkannt werden. Prüfe, ob sie zu deinem Server passt.')
    const name = sanitizeFilename(fileName)
    const dest = safeJoin(dir, folder, name)
    if (existsSync(dest) || existsSync(`${dest}.disabled`)) throw new Error(`${name} existiert bereits.`)
    mkdirSync(join(dir, folder), { recursive: true })
    renameSync(file, dest)
    return { kind: extensionKind(rec.loader) === 'plugin' ? 'plugin' : 'mod', undo: { type: 'files', paths: [`${folder}/${name}`] }, warnings }
  }

  if (ext === '.mrpack') {
    if (!extensionKind(rec.loader) || extensionKind(rec.loader) !== 'mod') throw new Error('Modpacks brauchen einen Fabric-, Quilt-, Forge- oder NeoForge-Server.')
    const pack = await readMrpack(file)
    const t = mrpackTarget(pack)
    const loaderOk = t.loader === rec.loader || (rec.loader === 'quilt' && t.loader === 'fabric')
    if (!loaderOk) throw new Error(`Das Modpack ist für ${t.loader}, dein Server nutzt ${rec.loader}.`)
    if (t.mcVersion !== rec.mcVersion) throw new Error(`Das Modpack ist für Minecraft ${t.mcVersion}, dein Server nutzt ${rec.mcVersion}.`)
    // Vorher sichern: Das ist die Grundlage für "Rückgängig".
    const backup = await host.backup('vor-modpack')
    warnings.push(...(await applyMrpack(file, pack, dir)))
    return { kind: 'modpack', undo: { type: 'backup', file: backup }, warnings }
  }

  if (ext === '.mcpack' || ext === '.mcaddon') {
    if (rec.edition !== 'bedrock') throw new Error('Bedrock-Packs (.mcpack, .mcaddon) passen nur zu einem Bedrock-Server.')
    const tmp = mkdtempSync(join(tmpdir(), 'trm-bp-'))
    try {
      await extract(file, { dir: tmp })
      // .mcaddon enthält oft weitere .mcpack-Dateien
      for (const e of readdirSync(tmp)) if (/\.mcpack$/i.test(e) && statSync(join(tmp, e)).isFile()) { const d = join(tmp, basename(e, extname(e))); await extract(join(tmp, e), { dir: d }); rmSync(join(tmp, e)) }
      const packs = findBedrockPacks(tmp)
      if (!packs.length) throw new Error('Die Datei enthält kein gültiges Bedrock-Pack (manifest.json fehlt).')
      const placed: string[] = []
      for (const p of packs) {
        const folder = p.kind === 'behavior' ? 'behavior_packs' : 'resource_packs'
        const name = sanitizeFilename(`${basename(p.dir) === basename(tmp) ? basename(fileName, ext) : basename(p.dir)}.x`, ['.x']).slice(0, -2)
        const dest = safeJoin(dir, folder, name)
        if (existsSync(dest)) throw new Error(`${folder}/${name} existiert bereits.`)
        mkdirSync(join(dir, folder), { recursive: true })
        renameSync(p.dir, dest)
        placed.push(`${folder}/${name}`)
      }
      warnings.push('Aktiviere das Pack für deine Welt (world_behavior_packs.json bzw. world_resource_packs.json), damit es wirksam wird.')
      return { kind: 'bedrock-pack', undo: { type: 'files', paths: placed }, warnings }
    } finally { rmSync(tmp, { recursive: true, force: true }) }
  }

  if (ext === '.zip') {
    if (rec.edition === 'bedrock') throw new Error('Für Bedrock nutze .mcpack/.mcaddon.')
    const names = await zipNames(file)
    if (names.some((n) => /^([^/]+\/)?level\.dat$/.test(n))) {
      if (host.running) throw new Error('Stoppe den Server, bevor du eine Welt hochlädst.')
      const world = await importWorldZip(file, dir, sanitizeFilename(`${basename(fileName, ext)}.x`, ['.x']).slice(0, -2) || 'welt')
      warnings.push(`Welt „${world}“ importiert. Aktiviere sie im Tab „Welten“.`)
      return { kind: 'world', undo: { type: 'files', paths: [world] }, warnings }
    }
    if (names.includes('pack.mcmeta')) {
      const level = host.levelName()
      const name = sanitizeFilename(fileName, ['.zip'])
      const dest = safeJoin(dir, level, 'datapacks', name)
      if (existsSync(dest)) throw new Error(`${name} existiert bereits.`)
      mkdirSync(join(dir, level, 'datapacks'), { recursive: true })
      renameSync(file, dest)
      return { kind: 'datapack', undo: { type: 'files', paths: [`${level}/datapacks/${name}`] }, warnings: ['Führe /reload aus, damit das Datapack geladen wird.'] }
    }
    throw new Error('Unbekannte ZIP-Datei: weder Welt (level.dat) noch Datapack (pack.mcmeta).')
  }

  throw new Error(`Dateityp nicht erlaubt: ${ext || fileName}`)
}

/** Macht einen Upload rückgängig. Dateien werden gelöscht, Modpacks per Backup wiederhergestellt. */
export async function undoUpload(dir: string, undo: Undo, restore: (file: string) => Promise<void>): Promise<void> {
  if (undo.type === 'backup') return restore(undo.file)
  for (const p of undo.paths) rmSync(safeJoin(dir, p), { recursive: true, force: true })
}


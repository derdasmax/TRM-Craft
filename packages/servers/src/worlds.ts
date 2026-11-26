import extract from 'extract-zip'
import nbt from 'prismarine-nbt'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { WorldInfo } from '@trm/core'
import { parseProperties } from './properties'
import { safeJoin } from './sanitize'
import { zipDirectory } from './backups'

export const WORLD_NAME = /^[\w\- .()]{1,60}$/

function dirSize(dir: string, cap = 50_000): number {
  let n = 0
  let seen = 0
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (++seen > cap) return
      const p = join(d, e.name)
      if (e.isDirectory()) walk(p)
      else n += statSync(p).size
    }
  }
  try { walk(dir) } catch { /* ignore */ }
  return n
}

/** Liest den Seed aus level.dat (Java). Gibt undefined zurück, wenn er nicht lesbar ist. */
export async function readSeed(levelDat: string): Promise<string | undefined> {
  try {
    const { parsed } = await nbt.parse(readFileSync(levelDat))
    const data = nbt.simplify(parsed) as { Data?: { WorldGenSettings?: { seed?: unknown }; RandomSeed?: unknown } }
    const raw = data.Data?.WorldGenSettings?.seed ?? data.Data?.RandomSeed
    if (raw === undefined) return undefined
    if (Array.isArray(raw)) return (((BigInt(raw[0]) << 32n) | (BigInt(raw[1]) & 0xffffffffn)).toString())
    return String(raw)
  } catch { return undefined }
}

export function activeWorld(dir: string): string {
  const f = join(dir, 'server.properties')
  return (existsSync(f) ? parseProperties(readFileSync(f, 'utf8'))['level-name'] : undefined) ?? 'world'
}

export async function listWorlds(dir: string): Promise<WorldInfo[]> {
  const active = activeWorld(dir)
  const out: WorldInfo[] = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || !existsSync(join(dir, e.name, 'level.dat'))) continue
    out.push({ name: e.name, active: e.name === active, sizeBytes: dirSize(join(dir, e.name)), seed: await readSeed(join(dir, e.name, 'level.dat')) })
  }
  return out.sort((a, b) => Number(b.active) - Number(a.active) || a.name.localeCompare(b.name))
}

/** Ordner, die zu einer Welt gehören (Paper legt Nether und End als eigene Ordner an). */
export const worldFolders = (name: string) => [name, `${name}_nether`, `${name}_the_end`]

export function resetWorld(dir: string, name: string): void {
  if (!WORLD_NAME.test(name)) throw new Error('Ungültiger Weltname.')
  for (const f of worldFolders(name)) rmSync(safeJoin(dir, f), { recursive: true, force: true })
}

export async function exportWorld(dir: string, name: string, dest: string): Promise<void> {
  if (!WORLD_NAME.test(name) || !existsSync(join(dir, name, 'level.dat'))) throw new Error('Welt nicht gefunden.')
  if (!/\.zip$/i.test(dest)) throw new Error('Das Ziel muss eine .zip-Datei sein.')
  await zipDirectory(dir, dest, { excludeTop: new Set(), only: worldFolders(name).filter((f) => existsSync(join(dir, f))) })
}

/** Entpackt eine Welt-ZIP und verschiebt den Ordner mit level.dat unter einem freien Namen. */
export async function importWorldZip(zipPath: string, serverDir: string, preferred = 'world', overwrite = false): Promise<string> {
  const tmp = join(serverDir, '.world-import')
  rmSync(tmp, { recursive: true, force: true })
  try {
    await extract(zipPath, { dir: tmp })
    const find = (d: string, depth: number): string | null => {
      if (existsSync(join(d, 'level.dat'))) return d
      if (depth === 0) return null
      for (const e of readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) { const r = find(join(d, e.name), depth - 1); if (r) return r }
      return null
    }
    const src = find(tmp, 2)
    if (!src) throw new Error('Die ZIP enthält keine Minecraft-Welt (level.dat fehlt).')
    let name = preferred
    if (!overwrite) for (let i = 2; existsSync(join(serverDir, name)); i++) name = `${preferred}-${i}`
    else rmSync(join(serverDir, name), { recursive: true, force: true })
    mkdirSync(serverDir, { recursive: true })
    renameSync(src, join(serverDir, name))
    return name
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

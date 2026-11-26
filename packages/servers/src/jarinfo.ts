import yauzl from 'yauzl'
import type { Loader } from '@trm/core'

export type JarKind = Loader | 'bukkit' | 'unknown'

export interface JarInfo {
  /** Loader, für die die Datei gebaut wurde (z. B. Fabric-Mod, Bukkit-Plugin). */
  kinds: JarKind[]
  entries: number
}

function listEntries(path: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    yauzl.open(path, { lazyEntries: true, autoClose: true }, (err, zip) => {
      if (err || !zip) return reject(err ?? new Error('Keine gültige JAR/ZIP-Datei.'))
      const names: string[] = []
      zip.on('entry', (e: yauzl.Entry) => {
        names.push(e.fileName)
        if (names.length > 100_000) return reject(new Error('Zu viele Einträge.'))
        zip.readEntry()
      })
      zip.on('end', () => resolve(names))
      zip.on('error', reject)
      zip.readEntry()
    })
  })
}

/** Erkennt anhand typischer Metadaten-Dateien, wofür eine JAR gebaut ist. */
export async function inspectJar(path: string): Promise<JarInfo> {
  const names = await listEntries(path)
  const has = (n: string) => names.includes(n)
  const kinds = new Set<JarKind>()
  if (has('fabric.mod.json')) kinds.add('fabric')
  if (has('quilt.mod.json')) kinds.add('quilt')
  if (has('META-INF/neoforge.mods.toml')) kinds.add('neoforge')
  if (has('META-INF/mods.toml') || has('mcmod.info')) kinds.add('forge')
  if (has('paper-plugin.yml')) kinds.add('paper')
  if (has('plugin.yml')) kinds.add('bukkit')
  if (has('velocity-plugin.json')) kinds.add('velocity')
  if (has('bungee.yml')) kinds.add('bungeecord')
  return { kinds: kinds.size ? [...kinds] : ['unknown'], entries: names.length }
}

/** Welche erkannten Arten laufen auf welchem Server? */
const COMPAT: Record<string, JarKind[]> = {
  fabric: ['fabric'],
  quilt: ['quilt', 'fabric'],
  forge: ['forge'],
  neoforge: ['neoforge', 'forge'],
  paper: ['paper', 'bukkit'],
  purpur: ['paper', 'bukkit'],
  folia: ['paper', 'bukkit'],
  spigot: ['bukkit'],
  velocity: ['velocity'],
  waterfall: ['bungeecord'],
  bungeecord: ['bungeecord'],
}

export function isCompatible(serverLoader: Loader, info: JarInfo): boolean {
  if (info.kinds.includes('unknown')) return true // lässt sich nicht beurteilen, daher nur warnen
  const ok = COMPAT[serverLoader] ?? []
  return info.kinds.some((k) => ok.includes(k))
}

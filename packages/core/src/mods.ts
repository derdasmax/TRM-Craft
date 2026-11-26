import type { Loader, ServerRecord } from './servers'

export type ModSource = 'modrinth' | 'curseforge' | 'hangar'
export type ModKind = 'mod' | 'plugin' | 'modpack'

export interface ModHit {
  source: ModSource
  id: string
  slug: string
  title: string
  description: string
  iconUrl?: string
  downloads: number
  author?: string
  categories: string[]
}

export interface ModSearchArgs {
  source: ModSource
  /** Server, für den gesucht wird (Loader und Version werden daraus abgeleitet). */
  serverId?: string
  kind: ModKind
  query: string
  offset: number
  category?: string
}

export interface ModSearchResult {
  hits: ModHit[]
  total: number
}

export interface InstalledMod {
  file: string
  enabled: boolean
  size: number
  source: ModSource | 'manual'
  projectId?: string
  title?: string
  iconUrl?: string
  version?: string
}

export interface ModInstallResult {
  installed: { title: string; file: string }[]
  warnings: string[]
}

export interface ModUpdate {
  file: string
  title: string
  from: string
  to: string
}

export type ModpackSource =
  | { type: 'modrinth'; projectId: string }
  | { type: 'curseforge'; projectId: string }
  | { type: 'file'; path: string }

export interface ModpackInstallArgs {
  token: string
  source: ModpackSource
  name: string
  ramMb: number
  acceptEula: true
}

/** Welche Erweiterungen ein Server aufnimmt, falls überhaupt. */
export function extensionKind(loader: Loader): ModKind | null {
  switch (loader) {
    case 'fabric': case 'quilt': case 'forge': case 'neoforge': return 'mod'
    case 'paper': case 'purpur': case 'folia': case 'spigot': case 'velocity': case 'waterfall': case 'bungeecord': return 'plugin'
    default: return null
  }
}

export type ModTarget = Pick<ServerRecord, 'loader' | 'mcVersion'>

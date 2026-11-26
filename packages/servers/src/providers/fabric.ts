import { z } from 'zod'
import type { VersionInfo } from '@trm/core'
import { fetchJson, type FetchLike } from '../download'

const Entry = z.object({ version: z.string(), stable: z.boolean() })
const Entries = z.array(Entry)

export type MetaKind = 'fabric' | 'quilt'
const BASE: Record<MetaKind, string> = { fabric: 'https://meta.fabricmc.net/v2', quilt: 'https://meta.quiltmc.org/v3' }

/** Minecraft-Versionen, die Fabric bzw. Quilt unterstützen (neueste zuerst, stabile als Release). */
export async function listMetaGameVersions(kind: MetaKind, f?: FetchLike): Promise<VersionInfo[]> {
  const games = Entries.parse(await fetchJson(`${BASE[kind]}/versions/game`, f))
  return games.map((g) => ({ id: g.version, type: g.stable ? ('release' as const) : ('snapshot' as const) })).filter((v) => v.type === 'release')
}

const firstStable = (e: z.infer<typeof Entry>[]) => (e.find((x) => x.stable) ?? e[0])?.version

export interface ResolvedFabric {
  /** Direkter Server-Download (nur Fabric). */
  url: string
  loader: string
  installer: string
}

export async function resolveFabric(mc: string, f?: FetchLike, pinned?: string): Promise<ResolvedFabric> {
  const loader = pinned ?? firstStable(Entries.parse(await fetchJson(`${BASE.fabric}/versions/loader`, f)))
  const inst = firstStable(Entries.parse(await fetchJson(`${BASE.fabric}/versions/installer`, f)))
  if (!loader || !inst) throw new Error(`Fabric unterstützt ${mc} nicht.`)
  return { url: `${BASE.fabric}/versions/loader/${encodeURIComponent(mc)}/${loader}/${inst}/server/jar`, loader, installer: inst }
}

export interface ResolvedQuilt {
  installerUrl: string
  installerVersion: string
}

/** Quilt liefert nur einen Installer, der den Server einrichtet. */
export async function resolveQuilt(f?: FetchLike): Promise<ResolvedQuilt> {
  const inst = firstStable(Entries.parse(await fetchJson(`${BASE.quilt}/versions/installer`, f)))
  if (!inst) throw new Error('Quilt-Installer nicht gefunden.')
  return { installerVersion: inst, installerUrl: `https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/${inst}/quilt-installer-${inst}.jar` }
}

import { z } from 'zod'
import type { VersionInfo } from '@trm/core'
import { fetchJson, type FetchLike } from '../download'

export const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

export const ManifestSchema = z.object({
  latest: z.object({ release: z.string(), snapshot: z.string() }),
  versions: z.array(z.object({ id: z.string(), type: z.string(), url: z.string().url(), releaseTime: z.string() })),
})
export const VersionJsonSchema = z.object({
  id: z.string(),
  downloads: z.object({ server: z.object({ url: z.string().url(), sha1: z.string(), size: z.number() }).optional() }),
  javaVersion: z.object({ majorVersion: z.number() }).optional(),
})
export type Manifest = z.infer<typeof ManifestSchema>

/** Ältere Versionen als 1.2.5 haben kein Server-JAR zum Download. */
const MIN_SERVER_DATE = '2012-03-29'

export async function fetchManifest(f?: FetchLike): Promise<Manifest> {
  return ManifestSchema.parse(await fetchJson(MANIFEST_URL, f))
}

export function listFromManifest(m: Manifest, includeSnapshots = false): VersionInfo[] {
  return m.versions
    .filter((v) => (v.type === 'release' || (includeSnapshots && v.type === 'snapshot')) && v.releaseTime >= MIN_SERVER_DATE)
    .map((v) => ({ id: v.id, type: v.type as 'release' | 'snapshot' }))
}

export interface ResolvedVanilla {
  url: string
  sha1: string
  size: number
  javaMajor: number
}

export async function resolveVanilla(version: string, f?: FetchLike): Promise<ResolvedVanilla> {
  const manifest = await fetchManifest(f)
  const entry = manifest.versions.find((v) => v.id === version)
  if (!entry) throw new Error(`Unbekannte Minecraft-Version: ${version}`)
  const json = VersionJsonSchema.parse(await fetchJson(entry.url, f))
  const server = json.downloads.server
  if (!server) throw new Error(`Für ${version} gibt es keinen Server-Download.`)
  return { ...server, javaMajor: json.javaVersion?.majorVersion ?? 8 }
}

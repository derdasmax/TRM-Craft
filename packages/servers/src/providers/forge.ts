import { z } from 'zod'
import type { VersionInfo } from '@trm/core'
import { fetchJson, type FetchLike } from '../download'
import { compareVersionsDesc } from './paper'

export const PROMOS_URL = 'https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json'
export const PromosSchema = z.object({ promos: z.record(z.string()) })

const KEY = /^(\d+\.\d+(?:\.\d+)?)-(latest|recommended)$/

export async function listForgeVersions(f?: FetchLike): Promise<VersionInfo[]> {
  const { promos } = PromosSchema.parse(await fetchJson(PROMOS_URL, f))
  const mcs = new Set<string>()
  for (const k of Object.keys(promos)) {
    const m = KEY.exec(k)
    if (m) mcs.add(m[1]!)
  }
  return [...mcs].sort(compareVersionsDesc).map((id) => ({ id, type: 'release' as const }))
}

export interface ResolvedForge {
  forgeVersion: string
  installerUrl: string
}

/** Bevorzugt die empfohlene Version, sonst die neueste. */
export async function resolveForge(mc: string, f?: FetchLike): Promise<ResolvedForge> {
  const { promos } = PromosSchema.parse(await fetchJson(PROMOS_URL, f))
  const v = promos[`${mc}-recommended`] ?? promos[`${mc}-latest`]
  if (!v) throw new Error(`Für Minecraft ${mc} gibt es kein Forge.`)
  const full = `${mc}-${v}`
  return { forgeVersion: v, installerUrl: `https://maven.minecraftforge.net/net/minecraftforge/forge/${full}/forge-${full}-installer.jar` }
}

// ---------- NeoForge ----------
const NF_VERSIONS = 'https://maven.neoforged.net/api/maven/versions/releases/net/neoforged/neoforge'
export const NeoVersionsSchema = z.object({ versions: z.array(z.string()) })

/** NeoForge 21.1.77 gehört zu Minecraft 1.21.1, 21.0.x zu 1.21, 20.4.x zu 1.20.4. */
export function neoForgeToMc(v: string): string | null {
  const m = /^(\d+)\.(\d+)\./.exec(v)
  if (!m) return null
  const [, a, b] = m
  return b === '0' ? `1.${a}` : `1.${a}.${b}`
}

const isStableNeo = (v: string) => !/-(beta|alpha|rc)/i.test(v)

export async function listNeoForgeVersions(f?: FetchLike): Promise<VersionInfo[]> {
  const { versions } = NeoVersionsSchema.parse(await fetchJson(NF_VERSIONS, f))
  const mcs = new Set<string>()
  for (const v of versions) {
    const mc = isStableNeo(v) ? neoForgeToMc(v) : null
    if (mc) mcs.add(mc)
  }
  return [...mcs].sort(compareVersionsDesc).map((id) => ({ id, type: 'release' as const }))
}

export async function resolveNeoForge(mc: string, f?: FetchLike): Promise<{ neoVersion: string; installerUrl: string }> {
  const { versions } = NeoVersionsSchema.parse(await fetchJson(NF_VERSIONS, f))
  const candidates = versions.filter((v) => isStableNeo(v) && neoForgeToMc(v) === mc)
  const best = candidates.sort((a, b) => compareVersionsDesc(a, b))[0]
  if (!best) throw new Error(`Für Minecraft ${mc} gibt es kein NeoForge.`)
  return { neoVersion: best, installerUrl: `https://maven.neoforged.net/releases/net/neoforged/neoforge/${best}/neoforge-${best}-installer.jar` }
}

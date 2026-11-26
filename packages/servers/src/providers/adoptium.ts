import { z } from 'zod'
import { fetchJson, type FetchLike } from '../download'

export const AssetsSchema = z.array(z.object({ binary: z.object({ package: z.object({ link: z.string().url(), checksum: z.string(), name: z.string() }) }) }))

export interface JreAsset {
  url: string
  sha256: string
  name: string
}

/** Neueste Windows-x64-JRE (Temurin) für eine Java-Hauptversion. */
export async function resolveJre(major: number, f?: FetchLike): Promise<JreAsset> {
  const url = `https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=jre&os=windows&vendor=eclipse`
  const assets = AssetsSchema.parse(await fetchJson(url, f))
  const p = assets[0]?.binary.package
  if (!p) throw new Error(`Keine Java-${major}-Laufzeit gefunden.`)
  return { url: p.link, sha256: p.checksum, name: p.name }
}

/** Mindest-Java-Version je Minecraft-Version, falls die Mojang-Daten fehlen. */
export function javaForMinecraft(mc: string): number {
  const [maj, min = 0, pat = 0] = mc.split('.').map((x) => parseInt(x, 10) || 0)
  if (maj !== 1) return 21
  if (min >= 21 || (min === 20 && pat >= 5)) return 21
  if (min >= 18) return 17
  if (min === 17) return 16
  return 8
}

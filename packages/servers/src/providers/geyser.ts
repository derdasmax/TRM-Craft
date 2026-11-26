import { z } from 'zod'
import { fetchJson, type FetchLike } from '../download'

const BuildSchema = z.object({ downloads: z.record(z.object({ name: z.string(), sha256: z.string() })) })

export type GeyserProject = 'geyser' | 'floodgate'

export async function resolveGeyser(project: GeyserProject, f?: FetchLike): Promise<{ url: string; sha256: string; name: string }> {
  const base = `https://download.geysermc.org/v2/projects/${project}/versions/latest/builds/latest`
  const build = BuildSchema.parse(await fetchJson(base, f))
  const spigot = build.downloads.spigot
  if (!spigot) throw new Error(`${project}: Kein Spigot/Paper-Build gefunden.`)
  return { url: `${base}/downloads/spigot`, sha256: spigot.sha256, name: spigot.name }
}

/** Minimale Geyser-Konfiguration: Bedrock-Port, Weiterleitung an den Java-Server, Anmeldung über Floodgate. */
export function geyserConfig(bedrockPort: number, javaPort: number): string {
  return `# Von TRM-Craft erzeugt. Alle anderen Werte nutzen Geysers Standard.
bedrock:
  port: ${bedrockPort}
  clone-remote-port: false
remote:
  address: auto
  port: ${javaPort}
  auth-type: floodgate
`
}

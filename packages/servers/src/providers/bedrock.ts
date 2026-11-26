import { z } from 'zod'
import { fetchJson, type FetchLike } from '../download'

export const LINKS_URL = 'https://net-secondary.web.minecraft-services.net/api/v1.0/download/links'
export const LinksSchema = z.object({ result: z.object({ links: z.array(z.object({ downloadType: z.string(), downloadUrl: z.string().url() })) }) })

export interface ResolvedBedrock {
  version: string
  url: string
}

/** Neueste offizielle Windows-Version des Bedrock Dedicated Servers. */
export async function resolveBedrock(f?: FetchLike): Promise<ResolvedBedrock> {
  const { result } = LinksSchema.parse(await fetchJson(LINKS_URL, f))
  const link = result.links.find((l) => l.downloadType === 'serverBedrockWindows')
  const m = link && /bedrock-server-([\d.]+)\.zip/.exec(link.downloadUrl)
  if (!link || !m) throw new Error('Bedrock-Download wurde nicht gefunden.')
  return { version: m[1]!, url: link.downloadUrl }
}

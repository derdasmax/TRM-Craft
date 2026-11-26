import { isIPv4 } from 'node:net'
import { z } from 'zod'
import type { ReachResult } from '@trm/core'
import { fetchJson, type FetchLike } from '../download'

const Schema = z.object({ online: z.boolean() })

/**
 * Prüft über mcsrvstat.us, ob ein Server von außen erreichbar ist. Dabei wird IP und Port an diesen Dienst gesendet.
 * Der Server muss dafür laufen.
 */
export async function checkReachable(ip: string, port: number, edition: 'java' | 'bedrock', f?: FetchLike): Promise<ReachResult> {
  if (!isIPv4(ip) || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Ungültige Adresse.')
  const address = `${ip}:${port}`
  const url = `https://api.mcsrvstat.us/${edition === 'bedrock' ? 'bedrock/3' : '3'}/${address}`
  const { online } = Schema.parse(await fetchJson(url, f))
  return online ? { online, address } : {
    online, address,
    hint: edition === 'bedrock'
      ? 'Nicht erreichbar. Prüfe, ob der Server läuft, ob UDP-Port ' + port + ' weitergeleitet ist und ob die Windows-Firewall ihn erlaubt.'
      : 'Nicht erreichbar. Prüfe, ob der Server läuft, ob TCP-Port ' + port + ' im Router weitergeleitet ist und ob die Windows-Firewall ihn erlaubt. Bei CGNAT hilft nur ein Tunnel.',
  }
}

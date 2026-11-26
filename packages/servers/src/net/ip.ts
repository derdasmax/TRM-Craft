import { isIPv4 } from 'node:net'
import { networkInterfaces } from 'node:os'
import { fetchJson, type FetchLike } from '../download'

export async function publicIp(f?: FetchLike): Promise<string | null> {
  try {
    const r = await fetchJson<{ ip?: string }>('https://api.ipify.org?format=json', f)
    return r.ip && isIPv4(r.ip) ? r.ip : null
  } catch {
    return null
  }
}

export function isPrivateIPv4(host: string): boolean {
  if (!isIPv4(host)) return false
  const [a, b] = host.split('.').map(Number) as [number, number]
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
}

/** Lokale IPv4-Adressen im Heimnetz (Private-Bereiche zuerst). */
export function localIps(ifaces: ReturnType<typeof networkInterfaces> = networkInterfaces()): string[] {
  const all = Object.values(ifaces).flatMap((l) => l ?? []).filter((i) => i.family === 'IPv4' && !i.internal).map((i) => i.address)
  return [...all.filter(isPrivateIPv4), ...all.filter((a) => !isPrivateIPv4(a))]
}

import { PairResponseSchema, PROTOCOL_VERSION, type PairResponse } from './protocol'

/** Nur verschlüsselte Verbindungen (wss). Unverschlüsselt (ws) ist ausschließlich für lokale Entwicklung erlaubt. */
export function validateRemoteUrl(raw: string): URL {
  let u: URL
  try { u = new URL(raw) } catch { throw new Error('Die Adresse der Webseite ist ungültig.') }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1'
  if (u.protocol !== 'wss:' && !(u.protocol === 'ws:' && local)) throw new Error('Die Adresse muss mit wss:// beginnen (verschlüsselte Verbindung).')
  if (u.username || u.password) throw new Error('Die Adresse darf keine Zugangsdaten enthalten.')
  return u
}

/** HTTP-Basisadresse zum selben Host (für die Kopplung). */
export function httpBase(wsUrl: string): string {
  const u = validateRemoteUrl(wsUrl)
  return `${u.protocol === 'wss:' ? 'https:' : 'http:'}//${u.host}`
}

const CODE = /^[A-Za-z0-9-]{4,24}$/

/** Tauscht den auf der Webseite angezeigten Kopplungscode gegen ein Geräte-Token. */
export async function pairDevice(wsUrl: string, code: string, deviceName: string, appVersion: string, f: typeof fetch = fetch): Promise<PairResponse> {
  const c = code.trim()
  if (!CODE.test(c)) throw new Error('Der Code ist ungültig. Er besteht aus Buchstaben, Zahlen und Bindestrichen.')
  const res = await f(`${httpBase(wsUrl)}/api/devices/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({ code: c, deviceName: deviceName.slice(0, 60), appVersion, protocol: PROTOCOL_VERSION }),
    signal: AbortSignal.timeout(15_000),
  })
  if (res.status === 404 || res.status === 400 || res.status === 410) throw new Error('Der Code ist abgelaufen oder falsch. Erzeuge auf der Webseite einen neuen.')
  if (!res.ok) throw new Error(`Die Webseite hat die Kopplung abgelehnt (${res.status}).`)
  return PairResponseSchema.parse(await res.json())
}

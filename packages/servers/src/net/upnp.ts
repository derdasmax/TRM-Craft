import { createSocket } from 'node:dgram'
import { isPrivateIPv4 } from './ip'
import type { FetchLike } from '../download'

const SSDP_ADDR = '239.255.255.250'
const TARGETS = ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2']
const SERVICES = ['urn:schemas-upnp-org:service:WANIPConnection:2', 'urn:schemas-upnp-org:service:WANIPConnection:1', 'urn:schemas-upnp-org:service:WANPPPConnection:1']

/** Router liefern Adressen in ihren Antworten. Wir folgen nur Adressen im Heimnetz (SSRF-Schutz). */
export function assertLan(url: string): URL {
  const u = new URL(url)
  if (u.protocol !== 'http:' || !isPrivateIPv4(u.hostname)) throw new Error('UPnP-Adresse liegt nicht im lokalen Netz.')
  return u
}

export function discoverGateway(timeoutMs = 3000): Promise<string | null> {
  return new Promise((resolve) => {
    const sock = createSocket({ type: 'udp4', reuseAddr: true })
    const done = (v: string | null) => { try { sock.close() } catch { /* ignore */ } clearTimeout(t); resolve(v) }
    const t = setTimeout(() => done(null), timeoutMs)
    sock.on('message', (msg) => {
      const loc = /^location:\s*(\S+)/im.exec(msg.toString())?.[1]
      if (loc) { try { assertLan(loc); done(loc) } catch { /* fremde Antwort ignorieren */ } }
    })
    sock.on('error', () => done(null))
    sock.bind(0, () => {
      for (const st of TARGETS) sock.send(Buffer.from(`M-SEARCH * HTTP/1.1\r\nHOST: ${SSDP_ADDR}:1900\r\nMAN: "ssdp:discover"\r\nMX: 2\r\nST: ${st}\r\n\r\n`), 1900, SSDP_ADDR)
    })
  })
}

export interface Control { controlUrl: string; serviceType: string }

/** Findet im Geräte-XML den Dienst für Portweiterleitungen. */
export function parseDescription(xml: string, base: string): Control | null {
  for (const st of SERVICES) {
    const i = xml.indexOf(`<serviceType>${st}</serviceType>`)
    if (i < 0) continue
    const rest = xml.slice(i)
    const c = /<controlURL>([^<]+)<\/controlURL>/.exec(rest)?.[1]
    if (c) return { serviceType: st, controlUrl: new URL(c.trim(), base).toString() }
  }
  return null
}

const esc = (s: string) => s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`)

export function soapEnvelope(serviceType: string, action: string, args: Record<string, string | number>): string {
  const body = Object.entries(args).map(([k, v]) => `<${k}>${esc(String(v))}</${k}>`).join('')
  return `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body><u:${action} xmlns:u="${serviceType}">${body}</u:${action}></s:Body></s:Envelope>`
}

export interface UpnpDeps { discover?: () => Promise<string | null>; fetchImpl?: FetchLike }

export class UpnpClient {
  private control: Control | null = null
  constructor(private readonly d: UpnpDeps = {}) {}

  private get f(): FetchLike { return this.d.fetchImpl ?? fetch }

  async connect(): Promise<boolean> {
    const loc = await (this.d.discover ?? discoverGateway)()
    if (!loc) return false
    const url = assertLan(loc)
    const res = await this.f(url.toString(), { signal: AbortSignal.timeout(4000) })
    if (!res.ok) return false
    const c = parseDescription(await res.text(), url.toString())
    if (!c) return false
    assertLan(c.controlUrl)
    this.control = c
    return true
  }

  private async call(action: string, args: Record<string, string | number>): Promise<string> {
    if (!this.control) throw new Error('Kein UPnP-Router gefunden.')
    const res = await this.f(this.control.controlUrl, {
      method: 'POST',
      headers: { 'content-type': 'text/xml; charset="utf-8"', soapaction: `"${this.control.serviceType}#${action}"` },
      body: soapEnvelope(this.control.serviceType, action, args),
      signal: AbortSignal.timeout(5000),
    })
    const text = await res.text()
    if (!res.ok) throw new Error(/<errorDescription>([^<]+)</.exec(text)?.[1] ?? `UPnP-Fehler (${res.status})`)
    return text
  }

  async externalIp(): Promise<string | null> {
    return /<NewExternalIPAddress>([^<]+)</.exec(await this.call('GetExternalIPAddress', {}))?.[1] ?? null
  }

  async addMapping(port: number, protocol: 'TCP' | 'UDP', internalIp: string, description = 'TRM-Craft'): Promise<void> {
    if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Ungültiger Port.')
    if (!isPrivateIPv4(internalIp)) throw new Error('Ungültige lokale Adresse.')
    await this.call('AddPortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol, NewInternalPort: port, NewInternalClient: internalIp, NewEnabled: 1, NewPortMappingDescription: description, NewLeaseDuration: 0 })
  }

  async deleteMapping(port: number, protocol: 'TCP' | 'UDP'): Promise<void> {
    await this.call('DeletePortMapping', { NewRemoteHost: '', NewExternalPort: port, NewProtocol: protocol })
  }
}

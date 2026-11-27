import { z } from 'zod'
import { assertAllowedUrl, type FetchLike } from '../download'

const API = 'https://api.cloudflare.com/client/v4'
const LABEL = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/
const DOMAIN = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$/

export const validDomain = (d: string) => DOMAIN.test(d.toLowerCase())
export const validLabel = (s: string) => LABEL.test(s.toLowerCase())
export const joinHost = (sub: string, domain: string) => (sub ? `${sub}.${domain}` : domain).toLowerCase()

const Envelope = z.object({ success: z.boolean(), errors: z.array(z.object({ message: z.string() })).default([]), result: z.unknown() })
const Record = z.object({ id: z.string(), type: z.string(), name: z.string(), content: z.string().optional() })

export class Cloudflare {
  constructor(private readonly token: string, private readonly f: FetchLike = fetch) {}

  private async req<T>(method: string, path: string, schema: z.ZodType<T, z.ZodTypeDef, unknown>, body?: unknown): Promise<T> {
    const url = `${API}${path}`
    assertAllowedUrl(url)
    const res = await this.f(url, { method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json', accept: 'application/json' }, body: body ? JSON.stringify(body) : undefined })
    const env = Envelope.safeParse(await res.json().catch(() => ({})))
    if (!env.success || !env.data.success) {
      if (res.status === 401 || res.status === 403) throw new Error(`Cloudflare hat den Token abgelehnt (${path.split('?')[0]}). Er braucht die Berechtigungen „Zone: DNS: Bearbeiten“, „Konto: Cloudflare Tunnel: Bearbeiten“ und „Konto: Kontoeinstellungen: Lesen“.`)
      throw new Error(env.success ? (env.data.errors[0]?.message ?? `Cloudflare-Fehler (${res.status})`) : `Cloudflare-Fehler (${res.status})`)
    }
    return schema.parse(env.data.result)
  }

  async verify(): Promise<void> {
    await this.req('GET', '/user/tokens/verify', z.object({ status: z.string() }).refine((r) => r.status === 'active', 'Der Token ist nicht aktiv.'))
  }

  async zoneId(domain: string): Promise<string> {
    if (!validDomain(domain)) throw new Error('Ungültige Domain.')
    const zones = await this.req('GET', `/zones?name=${encodeURIComponent(domain.toLowerCase())}`, z.array(z.object({ id: z.string(), name: z.string() })))
    const z0 = zones.find((z1) => z1.name === domain.toLowerCase())
    if (!z0) throw new Error(`Die Domain ${domain} gehört nicht zu diesem Cloudflare-Konto.`)
    return z0.id
  }

  /** Zone samt Konto-ID (für Tunnel-Aufrufe). */
  async zone(domain: string): Promise<{ id: string; account: string }> {
    if (!validDomain(domain)) throw new Error('Ungültige Domain.')
    const zones = await this.req('GET', `/zones?name=${encodeURIComponent(domain.toLowerCase())}`, z.array(z.object({ id: z.string(), name: z.string(), account: z.object({ id: z.string() }) })))
    const z0 = zones.find((z1) => z1.name === domain.toLowerCase())
    if (!z0) throw new Error(`Die Domain ${domain} gehört nicht zu diesem Cloudflare-Konto.`)
    if (!z0.account) throw new Error('Cloudflare hat die Konto-ID der Domain nicht geliefert. Prüfe die Token-Rechte (Konto: Lesen).')
    return { id: z0.id, account: z0.account.id }
  }

  // ---------- Cloudflare Tunnel ----------
  async findTunnel(account: string, name: string): Promise<string | undefined> {
    const list = await this.req('GET', `/accounts/${account}/cfd_tunnel?name=${encodeURIComponent(name)}&is_deleted=false`, z.array(z.object({ id: z.string(), name: z.string() })))
    return list.find((t) => t.name === name)?.id
  }

  async createTunnel(account: string, name: string): Promise<string> {
    const t = await this.req('POST', `/accounts/${account}/cfd_tunnel`, z.object({ id: z.string() }), { name, config_src: 'cloudflare' })
    return t.id
  }

  /** Token, mit dem `cloudflared` den Tunnel startet. */
  async tunnelToken(account: string, tunnel: string): Promise<string> {
    return this.req('GET', `/accounts/${account}/cfd_tunnel/${tunnel}/token`, z.string())
  }

  /** Leitet `host` durch den Tunnel an den lokalen Dienst weiter, alles andere liefert 404. */
  async configureTunnel(account: string, tunnel: string, host: string, localPort: number): Promise<void> {
    await this.req('PUT', `/accounts/${account}/cfd_tunnel/${tunnel}/configurations`, z.unknown(), {
      config: { ingress: [{ hostname: host, service: `http://127.0.0.1:${localPort}`, originRequest: {} }, { service: 'http_status:404' }] },
    })
  }

  /** CNAME auf den Tunnel (über Cloudflares Proxy, sonst funktioniert der Tunnel nicht). */
  async upsertCname(zone: string, host: string, tunnel: string): Promise<void> {
    const body = { type: 'CNAME', name: host, content: `${tunnel}.cfargotunnel.com`, ttl: 1, proxied: true, comment: 'TRM-Craft' }
    const ex = await this.find(zone, 'CNAME', host)
    if (ex) await this.req('PUT', `/zones/${zone}/dns_records/${ex.id}`, Record, body)
    else await this.req('POST', `/zones/${zone}/dns_records`, Record, body)
  }

  async removeCname(zone: string, host: string): Promise<void> {
    const ex = await this.find(zone, 'CNAME', host)
    if (ex) await this.req('DELETE', `/zones/${zone}/dns_records/${ex.id}`, z.object({ id: z.string() }))
  }

  async deleteTunnel(account: string, tunnel: string): Promise<void> {
    await this.req('DELETE', `/accounts/${account}/cfd_tunnel/${tunnel}/connections`, z.unknown()).catch(() => {})
    await this.req('DELETE', `/accounts/${account}/cfd_tunnel/${tunnel}`, z.unknown())
  }

  private async find(zone: string, type: string, name: string) {
    const list = await this.req('GET', `/zones/${zone}/dns_records?type=${type}&name=${encodeURIComponent(name)}`, z.array(Record))
    return list[0]
  }

  /** A-Record (nicht über Cloudflares Proxy, sonst kommt Minecraft-Verkehr nicht durch). */
  async upsertA(zone: string, host: string, ip: string): Promise<void> {
    const body = { type: 'A', name: host, content: ip, ttl: 60, proxied: false, comment: 'TRM-Craft' }
    const ex = await this.find(zone, 'A', host)
    if (ex) await this.req('PUT', `/zones/${zone}/dns_records/${ex.id}`, Record, body)
    else await this.req('POST', `/zones/${zone}/dns_records`, Record, body)
  }

  /** SRV für Java: _minecraft._tcp.<host> → <host>:<port>. Bedrock unterstützt kein SRV. */
  async upsertSrv(zone: string, host: string, port: number): Promise<void> {
    const name = `_minecraft._tcp.${host}`
    const body = { type: 'SRV', name, ttl: 60, data: { priority: 0, weight: 5, port, target: host }, comment: 'TRM-Craft' }
    const ex = await this.find(zone, 'SRV', name)
    if (ex) await this.req('PUT', `/zones/${zone}/dns_records/${ex.id}`, Record, body)
    else await this.req('POST', `/zones/${zone}/dns_records`, Record, body)
  }

  async remove(zone: string, host: string): Promise<void> {
    for (const [type, name] of [['A', host], ['SRV', `_minecraft._tcp.${host}`]] as const) {
      const ex = await this.find(zone, type, name)
      if (ex) await this.req('DELETE', `/zones/${zone}/dns_records/${ex.id}`, z.object({ id: z.string() }))
    }
  }
}

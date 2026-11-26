import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { DomainConfig } from '@trm/core'
import { Cloudflare, joinHost, validDomain, validLabel } from './cloudflare'

export interface DdnsDeps {
  file: string
  token: () => string | null
  publicIp: () => Promise<string | null>
  portOf: (serverId: string) => number | null
  now?: () => number
  cf?: (token: string) => Cloudflare
  log?: (msg: string) => void
}

/** Hält die DNS-Einträge aktuell, auch wenn sich die öffentliche IP ändert (Dynamisches DNS). */
export class Ddns {
  private items: DomainConfig[] = []
  private timer: NodeJS.Timeout | null = null

  constructor(private readonly d: DdnsDeps) {
    try { if (existsSync(d.file)) this.items = (JSON.parse(readFileSync(d.file, 'utf8')) as { domains: DomainConfig[] }).domains ?? [] } catch { this.items = [] }
  }

  private save() {
    const tmp = `${this.d.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ domains: this.items }, null, 2))
    renameSync(tmp, this.d.file)
  }

  private cf(): Cloudflare {
    const t = this.d.token()
    if (!t) throw new Error('Es ist kein Cloudflare-Token gespeichert.')
    return (this.d.cf ?? ((x) => new Cloudflare(x)))(t)
  }

  get(serverId: string): DomainConfig | null { return this.items.find((i) => i.serverId === serverId) ?? null }

  async set(serverId: string, domain: string, sub: string, srv: boolean): Promise<DomainConfig> {
    domain = domain.trim().toLowerCase()
    sub = sub.trim().toLowerCase()
    if (!validDomain(domain)) throw new Error('Ungültige Domain.')
    if (sub && !validLabel(sub)) throw new Error('Ungültiger Subdomain-Name (nur Buchstaben, Zahlen und Bindestriche).')
    const port = this.d.portOf(serverId)
    if (!port) throw new Error('Server nicht gefunden.')
    const host = joinHost(sub, domain)
    const clash = this.items.find((i) => i.host === host && i.serverId !== serverId)
    if (clash) throw new Error(`${host} wird bereits für einen anderen Server genutzt.`)
    const cf = this.cf() // zuerst: fehlt der Token, ist das die wichtigere Meldung
    const ip = await this.d.publicIp()
    if (!ip) throw new Error('Die öffentliche IP konnte nicht ermittelt werden.')
    const zone = await cf.zoneId(domain)
    await cf.upsertA(zone, host, ip)
    if (srv) await cf.upsertSrv(zone, host, port)
    const cfg: DomainConfig = { serverId, host, zoneName: domain, srv, lastIp: ip, lastUpdated: (this.d.now ?? Date.now)() }
    this.items = [...this.items.filter((i) => i.serverId !== serverId), cfg]
    this.save()
    return cfg
  }

  async remove(serverId: string): Promise<void> {
    const c = this.get(serverId)
    if (!c) return
    if (this.d.token()) { const cf = this.cf(); await cf.remove(await cf.zoneId(c.zoneName), c.host).catch(() => {}) }
    this.items = this.items.filter((i) => i.serverId !== serverId)
    this.save()
  }

  /** Aktualisiert alle A-Records, wenn sich die öffentliche IP geändert hat. Gibt die Anzahl aktualisierter Einträge zurück. */
  async tick(): Promise<number> {
    if (!this.items.length || !this.d.token()) return 0
    const ip = await this.d.publicIp()
    if (!ip) return 0
    const stale = this.items.filter((i) => i.lastIp !== ip)
    if (!stale.length) return 0
    const cf = this.cf()
    let n = 0
    for (const c of stale) {
      try {
        await cf.upsertA(await cf.zoneId(c.zoneName), c.host, ip)
        c.lastIp = ip
        c.lastUpdated = (this.d.now ?? Date.now)()
        n++
        this.d.log?.(`DNS aktualisiert: ${c.host} → ${ip}`)
      } catch (e) { this.d.log?.(`DNS-Update für ${c.host} fehlgeschlagen: ${(e as Error).message}`) }
    }
    if (n) this.save()
    return n
  }

  start(intervalMs = 5 * 60_000) { this.stop(); this.timer = setInterval(() => void this.tick(), intervalMs); void this.tick() }
  stop() { if (this.timer) clearInterval(this.timer); this.timer = null }
}

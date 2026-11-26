import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { Cloudflare, CloudflaredRunner, removeTunnel, setupTunnel, type TunnelMeta } from '@trm/servers'
import { DeviceStore, PairingCodes, RemoteServer, SessionStore, UploadManager, type ServerSummary, type UploadServer } from '@trm/remote'
import type { CommandName, DeviceInfo, RemoteStatus, Settings, UploadRecord } from '@trm/core'
import type { SecretStore } from './secrets'

export interface RemoteHostDeps {
  dir: string
  appVersion: string
  settings: () => Settings
  patchSettings: (p: { remote: Partial<Settings['remote']> }) => Settings
  secrets: () => SecretStore
  emit: (event: string, payload: unknown) => void
  exec: (c: CommandName, a: unknown) => Promise<unknown>
  known: (c: string) => c is CommandName
  summaries: () => ServerSummary[]
  uploadServer: (id: string) => UploadServer | null
  restore: (serverId: string, file: string) => Promise<void>
  log?: (m: string) => void
}

const originOf = (u: string): string | null => { try { const x = new URL(u); return x.protocol === 'https:' || x.hostname === 'localhost' ? x.origin : null } catch { return null } }

/** Alles rund um den Fernzugriff: API-Server, Geräte, Kopplung, Uploads und Cloudflare-Tunnel. */
export class RemoteHost {
  readonly devices: DeviceStore
  readonly sessions = new SessionStore()
  readonly pairing = new PairingCodes()
  readonly uploads: UploadManager
  readonly server: RemoteServer
  readonly runner: CloudflaredRunner
  private lastError: string | undefined
  private lastKey = ''
  private metaFile: string
  private statusTimer: ReturnType<typeof setTimeout> | null = null

  constructor(private readonly d: RemoteHostDeps) {
    this.metaFile = join(d.dir, 'remote-tunnel.json')
    this.devices = new DeviceStore(join(d.dir, 'remote-devices.json'))
    this.uploads = new UploadManager({
      dir: join(d.dir, 'uploads'),
      limitBytes: () => d.settings().remote.uploadLimitMb * 1048576,
      canUpload: () => true, // pro Gerät/Sitzung im Server geprüft
      send: (m) => this.server.uploadSend(m),
      emit: (r: UploadRecord) => { d.emit('remote.upload', r); this.server.forward('remote.upload', r) },
      restore: d.restore,
      server: d.uploadServer,
    })
    this.runner = new CloudflaredRunner({ dir: join(d.dir, 'runtimes', 'cloudflared'), emit: (info) => { d.emit('remote.status', this.status()); if (info.phase === 'connected') void this.verifyReach() } })
    this.server = new RemoteServer({
      config: () => this.config(),
      exec: d.exec, known: d.known, summaries: d.summaries, uploads: this.uploads,
      devices: this.devices, sessions: this.sessions, pairing: this.pairing,
      info: () => ({ appVersion: d.appVersion, deviceName: d.settings().remote.deviceName || hostname(), tunnel: d.settings().remote.mode === 'tunnel' }),
      onChange: () => this.scheduleStatus(),
      log: d.log,
    })
    this.runner.configured(this.meta()?.host, !!(this.meta() as { service?: boolean } | null)?.service)
  }

  // ---------- Konfiguration ----------
  private config() {
    const r = this.d.settings().remote
    let tls: { cert: Buffer; key: Buffer } | undefined
    if (r.mode === 'direct' && r.tlsCertPath && r.tlsKeyPath) {
      try { tls = { cert: readFileSync(r.tlsCertPath), key: readFileSync(r.tlsKeyPath) } } catch { /* Fehler zeigt apply() */ }
    }
    return { enabled: r.enabled, mode: r.mode, port: r.port, allowedOrigins: r.allowedOrigins, publicHost: r.publicHost || this.meta()?.host || '', maxRole: r.maxRole, tls }
  }

  private meta(): TunnelMeta | null {
    try { return existsSync(this.metaFile) ? (JSON.parse(readFileSync(this.metaFile, 'utf8')) as TunnelMeta) : null } catch { return null }
  }

  private scheduleStatus() {
    if (this.statusTimer) return
    this.statusTimer = setTimeout(() => { this.statusTimer = null; this.d.emit('remote.status', this.status()) }, 100)
  }

  status(): RemoteStatus {
    const r = this.d.settings().remote
    const meta = this.meta()
    const offer = this.pairing.current()
    const host = r.publicHost || meta?.host
    const names = new Map(this.devices.info(() => 0).map((x) => [x.id, x.name]))
    return {
      enabled: r.enabled, listening: this.server.listening, mode: r.mode, port: this.server.boundPort || r.port,
      publicUrl: r.mode === 'tunnel' ? (meta?.host ? `https://${meta.host}` : undefined) : host ? `https://${host}:${r.port}` : undefined,
      tunnel: { ...this.runner.info, host: meta?.host },
      devices: this.devices.count(),
      sessions: this.sessions.list().map((s) => ({ id: s.id, user: s.user, role: s.role, device: names.get(s.deviceId) ?? '?', since: s.since })),
      pairing: offer ? { code: offer.code, expiresAt: offer.expiresAt } : undefined,
      lastError: this.lastError,
    }
  }

  /** Bringt Server und Tunnel in den Zustand, den die Einstellungen verlangen. */
  async apply(): Promise<void> {
    const r = this.d.settings().remote
    const key = JSON.stringify([r.enabled, r.mode, r.port, r.allowedOrigins, r.publicHost, r.tlsCertPath, r.tlsKeyPath, r.maxRole])
    try {
      if (!r.enabled) {
        if (this.server.listening) await this.server.stop()
        this.runner.stop()
        this.lastError = undefined
      } else if (!this.server.listening || key !== this.lastKey) {
        if (r.mode === 'direct' && !this.config().tls) throw new Error('Für den Direktmodus fehlen Zertifikat und Schlüssel (PEM-Dateien).')
        await this.server.start()
        this.lastError = undefined
      }
      this.lastKey = key
      if (r.enabled && r.mode === 'tunnel') await this.startTunnel()
      else if (this.runner.running) this.runner.stop()
    } catch (e) {
      this.lastError = e instanceof Error ? (/EADDRINUSE/.test(e.message) ? `Port ${r.port} ist schon belegt. Wähle einen anderen Port.` : e.message) : String(e)
      await this.server.stop().catch(() => {})
    }
    this.d.emit('remote.status', this.status())
  }

  private async startTunnel() {
    const token = this.d.secrets().get('cftunnel')
    if (!token || !this.meta() || this.runner.running || this.runner.info.serviceInstalled) return
    await this.runner.start(token)
  }

  private async verifyReach() {
    const r = this.d.settings().remote
    if (r.allowedOrigins[0]) await this.runner.checkReachable(r.allowedOrigins[0])
  }

  forward(event: string, payload: unknown) { this.server.forward(event, payload) }

  async shutdown() {
    this.runner.stop()
    await this.server.stop().catch(() => {})
  }

  // ---------- Kopplung ----------
  pairStart(upload: boolean): RemoteStatus {
    this.pairing.start({ upload })
    const s = this.status()
    setTimeout(() => this.d.emit('remote.status', this.status()), 10 * 60_000 + 500).unref?.()
    return s
  }
  pairCancel() { this.pairing.cancel(); this.d.emit('remote.status', this.status()) }

  /** Weg B: Die Webseite zeigt einen Code, der in der App eingegeben wird. Die App übergibt ihr Gerät-Token nur an eine freigegebene Origin. */
  async claim(siteUrl: string, code: string, upload: boolean, f: typeof fetch = fetch): Promise<void> {
    const r = this.d.settings().remote
    const origin = originOf(siteUrl)
    if (!origin) throw new Error('Die Adresse der Webseite muss mit https:// beginnen.')
    if (!r.allowedOrigins.includes(origin)) throw new Error(`${origin} ist nicht unter „Erlaubte Webseiten“ eingetragen. Trage sie zuerst dort ein.`)
    const publicUrl = this.status().publicUrl
    if (!publicUrl) throw new Error('Richte zuerst den Cloudflare-Tunnel (oder den Direktmodus) ein, damit die Webseite die App erreichen kann.')
    if (!/^[A-Za-z0-9-]{4,24}$/.test(code.trim())) throw new Error('Der Code sieht nicht richtig aus.')
    const { device, token } = this.devices.add(new URL(origin).hostname, { upload }, r.maxRole, origin)
    try {
      const res = await f(`${origin}/api/trm/claim`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(15_000),
        body: JSON.stringify({ code: code.trim(), apiUrl: publicUrl, deviceToken: token, deviceId: device.id, deviceName: r.deviceName || hostname(), perms: { upload }, maxRole: device.role, protocolVersion: 2 }),
      })
      if (!res.ok) throw new Error(res.status === 404 ? 'Der Code ist falsch oder abgelaufen.' : `Die Webseite hat die Kopplung abgelehnt (${res.status}).`)
    } catch (e) {
      this.devices.revoke(device.id)
      throw e instanceof Error ? e : new Error(String(e))
    }
    this.d.emit('remote.status', this.status())
  }

  deviceList(): DeviceInfo[] { return this.devices.info((id) => this.sessions.countFor(id)) }
  revoke(id: string) {
    this.devices.revoke(id)
    this.server.closeDevice(id)
    this.d.emit('remote.status', this.status())
  }

  // ---------- Cloudflare-Tunnel ----------
  async tunnelSetup(domain: string, sub: string): Promise<RemoteStatus> {
    const t = this.d.secrets().get('cloudflare')
    if (!t) throw new Error('Speichere zuerst unter „Netzwerk“ deinen Cloudflare-API-Token.')
    const r = this.d.settings().remote
    const res = await setupTunnel(new Cloudflare(t), { domain, sub, port: r.port }, (m) => this.d.log?.(m))
    this.d.secrets().set('cftunnel', res.tunnelToken)
    writeFileSync(this.metaFile, JSON.stringify(res.meta))
    this.d.patchSettings({ remote: { mode: 'tunnel', publicHost: res.meta.host } })
    this.runner.configured(res.meta.host, this.runner.info.serviceInstalled)
    await this.apply()
    return this.status()
  }

  async tunnelStart() { await this.startTunnel(); this.d.emit('remote.status', this.status()) }
  tunnelStop() { this.runner.stop(); this.d.emit('remote.status', this.status()) }

  async tunnelService(install: boolean) {
    if (install) {
      const token = this.d.secrets().get('cftunnel')
      if (!token) throw new Error('Richte zuerst den Tunnel ein.')
      await this.runner.installService(token)
    } else await this.runner.uninstallService()
    const m = this.meta()
    if (m) writeFileSync(this.metaFile, JSON.stringify({ ...m, service: install }))
    this.d.emit('remote.status', this.status())
  }

  async tunnelRemove() {
    const meta = this.meta()
    if (this.runner.info.serviceInstalled) await this.runner.uninstallService().catch(() => {})
    this.runner.stop()
    const t = this.d.secrets().get('cloudflare')
    if (meta && t) await removeTunnel(new Cloudflare(t), meta).catch((e: Error) => { this.lastError = `Cloudflare-Eintrag nicht gelöscht: ${e.message}` })
    this.d.secrets().delete('cftunnel')
    rmSync(this.metaFile, { force: true })
    this.d.patchSettings({ remote: { publicHost: '' } })
    this.runner.configured(undefined)
    this.d.emit('remote.status', this.status())
  }
}

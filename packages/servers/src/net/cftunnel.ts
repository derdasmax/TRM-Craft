import { spawn, execFile, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import type { RemoteTunnelInfo } from '@trm/core'
import { downloadFile, fetchJson, type FetchLike } from '../download'
import { Cloudflare, joinHost, validDomain, validLabel } from './cloudflare'

const ReleaseSchema = z.object({ assets: z.array(z.object({ name: z.string(), browser_download_url: z.string().url(), digest: z.string().nullable().optional() })) })
// eslint-disable-next-line no-control-regex
const ANSI = /\x1b\[[\d;]*[A-Za-z]/g
const TOKEN = /^[A-Za-z0-9+/=_-]{20,4000}$/
export const TUNNEL_NAME = 'TRM-Craft'

/** Wählt die Windows-x64-Datei von cloudflared. */
export function pickCloudflaredAsset(assets: { name: string; browser_download_url: string; digest?: string | null }[]) {
  const a = assets.find((x) => x.name === 'cloudflared-windows-amd64.exe')
  if (!a) return null
  const sha = /^sha256:([0-9a-f]{64})$/i.exec(a.digest ?? '')?.[1]
  return { name: a.name, url: a.browser_download_url, sha256: sha }
}

export interface TunnelMeta { host: string; tunnelId: string; accountId: string; zoneId: string; domain: string }

export interface SetupResult { meta: TunnelMeta; tunnelToken: string }

/** Assistent: legt Tunnel, Weiterleitung und DNS-Eintrag (z. B. craft.meinedomain.de) an. Idempotent. */
export async function setupTunnel(cf: Cloudflare, o: { domain: string; sub: string; port: number }, log: (m: string) => void = () => {}): Promise<SetupResult> {
  const domain = o.domain.trim().toLowerCase()
  const sub = o.sub.trim().toLowerCase()
  if (!validDomain(domain)) throw new Error('Ungültige Domain.')
  if (!sub || !validLabel(sub)) throw new Error('Ungültiger Name vor der Domain (nur a–z, 0–9 und -).')
  const host = joinHost(sub, domain)
  log('Prüfe Cloudflare-Zugang …')
  // Kein verify(): Konto-Tokens lehnen den Benutzer-Endpunkt ab. Ein ungültiger Token fällt gleich bei der Zonen-Abfrage auf.
  const zone = await cf.zone(domain)
  log(`Domain ${domain} gefunden.`)
  const tunnelId = (await cf.findTunnel(zone.account, TUNNEL_NAME)) ?? (await cf.createTunnel(zone.account, TUNNEL_NAME))
  log('Tunnel bereit.')
  await cf.configureTunnel(zone.account, tunnelId, host, o.port)
  await cf.upsertCname(zone.id, host, tunnelId)
  log(`Adresse ${host} angelegt.`)
  const tunnelToken = await cf.tunnelToken(zone.account, tunnelId)
  return { meta: { host, tunnelId, accountId: zone.account, zoneId: zone.id, domain }, tunnelToken }
}

export async function removeTunnel(cf: Cloudflare, meta: TunnelMeta): Promise<void> {
  await cf.removeCname(meta.zoneId, meta.host)
  await cf.deleteTunnel(meta.accountId, meta.tunnelId)
}

export type CfExec = (cmd: string, args: string[]) => Promise<{ code: number }>
const defaultExec: CfExec = (cmd, args) => new Promise((resolve) => execFile(cmd, args, { windowsHide: true, timeout: 120_000 }, (e) => resolve({ code: e ? (typeof (e as { code?: unknown }).code === 'number' ? ((e as { code: number }).code) : 1) : 0 })))

/** PowerShell-Argumente für einen Aufruf mit Administratorrechten (UAC). Alle Teile sind vorher geprüft. */
export function elevated(exe: string, args: string[]): string[] {
  const q = (a: string) => `'${a.replace(/'/g, "''")}'`
  return ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${q(exe)} -ArgumentList ${args.map(q).join(',')} -Verb RunAs -Wait -WindowStyle Hidden`]
}

export interface RunnerDeps {
  dir: string
  emit: (i: RemoteTunnelInfo) => void
  fetchImpl?: FetchLike
  download?: typeof downloadFile
  exec?: CfExec
  platform?: NodeJS.Platform
  /** Nur für Tests: ersetzt den Prozessstart. */
  command?: (exe: string) => { cmd: string; args: string[] }
}

/** Startet `cloudflared` als Kindprozess der App (oder verwaltet den Windows-Dienst). */
export class CloudflaredRunner {
  private child: ChildProcessWithoutNullStreams | null = null
  private s: RemoteTunnelInfo = { phase: 'none', serviceInstalled: false, lines: [] }
  constructor(private readonly d: RunnerDeps) {}

  get info(): RemoteTunnelInfo { return this.s }
  private set(p: Partial<RemoteTunnelInfo>) { this.s = { ...this.s, ...p }; this.d.emit(this.s) }
  private get exe() { return join(this.d.dir, 'cloudflared.exe') }

  /** Setzt Host/Phase nach dem Laden der gespeicherten Einrichtung. */
  configured(host: string | undefined, serviceInstalled = false) {
    if (!host) return this.set({ phase: 'none', host: undefined, serviceInstalled: false })
    if (!this.child) this.set({ host, serviceInstalled, phase: this.s.phase === 'none' ? 'ready' : this.s.phase })
    else this.set({ host, serviceInstalled })
  }

  async ensureBinary(): Promise<string> {
    if (existsSync(this.exe) || this.d.command) return this.exe
    this.set({ phase: 'downloading', error: undefined })
    const rel = ReleaseSchema.parse(await fetchJson('https://api.github.com/repos/cloudflare/cloudflared/releases/latest', this.d.fetchImpl))
    const asset = pickCloudflaredAsset(rel.assets)
    if (!asset) throw new Error('Für Windows wurde kein cloudflared gefunden.')
    mkdirSync(this.d.dir, { recursive: true })
    await (this.d.download ?? downloadFile)({ url: asset.url, dest: this.exe, sha256: asset.sha256, fetchImpl: this.d.fetchImpl })
    try { chmodSync(this.exe, 0o755) } catch { /* Windows */ }
    return this.exe
  }

  async start(tunnelToken: string): Promise<void> {
    if (this.child) return
    if (!TOKEN.test(tunnelToken)) return this.set({ phase: 'error', error: 'Der Tunnel-Token ist ungültig. Richte den Tunnel neu ein.' })
    try {
      const exe = await this.ensureBinary()
      this.set({ phase: 'starting', lines: [], error: undefined })
      const { cmd, args } = this.d.command?.(exe) ?? { cmd: exe, args: ['tunnel', '--no-autoupdate', 'run'] }
      // Der Token geht über die Umgebung, nicht über die Kommandozeile (sichtbar in der Prozessliste).
      const child = spawn(cmd, args, { cwd: this.d.dir, windowsHide: true, env: { ...process.env, TUNNEL_TOKEN: tunnelToken } })
      this.child = child
      const feed = (b: Buffer) => {
        for (const raw of b.toString('utf8').split(/\r?\n/)) {
          const line = raw.replace(ANSI, '').trim()
          if (!line) continue
          const connected = /Registered tunnel connection|Connection .* registered/i.test(line)
          this.set({ lines: [...this.s.lines.slice(-49), line.replace(tunnelToken, '***')], phase: connected ? 'connected' : this.s.phase })
        }
      }
      child.stdout.on('data', feed)
      child.stderr.on('data', feed)
      child.once('error', (e) => { this.child = null; this.set({ phase: 'error', error: e.message }) })
      child.once('close', (code) => { this.child = null; this.set(this.s.phase === 'error' ? {} : { phase: 'stopped', reachable: undefined, error: code ? `cloudflared wurde beendet (Code ${code}).` : undefined }) })
    } catch (e) {
      this.set({ phase: 'error', error: e instanceof Error ? e.message : String(e) })
    }
  }

  stop(): void {
    this.child?.kill()
    this.child = null
    this.set({ phase: this.s.host ? 'stopped' : 'none', reachable: undefined })
  }

  get running() { return !!this.child }

  /** Installiert cloudflared als Windows-Dienst (UAC-Abfrage). Der Dienst startet mit Windows, auch ohne die App. */
  async installService(tunnelToken: string): Promise<void> {
    if ((this.d.platform ?? process.platform) !== 'win32') throw new Error('Der Dienst lässt sich nur unter Windows einrichten.')
    if (!TOKEN.test(tunnelToken)) throw new Error('Der Tunnel-Token ist ungültig.')
    const exe = await this.ensureBinary()
    this.stop() // Läuft der Tunnel schon als Kindprozess, würde er doppelt verbinden.
    const r = await (this.d.exec ?? defaultExec)('powershell.exe', elevated(exe, ['service', 'install', tunnelToken]))
    if (r.code !== 0) throw new Error('Der Dienst wurde nicht eingerichtet (Administrator-Abfrage abgelehnt?).')
    this.set({ serviceInstalled: true, phase: 'connected', error: undefined })
  }

  async uninstallService(): Promise<void> {
    if ((this.d.platform ?? process.platform) !== 'win32') throw new Error('Der Dienst lässt sich nur unter Windows entfernen.')
    const r = await (this.d.exec ?? defaultExec)('powershell.exe', elevated(await this.ensureBinary(), ['service', 'uninstall']))
    if (r.code !== 0) throw new Error('Der Dienst wurde nicht entfernt (Administrator-Abfrage abgelehnt?).')
    this.set({ serviceInstalled: false, phase: this.s.host ? 'stopped' : 'none' })
  }

  /** Prüft, ob die API über die öffentliche Adresse antwortet. */
  async checkReachable(origin: string, f: FetchLike = fetch): Promise<boolean> {
    try {
      const res = await f(`https://${this.s.host}/api/v1/info`, { headers: { origin }, signal: AbortSignal.timeout(8000) } as never)
      const body = (await res.json().catch(() => null)) as { name?: string } | null
      const ok = res.status === 200 && body?.name === 'TRM-Craft'
      this.set({ reachable: ok })
      return ok
    } catch { this.set({ reachable: false }); return false }
  }
}

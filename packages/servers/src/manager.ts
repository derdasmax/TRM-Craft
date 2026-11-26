import extract from 'extract-zip'
import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { isAbsolute, join, resolve, sep } from 'node:path'
import {
  CreateServerInputSchema, LOADER_INFO, SERVER_ID, ServerRecordSchema,
  type AppEvents, type BackupInfo, type PlayerAction, type PlayerEntry, type StatsSample, type WorldInfo, type CreateServerInput, type CrashReport, type ServerRecord, type ServerStatus, type ServerView, type SystemMemory, type VersionInfo, type Loader,
} from '@trm/core'
import { analyzeCrash } from './crash'
import { downloadFile, type FetchLike } from './download'
import { ensureJava } from './java'
import { jvmArgs } from './jvm'
import { findFreePort, isPortFree, isUdpPortFree } from './ports'
import { runInstaller, type InstallerRunner } from './installer'
import { installCrossplay, LOADER_DEFS } from './loaders'
import { BackupService, type SaveHost } from './backups'
import { ServerFiles } from './files'
import { PlayerTracker, playerCommand } from './players'
import { cpuPercent, defaultStatReader, LowTpsDetector, parseTps, StatsStore, type ProcStat, type StatReader } from './stats'
import { exportWorld, importWorldZip, listWorlds, resetWorld, WORLD_NAME } from './worlds'
import { parseProperties, updateProperties } from './properties'
import { ServerProcess, type LaunchSpec } from './process'

export type EmitFn = <K extends 'servers.status' | 'servers.removed' | 'servers.log' | 'servers.progress' | 'servers.stats'>(event: K, payload: AppEvents[K]) => void

export interface ManagerDeps {
  dataDir: string
  emit: EmitFn
  fetchImpl?: FetchLike
  platform?: NodeJS.Platform
  /** Nur für Tests: ersetzt den Java-Start. */
  launcher?: (r: ServerRecord, javaPath: string, dir: string) => LaunchSpec
  ensureJavaImpl?: typeof ensureJava
  downloadImpl?: typeof downloadFile
  installerRunner?: InstallerRunner
  /** Nur für Tests: ersetzt die Loader-Installation. */
  loaderDefs?: typeof LOADER_DEFS
  portCheck?: (p: number, udp?: boolean) => Promise<boolean>
  restartDelayMs?: (attempt: number) => number
  statReader?: StatReader
  /** Wird bei anhaltend niedrigen TPS aufgerufen. */
  onLowTps?: (id: string, tps: number) => void
}

interface Runtime {
  proc: ServerProcess
  logs: string[]
  restarts: number
  restartWindowStart: number
  lastCrash?: CrashReport
  restartTimer?: NodeJS.Timeout
  known: Set<string>
  lastTps?: number
  tpsPending?: NodeJS.Timeout
}

const LOG_LIMIT = 2000
const RESTART_WINDOW_MS = 10 * 60_000
const MAX_RESTARTS = 5

const slug = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 28) || 'server'

export class ServerManager {
  private records: ServerRecord[] = []
  private runtimes = new Map<string, Runtime>()
  private resumeIds: string[] = []
  private readonly serversDir: string
  private readonly runtimesDir: string
  private readonly file: string
  private shuttingDown = false
  private trackers = new Map<string, PlayerTracker>()
  private readonly stats = new StatsStore()
  private readonly lowTps = new LowTpsDetector()
  private prevStat = new Map<string, { t: number; s: ProcStat }>()
  private monitor: NodeJS.Timeout | null = null
  private monitorTicks = 0
  private readonly backups = new BackupService()

  constructor(private readonly d: ManagerDeps) {
    this.serversDir = join(d.dataDir, 'servers')
    this.runtimesDir = join(d.dataDir, 'runtimes')
    this.file = join(d.dataDir, 'servers.json')
    mkdirSync(this.serversDir, { recursive: true })
    this.load()
  }

  // ---------- Persistenz ----------
  private load() {
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as { servers?: unknown[]; resume?: string[] }
      this.records = (raw.servers ?? []).flatMap((s) => {
        const r = ServerRecordSchema.safeParse(s)
        return r.success ? [r.data] : []
      })
      this.resumeIds = raw.resume ?? []
    } catch {
      this.records = []
    }
  }

  private save() {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify({ servers: this.records, resume: this.resumeIds }, null, 2))
    renameSync(tmp, this.file)
  }

  // ---------- Helfer ----------
  /** Verhindert Path-Traversal: IDs müssen dem Muster entsprechen und im Server-Ordner liegen. */
  serverDir(id: string): string {
    if (!SERVER_ID.test(id)) throw new Error('Ungültige Server-ID.')
    const dir = resolve(this.serversDir, id)
    if (!dir.startsWith(resolve(this.serversDir) + sep)) throw new Error('Ungültiger Pfad.')
    return dir
  }

  recordOf(id: string): ServerRecord {
    return this.rec(id)
  }

  statusOf(id: string): ServerStatus {
    return this.runtimes.get(id)?.proc.status ?? 'stopped'
  }

  private rec(id: string): ServerRecord {
    const r = this.records.find((x) => x.id === id)
    if (!r) throw new Error('Server nicht gefunden.')
    return r
  }

  private rt(id: string): Runtime {
    let r = this.runtimes.get(id)
    if (!r) {
      r = { proc: new ServerProcess(), logs: [], restarts: 0, restartWindowStart: Date.now(), known: new Set() }
      this.runtimes.set(id, r)
      this.wire(id, r)
    }
    return r
  }

  view(id: string): ServerView {
    const r = this.rec(id)
    const rt = this.runtimes.get(id)
    return {
      ...r,
      status: rt?.proc.status ?? 'stopped',
      players: [...(rt?.proc.players ?? [])],
      startedAt: rt?.proc.startedAt ?? null,
      restarts: rt?.restarts ?? 0,
      lastCrash: rt?.lastCrash,
    }
  }

  list(): ServerView[] {
    return this.records.map((r) => this.view(r.id))
  }

  private push(id: string) {
    this.d.emit('servers.status', this.view(id))
  }

  memory(): SystemMemory {
    return { totalMb: Math.round(os.totalmem() / 1048576), freeMb: Math.round(os.freemem() / 1048576) }
  }

  async versions(loader: Loader): Promise<VersionInfo[]> {
    return (this.d.loaderDefs ?? LOADER_DEFS)[loader].versions(this.d.fetchImpl)
  }

  private usedPorts(except?: string): Set<number> {
    return new Set(this.records.filter((r) => r.id !== except).flatMap((r) => (r.bedrockPort ? [r.port, r.bedrockPort] : [r.port])))
  }

  private async portFree(p: number, udp = false) {
    if (this.d.portCheck) return this.d.portCheck(p, udp)
    return udp ? isUdpPortFree(p) : isPortFree(p)
  }

  // ---------- Erstellen ----------
  async create(token: string, raw: CreateServerInput): Promise<ServerRecord> {
    const input = CreateServerInputSchema.parse(raw) // erzwingt acceptEula === true
    const progress = (label: string, percent: number | null) => this.d.emit('servers.progress', { token, label, percent })

    const info = LOADER_INFO[input.loader]
    const defs = this.d.loaderDefs ?? LOADER_DEFS
    const owner = input.port ? this.records.find((r) => r.port === input.port) : undefined
    if (owner) throw new Error(`Port ${input.port} ist bereits dem Server „${owner.name}“ zugewiesen.`)
    const udp = !!info.udp
    const port = input.port ?? (await findFreePort(info.defaultPort ?? 25565, this.usedPorts(), (p) => this.portFree(p, udp)))
    if (!(await this.portFree(port, udp))) throw new Error(`Port ${port} ist auf diesem PC bereits belegt.`)
    // Proxys lesen ihren Port aus einer Konfigurationsdatei, die erst beim ersten Start entsteht.
    if (info.proxy && port !== info.defaultPort) throw new Error(`${info.label} läuft zunächst auf Port ${info.defaultPort}. Dieser Port ist belegt. Beende das andere Programm oder ändere den Port später in der Konfigurationsdatei.`)

    const id = `${slug(input.name)}-${randomBytes(2).toString('hex')}`
    const dir = this.serverDir(id)
    mkdirSync(dir, { recursive: true })
    try {
      progress('Version wird gesucht …', null)
      const javaMajor = await defs[input.loader].javaMajor(input.mcVersion, this.d.fetchImpl)
      const java = info.java
        ? await (this.d.ensureJavaImpl ?? ensureJava)({ runtimesDir: this.runtimesDir, major: javaMajor, platform: this.d.platform, fetchImpl: this.d.fetchImpl, onProgress: progress })
        : ''
      const result = await defs[input.loader].install({
        dir, version: input.mcVersion, loaderVersion: input.loaderVersion, java, platform: this.d.platform ?? process.platform, fetchImpl: this.d.fetchImpl,
        download: this.d.downloadImpl ?? downloadFile, run: this.d.installerRunner ?? runInstaller, extract: (zip, to) => extract(zip, { dir: to }), progress,
      })
      if (info.extFolder) mkdirSync(join(dir, info.extFolder), { recursive: true })

      const acceptedAt = info.proxy ? null : new Date().toISOString()
      let bedrockPort: number | undefined
      if (info.edition === 'bedrock') {
        const f = join(dir, 'server.properties')
        const props: Record<string, string> = { 'server-port': String(port), 'server-portv6': String(port + 1) }
        if (input.motd) props['server-name'] = input.motd.replace(/[\r\n;]/g, ' ')
        if (input.seed) props['level-seed'] = input.seed.replace(/[\r\n]/g, '')
        if (input.gamemode) props.gamemode = input.gamemode
        if (input.difficulty) props.difficulty = input.difficulty === 'peaceful' ? 'peaceful' : input.difficulty
        if (input.maxPlayers) props['max-players'] = String(input.maxPlayers)
        writeFileSync(f, updateProperties(existsSync(f) ? readFileSync(f, 'utf8') : '', props))
      } else if (!info.proxy) {
        writeFileSync(join(dir, 'eula.txt'), `# Vom Nutzer in TRM-Craft akzeptiert am ${acceptedAt}\n# https://aka.ms/MinecraftEULA\neula=true\n`)
        const props: Record<string, string> = { 'server-port': String(port) }
        if (input.motd) props.motd = input.motd.replace(/[\r\n]/g, ' ')
        if (input.seed) props['level-seed'] = input.seed.replace(/[\r\n]/g, '')
        if (input.gamemode) props.gamemode = input.gamemode
        if (input.difficulty) props.difficulty = input.difficulty
        if (input.maxPlayers) props['max-players'] = String(input.maxPlayers)
        writeFileSync(join(dir, 'server.properties'), updateProperties('', props))
        if (input.worldZip) {
          progress('Welt wird importiert …', null)
          await importWorldZip(input.worldZip, dir, 'world', true)
        }
        if (input.crossplay && info.crossplay) {
          bedrockPort = await findFreePort(19132, new Set([...this.usedPorts(), port]), (p) => this.portFree(p, true))
          await installCrossplay({ dir, fetchImpl: this.d.fetchImpl, download: this.d.downloadImpl ?? downloadFile, progress }, port, bedrockPort)
        }
      }

      const record = ServerRecordSchema.parse({
        id, name: input.name, loader: input.loader, mcVersion: input.mcVersion, build: result.build, port, ramMb: input.ramMb,
        jvmPreset: 'aikar', javaMajor: info.java ? javaMajor : undefined, launch: result.launch, crossplay: !!bedrockPort, bedrockPort, edition: info.edition, autoRestart: true, autostart: false, eulaAcceptedAt: acceptedAt, createdAt: new Date().toISOString(),
      })
      this.records.push(record)
      this.save()
      progress('Fertig', 100)
      this.push(id)
      return record
    } catch (e) {
      rmSync(dir, { recursive: true, force: true })
      throw e
    }
  }

  // ---------- Steuerung ----------
  private wire(id: string, rt: Runtime) {
    const p = rt.proc
    p.on('status', () => this.push(id))
    p.on('players', (list) => {
      const tr = this.tracker(id)
      const now = new Set(list)
      for (const n of now) if (!rt.known.has(n)) tr.join(n)
      for (const n of rt.known) if (!now.has(n)) tr.leave(n)
      rt.known = now
      this.push(id)
    })
    p.on('line', (line) => {
      if (rt.tpsPending) {
        const v = parseTps(line)
        if (v !== null) {
          rt.lastTps = v
          clearTimeout(rt.tpsPending)
          rt.tpsPending = undefined
          return // die TPS-Abfrage soll die Konsole nicht zumüllen
        }
      }
      rt.logs.push(line)
      if (rt.logs.length > LOG_LIMIT) rt.logs.splice(0, rt.logs.length - LOG_LIMIT)
      this.d.emit('servers.log', { id, line })
    })
    p.on('exit', ({ code, crashed }) => {
      if (!crashed) return
      rt.lastCrash = analyzeCrash(rt.logs, code)
      this.push(id)
      void this.maybeRestart(id, rt)
    })
  }

  private async maybeRestart(id: string, rt: Runtime) {
    const r = this.records.find((x) => x.id === id)
    if (!r || !r.autoRestart || this.shuttingDown) return
    // Konfigurationsfehler lösen sich durch Neustarts nicht.
    if (['port-in-use', 'eula', 'corrupt-jar', 'java-too-old'].includes(rt.lastCrash?.kind ?? '')) return
    const now = Date.now()
    if (now - rt.restartWindowStart > RESTART_WINDOW_MS) (rt.restarts = 0, (rt.restartWindowStart = now))
    if (rt.restarts >= MAX_RESTARTS) {
      this.d.emit('servers.log', { id, line: '[TRM-Craft] Zu viele Abstürze, automatischer Neustart wird deaktiviert.' })
      return
    }
    const delay = (this.d.restartDelayMs ?? ((n) => Math.min(5000 * 2 ** n, 60_000)))(rt.restarts)
    rt.restarts++
    this.d.emit('servers.log', { id, line: `[TRM-Craft] Server abgestürzt, Neustart in ${Math.round(delay / 1000)} s (Versuch ${rt.restarts}/${MAX_RESTARTS}).` })
    rt.restartTimer = setTimeout(() => void this.start(id).catch(() => {}), delay)
  }

  async start(id: string): Promise<void> {
    const r = this.rec(id)
    const rt = this.rt(id)
    if (rt.proc.status === 'starting' || rt.proc.status === 'running' || rt.proc.status === 'stopping') return
    clearTimeout(rt.restartTimer)
    const proxy = LOADER_INFO[r.loader].proxy
    if (!proxy && !r.eulaAcceptedAt) throw new Error('Die Minecraft-EULA wurde nicht akzeptiert.')
    const dir = this.serverDir(id)
    if (r.launch.type === 'jar' && !existsSync(join(dir, r.launch.jar))) throw new Error(`${r.launch.jar} fehlt. Erstelle den Server neu.`)
    for (const other of this.records) {
      if (other.id !== id && other.port === r.port && this.runtimes.get(other.id)?.proc.status === 'running') throw new Error(`Port ${r.port} wird bereits von „${other.name}“ genutzt.`)
    }
    const udp = !!LOADER_INFO[r.loader].udp
    if (!(await this.portFree(r.port, udp))) throw new Error(`Port ${r.port} ist belegt. Ändere den Port in den Server-Einstellungen.`)
    if (r.bedrockPort && !(await this.portFree(r.bedrockPort, true))) throw new Error(`Der Bedrock-Port ${r.bedrockPort} (UDP) ist belegt.`)
    const java = r.javaMajor
      ? await (this.d.ensureJavaImpl ?? ensureJava)({
          runtimesDir: this.runtimesDir, major: r.javaMajor, platform: this.d.platform, fetchImpl: this.d.fetchImpl,
          onProgress: (label, percent) => this.d.emit('servers.progress', { token: `start-${id}`, label, percent }),
        })
      : ''
    rt.lastCrash = undefined
    rt.logs.length = 0
    const spec = this.d.launcher?.(r, java, dir) ?? (r.launch.type === 'exe' ? { command: join(dir, r.launch.exe), args: [], cwd: dir } : { command: java, args: jvmArgs(r, this.d.platform), cwd: dir })
    rt.proc.start(spec)
  }

  async stop(id: string): Promise<void> {
    const rt = this.runtimes.get(id)
    if (!rt) return
    clearTimeout(rt.restartTimer)
    await rt.proc.stop()
  }

  async restart(id: string): Promise<void> {
    await this.stop(id)
    await this.start(id)
  }

  async kill(id: string): Promise<void> {
    const rt = this.runtimes.get(id)
    if (!rt) return
    clearTimeout(rt.restartTimer)
    await rt.proc.kill()
  }

  command(id: string, command: string): void {
    this.rt(id).proc.send(command)
  }

  logs(id: string): string[] {
    this.rec(id)
    return [...(this.runtimes.get(id)?.logs ?? [])]
  }

  update(id: string, patch: Partial<Pick<ServerRecord, 'name' | 'ramMb' | 'jvmPreset' | 'autoRestart' | 'autostart' | 'port' | 'backup' | 'notify'>>): ServerRecord {
    const r = this.rec(id)
    if (patch.port !== undefined && patch.port !== r.port) {
      const clash = this.records.find((x) => x.id !== id && x.port === patch.port)
      if (clash) throw new Error(`Port ${patch.port} gehört bereits zu „${clash.name}“.`)
    }
    if (patch.port !== undefined && patch.port !== r.port && LOADER_INFO[r.loader].proxy) throw new Error('Der Port eines Proxys wird in dessen Konfigurationsdatei geändert.')
    const next = ServerRecordSchema.parse({ ...r, ...patch })
    this.records[this.records.indexOf(r)] = next
    if (patch.port !== undefined && patch.port !== r.port) this.setProperties(id, { 'server-port': String(patch.port) })
    this.save()
    this.push(id)
    return next
  }

  async remove(id: string): Promise<void> {
    const r = this.rec(id)
    const st = this.runtimes.get(id)?.proc.status
    if (st && st !== 'stopped' && st !== 'crashed') throw new Error('Stoppe den Server, bevor du ihn löschst.')
    const dir = this.serverDir(id)
    this.runtimes.delete(id)
    this.trackers.delete(id)
    this.stats.clear(id)
    this.records = this.records.filter((x) => x !== r)
    this.save()
    rmSync(dir, { recursive: true, force: true })
    this.d.emit('servers.removed', id)
  }

  getProperties(id: string): Record<string, string> {
    this.rec(id)
    const f = join(this.serverDir(id), 'server.properties')
    return existsSync(f) ? parseProperties(readFileSync(f, 'utf8')) : {}
  }

  setProperties(id: string, values: Record<string, string>): void {
    this.rec(id)
    const f = join(this.serverDir(id), 'server.properties')
    writeFileSync(f, updateProperties(existsSync(f) ? readFileSync(f, 'utf8') : '', values))
  }

  // ---------- Icon ----------
  /** Speichert ein 64x64-PNG als server-icon.png. Die UI skaliert vorher; hier wird Format und Größe geprüft. */
  setIcon(id: string, pngBase64: string): void {
    const r = this.rec(id)
    if (LOADER_INFO[r.loader].proxy || r.edition === 'bedrock') throw new Error('Dieser Server-Typ unterstützt kein Icon.')
    const buf = Buffer.from(pngBase64, 'base64')
    if (buf.length > 100_000 || buf.length < 24 || buf.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('Das Icon muss ein PNG sein.')
    if (buf.readUInt32BE(16) !== 64 || buf.readUInt32BE(20) !== 64) throw new Error('Das Icon muss 64 x 64 Pixel groß sein.')
    writeFileSync(join(this.serverDir(id), 'server-icon.png'), buf)
  }

  getIcon(id: string): string | null {
    this.rec(id)
    const f = join(this.serverDir(id), 'server-icon.png')
    return existsSync(f) ? `data:image/png;base64,${readFileSync(f).toString('base64')}` : null
  }

  // ---------- Spieler ----------
  private tracker(id: string): PlayerTracker {
    let t = this.trackers.get(id)
    if (!t) { t = new PlayerTracker(join(this.serverDir(id), '.trm', 'players.json')); this.trackers.set(id, t) }
    return t
  }

  playersList(id: string): PlayerEntry[] {
    this.rec(id)
    return this.tracker(id).list()
  }

  playerAction(id: string, action: PlayerAction, name: string, arg?: string): void {
    const r = this.rec(id)
    if (LOADER_INFO[r.loader].proxy) throw new Error('Auf Proxys sind Spieleraktionen nicht verfügbar.')
    this.command(id, playerCommand(r.edition, action, name, arg))
  }

  // ---------- Dateien ----------
  files(id: string): ServerFiles {
    this.rec(id)
    return new ServerFiles(this.serverDir(id))
  }

  // ---------- Backups ----------
  backupDir(id: string): string {
    const r = this.rec(id)
    if (r.backup.dir) {
      if (!isAbsolute(r.backup.dir)) throw new Error('Der Backup-Ordner muss ein absoluter Pfad sein.')
      return join(r.backup.dir, 'TRM-Craft', id)
    }
    return join(this.d.dataDir, 'backups', id)
  }

  private saveHost(id: string): SaveHost {
    const r = this.rec(id)
    return {
      dir: this.serverDir(id),
      edition: r.edition,
      status: () => this.statusOf(id),
      command: (c) => this.command(id, c),
      onLine: (fn) => { const p = this.rt(id).proc; p.on('line', fn); return () => void p.off('line', fn) },
    }
  }

  backupsList(id: string): BackupInfo[] { return this.backups.list(this.backupDir(id)) }
  backupCreate(id: string, label?: string): Promise<BackupInfo> { return this.backups.create(this.saveHost(id), this.backupDir(id), this.rec(id).backup.keep, label) }
  backupRestore(id: string, file: string): Promise<void> { return this.backups.restore(this.saveHost(id), this.backupDir(id), this.rec(id).backup.keep, file) }
  backupDelete(id: string, file: string): void { this.backups.delete(this.backupDir(id), file) }

  // ---------- Welten ----------
  worldsList(id: string): Promise<WorldInfo[]> {
    if (this.rec(id).edition === 'bedrock') throw new Error('Weltverwaltung ist für Bedrock noch nicht verfügbar.')
    return listWorlds(this.serverDir(id))
  }

  private requireStopped(id: string) {
    const st = this.statusOf(id)
    if (st !== 'stopped' && st !== 'crashed') throw new Error('Stoppe den Server zuerst.')
  }

  async setActiveWorld(id: string, name: string): Promise<void> {
    this.requireStopped(id)
    if (!WORLD_NAME.test(name) || !(await listWorlds(this.serverDir(id))).some((w) => w.name === name)) throw new Error('Welt nicht gefunden.')
    this.setProperties(id, { 'level-name': name })
  }

  exportWorld(id: string, name: string, dest: string): Promise<void> {
    const host = this.saveHost(id)
    return import('./backups').then(({ withSaveLock }) => withSaveLock(host, () => exportWorld(this.serverDir(id), name, dest)))
  }

  importWorld(id: string, zipPath: string): Promise<string> {
    this.requireStopped(id)
    return importWorldZip(zipPath, this.serverDir(id), 'world')
  }

  async resetWorld(id: string, name: string): Promise<void> {
    this.requireStopped(id)
    // Vor dem Löschen immer sichern.
    await this.backupCreate(id, `vor-reset-${name}`)
    resetWorld(this.serverDir(id), name)
  }

  // ---------- Leistung ----------
  statsHistory(id: string): StatsSample[] {
    this.rec(id)
    return this.stats.get(id)
  }

  /** Startet die regelmäßige Messung (CPU, RAM, TPS). Wird von der App einmal aufgerufen. */
  startMonitoring(intervalMs = 5000): void {
    if (this.monitor) return
    this.monitor = setInterval(() => void this.sample(), intervalMs)
  }

  stopMonitoring(): void {
    if (this.monitor) clearInterval(this.monitor)
    this.monitor = null
  }

  async sample(now = Date.now()): Promise<void> {
    const live = [...this.runtimes].filter(([, r]) => r.proc.status === 'running' && r.proc.pid)
    if (!live.length) return
    const stat = await (this.d.statReader ?? defaultStatReader)(live.map(([, r]) => r.proc.pid!))
    this.monitorTicks++
    for (const [id, rt] of live) {
      const cur = stat.get(rt.proc.pid!)
      if (!cur) continue
      const prev = this.prevStat.get(id)
      this.prevStat.set(id, { t: now, s: cur })
      const sample: StatsSample = { t: now, cpu: prev ? cpuPercent(prev.s, cur, now - prev.t) : 0, ramMb: Math.round(cur.rssBytes / 1048576), players: rt.proc.players.size, tps: rt.lastTps }
      this.stats.push(id, sample)
      this.d.emit('servers.stats', { id, sample })
      if (this.lowTps.feed(id, sample.tps)) {
        this.d.emit('servers.log', { id, line: `[TRM-Craft] Warnung: Die TPS liegen seit längerem unter 15 (${sample.tps}).` })
        this.d.onLowTps?.(id, sample.tps!)
      }
      // TPS alle 60 s abfragen (nur dort, wo der Befehl existiert).
      const loader = this.rec(id).loader
      if (this.monitorTicks % 12 === 0 && (loader === 'paper' || loader === 'purpur') && !rt.tpsPending) {
        rt.tpsPending = setTimeout(() => (rt.tpsPending = undefined), 3000)
        try { rt.proc.send('tps') } catch { clearTimeout(rt.tpsPending); rt.tpsPending = undefined }
      }
    }
    for (const id of this.prevStat.keys()) if (!live.some(([i]) => i === id)) this.prevStat.delete(id)
  }

  // ---------- Neustart mit Vorwarnung ----------
  async restartWithWarning(id: string, seconds: number, sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))): Promise<void> {
    if (this.statusOf(id) === 'running' && seconds > 0) {
      // Warnungen bei der vollen Zeit sowie bei 30 und 10 Sekunden.
      const marks = [...new Set([seconds, 30, 10].filter((m) => m <= seconds))].sort((x, y) => y - x)
      for (const [i, left] of marks.entries()) {
        this.command(id, `say Der Server startet in ${left} Sekunden neu.`)
        await sleep((left - (marks[i + 1] ?? 0)) * 1000)
      }
    }
    await this.restart(id)
  }

  // ---------- Lebenszyklus der App ----------
  activeCount(): number {
    return [...this.runtimes.values()].filter((r) => r.proc.status === 'running' || r.proc.status === 'starting').length
  }

  announce(seconds: number): void {
    for (const [id, rt] of this.runtimes) {
      if (rt.proc.status === 'running') this.command(id, `say TRM-Craft wird aktualisiert. Der Server startet in ${seconds} Sekunden neu.`)
    }
  }

  /** Stoppt alle Server sauber. Mit `resume` werden die laufenden für den nächsten App-Start vorgemerkt. */
  async shutdownAll(resume = false): Promise<void> {
    this.shuttingDown = true
    const running = [...this.runtimes].filter(([, r]) => r.proc.status === 'running' || r.proc.status === 'starting')
    this.resumeIds = resume ? running.map(([id]) => id) : []
    this.save()
    await Promise.all([...this.runtimes.values()].map(async (r) => (clearTimeout(r.restartTimer), r.proc.stop())))
  }

  async resume(): Promise<void> {
    const ids = new Set([...this.resumeIds, ...this.records.filter((r) => r.autostart).map((r) => r.id)])
    this.resumeIds = []
    this.save()
    for (const id of ids) if (this.records.some((r) => r.id === id)) await this.start(id).catch((e) => this.d.emit('servers.log', { id, line: `[TRM-Craft] Autostart fehlgeschlagen: ${e.message}` }))
  }
}

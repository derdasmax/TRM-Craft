import { app, BrowserWindow, dialog, ipcMain, Notification, safeStorage, session, shell } from 'electron'
import { IPC_CHANNEL, IPC_EVENT_CHANNEL, onHealthy, onStart, type CommandName, type ServerView } from '@trm/core'
import { dataDir, settingsFile } from './paths'
import { SettingsStore } from './settings-store'
import { UpdaterService } from './updater'
import { loadGuard, saveGuard } from './guard-store'
import { rollbackTo } from './rollback'
import { createTray } from './tray'
import { registerShutdownHook, stopAll } from './lifecycle'
import { activeWorld, buildJoinInfo, checkReachable, Cloudflare, Ddns, Firewall, installModpack, isDiscordWebhook, localIps, ModManager, PlayitTunnel, publicIp, ruleName, Scheduler, ServerManager, UpnpClient } from '@trm/servers'
import { Notifier } from './notifier'
import { pairDevice, RemoteClient, UploadManager, type UploadServer } from '@trm/remote'
import { commandRoles, type RemoteStatus } from '@trm/core'
import { hostname } from 'node:os'
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import WebSocket from 'ws'
import { join } from 'node:path'
import { SecretStore } from './secrets'

const DEV_URL = process.env.TRM_DEV_URL
let win: BrowserWindow | null = null
let splash: BrowserWindow | null = null
let settings: SettingsStore
let updater: UpdaterService
let servers: ServerManager
let mods: ModManager
let scheduler: Scheduler
let notifier: Notifier
let ddns: Ddns
let remote: RemoteClient
let uploads: UploadManager
let remoteState: { connected: boolean; error?: string; sessions: RemoteStatus['sessions'] } = { connected: false, sessions: [] }
let tunnel: PlayitTunnel
const upnp = new UpnpClient()
let upnpReady = false
const firewall = new Firewall()
/** Von TRM-Craft angelegte UPnP-Weiterleitungen je Server. */
const mapped = new Map<string, { port: number; protocol: 'TCP' | 'UDP' }[]>()

const deviceFile = () => join(dataDir(), 'remote-device.json')
function readDevice(): { deviceId: string; siteName?: string; canUpload: boolean } | null {
  try { return existsSync(deviceFile()) ? JSON.parse(readFileSync(deviceFile(), 'utf8')) : null } catch { return null }
}
function remoteStatus(): RemoteStatus {
  const r = settings.get().remote
  const dev = readDevice()
  return { enabled: r.enabled, paired: secrets.has('remote'), connected: remoteState.connected, url: r.url, siteName: dev?.siteName, lastError: remoteState.error, sessions: remoteState.sessions, canUpload: !!dev?.canUpload }
}
const isCommand = (c: string): c is CommandName => c in commandRoles

/** Alle Ports, die Spieler für diesen Server erreichen müssen. */
function serverPorts(id: string): { port: number; protocol: 'TCP' | 'UDP' }[] {
  const r = servers.recordOf(id)
  const list: { port: number; protocol: 'TCP' | 'UDP' }[] = [{ port: r.port, protocol: r.edition === 'bedrock' ? 'UDP' : 'TCP' }]
  if (r.bedrockPort) list.push({ port: r.bedrockPort, protocol: 'UDP' })
  return list
}

/** Entfernt unsere Weiterleitungen beim Beenden (höchstens 3 s warten). */
function upnpCleanup(): Promise<unknown> {
  const all = [...mapped.values()].flat()
  if (!all.length) return Promise.resolve()
  return Promise.race([Promise.all(all.map((m) => upnp.deleteMapping(m.port, m.protocol).catch(() => {}))), new Promise((r) => setTimeout(r, 3000))])
}

async function ensureUpnp() {
  if (!upnpReady) upnpReady = await upnp.connect().catch(() => false)
  if (!upnpReady) throw new Error('Kein UPnP-Router gefunden. Aktiviere UPnP im Router oder leite die Ports manuell weiter.')
}
let secrets: SecretStore
let quitting = false
const HEALTHY_AFTER_MS = 20_000

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) app.quit()

function emit(event: string, payload: unknown) {
  win?.webContents.send(IPC_EVENT_CHANNEL, event, payload)
}

function isAllowedUrl(url: string): boolean {
  if (DEV_URL && url.startsWith(DEV_URL)) return true
  return url.startsWith('file://')
}

const handlers: Record<CommandName, (args: any) => unknown> = {
  'app.info': () => ({
    name: app.getName(),
    version: app.getVersion(),
    platform: process.platform,
    dataDir: dataDir(),
    isPackaged: app.isPackaged,
  }),
  'settings.get': () => settings.get(),
  'settings.update': (patch) => {
    const before = JSON.stringify(settings.get().remote)
    const next = settings.update(patch)
    updater?.applySettings()
    if (remote && JSON.stringify(next.remote) !== before) { remote.start(); emit('remote.status', remoteStatus()) }
    emit('settings.changed', next)
    return next
  },
  'window.minimize': () => win?.minimize(),
  'window.toggleMaximize': () => {
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  },
  'window.close': () => win?.close(),
  'window.isMaximized': () => win?.isMaximized() ?? false,
  'updater.getState': () => updater.getState(),
  'updater.check': () => updater.check(),
  'updater.download': () => updater.download(),
  'updater.installNow': () => updater.installNow(),
  'updater.skipCountdown': () => updater.skipCountdown(),
  'system.memory': () => servers.memory(),
  'versions.list': (loader) => servers.versions(loader),
  'servers.list': () => servers.list(),
  'servers.create': ({ token, input }) => servers.create(token, input),
  'servers.update': ({ id, patch }) => servers.update(id, patch),
  'servers.start': (id) => servers.start(id),
  'servers.stop': (id) => servers.stop(id),
  'servers.restart': (id) => servers.restart(id),
  'servers.kill': (id) => servers.kill(id),
  'servers.delete': async (id) => {
    await servers.remove(id)
    scheduler.removeForServer(id)
    await ddns.remove(id).catch(() => {})
    if (mapped.has(id)) await upnp.deleteMapping(mapped.get(id)![0]!.port, 'TCP').catch(() => {})
    notifier.forget(id)
    secrets.delete(`discord:${id}`)
  },
  'servers.command': ({ id, command }) => servers.command(id, command),
  'servers.logs': (id) => servers.logs(id),
  'servers.properties.get': (id) => servers.getProperties(id),
  'servers.properties.set': ({ id, values }) => servers.setProperties(id, values),
  'mods.search': (a) => mods.search(a),
  'mods.installed': (id) => mods.installed(id),
  'mods.install': ({ id, source, projectId }) => mods.install(id, source, projectId),
  'mods.addFiles': ({ id, paths, force }) => mods.addFiles(id, paths, force),
  'mods.toggle': ({ id, file, enabled }) => mods.toggle(id, file, enabled),
  'mods.remove': ({ id, file }) => mods.remove(id, file),
  'mods.checkUpdates': (id) => mods.checkUpdates(id),
  'mods.update': ({ id, file }) => mods.update(id, file),
  'modpacks.install': (args) =>
    installModpack(
      { create: (t, i) => servers.create(t, i), serverDir: (id) => servers.serverDir(id), remove: (id) => servers.remove(id) },
      args,
      { curseKey: () => secrets.get('curseforge'), progress: (label, percent) => emit('servers.progress', { token: args.token, label, percent }) },
    ),
  'players.list': (id) => servers.playersList(id),
  'players.action': ({ id, action, name, arg }) => servers.playerAction(id, action, name, arg),
  'files.list': ({ id, path }) => servers.files(id).list(path),
  'files.read': ({ id, path }) => servers.files(id).read(path),
  'files.write': ({ id, path, content }) => servers.files(id).write(path, content),
  'files.mkdir': ({ id, path }) => servers.files(id).mkdir(path),
  'files.delete': ({ id, path }) => servers.files(id).delete(path),
  'files.rename': ({ id, from, to }) => servers.files(id).rename(from, to),
  'files.unzip': ({ id, path }) => servers.files(id).unzip(path),
  'files.upload': ({ id, dir, paths }) => servers.files(id).upload(dir, paths),
  'servers.softwareStatus': (id) => servers.softwareStatus(id),
  'servers.updateSoftware': (id) => servers.updateSoftware(id),
  'servers.clone': ({ id, name }) => servers.clone(id, name),
  'servers.import': (input) => servers.importFolder(input),
  'servers.setIcon': ({ id, png }) => servers.setIcon(id, png),
  'servers.getIcon': (id) => servers.getIcon(id),
  'worlds.list': (id) => servers.worldsList(id),
  'worlds.setActive': ({ id, name }) => servers.setActiveWorld(id, name),
  'worlds.export': ({ id, name, dest }) => servers.exportWorld(id, name, dest),
  'worlds.import': ({ id, zipPath }) => servers.importWorld(id, zipPath),
  'worlds.reset': ({ id, name }) => servers.resetWorld(id, name),
  'backups.list': (id) => servers.backupsList(id),
  'backups.create': ({ id, label }) => servers.backupCreate(id, label),
  'backups.restore': ({ id, file }) => servers.backupRestore(id, file),
  'backups.delete': ({ id, file }) => servers.backupDelete(id, file),
  'schedules.list': () => scheduler.list(),
  'schedules.save': (t) => {
    servers.recordOf(t.serverId) // Server muss existieren
    return scheduler.upsert(t)
  },
  'schedules.delete': (id) => scheduler.remove(id),
  'stats.history': (id) => servers.statsHistory(id),
  'spark.profiler': ({ id, action }) => servers.command(id, `spark profiler ${action === 'start' ? 'start' : 'stop'}`),
  'notify.discordTest': (id) => notifier.test(servers.view(id)),
  'dialog.open': async ({ filters }) => (await dialog.showOpenDialog(win!, { properties: ['openFile'], filters })).filePaths[0] ?? null,
  'dialog.save': async ({ defaultName }) => (await dialog.showSaveDialog(win!, { defaultPath: defaultName, filters: [{ name: 'ZIP', extensions: ['zip'] }] })).filePath ?? null,
  'dialog.folder': async () => (await dialog.showOpenDialog(win!, { properties: ['openDirectory', 'createDirectory'] })).filePaths[0] ?? null,
  'net.info': async () => ({ publicIp: await publicIp(), localIps: localIps() }),
  'net.join': async (id) => buildJoinInfo(servers.recordOf(id), { domain: ddns.get(id), publicIp: await publicIp(), tunnel: null }),
  'net.reach': async (id) => {
    if (servers.statusOf(id) !== 'running') throw new Error('Starte den Server, um die Erreichbarkeit zu prüfen.')
    const ip = await publicIp()
    if (!ip) throw new Error('Die öffentliche IP konnte nicht ermittelt werden. Bist du online?')
    const r = servers.recordOf(id)
    const checks = [checkReachable(ip, r.port, r.edition)]
    if (r.bedrockPort) checks.push(checkReachable(ip, r.bedrockPort, 'bedrock'))
    return Promise.all(checks)
  },
  'net.upnp.status': async () => {
    try { await ensureUpnp() } catch { return { available: false, mapped: [...mapped.values()].flat() } }
    return { available: true, externalIp: (await upnp.externalIp().catch(() => null)) ?? undefined, mapped: [...mapped.values()].flat() }
  },
  'net.upnp.open': async (id) => {
    await ensureUpnp()
    const ip = localIps()[0]
    if (!ip) throw new Error('Keine lokale Netzwerkadresse gefunden.')
    const done: { port: number; protocol: 'TCP' | 'UDP' }[] = []
    for (const m of serverPorts(id)) { await upnp.addMapping(m.port, m.protocol, ip, `TRM-Craft ${servers.recordOf(id).name}`); done.push(m) }
    mapped.set(id, done)
  },
  'net.upnp.close': async (id) => {
    await ensureUpnp()
    for (const m of mapped.get(id) ?? serverPorts(id)) await upnp.deleteMapping(m.port, m.protocol).catch(() => {})
    mapped.delete(id)
  },
  'net.firewall.status': async (id) => ({ supported: firewall.supported, rules: await Promise.all(serverPorts(id).map(async (m) => ({ port: m.port, protocol: m.protocol, present: await firewall.exists(ruleName(id, m.protocol, m.port)) }))) }),
  'net.firewall.add': (id) => firewall.add(id, serverPorts(id).map((m) => ({ proto: m.protocol, port: m.port }))),
  'net.firewall.remove': (id) => firewall.remove(id, serverPorts(id).map((m) => ({ proto: m.protocol, port: m.port }))),
  'net.cf.verify': async () => {
    const t = secrets.get('cloudflare')
    if (!t) return { ok: false, message: 'Es ist kein Cloudflare-Token gespeichert.' }
    try { await new Cloudflare(t).verify(); return { ok: true } } catch (e) { return { ok: false, message: (e as Error).message } }
  },
  'net.domain.get': (id) => ddns.get(id),
  'net.domain.set': ({ id, domain, sub, srv }) => ddns.set(id, domain, sub, srv),
  'net.domain.remove': (id) => ddns.remove(id),
  'net.ddns.run': async () => void (await ddns.tick()),
  'net.tunnel.state': () => tunnel.state,
  'net.tunnel.start': () => tunnel.start(),
  'net.tunnel.stop': () => tunnel.stop(),
  'remote.status': () => remoteStatus(),
  'remote.pair': async (code) => {
    const r = settings.get().remote
    const res = await pairDevice(r.url, code, r.deviceName || hostname(), app.getVersion())
    secrets.set('remote', res.deviceToken)
    writeFileSync(deviceFile(), JSON.stringify({ deviceId: res.deviceId, siteName: res.siteName, canUpload: res.perms.upload }))
    const next = settings.update({ remote: { enabled: true } })
    emit('settings.changed', next)
    remote.start()
    return remoteStatus()
  },
  'remote.unpair': () => {
    secrets.delete('remote')
    rmSync(deviceFile(), { force: true })
    emit('settings.changed', settings.update({ remote: { enabled: false } }))
    remote.stop()
    emit('remote.status', remoteStatus())
  },
  'remote.uploads': () => uploads.history(),
  'remote.undo': (id) => uploads.undo(id),
  'secrets.set': ({ name, value }) => {
    if (!/^(curseforge|cloudflare|discord:[a-z0-9][a-z0-9-]{0,39})$/.test(name)) throw new Error('Unbekanntes Geheimnis.')
    if (name.startsWith('discord:') && !isDiscordWebhook(value.trim())) throw new Error('Das ist keine gültige Discord-Webhook-URL.')
    secrets.set(name, value)
  },
  'secrets.has': (name) => /^(curseforge|cloudflare|discord:[a-z0-9][a-z0-9-]{0,39})$/.test(name) && secrets.has(name),
  'secrets.delete': (name) => {
    if (!/^(curseforge|cloudflare|discord:[a-z0-9][a-z0-9-]{0,39})$/.test(name)) throw new Error('Unbekanntes Geheimnis.')
    secrets.delete(name)
  },
  'shell.openExternal': (url: string) => {
    // Nur https-Links nach außen öffnen.
    if (typeof url === 'string' && url.startsWith('https://')) return shell.openExternal(url)
    throw new Error('Nur https-Links erlaubt')
  },
}

function registerIpc() {
  ipcMain.handle(IPC_CHANNEL, async (event, command: string, args: unknown) => {
    if (!win || event.sender !== win.webContents) throw new Error('Unerlaubter Absender')
    const h = handlers[command as CommandName]
    if (!h) throw new Error(`Unbekannter Befehl: ${command}`)
    return h(args)
  })
}

function setupSecurity() {
  const csp = [
    "default-src 'self'",
    "script-src 'self'" + (DEV_URL ? " 'unsafe-inline'" : ''),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://mc-heads.net https://cdn.modrinth.com https://crafatar.com https://media.forgecdn.net https://hangarcdn.papermc.io",
    "font-src 'self' data:",
    "connect-src 'self'" + (DEV_URL ? ` ${DEV_URL.replace('http', 'ws')} ${DEV_URL}` : ''),
  ].join('; ')
  session.defaultSession.webRequest.onHeadersReceived((details, cb) => {
    cb({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
  })
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
}

function createSplash() {
  splash = new BrowserWindow({
    width: 420,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    alwaysOnTop: true,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  splash.loadFile(join(__dirname, 'splash.html'))
  splash.once('ready-to-show', () => splash?.show())
}

function createWindow() {
  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    show: false,
    backgroundColor: '#0b0d10',
    title: 'TRM-Craft',
    webPreferences: {
      preload: join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAllowedUrl(url)) e.preventDefault()
  })
  win.on('maximize', () => emit('window.maximized', true))
  win.on('unmaximize', () => emit('window.maximized', false))
  win.once('ready-to-show', () => {
    // Splash mindestens kurz zeigen, damit die Logo-Animation lesbar bleibt.
    setTimeout(() => {
      splash?.close()
      splash = null
      win?.show()
    }, 1400)
  })
  win.on('close', (e) => {
    // Mit aktivem Hintergrundbetrieb nur ins Tray, damit Server weiterlaufen.
    if (!quitting && settings.get().runInBackground) {
      e.preventDefault()
      win?.hide()
    }
  })
  win.on('closed', () => (win = null))

  if (DEV_URL) win.loadURL(DEV_URL)
  else win.loadFile(join(__dirname, 'ui', 'index.html'))
}

/** Startet die Absturz-Überwachung. Gibt die Version zurück, von der zurückgerollt wurde. */
async function runCrashGuard(): Promise<string | undefined> {
  const action = onStart(loadGuard(), app.getVersion())
  saveGuard(action.state)
  if (action.type === 'rollback' && app.isPackaged) {
    try {
      await rollbackTo(action.target)
      return undefined // App beendet sich, der Installer übernimmt
    } catch {
      // Rollback nicht möglich (offline?): normal weiterstarten.
    }
  }
  setTimeout(() => saveGuard(onHealthy(loadGuard() ?? action.state)), HEALTHY_AFTER_MS)
  const notice = action.state.rollbackNotice
  if (notice) {
    saveGuard({ ...action.state, rollbackNotice: null })
    return notice
  }
  return undefined
}

app.whenReady().then(async () => {
  // Nur für Tests unter Linux (ohne Schlüsselbund). Im gepackten Windows-Build ist dieser Schalter wirkungslos.
  if (!app.isPackaged && process.platform === 'linux' && process.env.TRM_TEST_WEAK_ENCRYPTION === '1') safeStorage.setUsePlainTextEncryption(true)
  settings = new SettingsStore(settingsFile())
  const rolledBackFrom = await runCrashGuard()
  notifier = new Notifier({
    desktopEnabled: () => settings.get().notifications.desktop,
    webhook: (id) => secrets.get(`discord:${id}`),
    log: (id, line) => emit('servers.log', { id, line }),
  })
  servers = new ServerManager({
    dataDir: dataDir(),
    emit: (e, p) => {
      emit(e, p)
      remote?.forward(e, p)
      if (e === 'servers.status') notifier.onStatus(p as ServerView)
    },
    onLowTps: (id, tps) => {
      const s = servers.view(id)
      if (s.notify.desktop && settings.get().notifications.desktop) new Notification({ title: 'TRM-Craft', body: `${s.name}: Die TPS sind niedrig (${tps}).` }).show()
    },
  })
  ddns = new Ddns({ file: join(dataDir(), 'domains.json'), token: () => secrets.get('cloudflare'), publicIp: () => publicIp(), portOf: (id) => { try { return servers.recordOf(id).port } catch { return null } } })
  tunnel = new PlayitTunnel({ dir: join(dataDir(), 'runtimes', 'playit'), emit: (s) => emit('net.tunnel', s) })
  uploads = new UploadManager({
    dir: join(dataDir(), 'uploads'),
    limitBytes: () => settings.get().remote.uploadLimitMb * 1048576,
    canUpload: () => !!readDevice()?.canUpload,
    siteHost: () => { try { return new URL(settings.get().remote.url).hostname } catch { return null } },
    send: (m) => remote.reply(m),
    emit: (r) => { emit('remote.upload', r); remote.forward('remote.upload', r) },
    restore: (id, file) => servers.backupRestore(id, file),
    server: (id): UploadServer | null => {
      try {
        const rec = servers.recordOf(id)
        const dir = servers.serverDir(id)
        return {
          rec, dir, name: rec.name, levelName: () => activeWorld(dir),
          get running() { return ['running', 'starting'].includes(servers.statusOf(id)) },
          backup: async (label) => (await servers.backupCreate(id, label)).file,
          restart: (sec) => servers.restartWithWarning(id, sec),
        }
      } catch { return null }
    },
  })
  remote = new RemoteClient({
    config: () => { const r = settings.get().remote; return { enabled: r.enabled, url: r.url, maxRole: r.maxRole } },
    token: () => secrets.get('remote'),
    create: (url, token) => new WebSocket(url, { headers: { authorization: `Bearer ${token}` }, handshakeTimeout: 10_000, maxPayload: 8 * 1024 * 1024 }) as never,
    exec: (c, a) => Promise.resolve(handlers[c](a)),
    known: isCommand,
    hello: () => ({ deviceId: readDevice()?.deviceId, deviceName: settings.get().remote.deviceName || hostname(), appVersion: app.getVersion(), platform: process.platform, canUpload: !!readDevice()?.canUpload, servers: servers.list().map((s) => ({ id: s.id, name: s.name, loader: s.loader, mcVersion: s.mcVersion, edition: s.edition, status: s.status, players: s.players.length })) }),
    uploads,
    onState: (st) => { remoteState = st; emit('remote.status', remoteStatus()) },
  })
  scheduler = new Scheduler(
    join(dataDir(), 'schedules.json'),
    {
      restart: (id, warn) => servers.restartWithWarning(id, warn),
      backup: async (id) => void (await servers.backupCreate(id, 'geplant')),
      command: (id, c) => { if (servers.statusOf(id) === 'running') servers.command(id, c) },
      announce: (id, m) => { if (servers.statusOf(id) === 'running') servers.command(id, `say ${m.replace(/[\r\n]/g, ' ')}`) },
    },
    Date.now,
    (task, e) => emit('servers.log', { id: task.serverId, line: `[TRM-Craft] Geplante Aufgabe „${task.name}“ fehlgeschlagen: ${(e as Error).message}` }),
  )
  secrets = new SecretStore(join(dataDir(), 'secrets.json'), {
    isAvailable: () => safeStorage.isEncryptionAvailable(),
    encrypt: (p) => safeStorage.encryptString(p),
    decrypt: (d) => safeStorage.decryptString(d),
  })
  mods = new ModManager({ servers, curseKey: () => secrets.get('curseforge') })
  // Vor Updates/Beenden: Spieler warnen und Server sauber stoppen. Danach laufen sie von selbst wieder an.
  registerShutdownHook({ name: 'servers', activeCount: () => servers.activeCount(), announce: (s) => servers.announce(s), stop: ({ resume }) => servers.shutdownAll(resume) })
  updater = new UpdaterService(() => settings.get(), (s) => emit('updater.state', s), rolledBackFrom)
  setupSecurity()
  registerIpc()
  createSplash()
  createWindow()
  createTray(() => win, () => void updater.check(), () => app.quit())
  if (rolledBackFrom && settings.get().notifications.desktop)
    new Notification({ title: 'TRM-Craft', body: `Version ${rolledBackFrom} ist abgestürzt. Die vorherige Version wurde wiederhergestellt.` }).show()
  setTimeout(() => void updater.check(), 8_000)
  void servers.resume()
  servers.startMonitoring()
  ddns.start()
  remote.start()
  scheduler.start()
})

app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  scheduler?.stop()
  servers?.stopMonitoring()
  ddns?.stop()
  remote?.stop()
  tunnel?.stop()
  // Server sauber stoppen, dann endgültig beenden.
  Promise.all([stopAll(), upnpCleanup()]).finally(() => app.quit())
})

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})

app.on('window-all-closed', () => {
  if (!settings.get().runInBackground) app.quit()
})

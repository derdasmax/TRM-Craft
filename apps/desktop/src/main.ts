import { app, BrowserWindow, ipcMain, Notification, safeStorage, session, shell } from 'electron'
import { IPC_CHANNEL, IPC_EVENT_CHANNEL, onHealthy, onStart, type CommandName } from '@trm/core'
import { dataDir, settingsFile } from './paths'
import { SettingsStore } from './settings-store'
import { UpdaterService } from './updater'
import { loadGuard, saveGuard } from './guard-store'
import { rollbackTo } from './rollback'
import { createTray } from './tray'
import { registerShutdownHook, stopAll } from './lifecycle'
import { installModpack, ModManager, ServerManager } from '@trm/servers'
import { join } from 'node:path'
import { SecretStore } from './secrets'

const DEV_URL = process.env.TRM_DEV_URL
let win: BrowserWindow | null = null
let splash: BrowserWindow | null = null
let settings: SettingsStore
let updater: UpdaterService
let servers: ServerManager
let mods: ModManager
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
    const next = settings.update(patch)
    updater?.applySettings()
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
  'servers.delete': (id) => servers.remove(id),
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
  'secrets.set': ({ name, value }) => secrets.set(name, value),
  'secrets.has': (name) => secrets.has(name),
  'secrets.delete': (name) => secrets.delete(name),
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
  settings = new SettingsStore(settingsFile())
  const rolledBackFrom = await runCrashGuard()
  servers = new ServerManager({ dataDir: dataDir(), emit: (e, p) => emit(e, p) })
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
})

app.on('before-quit', (e) => {
  if (quitting) return
  quitting = true
  e.preventDefault()
  // Server sauber stoppen, dann endgültig beenden.
  stopAll().finally(() => app.quit())
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
